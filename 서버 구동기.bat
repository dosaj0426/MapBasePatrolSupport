@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
    echo [오류] 백엔드 Python 환경이 없습니다. README.md의 설치 안내를 확인하세요.
    pause
    exit /b 1
)
"backend\.venv\Scripts\python.exe" "scripts\run_servers.py" %*
if errorlevel 1 (
    if /i not "%~1"=="--check" if /i not "%~1"=="--self-test" pause
    exit /b 1
)
exit /b 0