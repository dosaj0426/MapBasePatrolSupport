"""로컬 시제품 API. 경로는 역할 구분이며 실제 인증은 별도 도입이 필요하다."""
import io
import os
import asyncio
import json
from uuid import uuid4
from typing import Literal
from contextlib import asynccontextmanager
from datetime import datetime
import httpx
from PIL import Image, UnidentifiedImageError
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, BackgroundTasks, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, ConfigDict, AwareDatetime
from sqlalchemy import select, delete
from .store import Session, init, row, now, Officer, Icon, Place, Patrol, Point, ZoneState, Alert, UPLOADS
from .geo import distance, zone_transition
from .patrol_results import summarize
from tts.common import CACHE as TTS_CACHE, MODEL_ID as TTS_MODEL, SPEAKER as TTS_SPEAKER, audio_key, normalize

@asynccontextmanager
async def lifespan(app):
    init()
    yield

app = FastAPI(title='스마트 순찰 관리 API', version='0.2.0', lifespan=lifespan)
app.mount('/api/uploads/icons', StaticFiles(directory=UPLOADS), name='icons')

class Model(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)

class OfficerInput(Model):
    name: str = Field(min_length=1, max_length=80)

class SpeechInput(Model):
    text: str = Field(min_length=1, max_length=600)

@app.get('/api/tts/status')
def tts_status():
    try:
        response = httpx.get('http://127.0.0.1:8001/health', timeout=2)
        response.raise_for_status()
        return {'available': True, **response.json()}
    except (httpx.HTTPError, ValueError):
        return {'available': False, 'engine': TTS_MODEL, 'speaker': TTS_SPEAKER}

@app.post('/api/tts/synthesize')
def tts_synthesize(data: SpeechInput):
    text = normalize(data.text)
    if not text: raise HTTPException(422, '안내 문구를 입력해 주세요.')
    key = audio_key(text)
    if not (TTS_CACHE / (key + '.wav')).exists():
        try:
            response = httpx.post('http://127.0.0.1:8001/synthesize', json={'text': text}, timeout=300)
            response.raise_for_status()
        except httpx.HTTPError:
            raise HTTPException(503, '로컬 TTS 음성을 생성하지 못했습니다. TTS 서버 실행 상태를 확인해 주세요.')
    if not (TTS_CACHE / (key + '.wav')).exists(): raise HTTPException(503, '생성된 음성 파일이 없습니다.')
    return {'url': f'/api/tts/audio/{key}.wav', 'engine': TTS_MODEL, 'speaker': TTS_SPEAKER}

@app.get('/api/tts/audio/{key}.wav')
def tts_audio(key: str):
    import re
    if not re.fullmatch(r'[a-f0-9]{64}', key): raise HTTPException(404, '음성 파일이 없습니다.')
    path = TTS_CACHE / (key + '.wav')
    if not path.is_file(): raise HTTPException(404, '음성 파일이 없습니다.')
    return FileResponse(path, media_type='audio/wav', headers={'Cache-Control': 'private, max-age=86400'})

class PositionInput(Model):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    source: Literal['gps', 'demo'] = 'demo'
    accuracy: float = Field(default=0, ge=0, le=100000)
    measured_at: AwareDatetime

class HeadingInput(Model):
    heading: float | None = Field(default=None, ge=0, lt=360)
    source: Literal['sensor', 'gps', 'demo', 'unknown']
    measured_at: AwareDatetime

class RoutePoint(PositionInput):
    sequence: int = Field(ge=0)

class PointBatch(Model):
    points: list[RoutePoint] = Field(min_length=1, max_length=500)

class StartInput(Model):
    source: Literal['gps', 'demo']

class EndInput(Model):
    last_sequence: int = Field(ge=0)

class PlaceInput(Model):
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=80)
    address: str = Field(min_length=3, max_length=300)
    postal_code: str = Field(default='', max_length=10, pattern=r'^\d{0,5}$')
    detail: str = Field(default='', max_length=200)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    icon_id: int | None = None
    enhanced: bool = False
    radius: float = Field(default=50, ge=5, le=10000)
    multiplier: float = Field(default=1.5, gt=1, le=10)
    message: str = Field(default='', max_length=500)
    alert_type: Literal['info', 'warning', 'danger', 'emergency'] = 'warning'

def get_or_404(db, model, id):
    obj = db.get(model, id)
    if not obj: raise HTTPException(404, '해당 데이터가 없습니다.')
    return obj

