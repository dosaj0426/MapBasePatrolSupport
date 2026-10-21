"""두 개발 서버의 로그와 수명을 콘솔 하나에서 관리한다 (Windows)."""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


class Job:
    """콘솔이 강제로 닫혀도 실행한 서버의 하위 프로세스를 함께 정리한다."""
    def __init__(self):
        class Basic(ctypes.Structure):
            _fields_ = [('PerProcessUserTimeLimit', ctypes.c_longlong), ('PerJobUserTimeLimit', ctypes.c_longlong),
                        ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                        ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                        ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_ulonglong) for n in ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]
        class Extended(ctypes.Structure):
            _fields_ = [('BasicLimitInformation', Basic), ('IoInfo', IO), ('ProcessMemoryLimit', ctypes.c_size_t),
                        ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.SetInformationJobObject.restype = wintypes.BOOL
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        info = Extended()
        info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
            self.close()
            raise ctypes.WinError(ctypes.get_last_error())

    def add(self, process):
        if not self.kernel.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle))):
            process.kill()
            process.wait()
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def output(label, stream):
    for line in stream:
        print(f'[{label}] {line.rstrip()}', flush=True)


def launch(job, label, command, cwd):
    env = {**os.environ, 'PYTHONUNBUFFERED': '1', 'PYTHONIOENCODING': 'utf-8', 'NO_COLOR': '1'}
    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
                               creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    job.add(process)
    threading.Thread(target=output, args=(label, process.stdout), daemon=True).start()
    return process


def stop(job, processes):
    for p in processes:
        if p.poll() is None:
            try:
                p.send_signal(signal.CTRL_BREAK_EVENT)
            except OSError:
                pass
    deadline = time.monotonic() + 3
    for p in processes:
        try:
            p.wait(timeout=max(.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            pass
    job.close()
    for p in processes:
        p.wait(timeout=5)


def main():
    python = ROOT / 'backend/.venv/Scripts/python.exe'
    node = shutil.which('node.exe') or str(Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')
    vite = ROOT / 'frontend/node_modules/vite/bin/vite.js'
    tts_python = ROOT / 'backend/.tts-venv/Scripts/python.exe'
    tts_installed = '--local-tts' in sys.argv and (ROOT / 'backend/.tts-venv/Lib/site-packages/qwen_tts/__init__.py').exists()
    os.environ['PATROL_LOCAL_TTS'] = '1' if tts_installed else '0'
    for path in (python, Path(node), vite):
        if not path.is_file():
            raise RuntimeError(f'실행 파일이 없습니다: {path}\nREADME.md의 설치 안내를 확인해 주세요.')
    checked = subprocess.run([str(python), '-c', 'import fastapi, uvicorn, sqlalchemy, httpx, PIL, multipart, dotenv; from app.store import engine'], cwd=ROOT / 'backend')
    if checked.returncode:
        raise RuntimeError('백엔드 의존성 또는 backend/.env의 DATABASE_URL 설정을 확인해 주세요.')
    job = Job()
    processes = []
    try:
        if '--check' in sys.argv:
            print('[확인 완료] 실행 환경과 DB 주소 형식이 정상입니다.')
            return 0
        if '--self-test' in sys.argv:
            for label in ('백엔드 테스트', '프론트 테스트'):
                processes.append(launch(job, label, [str(python), '-u', '-c', 'import time; print("실행 확인", flush=True); time.sleep(30)'], ROOT))
            time.sleep(.5)
            return 0
        for port in ((8000, 5173, 8001) if tts_installed else (8000, 5173)):
            with socket.socket() as sock:
                if sock.connect_ex(('127.0.0.1', port)) == 0:
                    raise RuntimeError(f'{port} 포트에 서버가 이미 실행 중입니다. 기존 서버를 종료한 뒤 다시 실행하세요. 기존 서버는 그대로 유지합니다.')
        print('스마트 순찰 서버를 시작합니다. 종료: Ctrl+C\n관리자: http://127.0.0.1:5173/admin\n순찰자: http://127.0.0.1:5173/user', flush=True)
        processes.append(launch(job, '백엔드', [str(python), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'], ROOT / 'backend'))
        processes.append(launch(job, '프론트', [node, str(vite), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], ROOT / 'frontend'))
        if tts_installed:
            processes.append(launch(job, '음성', [str(tts_python), '-m', 'uvicorn', 'tts.worker:app', '--host', '127.0.0.1', '--port', '8001'], ROOT / 'backend'))
        else:
            print('[음성] 브라우저 기본 한국어 TTS 사용 · 음성 모델 서버는 실행하지 않습니다.', flush=True)
        tunnel_exe = ROOT / '.tools/cloudflared.exe'
        tunnel_config = ROOT / 'cloudflare.yml'
        if (ROOT / '.tools/tunnel-enabled').exists() and tunnel_exe.exists() and tunnel_config.exists() and (ROOT / '.tools/safety-map.json').exists():
            processes.append(launch(job, '터널', [str(tunnel_exe), 'tunnel', '--config', str(tunnel_config), 'run', 'safety-map'], ROOT))
            print('외부 접속: https://safety-map.mcrolcharge.com', flush=True)
        while True:
            for p in processes:
                if p.poll() is not None:
                    raise RuntimeError(f'서버가 종료되었습니다 (코드 {p.returncode}). 위 로그를 확인해 주세요.')
            time.sleep(.25)
    except KeyboardInterrupt:
        print('\n실행한 서버를 모두 종료합니다.', flush=True)
        return 0
    finally:
        stop(job, processes)
        if processes:
            print('[종료 완료] 이 구동기에서 실행한 프로세스를 정리했습니다.', flush=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'[오류] {error}', file=sys.stderr)
        sys.exit(1)
