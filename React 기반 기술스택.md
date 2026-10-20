# 스마트 순찰 지원 시스템 - 간단한 기술 스택

## 1. 핵심 기술

**React + Python + FastAPI + Uvicorn**을 필수 구성으로 사용한다.

| 기술 | 역할 |
| --- | --- |
| React | 지도, 버튼, 알림, 관리자·순찰자 화면 구성 |
| Python | 위치 계산, 순찰 기록 처리, 검색·분석 로직 |
| FastAPI | 프론트엔드 요청 처리, 입력 검증, API 제공 |
| Uvicorn | FastAPI 애플리케이션 실행 |

## 2. 화면과 데이터 저장에 필요한 구성

| 구분 | 선택 | 역할 |
| --- | --- | --- |
| 화면 작성 | JavaScript + JSX | React 컴포넌트 작성 |
| 디자인 | 일반 CSS | 색상, 크기, 배치, 반응형 화면 |
| 지도 | NAVER Maps JavaScript API | 현재 위치, 시설, 강화구역, 경로 표시 |
| 데이터베이스 | MySQL | 회원, 구역, 순찰·점검 기록 저장 |
| 개발 도구 | Vite + npm | React 개발 서버와 배포용 빌드 |
| DB 접근 | SQLAlchemy + PyMySQL | Python에서 MySQL 조회·저장 |
| 입력 검증 | Pydantic | FastAPI 요청·응답 형식 정의 |

초기에는 TypeScript를 제외하고 JavaScript로 작성해 학습할 기술을 줄인다. TypeScript는 필요할 때 도입할 수 있다.

Vite와 npm 사용을 위해 개발 환경에 Node.js가 필요하지만 백엔드는 Python이다. 완성된 React 빌드 파일은 웹 서버에서 제공하고 브라우저에서 실행한다.

## 3. 단순하게 사용하는 방법

- 화면 상태: React 기본 useState·useContext.
- API 요청: 브라우저 기본 fetch.
- 디자인: 일반 CSS 파일.
- GPS: 브라우저 Geolocation API.
- 원·사각형 구역 판정: 직접 작성한 JavaScript·Python 함수.
- 초기 DB 변경: SQL 스크립트로 기록하고, 변경이 늘어나면 Alembic 검토.

TanStack Query, Turf.js, 별도 UI 프레임워크는 초기 구성에서 제외한다. JavaScript와 Python의 좌표·거리·경계 판정 규칙은 동일한 테스트 데이터로 확인한다.

동기 DB 접근은 FastAPI의 일반 def 경로 함수 또는 적절한 스레드 실행으로 처리한다. async def에서 동기 DB 호출을 직접 실행해 이벤트 루프를 막지 않도록 한다. 조회·저장은 매개변수 바인딩과 트랜잭션을 사용한다.

## 4. 데이터 흐름

```text
브라우저: React 화면 + CSS + 네이버 지도 + GPS
                  ↓ fetch 요청
          Uvicorn → FastAPI
                  ↓
             Python 로직
                  ↓
                MySQL
```

React는 화면을, FastAPI는 요청을, Python은 처리 로직을, MySQL은 저장을 담당한다. Uvicorn은 FastAPI 앱을 실행한다.

## 5. 먼저 구현할 기능

1. 시제품은 `/admin`·`/user`로 관리자·순찰자 화면에 진입한다. 계정 로그인과 서버 권한 검사는 후속 단계로 둔다.
2. 네이버 지도, 위험구역·시설 표시.
3. 순찰 시작·종료와 GPS 경로 기록.
4. 강화구역 진입 횟수, 외곽 범위를 이용한 중복 진입 방지, GPS 이상치 처리.
5. 체류시간 기반 점검 확인과 순찰 결과 조회.

체류시간 충족만으로 점검 완료를 확정하지 않고 사용자 확인 후 기록한다. 서버에서 순찰 소유권과 권한을 검사하고 최종 집계를 확정한다. 좌표 순번으로 중복 전송을 막고 집계 상태는 DB에 저장한다.

## 6. 계획서 기능을 구현할 때 추가

기술 구성을 줄인 것이며 계획서의 기능 요구사항을 삭제한 것은 아니다. 다음은 후속 개발에 필요한 구성이다.

| 기능 | 추가 기술·서비스 |
| --- | --- |
| Google 로그인 | Google OAuth/OIDC 연동 라이브러리, Authlib 후보 |
| CSV·Excel 등록 | Python csv 표준 라이브러리, openpyxl, python-multipart |
| AI·지역 추천 | JEV API, HTTPX |
| RAG 검색 | 문서 추출, 임베딩 모델, 벡터 저장소; Chroma 후보 |
| 음성 질의·안내 | 브라우저 녹음, 서버 STT/TTS; 공급자 미정 |
| 간단한 음성 안내 시제품 | 브라우저 SpeechSynthesis |
| 분석 그래프 | 차트 라이브러리 1개; Recharts 후보 |
| AWS 배포 | EC2 제안, RDS for MySQL, S3, boto3 |
| 이용 통계 | Google Analytics; 민감한 위치·신고·질의 내용 제외 |

JEV API 명세, 임베딩·음성 공급자, 벡터 저장소는 별도 확정한다. 네이버 지도는 Application·Web 서비스 URL 등록과 실제 계정의 사용 한도·요금 확인이 필요하다.

## 7. 폴더 구조

```text
patrol-system/
  frontend/
    src/
      App.jsx
      pages/
      components/
      api.js
      styles.css
  backend/
    app/
      main.py
      routers/
      schemas.py
      models.py
      database.py
      services/
    requirements.txt
  database/
    schema.sql
  tests/
```

## 8. 유지할 구현 기준

- HTTPS, 위치·마이크 권한과 오류 처리를 적용한다.
- 비밀번호는 안전한 해시로 저장하고 세션·역할 검사를 서버에서 수행한다.
- DB 접속 정보와 서버 비밀키는 환경변수로 관리한다.
- 위치·진입 판정과 권한·집계 로직은 테스트하고 GPS·음성은 실제 기기로 검증한다.
- 계획서의 PFR-01~03 성능 목표와 시험 조건을 유지한다.

## 9. 근거

- 팀프로젝트 계획서의 PDF 9페이지 구성도에 Python·FastAPI·Uvicorn·MySQL이 명시되어 있다.
- React와 네이버 지도는 사용자 요청을 반영했다. 보조 라이브러리는 간소화를 위한 제안이다.
- 계획서의 회원·Google 로그인은 기본 구현 범위다. 경찰서 시제품용 Capability URL은 별도 선택지다.
- 계획서 상세 요구사항과 추진일정의 ID가 달라 상세 요구사항 표를 기준으로 구현한다.
- 개발 환경 구현: 루트 `README.md` 참고. 현재 `/admin`·`/user` 화면과 FastAPI 연결이 구현되어 있다. 이 경로만으로는 실제 인증·권한 제한을 제공하지 않으며, 비밀 토큰 기반 Capability URL은 별도 확장 사항이다.

공식 참고: [React](https://react.dev/learn/build-a-react-app-from-scratch), [FastAPI](https://fastapi.tiangolo.com/), [Uvicorn 실행 안내](https://fastapi.tiangolo.com/deployment/manually/), [SQLAlchemy MySQL](https://docs.sqlalchemy.org/en/20/dialects/mysql.html), [NAVER Maps](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html).