def officer_data(db, item):
    result = row(item)
    result['url'] = f'/user/{item.id}'
    active = db.scalar(select(Patrol).where(Patrol.officer_id == item.id, Patrol.ended_at.is_(None)))
    result['active_patrol_id'] = active.id if active else None
    return result

@app.get('/api/health')
def health(): return {'status': 'ok'}

@app.get('/api/{role}/context')
def context(role: Literal['admin', 'user']):
    return {'role': role, 'label': '관리자' if role == 'admin' else '순찰자', 'access_mode': 'development-path'}

@app.get('/api/officers')
def officers():
    with Session() as db: return [officer_data(db, o) for o in db.scalars(select(Officer).order_by(Officer.id))]

@app.get('/api/live/officers')
async def live_officers(request: Request):
    async def events():
        previous = None
        heartbeat = 0
        while not await request.is_disconnected():
            data = json.dumps(await asyncio.to_thread(officers), ensure_ascii=False)
            if data != previous:
                yield f'data: {data}\n\n'
                previous = data
            elif heartbeat % 15 == 0: yield ': keepalive\n\n'
            heartbeat += 1
            await asyncio.sleep(1)
    return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no'})

@app.post('/api/officers/{officer_id}/heading')
def update_heading(officer_id: int, data: HeadingInput):
    with Session.begin() as db:
        item = get_or_404(db, Officer, officer_id)
        if item.heading_updated_at and data.measured_at <= datetime.fromisoformat(item.heading_updated_at):
            return {'accepted': False}
        item.heading = data.heading
        item.heading_source = data.source
        item.heading_updated_at = data.measured_at.isoformat()
    return {'accepted': True}

@app.post('/api/officers', status_code=201)
def create_officer(data: OfficerInput):
    with Session.begin() as db:
        item = Officer(name=data.name); db.add(item); db.flush()
        return officer_data(db, item)

@app.get('/api/officers/{officer_id}')
def officer(officer_id: int):
    with Session() as db: return officer_data(db, get_or_404(db, Officer, officer_id))

@app.patch('/api/officers/{officer_id}')
def rename_officer(officer_id: int, data: OfficerInput):
    with Session.begin() as db:
        item = get_or_404(db, Officer, officer_id); item.name = data.name
        return officer_data(db, item)

@app.post('/api/officers/{officer_id}/location')
def location(officer_id: int, data: PositionInput):
    with Session.begin() as db:
        item = db.scalar(select(Officer).where(Officer.id == officer_id).with_for_update())
        if not item: raise HTTPException(404, '순찰자가 없습니다.')
        if data.source == 'gps' and data.accuracy > 100: return {'accepted': False, 'reason': 'GPS 정확도가 낮습니다.'}
        if item.updated_at and item.source == data.source == 'gps':
            seconds = (data.measured_at - datetime.fromisoformat(item.updated_at)).total_seconds()
            if seconds <= 0 or (seconds < 60 and distance((item.lat, item.lng), (data.lat, data.lng)) / seconds > 70):
                return {'accepted': False, 'reason': 'GPS 이상치 또는 이전 좌표입니다.'}
        item.lat, item.lng, item.source, item.accuracy, item.updated_at = data.lat, data.lng, data.source, data.accuracy, data.measured_at.isoformat()
        for place in db.scalars(select(Place).where(Place.enhanced.is_(True))):
            state = db.scalar(select(ZoneState).where(ZoneState.officer_id == officer_id, ZoneState.place_id == place.id))
            if not state:
                state = ZoneState(officer_id=officer_id, place_id=place.id, revision=place.revision, armed=True); db.add(state)
            if state.revision != place.revision: state.revision, state.armed = place.revision, True
            state.armed, entered = zone_transition(state.armed, distance((data.lat, data.lng), (place.lat, place.lng)), place.radius, place.multiplier)
            if entered:
                db.add(Alert(officer_id=officer_id, type=place.alert_type, title=f'{place.name} 강화구역 진입', body=('[데모] ' if data.source == 'demo' else '') + (place.message or f'{place.name} 범죄예방 강화구역입니다. 주변을 확인해 주세요.')))
        return {'accepted': True}

@app.get('/api/icons')
def icons(q: str = ''):
    with Session() as db:
        items = db.scalars(select(Icon).where(Icon.name.contains(q, autoescape=True)).order_by(Icon.id.desc()))
        return [{**row(i), 'url': f'/api/uploads/icons/{i.filename}'} for i in items]

