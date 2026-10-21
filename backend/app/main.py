"""로컬 시제품 API. 경로는 역할 구분이며 실제 인증은 별도 도입이 필요하다."""
import io
import csv
from threading import Lock, Thread, Event
from concurrent.futures import ThreadPoolExecutor
import os
import asyncio
import json
from uuid import uuid4
from typing import Literal
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import httpx
from PIL import Image, UnidentifiedImageError
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, BackgroundTasks, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, ConfigDict, AwareDatetime
from sqlalchemy import select, delete
from .store import Session, init, row, now, Officer, Icon, Place, Patrol, Point, ZoneState, Alert, UPLOADS, PlaceImport
from .geo import distance, zone_transition, relative_side, zone_message
from .access import install_access, authenticate, COOKIE
from .patrol_results import summarize
from .place_csv import parse_csv, row_payload
from pydantic import ValidationError
from tts.common import CACHE as TTS_CACHE, MODEL_ID as TTS_MODEL, SPEAKER as TTS_SPEAKER, audio_key, normalize

@asynccontextmanager
async def lifespan(app):
    init()
    stop = Event()
    def warm_existing():
        with Session() as db:
            places = list(db.scalars(select(Place).where(Place.enhanced.is_(True))))
        for place in places:
            if stop.is_set(): break
            prepare_speech(place, stop)
    if LOCAL_TTS_ENABLED: Thread(target=warm_existing, name='zone-voice-cache', daemon=True).start()
    try:
        yield
    finally:
        stop.set()

LOCAL_TTS_ENABLED = os.getenv('PATROL_LOCAL_TTS','0') == '1'
CSV_COMMIT_LOCK = Lock()

app = FastAPI(title='스마트 순찰 관리 API', version='0.2.0', lifespan=lifespan)
install_access(app)
app.mount('/api/uploads/icons', StaticFiles(directory=UPLOADS), name='icons')

class Model(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)

class OfficerInput(Model):
    name: str = Field(min_length=1, max_length=80)

class SpeechInput(Model):
    text: str = Field(min_length=1, max_length=600)

@app.get('/api/tts/status')
def tts_status():
    if not LOCAL_TTS_ENABLED: return {'available': False, 'engine': 'browser-speech-synthesis', 'mode': 'browser'}
    try:
        response = httpx.get('http://127.0.0.1:8001/health', timeout=2)
        response.raise_for_status()
        return {'available': True, **response.json()}
    except (httpx.HTTPError, ValueError):
        return {'available': False, 'engine': TTS_MODEL, 'speaker': TTS_SPEAKER}

@app.post('/api/tts/synthesize')
def tts_synthesize(data: SpeechInput):
    if not LOCAL_TTS_ENABLED: raise HTTPException(503, '데모는 브라우저 기본 TTS를 사용합니다.')
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

class HeadingInput(Model):
    heading: float | None = Field(default=None, ge=0, lt=360)
    source: Literal['sensor', 'gps', 'demo', 'unknown']
    measured_at: AwareDatetime

class PositionInput(Model):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    source: Literal['gps', 'demo'] = 'demo'
    accuracy: float = Field(default=0, ge=0, le=100000)
    measured_at: AwareDatetime
    orientation: HeadingInput | None = None

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

def active_officer(db, officer_id):
    item = get_or_404(db, Officer, officer_id)
    if not item.active: raise HTTPException(404, '제거된 순찰자입니다. 관리자에게 문의해 주세요.')
    return item

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
    with Session() as db: return [officer_data(db, o) for o in db.scalars(select(Officer).where(Officer.active.is_(True)).order_by(Officer.id))]

@app.get('/api/live/officers')
async def live_officers(request: Request):
    async def events():
        previous = None
        heartbeat = 0
        while not await request.is_disconnected():
            if not await asyncio.to_thread(authenticate, request.cookies.get(COOKIE)): return
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
        item = active_officer(db, officer_id)
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
    with Session() as db: return officer_data(db, active_officer(db, officer_id))

@app.patch('/api/officers/{officer_id}')
def rename_officer(officer_id: int, data: OfficerInput):
    with Session.begin() as db:
        item = active_officer(db, officer_id); item.name = data.name
        return officer_data(db, item)

