"""독립 환경에서 실행하는 로컬 TTS. 모델은 한 번 로드하고 WAV를 재사용한다."""
import os
os.environ.setdefault('HF_HOME', str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'models/huggingface'))
os.environ.setdefault('HF_HUB_DISABLE_SYMLINKS_WARNING', '1')
import threading
import time
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from .common import MODEL_ID, SPEAKER, ROOT, CACHE, normalize, audio_key

app = FastAPI(title='Local Korean TTS')
lock = threading.Lock()
model = None

class Request(BaseModel):
    text: str = Field(min_length=1, max_length=600)

@app.get('/health')
def health():
    return {'engine': MODEL_ID, 'speaker': SPEAKER, 'loaded': model is not None}

def synthesize(text):
    global model
    text = normalize(text)
    if not text: raise ValueError('안내 문구를 입력해 주세요.')
    CACHE.mkdir(parents=True, exist_ok=True)
    key = audio_key(text)
    target = CACHE / (key + '.wav')
    if target.exists(): return {'key': key, 'cached': True}
    with lock:
        if target.exists(): return {'key': key, 'cached': True}
        # Windows의 torchaudio가 요구하는 Microsoft OpenMP 런타임.
        runtime = ROOT / 'models/runtime/vcomp140.dll'
        if os.name == 'nt' and runtime.exists():
            import ctypes
            runtime_handle = ctypes.WinDLL(str(runtime))
        import torch
        import soundfile as sf
        from qwen_tts import Qwen3TTSModel
        if model is None:
            device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
            print(f'TTS 모델 로드: {MODEL_ID}, 장치 {device}', flush=True)
            precision = torch.bfloat16 if device.startswith('cuda') and torch.cuda.is_bf16_supported() else torch.float32
            model = Qwen3TTSModel.from_pretrained(MODEL_ID, device_map=device,
                dtype=precision,
                attn_implementation='sdpa')
        started = time.monotonic()
        with torch.inference_mode():
            wavs, rate = model.generate_custom_voice(text=text, language='Korean', speaker=SPEAKER,
                max_new_tokens=2048)
        temporary = target.with_suffix('.tmp.wav')
        sf.write(str(temporary), wavs[0], rate, subtype='PCM_16')
        temporary.replace(target)
        seconds = round(time.monotonic() - started, 2)
        print(f'TTS 생성 완료: {seconds}초', flush=True)
        return {'key': key, 'cached': False, 'generation_seconds': seconds}

@app.post('/synthesize')
def generate(data: Request):
    try: return synthesize(data.text)
    except Exception as e:
        print(f'TTS 생성 실패: {type(e).__name__}: {e}', flush=True)
        raise HTTPException(503, '로컬 TTS 생성에 실패했습니다. TTS 서버 로그를 확인해 주세요.') from e

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample', action='store_true')
    args = parser.parse_args()
    if args.sample:
        print(synthesize('부산진경찰서 범죄예방 강화구역입니다. 주변을 확인해 주세요.'))
