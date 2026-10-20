# Cloudflare 터널 연결

대상: https://safety-map.mcrolcharge.com

- 전용 터널: safety-map
- 라우팅: cloudflare.yml → http://127.0.0.1:5173
- /api 요청은 Vite가 내부 8000번 백엔드로 전달한다.
- DNS CNAME과 Vite 허용 호스트 설정은 완료했다.
- 기존 다른 서비스의 터널은 변경하지 않았다.
- 실행 파일과 터널 비밀 인증 파일은 .tools/에 있으며 버전 관리에서 제외한다.

## 현재 활성화 상태

2026-10-20 사용자가 현재 인증 없는 상태의 외부 공개를 명시적으로 승인하여 터널을 실행했다. .tools/tunnel-enabled 파일이 있으며 이후 서버 구동기에서도 터널을 함께 실행한다.

현재 앱에는 로그인·권한 검사가 없다. 공개 주소를 가진 사람은 관리자 기능과 순찰 위치·기록에 접근할 수 있다. 비공개로 전환하려면 전용 safety-map 터널 프로세스를 종료하고 .tools/tunnel-enabled 파일을 제거한다. 다른 서비스의 터널은 종료하지 않는다.

## 지도 설정

외부 주소에서 네이버 지도가 인증되려면 네이버 Maps Application의 Web 서비스 URL에도 https://safety-map.mcrolcharge.com 을 등록해야 한다. 현재 localhost 설정만으로 해당 외부 도메인의 지도 표시가 보장되지는 않는다.

외부 접속은 터널·프론트엔드·백엔드가 실행 중인 동안 제공된다. PC를 끄거나 서버를 종료하면 접속할 수 없다.

공식 설정 안내: https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/