@app.delete('/api/officers/{officer_id}')
def remove_officer(officer_id: int):
    with Session.begin() as db:
        item = db.scalar(select(Officer).where(Officer.id == officer_id).with_for_update())
        if not item: raise HTTPException(404, '순찰자가 없습니다.')
        if db.scalar(select(Patrol.id).where(Patrol.officer_id == officer_id, Patrol.ended_at.is_(None))):
            raise HTTPException(409, '진행 중인 순찰을 먼저 종료해 주세요. 순찰 기록은 보존됩니다.')
        item.active = False
    return {'removed': True, 'history_preserved': True}

@app.post('/api/officers/{officer_id}/location')
def location(officer_id: int, data: PositionInput):
    with Session.begin() as db:
        item = db.scalar(select(Officer).where(Officer.id == officer_id).with_for_update())
        if not item or not item.active: raise HTTPException(404, '순찰자가 없거나 제거되었습니다.')
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
                sample=data.orientation
                # Embedded orientation belongs to this location sample, avoiding queued-position/new-heading races.
                if sample:
                    heading, heading_source, measured = sample.heading,sample.source,sample.measured_at
                else:
                    heading, heading_source = item.heading,item.heading_source
                    measured = datetime.fromisoformat(item.heading_updated_at) if item.heading_updated_at else None
                compatible = heading_source in ('sensor','gps') if data.source=='gps' else heading_source in ('sensor','demo')
                fresh = measured is not None and -1 <= (data.measured_at-measured).total_seconds() <= 10
                minimum=max(3,data.accuracy) if data.source=='gps' else 3
                side=relative_side((data.lat,data.lng),(place.lat,place.lng),heading,minimum) if compatible and fresh else None
                body=('[데모] ' if data.source=='demo' else '')+zone_message(place.name,place.message,side)
                db.add(Alert(officer_id=officer_id, type=place.alert_type, title=f'{place.name} 강화구역 진입', body=body))
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
    if LOCAL_TTS_ENABLED and data.enhanced: background.add_task(prepare_speech, data)
    return result

@app.put('/api/places/{place_id}')
def edit_place(place_id: int, data: PlaceInput, background: BackgroundTasks):
    with Session.begin() as db: result = save_place(db, data, get_or_404(db, Place, place_id))
    if LOCAL_TTS_ENABLED and data.enhanced: background.add_task(prepare_speech, data)
    return result

def prepare_speech(data, stop=None):
    if not LOCAL_TTS_ENABLED: return
    # Cache the exact phrases sent in alerts, including directional introductions.
    for text in dict.fromkeys(zone_message(data.name,data.message,side) for side in ('전방','좌측','우측','후방',None)):
        if stop is not None and stop.is_set(): return
        if (TTS_CACHE / (audio_key(text) + '.wav')).exists(): continue
        for attempt in range(3):
            try:
                response = httpx.post('http://127.0.0.1:8001/synthesize', json={'text': text}, timeout=httpx.Timeout(300, connect=2))
                response.raise_for_status()
                print('강화구역 방향 음성 사전 생성 완료', flush=True)
                break
            except httpx.HTTPError:
                # The speech worker can still be starting when the API starts.
                if attempt == 2:
                    print('강화구역 음성 사전 생성 실패: 다음 서버 시작 또는 지점 저장 시 재시도합니다.', flush=True)
                elif stop is not None:
                    if stop.wait(3): return
                else:
                    import time
                    time.sleep(3)

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

@app.post('/api/places/import/preview')
async def preview_place_csv(file: UploadFile = File(...)):
    if not (file.filename or '').lower().endswith('.csv'): raise HTTPException(422,'CSV 파일을 선택해 주세요.')
    raw = await file.read(1024*1024+1)
    try: rows = parse_csv(raw)
    except (ValueError, csv.Error) as error: raise HTTPException(422,str(error))
    # Geocoding is blocking I/O, so keep it outside the ASGI event loop.
    return await asyncio.to_thread(build_place_preview,rows)