@app.post('/api/icons', status_code=201)
async def upload_icon(name: str = Form(min_length=1, max_length=80), file: UploadFile = File()):
    name = name.strip()
    if not name: raise HTTPException(422, '아이콘 이름을 입력해 주세요.')
    content = await file.read(2 * 1024 * 1024 + 1)
    if len(content) > 2 * 1024 * 1024: raise HTTPException(413, '아이콘은 2MB 이하로 업로드해 주세요.')
    try:
        image = Image.open(io.BytesIO(content))
        if image.format not in ['PNG', 'JPEG', 'WEBP'] or image.width * image.height > 16000000: raise ValueError()
        image.load(); image = image.convert('RGBA'); image.thumbnail((128, 128))
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        raise HTTPException(422, 'PNG·JPEG·WebP 이미지 파일만 사용할 수 있습니다.')
    filename = uuid4().hex + '.png'
    image.save(UPLOADS / filename)
    try:
        with Session.begin() as db:
            item = Icon(name=name, filename=filename); db.add(item); db.flush()
            return {**row(item), 'url': f'/api/uploads/icons/{filename}'}
    except Exception:
        (UPLOADS / filename).unlink(missing_ok=True)
        raise

@app.get('/api/places')
def places():
    with Session() as db: return [row(p) for p in db.scalars(select(Place).order_by(Place.id.desc()))]

def save_place(db, data, item=None):
    if data.icon_id is not None: get_or_404(db, Icon, data.icon_id)
    if item is None: item = Place(); db.add(item)
    else: item.revision += 1
    for key, value in data.model_dump().items(): setattr(item, key, value)
    db.flush()
    return row(item)

@app.post('/api/places', status_code=201)
def add_place(data: PlaceInput, background: BackgroundTasks):
    with Session.begin() as db: result = save_place(db, data)
    if data.enhanced: background.add_task(prepare_speech, data)
    return result

@app.put('/api/places/{place_id}')
def edit_place(place_id: int, data: PlaceInput, background: BackgroundTasks):
    with Session.begin() as db: result = save_place(db, data, get_or_404(db, Place, place_id))
    if data.enhanced: background.add_task(prepare_speech, data)
    return result

def prepare_speech(data):
    text = data.message or f'{data.name} 범죄예방 강화구역입니다. 주변을 확인해 주세요.'
    if (TTS_CACHE / (audio_key(text) + '.wav')).exists(): return
    try:
        response = httpx.post('http://127.0.0.1:8001/synthesize', json={'text': text}, timeout=httpx.Timeout(300, connect=1))
        response.raise_for_status()
    except httpx.HTTPError:
        print('강화구역 음성 사전 생성 실패: 관리자 미리듣기에서 재시도하세요.', flush=True)

@app.delete('/api/places/{place_id}')
def delete_place(place_id: int):
    with Session.begin() as db:
        item = get_or_404(db, Place, place_id)
        db.execute(delete(ZoneState).where(ZoneState.place_id == place_id)); db.delete(item)
    return {'deleted': True}

@app.get('/api/geocode')
def geocode(q: str = Query(min_length=3, max_length=300)):
    key, secret = os.getenv('NAVER_MAP_KEY_ID'), os.getenv('NAVER_MAP_KEY_SECRET')
    if not key or not secret or not key.isascii() or not secret.isascii():
        raise HTTPException(503, '네이버 주소 변환 키 설정이 필요합니다. backend/.env에 안내 문구 대신 실제 NAVER_MAP_KEY_ID와 NAVER_MAP_KEY_SECRET을 입력해 주세요.')
    try:
        response = httpx.get('https://maps.apigw.ntruss.com/map-geocode/v2/geocode', params={'query': q}, headers={'x-ncp-apigw-api-key-id': key, 'x-ncp-apigw-api-key': secret}, timeout=10)
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError): raise HTTPException(502, '주소 변환 실패: 네이버 Geocoding 서비스 활성화·인증 정보를 확인해 주세요.')
    return [{'address': x['roadAddress'] or x['jibunAddress'], 'lat': float(x['y']), 'lng': float(x['x']), 'postal_code': next((e['longName'] for e in x.get('addressElements', []) if 'POSTAL_CODE' in e.get('types', [])), '')} for x in result.get('addresses', [])]

def zone_config(place):
    return {key: getattr(place, key) for key in ('id', 'name', 'lat', 'lng', 'radius', 'multiplier')}

def patrol_public(item):
    return {k:v for k,v in row(item).items() if k not in ('zone_snapshot', 'result_json')}

def patrol_points(db, item):
    return [row(p) for p in db.scalars(select(Point).where(Point.patrol_id == item.id).order_by(Point.sequence))]

