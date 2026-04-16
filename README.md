# SONA - Personal AI Assistant

## Overview

SONA is a cinematic, voice-enabled personal AI assistant prototype designed to feel like a premium operating interface rather than a basic chatbot demo. It combines an immersive browser-based holographic HUD, a themed terminal boot sequence, real-time voice interaction, and optional local text-to-speech infrastructure to showcase product thinking, UX ambition, and practical AI integration in a single portfolio project.

The project exists as a recruiter-facing demonstration of how software engineering, interaction design, and AI-adjacent systems can be brought together into a polished end-to-end experience.

## Key Features

- Cinematic terminal boot flow with identity verification and themed system prompts
- Browser-based holographic health dashboard with animated telemetry and diagnostics views
- Wake-word-driven voice interaction powered by the browser speech recognition stack
- Dynamic text-to-speech pipeline with configurable ElevenLabs support and local `edge-tts` fallback
- Optional local Kokoro ONNX speech service for self-hosted TTS experimentation
- Multi-panel interface including biometric HUD, analytics dashboard, animated particle systems, and 3D visualizations

## System Architecture

SONA follows a lightweight local architecture:

`User Input -> Terminal Boot / Browser Voice Input -> Processing Layer -> TTS / UI Response -> Visual + Audio Output`

### Breakdown

- `Input`
  - Terminal prompts collect the initial identity and calibration flow
  - Browser microphone input captures spoken commands
  - Manual text input supports typed interactions in the UI
- `Processing`
  - Python launcher serves the frontend and handles the local `/api/tts` endpoint
  - Frontend JavaScript manages wake-word detection, interaction flow, holographic rendering, and state transitions
  - Optional Kokoro service provides a separate local speech generation endpoint
- `Decision`
  - TTS engine selection is based on environment configuration
  - Browser-side logic decides when to listen, speak, animate, or switch panels
- `Output`
  - Spoken assistant responses
  - Animated diagnostics dashboards
  - Real-time console-style and holographic interface feedback

### Model Assets

The Kokoro ONNX model is intentionally kept out of the GitHub repository because the file is larger than GitHub's 100 MB limit. If you want to run the optional local Kokoro service, place the model file in `models/kokoro-v0_19.onnx` on your machine.

## Tech Stack

- Python 3.11+
- FastAPI
- Uvicorn
- `edge-tts`
- `kokoro-onnx`
- `python-dotenv`
- HTML5
- CSS3
- Vanilla JavaScript
- Three.js
- GSAP
- ONNX model assets for local speech synthesis

## Project Structure

```text
sona-ai-assistant/
├── docs/
│   └── architecture.md
├── models/
│   ├── kokoro-v0_19.onnx  # large optional local asset, not committed to GitHub
│   └── voices.json
├── public/
│   ├── analytics.html
│   ├── heart_particles.js
│   ├── index.html
│   ├── particles.js
│   ├── particles.json
│   ├── particles_heart.js
│   ├── patient.jpg
│   ├── script.js
│   └── style.css
├── scripts/
│   ├── generate_particles.py
│   ├── run_kokoro_service.py
│   └── run_sona.py
├── src/
│   └── sona_assistant/
│       ├── __init__.py
│       ├── kokoro_service.py
│       └── main.py
├── .env.example
├── .gitignore
├── README.md
└── requirements.txt
```

## Demo

### Example Experience

1. Launch SONA from the terminal
2. Complete the themed biometric boot flow
3. The local browser HUD opens automatically
4. Click `ENGAGE S.O.N.A. DIAGNOSTICS`
5. Interact by voice or by typing commands into the interface
6. Navigate to the analytics dashboard for the secondary telemetry view

### Screenshots

Add screenshots to a future `docs/screenshots/` folder and reference them here:

- `docs/screenshots/boot-sequence.png`
- `docs/screenshots/main-hud.png`
- `docs/screenshots/analytics-dashboard.png`

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/sona-ai-assistant.git
cd sona-ai-assistant
```

### 2. Create a virtual environment

```bash
python -m venv .venv
```

On Windows:

```bash
.venv\\Scripts\\activate
```

On macOS/Linux:

```bash
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

```bash
copy .env.example .env
```

Set:

- `USE_ELEVENLABS=true` only if you want ElevenLabs as the preferred TTS provider
- `ELEVENLABS_API_KEY=...` if using ElevenLabs

If you want to suppress automatic browser launch during development or tests:

- `SONA_DISABLE_BROWSER=true`

## Usage

### Run the main SONA experience

```bash
python scripts/run_sona.py
```

### Run the optional Kokoro TTS service

```bash
python scripts/run_kokoro_service.py
```

The Kokoro service starts at:

```text
http://127.0.0.1:8880/v1/audio/speech
```

## Notes for Recruiters and Reviewers

- This project is intentionally presentation-heavy: it demonstrates engineering polish, local tooling, AI system integration, and interactive product design in one artifact.
- The repository has been cleaned to avoid committing local secrets, temporary files, and generated debug output.
- The codebase is structured to separate runtime logic, static assets, model assets, and documentation for easier maintenance.

## Future Improvements

- Replace hardcoded demo data with live health or wearable integrations
- Introduce structured intent handling for more deterministic assistant behavior
- Add automated tests around configuration loading and TTS fallback behavior
- Containerize the optional local services for easier onboarding
- Add CI checks for linting, startup validation, and dependency health

## Security

- Do not commit `.env` files or provider API keys
- Keep local model assets and third-party service credentials under explicit developer control
- Review any future telemetry integrations carefully before exposing real user health data

## License

Add a license before public release if you want others to reuse or adapt the project.
