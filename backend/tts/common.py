"""API와 독립 TTS 작업자가 공유하는 음성 파일 식별 규칙."""
import hashlib
import re
from pathlib import Path

MODEL_ID = 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice'
SPEAKER = 'Sohee'
ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/tts'

def normalize(text):
    text = re.sub(r'^\[데모\]\s*', '', text.strip())
    return re.sub(r'\s+', ' ', text)

def audio_key(text):
    return hashlib.sha256(f'{MODEL_ID}|{SPEAKER}|ko|v1|{normalize(text)}'.encode()).hexdigest()
