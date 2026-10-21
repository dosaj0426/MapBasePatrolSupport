"""Issue an admin capability locally; never print its bearer token to logs."""
import argparse
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.store import init,Session,AccessGrant,now
from app.access import issue_grant,grant_valid
from sqlalchemy import select
parser=argparse.ArgumentParser()
parser.add_argument('--replace',action='store_true',help='Revoke existing admin links and sessions')
args=parser.parse_args()
init()
with Session.begin() as db:
    old=list(db.scalars(select(AccessGrant).where(AccessGrant.role=='admin')))
    if any(grant_valid(db,g) for g in old) and not args.replace:
        raise SystemExit('An admin link already exists. Use --replace only to revoke and replace it.')
    for grant in old: grant.revoked_at=now()
    grant,url=issue_grant(db,'admin',days=30)
    target=ROOT/'.tools/admin-access-link.txt'
    target.parent.mkdir(exist_ok=True)
    target.write_text('관리자 접속 링크 (공유·Git 업로드 금지)\n'+url+'\n만료: '+grant.expires_at+'\n',encoding='utf-8')
print('Admin access link saved to .tools/admin-access-link.txt')