def patrol_result(db, item):
    zones = json.loads(item.zone_snapshot) if item.zone_snapshot is not None else [zone_config(p) for p in db.scalars(select(Place).where(Place.enhanced.is_(True)))]
    return summarize(patrol_points(db, item), zones, item.started_at, item.ended_at, item.zone_snapshot is None)

@app.post('/api/officers/{officer_id}/patrols', status_code=201)
def start_patrol(officer_id: int, data: StartInput):
    with Session.begin() as db:
        get_or_404(db, Officer, officer_id)
        if db.scalar(select(Patrol).where(Patrol.officer_id == officer_id, Patrol.ended_at.is_(None))): raise HTTPException(409, '진행 중인 순찰이 있습니다. 기록 목록에서 확인해 주세요.')
        zones = [zone_config(p) for p in db.scalars(select(Place).where(Place.enhanced.is_(True)))]
        item = Patrol(officer_id=officer_id, source=data.source, zone_snapshot=json.dumps(zones, ensure_ascii=False)); db.add(item); db.flush(); return row(item)

@app.post('/api/officers/{officer_id}/patrols/{patrol_id}/points')
def save_points(officer_id: int, patrol_id: int, data: PointBatch):
    with Session.begin() as db:
        patrol = db.scalar(select(Patrol).where(Patrol.id == patrol_id).with_for_update())
        if not patrol or patrol.officer_id != officer_id: raise HTTPException(404, '해당 순찰자의 기록이 없습니다.')
        existing = {p.sequence: p for p in db.scalars(select(Point).where(Point.patrol_id == patrol_id))}
        next_sequence = max(existing, default=-1) + 1
        for p in data.points:
            if p.sequence in existing:
                old = existing[p.sequence]
                if old.lat != p.lat or old.lng != p.lng: raise HTTPException(409, '같은 순번에 다른 좌표가 있습니다.')
                continue
            if patrol.ended_at: raise HTTPException(409, '이미 종료된 순찰입니다.')
            if p.sequence != next_sequence: raise HTTPException(409, '좌표 순번이 누락되었습니다.')
            values = p.model_dump(exclude={'accuracy'}); values['measured_at'] = p.measured_at.isoformat()
            point = Point(patrol_id=patrol_id, **values); db.add(point); existing[p.sequence] = point; next_sequence += 1
        return {'last_sequence': next_sequence - 1}

@app.post('/api/officers/{officer_id}/patrols/{patrol_id}/end')
def end_patrol(officer_id: int, patrol_id: int, data: EndInput):
    with Session.begin() as db:
        item = get_or_404(db, Patrol, patrol_id)
        if item.officer_id != officer_id: raise HTTPException(404, '해당 순찰자의 기록이 없습니다.')
        last = db.scalar(select(Point.sequence).where(Point.patrol_id == patrol_id).order_by(Point.sequence.desc()))
        if last != data.last_sequence: raise HTTPException(409, '미전송 좌표가 있습니다. 전송 후 종료해 주세요.')
        if not item.ended_at:
            item.ended_at = now()
            item.result_json = json.dumps(patrol_result(db, item), ensure_ascii=False)
        return {**patrol_public(item), 'result': json.loads(item.result_json) if item.result_json else patrol_result(db, item)}

@app.get('/api/patrols')
def patrols(officer_id: int | None = None):
    with Session() as db:
        query = select(Patrol).order_by(Patrol.id.desc()).limit(200)
        if officer_id is not None: query = query.where(Patrol.officer_id == officer_id)
        return [{**patrol_public(p), 'officer_name': get_or_404(db, Officer, p.officer_id).name} for p in db.scalars(query)]

@app.get('/api/patrols/{patrol_id}')
def patrol_detail(patrol_id: int):
    with Session() as db:
        item = get_or_404(db, Patrol, patrol_id)
        return {**patrol_public(item), 'officer_name': get_or_404(db, Officer, item.officer_id).name, 'points': patrol_points(db, item), 'result': json.loads(item.result_json) if item.result_json else patrol_result(db, item)}

@app.get('/api/officers/{officer_id}/alerts')
def alerts(officer_id: int, after: int = 0):
    with Session() as db:
        get_or_404(db, Officer, officer_id)
        return [row(a) for a in db.scalars(select(Alert).where(Alert.officer_id == officer_id, Alert.id > after).order_by(Alert.id).limit(200))]

@app.post('/api/officers/{officer_id}/alerts/{alert_id}/read')
def read_alert(officer_id: int, alert_id: int):
    with Session.begin() as db:
        item = get_or_404(db, Alert, alert_id)
        if item.officer_id != officer_id: raise HTTPException(404, '알림이 없습니다.')
        item.read = True
        return {'read': True}
