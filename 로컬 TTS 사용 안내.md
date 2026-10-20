# 로컬 한국어 TTS 사용 안내

## 구성

- 모델: Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice
- 음성: Sohee (한국어)
- 언어: Korean
- API 백엔드: 기존 Python 환경, 8000번
- 모델 작업자: 별도 `backend/.tts-venv`, 8001번, 로컬 접속 전용
- 화면: 관리자의 강화구역 설정에서 안내 문구 입력 후 생성·미리듣기
- 모델 캐시: `backend/models/huggingface`
- 생성 음성: `backend/data/tts/*.wav`

Qwen 공식 모델 및 코드의 Apache-2.0 라이선스를 확인해 사용한다. 사용한 모델·음성·안내 문구로 음성 파일을 식별하여 같은 문구는 재생성하지 않는다. [데모] 접두사는 음성 합성 시 제거한다. 글자 알림에는 그대로 남는다.

## 실행

설치된 환경에서는 기존 `서버 구동기.bat`이 백엔드·프론트·음성 작업자를 콘솔 하나에서 함께 실행한다. 기존 구동기가 이미 실행 중이면 종료 후 새로 실행해야 추가된 작업자가 실행된다. 음성 작업자는 모델을 첫 생성 요청 때 로드하며, 이후 메모리에 유지한다.

개별 실행은 backend 폴더에서:

```powershell
.\.tts-venv\Scripts\python.exe -m uvicorn tts.worker:app --host 127.0.0.1 --port 8001
```

## 설치 재현

Python 3.12, Windows, NVIDIA GTX 1660 환경 기준이다. 기존 `.venv`에는 무거운 모델 라이브러리를 추가하지 않는다.

```powershell
# backend 폴더
.\.venv\Scripts\python.exe -m venv .tts-venv
.\.tts-venv\Scripts\python.exe -m pip install -r requirements-tts.txt
.\.tts-venv\Scripts\python.exe -m pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu126
```

GTX 1660에는 FlashAttention 2를 설치하지 않는다. SDPA를 사용하며, GTX 1660에서는 float16 수치 오류를 피하기 위해 float32로 실행한다. bfloat16을 지원하는 GPU에서는 bfloat16을 선택한다. GPU 사용이 불가능하면 CPU float32로 동작하지만 속도는 별도 확인해야 한다.

## 사용 순서

1. 관리자에서 지점 이름과 주소를 지정한다.
2. 범죄예방 강화구역을 켜고 안내 문구를 입력한다. 비워두면 지점 이름을 포함한 기본 문구를 사용한다.
3. ‘안내 음성 생성 · 미리듣기’를 누른다.
4. 생성 완료 후 오디오 재생 버튼으로 발음·속도·끊김을 확인한다.
5. 지점을 저장한다. 강화구역 저장 시에도 사전 생성을 시도하며 실패해도 지점 데이터 저장은 유지된다.
6. 순찰자 화면의 음성 안내는 기본 ON이다. 브라우저 자동 재생 제한이 있으면 화면을 한 번 터치한다. 구역 진입 알림을 받으면 서버 음성을 재생하며, 사용자가 음성 버튼으로 끌 수 있다.

첫 생성은 모델 다운로드·로딩이 필요하여 오래 걸릴 수 있다. 현장 시연 전 모든 안내 문구를 미리 생성한다. 음성 생성 실패 시 임의로 브라우저 음성으로 바꾸지 않고 실패를 안내하며, 글자 알림은 유지한다. 예전 미확인 알림도 처음 접속할 때 수신할 수 있으므로, 현재 알림 재생 정책은 현장 사용 전 검토해야 한다.

## API

- GET /api/tts/status: 작업자 연결·모델 로드 여부
- POST /api/tts/synthesize: `{"text":"안내 문구"}` → 음성 URL
- GET /api/tts/audio/해시.wav: 생성된 음성 재생

생성 API는 대기 시간이 길 수 있다. 현재 로컬 시제품에는 인증이 없으므로 인터넷에 공개하지 않는다. 운영 시 권한 검사·요청 제한·작업 대기열·생성 실패 상태 표시를 강화해야 한다. 여러 생성 요청은 모델 작업자에서 순차 처리한다.

음성의 자연스러움·지명·숫자·층 수 발음은 실제 안내 문구를 사람이 들어보고 판단해야 한다. 좌우·층 수 자동 조합은 기존 로드맵의 별도 후속 기능이다.

## 공식 자료

- https://github.com/QwenLM/Qwen3-TTS
- https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice
- https://pytorch.org/get-started/previous-versions/

Windows에서 VCOMP140.DLL 누락 오류가 발생하면 Microsoft Visual C++ x64 런타임 설치가 필요하다. 현재 환경은 Microsoft 서명이 확인된 번들 vcomp140.dll을 backend/models/runtime에 두고 TTS 프로세스에서만 로드한다. 시스템 폴더는 수정하지 않았다.

## 현재 PC 검증 결과

- GTX 1660 6GB, RAM 약 32GB, PyTorch 2.7.1 CUDA 12.6.
- 한국어 안내 샘플 8.72초 생성 성공, 모델 합성 시간 32.23초(첫 프로세스 로딩 시간 별도).
- 생성된 파일을 관리자 오디오 컨트롤에서 재생 확인.
- 같은 문구의 캐시 API 응답은 재합성 없이 즉시 반환.
- 샘플: output/tts/부산진경찰서_안내_샘플.wav.
- 이 속도는 해당 문장·현재 PC에서의 측정값이며 다른 문장과 기기의 속도는 달라질 수 있음.
- 현재 PC는 실시간 합성보다 지점 등록 시 사전 생성하는 방식이 적합함.

통합 구동기에서는 모델 캐시 파일 생성에 따른 재시작을 막기 위해 백엔드 자동 reload를 사용하지 않는다. Python 코드를 수정하거나 .env를 바꾸면 구동기를 다시 실행한다. 프론트엔드 Vite의 화면 갱신은 유지한다.
