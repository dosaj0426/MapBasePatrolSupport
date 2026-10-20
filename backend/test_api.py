import os
import tempfile
import unittest
import io
from pathlib import Path
from datetime import datetime, timezone
from PIL import Image

test_root = Path(__file__).resolve().parent
temporary = tempfile.TemporaryDirectory(prefix='test-db-', dir=test_root)
assert Path(temporary.name).resolve().parent == test_root
os.environ['PATROL_DATA_DIR'] = temporary.name
os.environ['DATABASE_URL'] = 'sqlite:///' + temporary.name.replace('\\', '/') + '/test.db'
from app.main import app
from app.store import engine
from app.geo import zone_transition
from fastapi.testclient import TestClient

class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from unittest.mock import patch
        cls.speech_patch = patch('app.main.prepare_speech')
        cls.speech_patch.start()
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()
    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        engine.dispose()
        cls.speech_patch.stop()

    def test_patrol_results_snapshot_and_finalization(self):
        from app.store import Session, Place
        from datetime import timedelta
        c = self.client
        officer = c.post('/api/officers', json={'name':'결과 집계 테스트'}).json()
        with Session.begin() as db:
            zone = Place(name='집계 구역', category='테스트', address='테스트 주소', lat=35, lng=129, enhanced=True, radius=50, multiplier=1.5)
            db.add(zone); db.flush(); zone_id = zone.id
        patrol = c.post(f"/api/officers/{officer['id']}/patrols", json={'source':'demo'}).json()
        base = datetime.now(timezone.utc)-timedelta(seconds=30)
        # inside -> buffer (does not rearm) -> inside -> outside -> inside
        lats = [35,35.00055,35,35.001,35]
        points = [{'sequence':i,'lat':lat,'lng':129,'source':'demo','measured_at':(base+timedelta(seconds=i*5)).isoformat()} for i,lat in enumerate(lats)]
        url = f"/api/officers/{officer['id']}/patrols/{patrol['id']}"
        self.assertEqual(c.post(url+'/points', json={'points':points}).status_code,200)
        with Session.begin() as db:
            zone = db.get(Place,zone_id); zone.name='변경된 이름'; zone.radius=5
        detail = c.get(f"/api/patrols/{patrol['id']}").json()
        result = next(z for z in detail['result']['zones'] if z['id']==zone_id)
        self.assertEqual(result['name'],'집계 구역')
        self.assertEqual(result['entry_count'],2)
        self.assertGreaterEqual(result['dwell_seconds'],10)
        ended = c.post(url+'/end', json={'last_sequence':4}).json()
        self.assertIsNotNone(ended['ended_at'])
        saved = c.get(f"/api/patrols/{patrol['id']}").json()
        self.assertEqual(ended['result'],saved['result'])
        self.assertEqual(c.post(url+'/end',json={'last_sequence':4}).json()['result'],saved['result'])
        with Session.begin() as db: db.delete(db.get(Place,zone_id))

    def test_heading_update_is_independent_and_validated(self):
        from datetime import timedelta
        c = self.client
        officer = c.post('/api/officers', json={'name':'방향 테스트'}).json()
        before_patrols = len(c.get('/api/patrols').json())
        measured = datetime.now(timezone.utc)
        payload = {'heading': 90, 'source':'sensor', 'measured_at':measured.isoformat()}
        self.assertTrue(c.post(f"/api/officers/{officer['id']}/heading", json=payload).json()['accepted'])
        saved = c.get(f"/api/officers/{officer['id']}").json()
        self.assertEqual(saved['heading'],90)
        self.assertEqual(saved['heading_source'],'sensor')
        self.assertIsNone(saved['lat'])
        self.assertIsNone(saved['updated_at'])
        self.assertEqual(len(c.get('/api/patrols').json()), before_patrols)
        self.assertEqual(c.get(f"/api/officers/{officer['id']}/alerts").json(), [])
        old = {**payload,'heading':180,'measured_at':(measured-timedelta(seconds=1)).isoformat()}
        self.assertFalse(c.post(f"/api/officers/{officer['id']}/heading", json=old).json()['accepted'])
        for heading in [-1,360]:
            self.assertEqual(c.post(f"/api/officers/{officer['id']}/heading", json={**payload,'heading':heading}).status_code,422)
        clear = {**payload,'heading':None,'source':'unknown','measured_at':(measured+timedelta(seconds=1)).isoformat()}
        self.assertEqual(c.post(f"/api/officers/{officer['id']}/heading", json=clear).status_code,200)
        self.assertIsNone(c.get(f"/api/officers/{officer['id']}").json()['heading'])

    def test_default_icons_seed_is_idempotent(self):
        from app.store import init
        from PIL import Image
        import io
        def defaults():
            return {x['filename']: x for x in self.client.get('/api/icons').json() if x['filename'].startswith('default-')}
        before = defaults()
        self.assertEqual(len(before), 5)
        init(); init()
        after = defaults()
        self.assertEqual({k:v['id'] for k,v in before.items()}, {k:v['id'] for k,v in after.items()})
        for item in after.values():
            response = self.client.get(item['url'])
            self.assertEqual(response.status_code, 200)
            image = Image.open(io.BytesIO(response.content))
            self.assertEqual(image.size, (128,128))
            self.assertEqual(image.mode, 'RGBA')
            self.assertEqual(image.getpixel((0,0))[3], 0)

    def test_tts_cache_and_file_validation(self):
        from unittest.mock import patch
        from tts.common import audio_key
        import wave
        cache = Path(temporary.name) / 'tts'
        cache.mkdir(exist_ok=True)
        text = '테스트 강화구역입니다.'
        def create_audio(*args, **kwargs):
            with wave.open(str(cache / (audio_key(text) + '.wav')), 'wb') as audio:
                audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(24000)
                audio.writeframes(b'\x00\x00' * 2400)
            class Response:
                def raise_for_status(self): pass
            return Response()
        with patch('app.main.TTS_CACHE', cache), patch('app.main.httpx.post', side_effect=create_audio) as generate:
            first = self.client.post('/api/tts/synthesize', json={'text': text})
            self.assertEqual(first.status_code, 200)
            second = self.client.post('/api/tts/synthesize', json={'text': '[데모] ' + text})
            self.assertEqual(first.json()['url'], second.json()['url'])
            self.assertEqual(generate.call_count, 1)
            audio = self.client.get(first.json()['url'])
            self.assertEqual(audio.status_code, 200)
            self.assertTrue(audio.content.startswith(b'RIFF'))
            self.assertEqual(self.client.get('/api/tts/audio/invalid.wav').status_code, 404)
            self.assertEqual(self.client.post('/api/tts/synthesize', json={'text': '   '}).status_code, 422)

    def test_officer_icon_place_and_alert_hysteresis(self):
        c = self.client
        officer = c.post('/api/officers', json={'name': '테스트 순찰자'}).json()
        self.assertEqual(officer['url'], f'/user/{officer["id"]}')
        icon_bytes = io.BytesIO(); Image.new('RGBA', (16,16), '#087c69').save(icon_bytes, format='PNG')
        icon = c.post('/api/icons', data={'name': '테스트 아이콘'}, files={'file': ('test.png', icon_bytes.getvalue(), 'image/png')})
        self.assertEqual(icon.status_code, 201)
        self.assertEqual(c.get('/api/icons?q=테스트').status_code, 200)
        self.assertEqual(c.post('/api/icons', data={'name':'bad'}, files={'file':('bad.png', b'<script>', 'image/png')}).status_code, 422)
        place = {'name':'테스트 구역','category':'테스트','address':'부산진구 부전로111번길 6','lat':35.1602002,'lng':129.054338,'icon_id':icon.json()['id'],'enhanced':True,'radius':50,'multiplier':1.5,'message':'테스트 안내','alert_type':'danger'}
        result = c.post('/api/places', json=place); self.assertEqual(result.status_code, 201)
        def update(lat):
            return c.post(f'/api/officers/{officer["id"]}/location',json={'lat':lat,'lng':place['lng'],'source':'demo','measured_at':datetime.now(timezone.utc).isoformat()})
        update(place['lat'])
        update(place['lat']+.0005) # 내부 50m 밖, 외곽 75m 안
        update(place['lat'])
        self.assertEqual(len(c.get(f'/api/officers/{officer["id"]}/alerts').json()),1)
        update(place['lat']+.001)
        update(place['lat'])
        alerts=c.get(f'/api/officers/{officer["id"]}/alerts').json()
        self.assertEqual(len(alerts),2)
        self.assertEqual(c.post(f'/api/officers/{officer["id"]}/alerts/{alerts[0]["id"]}/read').json(),{'read':True})
        c.delete('/api/places/'+str(result.json()['id']))

    def test_route_order_duplicate_and_owner(self):
        c=self.client
        a=c.post('/api/officers',json={'name':'경로 테스트'}).json()['id']
        b=c.post('/api/officers',json={'name':'다른 순찰자'}).json()['id']
        p=c.post(f'/api/officers/{a}/patrols',json={'source':'demo'}).json()['id']
        self.assertEqual(c.post(f'/api/officers/{a}/patrols',json={'source':'demo'}).status_code,409)
        point={'lat':35.16,'lng':129.05,'source':'demo','measured_at':datetime.now(timezone.utc).isoformat(),'sequence':0}
        url=f'/api/officers/{a}/patrols/{p}/points'
        self.assertEqual(c.post(url,json={'points':[dict(point,sequence=1)]}).status_code,409)
        for _ in range(2): self.assertEqual(c.post(url,json={'points':[point]}).status_code,200)
        self.assertEqual(c.post(f'/api/officers/{b}/patrols/{p}/points',json={'points':[point]}).status_code,404)
        self.assertEqual(len(c.get(f'/api/patrols/{p}').json()['points']),1)
        self.assertEqual(c.post(f'/api/officers/{a}/patrols/{p}/end',json={'last_sequence':1}).status_code,409)
        self.assertEqual(c.post(f'/api/officers/{a}/patrols/{p}/end',json={'last_sequence':0}).status_code,200)
        self.assertEqual(c.post(url,json={'points':[dict(point,sequence=1)]}).status_code,409)

    def test_zone_boundaries(self):
        self.assertEqual(zone_transition(True,50,50,1.5),(False,True))
        self.assertEqual(zone_transition(False,75,50,1.5),(False,False))
        self.assertEqual(zone_transition(False,76,50,1.5),(True,False))

if __name__ == '__main__': unittest.main()
