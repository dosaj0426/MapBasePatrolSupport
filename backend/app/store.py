import os
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
DATA = Path(os.getenv('PATROL_DATA_DIR') or ROOT / 'data')
DATA.mkdir(parents=True, exist_ok=True)
UPLOADS = DATA / 'icons'
UPLOADS.mkdir(exist_ok=True)
DATABASE_URL = os.getenv('DATABASE_URL') or f'sqlite:///{(DATA / "patrol.db").as_posix()}'
engine = create_engine(DATABASE_URL, connect_args={'check_same_thread': False, 'timeout': 20} if DATABASE_URL.startswith('sqlite') else {}, pool_pre_ping=True)
Session = sessionmaker(engine, expire_on_commit=False)
Base = declarative_base()
def now(): return datetime.now(timezone.utc).isoformat()

class Officer(Base):
    __tablename__ = 'officers'
    id = Column(Integer, primary_key=True)
    name = Column(String(80), nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default='1')
    lat = Column(Float)
    lng = Column(Float)
    source = Column(String(10))
    accuracy = Column(Float)
    updated_at = Column(String(40))
    heading = Column(Float)
    heading_source = Column(String(20))
    heading_updated_at = Column(String(40))

class Icon(Base):
    __tablename__ = 'icons'
    id = Column(Integer, primary_key=True)
    name = Column(String(80), nullable=False)
    filename = Column(String(80), nullable=False)

class Place(Base):
    __tablename__ = 'places'
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    category = Column(String(80), nullable=False)
    address = Column(String(300), nullable=False)
    postal_code = Column(String(10), default='')
    detail = Column(String(200), default='')
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    icon_id = Column(Integer, ForeignKey('icons.id'), nullable=True)
    enhanced = Column(Boolean, default=False)
    radius = Column(Float, default=50)
    multiplier = Column(Float, default=1.5)
    message = Column(Text, default='')
    alert_type = Column(String(20), default='warning')
    revision = Column(Integer, default=1)

class Patrol(Base):
    __tablename__ = 'patrols'
    id = Column(Integer, primary_key=True)
    officer_id = Column(Integer, ForeignKey('officers.id'), nullable=False)
    started_at = Column(String(40), default=now)
    ended_at = Column(String(40))
    source = Column(String(10), nullable=False)
    zone_snapshot = Column(Text)
    result_json = Column(Text)

class Point(Base):
    __tablename__ = 'points'
    id = Column(Integer, primary_key=True)
    patrol_id = Column(Integer, ForeignKey('patrols.id'), nullable=False)
    sequence = Column(Integer, nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    measured_at = Column(String(40), nullable=False)
    source = Column(String(10), nullable=False)
    __table_args__ = (UniqueConstraint('patrol_id', 'sequence'),)

class ZoneState(Base):
    __tablename__ = 'zone_states'
    id = Column(Integer, primary_key=True)
    officer_id = Column(Integer, ForeignKey('officers.id'), nullable=False)
    place_id = Column(Integer, ForeignKey('places.id'), nullable=False)
    revision = Column(Integer, default=1)
    armed = Column(Boolean, default=True)
    __table_args__ = (UniqueConstraint('officer_id', 'place_id'),)

class Alert(Base):
    __tablename__ = 'alerts'
    id = Column(Integer, primary_key=True)
    officer_id = Column(Integer, ForeignKey('officers.id'), nullable=False)
    type = Column(String(20), nullable=False)
    title = Column(String(150), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(String(40), default=now)
    read = Column(Boolean, default=False)

class PlaceImport(Base):
    __tablename__ = 'place_imports'
    id = Column(String(40), primary_key=True)
    expires_at = Column(String(40), nullable=False)
    payload_json = Column(Text, nullable=False)
    errors_json = Column(Text, nullable=False)
    committed_json = Column(Text)

class AccessGrant(Base):
    __tablename__ = 'access_grants'
    id = Column(Integer, primary_key=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    role = Column(String(10), nullable=False)
    officer_id = Column(Integer, ForeignKey('officers.id'))
    created_at = Column(String(40), default=now)
    expires_at = Column(String(40), nullable=False)
    revoked_at = Column(String(40))

class AccessSession(Base):
    __tablename__ = 'access_sessions'
    id = Column(Integer, primary_key=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    grant_id = Column(Integer, ForeignKey('access_grants.id'), nullable=False)
    expires_at = Column(String(40), nullable=False)

def row(obj): return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
def init():
    Base.metadata.create_all(engine)
    from sqlalchemy import inspect, text
    columns = {c['name'] for c in inspect(engine).get_columns('officers')}
    with engine.begin() as connection:
        for name, kind in [('active', 'BOOLEAN NOT NULL DEFAULT 1'), ('heading', 'FLOAT'), ('heading_source', 'VARCHAR(20)'), ('heading_updated_at', 'VARCHAR(40)')]:
            if name not in columns: connection.execute(text(f'ALTER TABLE officers ADD COLUMN {name} {kind}'))
    patrol_columns = {c['name'] for c in inspect(engine).get_columns('patrols')}
    with engine.begin() as connection:
        for name in ('zone_snapshot', 'result_json'):
            if name not in patrol_columns: connection.execute(text(f'ALTER TABLE patrols ADD COLUMN {name} TEXT'))
    seed_default_icons()
    migrate_place_categories()

def migrate_place_categories():
    """Preserve existing category labels and images; never rewrite saved patrol results."""
    from sqlalchemy import select
    from .geo import ZONE_BUFFER_M
    with Session.begin() as db:
        icons=list(db.scalars(select(Icon).order_by(Icon.id)))
        by_name={}
        for icon in icons: by_name.setdefault(icon.name,icon)
        for place in db.scalars(select(Place)):
            category=by_name.get(place.category)
            if category is None:
                previous=db.get(Icon,place.icon_id) if place.icon_id else None
                category=Icon(name=place.category,filename=previous.filename if previous else 'default-prevention-zone.png')
                db.add(category);db.flush();by_name[category.name]=category
            place.icon_id=category.id
            # Legacy multiplier is retained only as a compatibility representation.
            multiplier=(place.radius+ZONE_BUFFER_M)/place.radius
            if abs(place.multiplier-multiplier)>1e-9:
                place.multiplier=multiplier

def seed_default_icons():
    """새 DB에도 기본 아이콘 제공. 파일명으로 확인해 재실행 시 중복 방지."""
    import json
    import shutil
    from sqlalchemy import select
    assets = ROOT / 'assets/default-icons'
    items = json.loads((assets / 'manifest.json').read_text(encoding='utf8'))
    with Session.begin() as db:
        for item in items:
            target = UPLOADS / item['filename']
            if not target.exists(): shutil.copyfile(assets / item['source'], target)
            if db.scalar(select(Icon).where((Icon.filename == item['filename']) | (Icon.name == item['name']))) is None:
                db.add(Icon(name=item['name'], filename=item['filename']))