def build_place_preview(rows):
    errors, valid, seen, cache = [], [], set(), {}
    addresses=list(dict.fromkeys(record.get('도로명주소','') for _,record in rows if len(record.get('도로명주소',''))>=3))
    def resolve(address):
        try: return address,geocode(address)
        except HTTPException as error: return address,str(error.detail)
    with ThreadPoolExecutor(max_workers=4) as pool: cache.update(pool.map(resolve,addresses))
    with Session() as db:
        icons=list(db.scalars(select(Icon)))
        existing={(p.name,p.address,p.detail or '') for p in db.scalars(select(Place))}
    for line,record in rows:
        try:
            payload=row_payload(record,icons)
            if len(payload['address'])<3 or not payload['name'] or not payload['category']: raise ValueError('지점명·분류·도로명주소를 모두 입력해 주세요.')
            if payload['address'] not in cache:
                try: cache[payload['address']]=geocode(payload['address'])
                except HTTPException as error: cache[payload['address']]=str(error.detail)
            found=cache[payload['address']]
            if isinstance(found,str): raise ValueError(found)
            if len(found)!=1: raise ValueError('주소 검색 결과가 없거나 여러 개입니다. 건물 번호까지 정확히 입력해 주세요.')
            address=found[0]
            payload.update({'address':address['address'],'lat':address['lat'],'lng':address['lng'],'postal_code':payload['postal_code'] or address.get('postal_code','')})
            data=PlaceInput(**payload)
            identity=(data.name,data.address,data.detail)
            if identity in seen or identity in existing: raise ValueError('이름·주소·상세주소가 같은 지점이 파일 또는 기존 목록에 있습니다.')
            seen.add(identity)
            valid.append({'line':line,'data':data.model_dump()})
        except ValidationError as error:
            errors.append({'line':line,'name':record.get('지점명',''),'message':'; '.join(str(e['loc'][0])+': '+e['msg'] for e in error.errors())})
        except ValueError as error:
            errors.append({'line':line,'name':record.get('지점명',''),'message':str(error)})
    batch=PlaceImport(id=str(uuid4()),expires_at=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(),payload_json=json.dumps(valid,ensure_ascii=False),errors_json=json.dumps(errors,ensure_ascii=False))
    with Session.begin() as db: db.add(batch)
    return {'id':batch.id,'total':len(rows),'rows':valid,'errors':errors,'expires_at':batch.expires_at}

@app.post('/api/places/import/{batch_id}/commit')
def commit_place_csv(batch_id: str, background: BackgroundTasks):
    with CSV_COMMIT_LOCK, Session.begin() as db:
        batch=db.scalar(select(PlaceImport).where(PlaceImport.id==batch_id).with_for_update())
        if not batch: raise HTTPException(404,'업로드 정보를 찾을 수 없습니다. 파일을 다시 검사해 주세요.')
        if batch.committed_json: return json.loads(batch.committed_json)
        if datetime.fromisoformat(batch.expires_at)<=datetime.now(timezone.utc): raise HTTPException(410,'미리보기 유효기간이 지났습니다. 파일을 다시 검사해 주세요.')
        if json.loads(batch.errors_json): raise HTTPException(422,'오류가 있는 CSV는 등록할 수 없습니다. 파일 수정 후 다시 검사해 주세요.')
        rows=json.loads(batch.payload_json)
        existing={(p.name,p.address,p.detail or '') for p in db.scalars(select(Place))}
        for entry in rows:
            data=PlaceInput(**entry['data'])
            if (data.name,data.address,data.detail) in existing: raise HTTPException(409,'미리보기 이후 동일한 지점이 등록되었습니다. 파일을 다시 검사해 주세요.')
            if data.icon_id is not None: get_or_404(db,Icon,data.icon_id)
        ids=[]
        for entry in rows:
            data=PlaceInput(**entry['data'])
            item=save_place(db,data); ids.append(item['id'])
            if LOCAL_TTS_ENABLED and data.enhanced: background.add_task(prepare_speech,data)
        result={'count':len(ids),'ids':ids}
        batch.committed_json=json.dumps(result)
        return result

