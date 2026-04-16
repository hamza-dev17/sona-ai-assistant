# SONA - Personal AI Assistant

## Overview

SONA is a personal AI assistant project that combines voice interaction, a browser-based web interface, and a text-to-speech pipeline. The main idea is simple: you start it from the terminal, the web UI opens locally, and then you can interact with it through voice or text.

For speech output, the project can use ElevenLabs when that is enabled, fall back to `edge-tts`, and optionally use a local ONNX-based Kokoro service if you want to run speech generation locally. I built this project mostly to learn how these parts fit together in one system and to experiment with building a more complete assistant instead of just another chatbot demo.

## What This Project Demonstrates

- Connecting a frontend and backend in one local project
- Handling voice input and voice output
- Using fallback logic so the app still works when one service is unavailable
- Organizing a project with source code, public assets, scripts, and docs
- Working with browser APIs, Python, and local model-based TTS

## Features

- Browser-based dashboard with multiple panels and animated UI elements
- Voice input using the browser speech recognition API
- Typed input support for commands in the web interface
- Local `/api/tts` endpoint for assistant speech output
- ElevenLabs support when an API key is provided
- `edge-tts` fallback when ElevenLabs is disabled or unavailable
- Optional Kokoro ONNX service for local speech synthesis
- Local Python server that serves the UI and handles TTS requests
- Separate analytics page for a second interface view

## System Architecture

SONA follows a simple flow:

`Input -> Processing -> Output`

### Input

The user starts the app from the terminal and interacts with the browser UI using either voice or text.

### Processing

The Python backend serves the frontend and handles TTS requests. The browser side listens for wake words, sends commands, and updates the UI.

### Output

The system responds with spoken audio and visual updates in the web interface.

## Why This Project

I wanted to build something that mixes AI, UI, and basic systems work instead of only making a chatbot. A big part of the project was trying out interaction design, local server setup, and different speech pipelines in one place. It was also a good way to practice structuring a real project in a way that is easier to understand and present.

## Demo

### Example Flow

1. Run the project from the terminal.
2. Complete the startup prompts.
3. The browser interface opens locally.
4. Click the start button in the web UI.
5. Use voice or text to interact with SONA.
6. Open the analytics page to see the secondary dashboard view.

### Screenshots

Add screenshots here later if you want:

- `docs/screenshots/boot-sequence.png`
- `docs/screenshots/main-hud.png`
- `docs/screenshots/analytics-dashboard.png`

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
.venv\Scripts\activate
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

Set these values if needed:

- `USE_ELEVENLABS=true` if you want ElevenLabs to be used first
- `ELEVENLABS_API_KEY=...` if you have an ElevenLabs API key
- `SONA_DISABLE_BROWSER=true` if you do not want the browser to open automatically

If you want to use the optional Kokoro service, place the ONNX model at:

```text
models/kokoro-v0_19.onnx
```

## Usage

### Run the main app

```bash
python scripts/run_sona.py
```

### Run the optional Kokoro service

```bash
python scripts/run_kokoro_service.py
```

The Kokoro service runs at:

```text
http://127.0.0.1:8880/v1/audio/speech
```

## Notes for Recruiters

- This is a local full-stack project, not just a UI mockup.
- It shows how I connected frontend interaction, Python backend logic, and TTS fallback handling.
- The project structure is separated into source code, public assets, scripts, and docs so it is easier to read and maintain.
- The large ONNX model is kept out of GitHub because of file size limits, but the project still documents how to use it locally.

## Future Improvements

- Add tests for the backend routes and configuration loading
- Replace the remaining demo data with real stored user data
- Add a cleaner intent parser for voice commands
- Package the optional TTS service in a more repeatable way
- Add deployment instructions for running the app on another machine

## Security

- Do not commit `.env` files or API keys
- Keep model files and other large local assets out of public history unless you use Git LFS
- Review any future integrations carefully before adding real user data

## License

Add a license if you want other people to reuse or adapt the project.
