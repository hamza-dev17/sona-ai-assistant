import io
import sys
from pathlib import Path

import soundfile as sf
import uvicorn
from fastapi import FastAPI, Request, Response

# Try to import Kokoro
try:
    from kokoro_onnx import Kokoro
except ImportError:
    print("\n[ERROR] kokoro-onnx is not installed. Please run: pip install -r requirements.txt")
    sys.exit(1)

app = FastAPI(title="S.O.N.A Local TTS", version="1.0")
kokoro = None

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = PROJECT_ROOT / "models"
MODEL_FILE = MODELS_DIR / "kokoro-v0_19.onnx"
VOICES_FILE = MODELS_DIR / "voices.json"


def load_kokoro():
    if not MODEL_FILE.exists() or not VOICES_FILE.exists():
        raise FileNotFoundError(
            f"Missing required model files in {MODELS_DIR}. "
            f"Expected `{MODEL_FILE.name}` and `{VOICES_FILE.name}`."
        )
    return Kokoro(str(MODEL_FILE), str(VOICES_FILE))


@app.on_event("startup")
def startup_event():
    global kokoro
    print("\n========================================================")
    print("              S.O.N.A // KOKORO TTS NODE                ")
    print("========================================================")
    print("\n[INIT] Loading Kokoro ONNX model... (This might take a moment)")
    try:
        kokoro = load_kokoro()
        print("[INIT] Model successfully loaded into memory.")
    except Exception as exc:
        print(f"[ERROR] Failed to load the model: {exc}")
        raise

# The OpenAI-compatible speech endpoint
@app.post("/v1/audio/speech")
async def generate_speech(request: Request):
    try:
        data = await request.json()
        
        text = data.get("input", "").strip()
        voice_id = data.get("voice", "af_sky")
        
        if not text:
            return Response(status_code=400, content="No input text provided.")

        print(f"\n[TTS] Generating audio for: '{text[:40]}...' [Voice: {voice_id}]")
        
        audio, sample_rate = kokoro.create(text, voice=voice_id, speed=1.0, lang="en-us")

        out_io = io.BytesIO()
        sf.write(out_io, audio, sample_rate, format="wav")
        return Response(content=out_io.getvalue(), media_type="audio/wav")

    except Exception as e:
        print(f"\n[ERROR] Audio generation failed: {str(e)}")
        return Response(status_code=500, content=f"Internal Server Error: {str(e)}")

@app.get("/")
def read_root():
    return {"status": "S.O.N.A Kokoro TTS Node Active", "endpoint": "/v1/audio/speech"}


def main():
    print("\n[SYSTEM] Starting local TTS inference server on http://localhost:8880/v1/audio/speech")
    print("[SYSTEM] Waiting for S.O.N.A connections. Press Ctrl+C to shutdown.\n")
    uvicorn.run(app, host="127.0.0.1", port=8880, log_level="warning")


if __name__ == "__main__":
    main()
