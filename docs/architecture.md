# SONA Architecture

SONA is split into two runtime surfaces:

1. `scripts/run_sona.py`
   Launches the cinematic terminal boot sequence, collects user input, starts a temporary local web server, and serves the main browser experience from `public/`.
2. `scripts/run_kokoro_service.py`
   Starts an optional FastAPI-based local TTS node backed by the Kokoro ONNX model in `models/`.

## Runtime Flow

1. User starts SONA from the terminal launcher.
2. The launcher performs the themed boot and biometric-style prompts.
3. A lightweight local HTTP server exposes the static frontend and `/api/tts`.
4. The browser UI handles voice recognition, ambient telemetry, and holographic interface rendering.
5. TTS requests flow through the Python backend:
   - ElevenLabs if enabled in `.env`
   - `edge-tts` as the default local fallback
6. Optional Kokoro service can be run separately for local model-backed speech experiments.
