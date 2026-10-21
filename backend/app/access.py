"""Capability links exchange their bearer secret for a revocable browser session."""
import asyncio
import hashlib
import os
import re
import secrets
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from .store import Session, AccessGrant, AccessSession, Officer, Patrol, now

COOKIE = 'patrol_session'
BASE_URL = os.getenv('PUBLIC_BASE_URL', 'https://safety-map.mcrolcharge.com').rstrip('/')
attempts = {}

def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def timestamp(value): return datetime.fromisoformat(value)
def utcnow(): return datetime.now(timezone.utc)

def grant_valid(db, grant):
    if not grant or grant.revoked_at or timestamp(grant.expires_at) <= utcnow(): return False
    if grant.role == 'user':
        officer = db.get(Officer, grant.officer_id)
        if not officer or not officer.active: return False
    return True

def issue_grant(db, role, officer_id=None, days=30):
    token = secrets.token_urlsafe(32)
    grant = AccessGrant(token_hash=digest(token), role=role, officer_id=officer_id,
                        expires_at=(utcnow()+timedelta(days=days)).isoformat())
    db.add(grant); db.flush()
    return grant, f'{BASE_URL}/access#{token}'

def authenticate(token):
    if not token: return None
    with Session() as db:
        session = db.scalar(select(AccessSession).where(AccessSession.token_hash==digest(token)))
        if not session or timestamp(session.expires_at)<=utcnow(): return None
        grant = db.get(AccessGrant,session.grant_id)
        if not grant_valid(db,grant): return None
        return {'role':grant.role,'officer_id':grant.officer_id,'expires_at':session.expires_at,'grant_id':grant.id}

def user_allowed(identity, path, method):
    if path in ('/api/session','/api/access/logout'): return True
    if method=='GET' and (path in ('/api/places','/api/icons') or path.startswith('/api/uploads/icons/') or path.startswith('/api/tts/audio/')): return True
    if path=='/api/tts/synthesize' and method=='POST': return True
    match = re.fullmatch(r'/api/officers/(\d+)(?:/(.*))?',path)
    if match:
        if int(match[1]) != identity['officer_id']: return False
        tail = match[2] or ''
        return (method=='GET' and (tail=='' or tail=='alerts')) or (method=='POST' and (tail in ('heading','location','patrols') or re.fullmatch(r'patrols/\d+/(points|end)|alerts/\d+/read',tail)))
    match = re.fullmatch(r'/api/patrols/(\d+)',path)
    if match and method=='GET':
        with Session() as db:
            patrol = db.get(Patrol,int(match[1]))
            return bool(patrol and patrol.officer_id==identity['officer_id'])
    return False

async def guard(request, call_next):
    path = request.url.path
    if not path.startswith('/api/'):
        return await call_next(request)
    if request.method not in ('GET','HEAD','OPTIONS'):
        origin = request.headers.get('origin')
        allowed = {BASE_URL,'http://127.0.0.1:5173','http://localhost:5173','http://testserver'}
        if (origin and origin not in allowed) or request.headers.get('sec-fetch-site')=='cross-site':
            return JSONResponse({'detail':'허용되지 않은 요청 출처입니다.'},status_code=403)
    if path not in ('/api/health','/api/access/exchange'):
        identity = await asyncio.to_thread(authenticate,request.cookies.get(COOKIE))
        if not identity: return JSONResponse({'detail':'접속 권한이 없거나 만료되었습니다. 발급받은 비밀 링크로 다시 접속해 주세요.'},status_code=401,headers={'Cache-Control':'no-store'})
        if identity['role']!='admin' and not user_allowed(identity,path,request.method):
            return JSONResponse({'detail':'이 기능에 대한 권한이 없습니다.'},status_code=403)
        request.state.identity = identity
    response = await call_next(request)
    response.headers['Cache-Control']='no-store'
    response.headers['Referrer-Policy']='no-referrer'
    return response

class ExchangeInput(BaseModel):
    token: str = Field(min_length=40,max_length=100,pattern=r'^[A-Za-z0-9_-]+$')
class GrantInput(BaseModel):
    days: int = Field(default=30,ge=1,le=365)

def install_access(app):
    app.middleware('http')(guard)

    @app.post('/api/access/exchange')
    def exchange(data: ExchangeInput, request: Request, response: Response):
        ip = request.client.host if request.client else 'unknown'
        current = time.monotonic()
        if len(attempts)>1024: attempts.clear()
        recent = attempts.setdefault(ip,deque())
        while recent and recent[0]<current-60: recent.popleft()
        if len(recent)>=20: raise HTTPException(429,'접속 시도가 많습니다. 1분 후 다시 시도해 주세요.')
        recent.append(current)
        with Session.begin() as db:
            grant = db.scalar(select(AccessGrant).where(AccessGrant.token_hash==digest(data.token)))
            if not grant_valid(db,grant): raise HTTPException(401,'링크가 잘못되었거나 만료·폐기되었습니다. 관리자에게 새 링크를 요청해 주세요.')
            token = secrets.token_urlsafe(32)
            expiry = min(timestamp(grant.expires_at),utcnow()+timedelta(hours=12))
            # Switching links replaces this browser's prior session.
            old = request.cookies.get(COOKIE)
            if old:
                previous = db.scalar(select(AccessSession).where(AccessSession.token_hash==digest(old)))
                if previous: db.delete(previous)
            db.add(AccessSession(token_hash=digest(token),grant_id=grant.id,expires_at=expiry.isoformat()))
            secure = request.url.hostname not in ('127.0.0.1','localhost','testserver')
            response.set_cookie(COOKIE,token,httponly=True,secure=secure,samesite='strict',path='/',max_age=max(1,int((expiry-utcnow()).total_seconds())))
            return {'role':grant.role,'officer_id':grant.officer_id,'expires_at':expiry.isoformat()}

    @app.get('/api/session')
    def session(request: Request):
        return {k:v for k,v in request.state.identity.items() if k!='grant_id'}

    @app.post('/api/access/logout')
    def logout(request: Request,response: Response):
        with Session.begin() as db:
            item=db.scalar(select(AccessSession).where(AccessSession.token_hash==digest(request.cookies.get(COOKIE,''))))
            if item: db.delete(item)
        response.delete_cookie(COOKIE,path='/')
        return {'ok':True}

    @app.get('/api/officers/{officer_id}/access-links')
    def grants(officer_id: int):
        with Session() as db:
            return [{'id':g.id,'expires_at':g.expires_at,'created_at':g.created_at,'active':grant_valid(db,g)} for g in db.scalars(select(AccessGrant).where(AccessGrant.officer_id==officer_id).order_by(AccessGrant.id.desc()))]

    @app.post('/api/officers/{officer_id}/access-links',status_code=201)
    def issue(officer_id: int,data: GrantInput):
        with Session.begin() as db:
            officer=db.get(Officer,officer_id)
            if not officer or not officer.active: raise HTTPException(404,'사용할 수 없는 순찰자입니다.')
            for old in db.scalars(select(AccessGrant).where(AccessGrant.officer_id==officer_id,AccessGrant.revoked_at.is_(None))): old.revoked_at=now()
            grant,url=issue_grant(db,'user',officer_id,data.days)
            return {'id':grant.id,'url':url,'expires_at':grant.expires_at}

    @app.delete('/api/officers/{officer_id}/access-links')
    def revoke(officer_id: int):
        with Session.begin() as db:
            for grant in db.scalars(select(AccessGrant).where(AccessGrant.officer_id==officer_id,AccessGrant.revoked_at.is_(None))): grant.revoked_at=now()
        return {'revoked':True}