@app.get('/api/reverse-geocode')
def reverse_geocode(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180)):
    key, secret = os.getenv('NAVER_MAP_KEY_ID'), os.getenv('NAVER_MAP_KEY_SECRET')
    if not key or not secret or not key.isascii() or not secret.isascii():
        raise HTTPException(503, '네이버 주소 변환 키 설정이 필요합니다.')
    try:
        response = httpx.get('https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc',
            params={'coords': f'{lng},{lat}', 'sourcecrs': 'epsg:4326', 'orders': 'roadaddr,addr,legalcode', 'output': 'json'},
            headers={'x-ncp-apigw-api-key-id': key, 'x-ncp-apigw-api-key': secret}, timeout=10)
        response.raise_for_status()
        result = response.json()
    except httpx.HTTPStatusError as error:
        if error.response.status_code in (401,403):
            raise HTTPException(503, '네이버 Maps Application에서 Reverse Geocoding 활성화와 API 키 권한을 확인해 주세요.')
        raise HTTPException(502, '주소 자동 변환 서비스에 연결하지 못했습니다. 주소를 직접 입력해 주세요.')
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, '주소 자동 변환에 실패했습니다. 주소를 직접 입력해 주세요.')
    if result.get('status', {}).get('code', 0) not in (0,):
        raise HTTPException(404, '해당 위치의 주소를 찾지 못했습니다. 주소를 직접 입력해 주세요.')
    items = result.get('results', [])
    item = next((x for kind in ('roadaddr','addr','legalcode') for x in items if x.get('name') == kind), None)
    if not item: raise HTTPException(404, '해당 위치의 주소를 찾지 못했습니다. 주소를 직접 입력해 주세요.')
    region, land = item.get('region', {}), item.get('land', {})
    areas = [region.get(f'area{i}', {}).get('name', '') for i in range(1,5)]
    kind = item.get('name')
    if kind == 'roadaddr':
        parts = areas[:2] + ([areas[2]] if areas[2].endswith(('읍','면')) else []) + [land.get('name', '')]
    else: parts = areas
    number = land.get('number1', '')
    if number:
        number = ('산' if kind == 'addr' and land.get('type') == '2' else '') + number
        if land.get('number2'): number += '-' + land['number2']
        parts.append(number)
    address = ' '.join(p for p in parts if p)
    if not address: raise HTTPException(404, '해당 위치의 주소를 찾지 못했습니다.')
    postal = next((v.get('value','') for k,v in land.items() if k.startswith('addition') and isinstance(v,dict) and v.get('type')=='zipcode'), '')
    return {'lat': lat, 'lng': lng, 'address': address, 'postal_code': postal, 'kind': kind}

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
        active_officer(db, officer_id)
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
            values = p.model_dump(exclude={'accuracy','orientation'}); values['measured_at'] = p.measured_at.isoformat()
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

@app.get('/api/places/{place_id}/inspections')
def place_inspections(place_id: int):
    """Patrol visits are evidence of zone entry, not a manual inspection checklist."""
    with Session() as db:
        get_or_404(db, Place, place_id)
        records = []
        patrols = db.scalars(select(Patrol).where(Patrol.ended_at.is_not(None)).order_by(Patrol.id.desc()).limit(200))
        for patrol in patrols:
            result = json.loads(patrol.result_json) if patrol.result_json else patrol_result(db, patrol)
            zone = next((z for z in result['zones'] if z['id'] == place_id and z['entry_count'] > 0), None)
            if zone:
                records.append({'patrol_id': patrol.id, 'officer_name': get_or_404(db, Officer, patrol.officer_id).name,
                                'started_at': patrol.started_at, 'ended_at': patrol.ended_at, 'source': patrol.source,
                                'entry_count': zone['entry_count'], 'dwell_seconds': zone['dwell_seconds'],
                                'first_entry_at': zone['first_entry_at'], 'last_entry_at': zone['last_entry_at'],
                                'legacy': result['legacy']})
        return records

@app.get('/api/officers/{officer_id}/alerts')
def alerts(officer_id: int, after: int = 0):
    with Session() as db:
        active_officer(db, officer_id)
        return [row(a) for a in db.scalars(select(Alert).where(Alert.officer_id == officer_id, Alert.id > after).order_by(Alert.id).limit(200))]

@app.post('/api/officers/{officer_id}/alerts/{alert_id}/read')
def read_alert(officer_id: int, alert_id: int):
    with Session.begin() as db:
        item = get_or_404(db, Alert, alert_id)
        if item.officer_id != officer_id: raise HTTPException(404, '알림이 없습니다.')
        item.read = True
        return {'read': True}
