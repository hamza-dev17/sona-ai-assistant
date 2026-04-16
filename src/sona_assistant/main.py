import asyncio
import http.server
import json
import os
import random
import socketserver
import sys
import tempfile
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from urllib.error import HTTPError

try:
    import edge_tts
except ImportError:
    edge_tts = None

try:
    from dotenv import dotenv_values, load_dotenv
except ImportError:
    dotenv_values = None
    load_dotenv = None


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = PROJECT_ROOT / "public"
ENV_PATH = PROJECT_ROOT / ".env"


def load_environment():
    """Load optional local configuration from the repository root."""
    if not ENV_PATH.exists() or load_dotenv is None or dotenv_values is None:
        return

    print(f"\033[2m[BOOT] Loading configuration from {ENV_PATH}...\033[0m")
    try:
        load_dotenv(dotenv_path=ENV_PATH, override=True)
    except Exception as exc:
        print(f"\033[91m[ERROR] Failed to load .env: {exc}\033[0m")
        return

    for key, value in dotenv_values(ENV_PATH).items():
        if key and value is not None and not os.environ.get(key):
            os.environ[key] = value


load_environment()

# ═══════════════════════════════════════════════════════════════
#  S.O.N.A  —  ANSI TERMINAL RENDERING ENGINE
# ═══════════════════════════════════════════════════════════════

# ANSI Escape Codes
CYAN    = '\033[96m'
GREEN   = '\033[92m'
RED     = '\033[91m'
YELLOW  = '\033[93m'
WHITE   = '\033[97m'
MAGENTA = '\033[95m'
BLUE    = '\033[94m'
RESET   = '\033[0m'
DIM     = '\033[2m'
BOLD    = '\033[1m'

# ── Icon Presets ──────────────────────────────────────────────
ICON_MAP = {
    '+':  f'{CYAN}+{RESET}',
    '✓':  f'{GREEN}✓{RESET}',
    '!':  f'{RED}!{RESET}',
    '~':  f'{CYAN}~{RESET}',
    '✗':  f'{RED}✗{RESET}',
    '⚡': f'{YELLOW}⚡{RESET}',
    '◈':  f'{MAGENTA}◈{RESET}',
}

# ── Level Color Map ───────────────────────────────────────────
LEVEL_COLORS = {
    'INIT':      CYAN,
    'OK':        GREEN,
    'WARN':      YELLOW,
    'CRITICAL':  RED,
    'DENIED':    RED,
    'PROCESS':   CYAN,
    'SYNC':      BLUE,
    'CALIBRATE': MAGENTA,
    'EXEC':      CYAN,
    'SECURE':    GREEN,
    'LINK':      BLUE,
    'SCAN':      CYAN,
    'MEM':       MAGENTA,
}

def _hex_addr():
    """Generate a random pseudo-memory address."""
    return f"0x{random.randint(0x1000, 0xFFFF):04X}"

def _timestamp():
    """High-precision timestamp matching the web UI format."""
    return time.strftime("%H:%M:%S.") + f"{int(time.time() * 1000 % 1000):03d}"

def slow_print(text, delay=0.018, color=WHITE):
    """Typewriter effect for cinematic narrative lines."""
    for char in text:
        sys.stdout.write(f"{color}{char}{RESET}")
        sys.stdout.flush()
        time.sleep(delay)
    print()

def medical_log(icon: str, level: str, message: str, delay: float = 0.5, source: str = None):
    """
    Enhanced medical-grade terminal log.
    Outputs: [TIMESTAMP] [ICON LEVEL] [SOURCE?] message
    """
    ts = _timestamp()
    
    # Resolve icon glyph
    icon_str = ICON_MAP.get(icon, f'{WHITE}{icon}{RESET}')
    
    # Resolve level color
    lv_color = LEVEL_COLORS.get(level, WHITE)
    level_tag = f"{lv_color}{icon_str} {lv_color}{level:<8}{RESET}"
    
    # Source tag (optional)
    src_tag = ""
    if source:
        src_tag = f"{DIM}@{source:<6}{RESET} "
    
    print(f"{DIM}[{ts}]{RESET} [{level_tag}] {src_tag}{message}")
    time.sleep(delay)

def clinical_input(prompt: str) -> str:
    """Styled input prompt for patient interaction."""
    print(f"\n{CYAN}{BOLD}>> {prompt}{RESET}")
    return input(f"{GREEN}SONA_SYS>{RESET} ").strip()

def masked_input(prompt: str) -> str:
    """Password-style input that displays ● for each character typed."""
    print(f"\n{CYAN}{BOLD}>> {prompt}{RESET}")
    sys.stdout.write(f"{GREEN}SONA_SYS>{RESET} ")
    sys.stdout.flush()
    
    # Try to use msvcrt on Windows for real-time masking
    try:
        import msvcrt
        chars = []
        while True:
            ch = msvcrt.getwch()
            if ch in ('\r', '\n'):  # Enter key
                print()  # newline
                break
            elif ch == '\x08':  # Backspace
                if chars:
                    chars.pop()
                    sys.stdout.write('\b \b')
                    sys.stdout.flush()
            elif ch == '\x03':  # Ctrl+C
                raise KeyboardInterrupt
            else:
                chars.append(ch)
                sys.stdout.write(f'{YELLOW}●{RESET}')
                sys.stdout.flush()
        return ''.join(chars).strip()
    except ImportError:
        # Fallback for non-Windows
        return input(f"").strip()

def hex_scramble(lines: int = 3, width: int = 48):
    """Rapid hex scramble animation to simulate decryption."""
    for _ in range(lines):
        hex_line = ''.join(f'{random.randint(0, 255):02X} ' for _ in range(width // 3))
        print(f"  {DIM}{YELLOW}{hex_line}{RESET}", end='\r')
        sys.stdout.flush()
        time.sleep(0.15)
    # Clear the last scramble line
    print(' ' * width, end='\r')

def _section_bar(title: str, char='─', width=64, color=CYAN):
    """Renders a titled section separator bar."""
    bar = char * width
    print(f"\n{color}{bar}{RESET}")
    print(f"{color}{BOLD}  {title}{RESET}")
    print(f"{color}{bar}{RESET}")

def _status_block(lines: list, width=64):
    """Renders a bordered status summary block."""
    border = f"{DIM}{'─' * width}{RESET}"
    print(f"\n{border}")
    for line in lines:
        print(f"  {line}")
    print(border)

# ═══════════════════════════════════════════════════════════════
#  BOOT DIAGNOSTIC SEQUENCE
# ═══════════════════════════════════════════════════════════════

def boot_diagnostic():
    
    # ── Splash Header ─────────────────────────────────────────
    print()
    print(f"{CYAN}{BOLD}{'═' * 64}{RESET}")
    print(f"{CYAN}{BOLD}       ███████╗ ██████╗ ███╗   ██╗ █████╗ {RESET}")
    print(f"{CYAN}{BOLD}       ██╔════╝██╔═══██╗████╗  ██║██╔══██╗{RESET}")
    print(f"{CYAN}{BOLD}       ███████╗██║   ██║██╔██╗ ██║███████║{RESET}")
    print(f"{CYAN}{BOLD}       ╚════██║██║   ██║██║╚██╗██║██╔══██║{RESET}")
    print(f"{CYAN}{BOLD}       ███████║╚██████╔╝██║ ╚████║██║  ██║{RESET}")
    print(f"{CYAN}{BOLD}       ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝{RESET}")
    print(f"{DIM}       PERSONAL BIOMETRIC AI  //  V.2.0  //  NEURAL BUILD{RESET}")
    print(f"{CYAN}{BOLD}{'═' * 64}{RESET}")
    print()
    time.sleep(0.8)
    
    # ── Phase 1: System Bootstrap ─────────────────────────────
    medical_log("+", "INIT", f"Bootstrapping biometric sensors...     {DIM}[{_hex_addr()}]{RESET}", 0.4, "CORE")
    medical_log("+", "INIT", f"Establishing neural bridge...           {DIM}[{_hex_addr()}]{RESET}", 0.3, "LINK")
    
    # Check for TTS Engine
    elevenlabs_key = os.environ.get('ELEVENLABS_API_KEY', '')
    if elevenlabs_key:
        medical_log("✓", "OK", f"ElevenLabs Neural TTS engaged {DIM}[Voice: Rachel // xi-api]{RESET}", 0.2, "VOICE")
        if edge_tts:
            medical_log("✓", "OK", f"edge-tts available as fallback {DIM}[Voice: en-US-JennyNeural]{RESET}", 0.15, "VOICE")
    elif edge_tts:
        medical_log("✓", "OK", f"edge-tts Neural TTS engaged {DIM}[Voice: en-US-JennyNeural]{RESET}", 0.2, "VOICE")
    else:
        medical_log("!", "WARN", "No TTS engine available - fallback to browser voice.", 0.2, "VOICE")
        
    medical_log("+", "INIT", f"Calibrating SpO2 and HR arrays...      {DIM}[{_hex_addr()}]{RESET}", 0.4, "BIOS")
    medical_log("+", "INIT", f"Loading cognitive language model...     {DIM}[{_hex_addr()}]{RESET}", 0.3, "AI")
    medical_log("✓", "OK",   "All subsystems nominal.", 0.3, "CORE")
    print()
    
    # ── Phase 2: Biometric Verification ───────────────────────
    _section_bar("⬡  SYSTEM LOCK  //  BIOMETRIC VERIFICATION REQUIRED", '─', 64, RED)
    
    patient_name = clinical_input("ENTER PATIENT IDENTITY ANCHOR:")
    
    auth_success = False
    for attempt in range(3):
        attempt_num = attempt + 1
        patient_id = masked_input(f"ENTER MEDICAL ENCRYPTION KEY {DIM}(HINT: A-77-VX){RESET}  {RED}[ATTEMPT {attempt_num}/3]{RESET}")
        
        # Hex scramble animation during "decryption"
        hex_scramble(lines=4, width=52)
        medical_log("~", "PROCESS", f"Decrypting biometric signature... {DIM}[{_hex_addr()}]{RESET}", 0.8, "CRYPT")
        
        if patient_id.strip().upper() == "A-77-VX":
            medical_log("✓", "OK", f"BIOMETRIC MATCH CONFIRMED. WELCOME, {BOLD}{patient_name.upper()}{RESET}.", 0.6, "AUTH")
            auth_success = True
            break
        else:
            attempts_left = 2 - attempt
            if attempts_left > 0:
                medical_log("!", "DENIED", f"INVALID SIGNATURE. RE-ALIGN SENSORS. {RED}{attempts_left} ATTEMPTS REMAINING.{RESET}", 1.2, "AUTH")
            else:
                medical_log("✗", "CRITICAL", "MAXIMUM ATTEMPTS REACHED. INITIATING SECURITY LOCKDOWN.", 1.5, "AUTH")
                
    if not auth_success:
        print(f"\n{RED}{BOLD}[SYSTEM PURGE] UNAUTHORIZED ACCESS ATTEMPT BYPASSED TO NEURAL QUARANTINE.{RESET}")
        slow_print("TERMINATING S.O.N.A CONNECTION...", delay=0.04, color=RED)
        sys.exit(1)
        
    print()

    # ── Phase 3: Sensor Calibration ───────────────────────────
    medical_log("~", "SYNC", f"Mapping physiological baseline...       {DIM}[{_hex_addr()}]{RESET}", 0.4, "DATA")
    medical_log("~", "SYNC", f"Warming up systemic scanner...          {DIM}[{_hex_addr()}]{RESET}", 0.5, "SCAN")
    
    bpm_override = clinical_input("CALIBRATION REQUIRED: ENTER EXPECTED RESTING HEART RATE (BPM):")
    try:
        bpm_val = int(bpm_override)
        medical_log("~", "CALIBRATE", f"Setting baseline HR engine to {BOLD}{bpm_val} BPM{RESET}.  {DIM}[{_hex_addr()}]{RESET}", 0.6, "BIOS")
    except ValueError:
        medical_log("!", "WARN", "Invalid integer. Defaulting baseline HR engine to 72 BPM.", 0.8, "BIOS")
    
    medical_log("✓", "SECURE", f"SENSORS LOCKED & ENCRYPTED.             {DIM}[{_hex_addr()}]{RESET}", 0.5, "CORE")
    print()

    # ── Phase 4: Cinematic Tension ────────────────────────────
    medical_log("⚡", "WARN", "Detecting slight cortisol elevation in frontal cortex...", 1.2, "NEURO")
    medical_log("⚡", "WARN", "Adrenaline levels fluctuating.", 1.0, "NEURO")
    resolve = clinical_input("EMERGENCY OVERRIDE: AUTHORIZE NEURO-STABILIZATION? (Y/N):")
    medical_log("~", "EXEC", f"Processing protocol [{resolve.upper()}] - Dispensing digital placebo...", 1.5, "EXEC")
    medical_log("✓", "OK", "Cognitive alignment restored. Vitals stable.", 0.8, "NEURO")
    print()
    
    # ── Phase 5: Final Status ─────────────────────────────────
    _status_block([
        f"{BOLD}PATIENT:{RESET}      {GREEN}{patient_name.upper()}{RESET}",
        f"{BOLD}STATUS:{RESET}       {CYAN}VITALS SECURED  //  AWAITING HOLOGRAPHIC PROJECTION{RESET}",
        f"{BOLD}AI ENGINE:{RESET}    {GREEN}S.O.N.A ONLINE{RESET}  {DIM}[PID: {os.getpid()}]{RESET}",
        f"{BOLD}ENCRYPTION:{RESET}   {MAGENTA}AES-256-GCM  //  BIOMETRIC HASH VERIFIED{RESET}",
    ])
    print()
    
    slow_print("▸ LAUNCHING MEDICAL HUD...", delay=0.03, color=CYAN)
    time.sleep(0.8)
    
    launch_web_server(patient_name)

# ═══════════════════════════════════════════════════════════════
#  WEB SERVER & TTS PIPELINE
# ═══════════════════════════════════════════════════════════════

_tts_disconnect_count = 0

def launch_web_server(patient_name):
    """Hosts an ephemeral local server to bypass browser restrictions."""
    global _tts_disconnect_count
    interface_dir = str(PUBLIC_DIR)

    if not PUBLIC_DIR.exists():
        raise FileNotFoundError(f"Frontend assets not found: {PUBLIC_DIR}")
    
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=interface_dir, **kwargs)
            
        def log_message(self, format, *args):
            pass

        def do_GET(self):
            try:
                return super().do_GET()
            except ConnectionAbortedError:
                pass  # Client disconnected mid-transfer — harmless
            except Exception:
                pass

        def do_POST(self):
            global _tts_disconnect_count
            if self.path == '/api/tts':
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                try:
                    data = json.loads(post_data)
                    text = data.get('text', '')
                    if not text:
                        self.send_response(400)
                        self.end_headers()
                        return

                    audio_data = None

                    # ── TTS ENGINE SELECTION (Toggle via .env) ───
                    use_eleven = os.environ.get('USE_ELEVENLABS', 'false').lower() == 'true'
                    elevenlabs_key = os.environ.get('ELEVENLABS_API_KEY', '').strip()
                    print(f"{DIM}[{_timestamp()}]{RESET} [{CYAN}DEBUG    {RESET}] TTS Request: use_eleven={use_eleven}, key_exists={bool(elevenlabs_key)}")

                    if use_eleven and elevenlabs_key:
                        try:
                            import urllib.request as req
                            from urllib.error import HTTPError
                            # Voice ID for "Rachel" — warm, natural female
                            voice_id = "21m00Tcm4TlvDq8ikWAM"
                            url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
                            payload = json.dumps({
                                "text": text,
                                "model_id": "eleven_multilingual_v2",
                                "voice_settings": {
                                    "stability": 0.75,
                                    "similarity_boost": 0.85
                                }
                            }).encode('utf-8')
                            headers = {
                                "Accept": "audio/mpeg",
                                "Content-Type": "application/json",
                                "xi-api-key": elevenlabs_key
                            }
                            api_req = req.Request(url, data=payload, headers=headers, method='POST')
                            try:
                                with req.urlopen(api_req, timeout=10) as resp:
                                    audio_data = resp.read()
                            except HTTPError as e:
                                error_body = e.read().decode('utf-8')
                                print(f"{DIM}[{_timestamp()}]{RESET} [{RED}! ERROR   {RESET}] ElevenLabs HTTP {e.code}: {error_body}")
                                audio_data = None
                        except Exception as e:
                            print(f"{DIM}[{_timestamp()}]{RESET} [{RED}! ERROR   {RESET}] ElevenLabs pipeline critical error: {e}")
                            import traceback
                            traceback.print_exc()
                            audio_data = None
                    elif elevenlabs_key and not use_eleven:
                        print(f"{DIM}[{_timestamp()}]{RESET} [{YELLOW}SKIP     {RESET}] ElevenLabs disabled via .env.")

                    # ── FALLBACK: edge-tts ────────────────────────
                    if audio_data is None:
                        if not edge_tts:
                            self.send_response(503)
                            self.end_headers()
                            return

                        print(f"{DIM}[{_timestamp()}]{RESET} [{CYAN}PROCESS  {RESET}] Synthesizing with edge-tts...")
                        VOICE = "en-US-JennyNeural"
                        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
                            tmp_path = tmp.name

                        async def synthesize():
                            communicate = edge_tts.Communicate(text, VOICE)
                            await communicate.save(tmp_path)

                        asyncio.run(synthesize())

                        with open(tmp_path, 'rb') as f:
                            audio_data = f.read()
                        os.unlink(tmp_path)
                        print(f"{DIM}[{_timestamp()}]{RESET} [{GREEN}✓ OK      {RESET}] edge-tts synthesis complete ({len(audio_data)} bytes).")

                    self.send_response(200)
                    self.send_header('Content-Type', 'audio/mpeg')
                    self.end_headers()
                    try:
                        self.wfile.write(audio_data)
                    except ConnectionAbortedError:
                        _tts_disconnect_count += 1
                        # Suppress spam — only show every 5th disconnect
                        if _tts_disconnect_count <= 1 or _tts_disconnect_count % 5 == 0:
                            print(f"{DIM}[{_timestamp()}]{RESET} [{YELLOW}⚡ TTS     {RESET}] {DIM}Neural audio stream interrupted (x{_tts_disconnect_count}){RESET}")
                    except Exception as e:
                        print(f"{DIM}[{_timestamp()}]{RESET} [{RED}! ERROR   {RESET}] TTS pipeline: {e}")

                except Exception as e:
                    print(f"{DIM}[{_timestamp()}]{RESET} [{RED}! ERROR   {RESET}] TTS synthesis failed: {e}")
                    self.send_response(500)
                    self.end_headers()
            else:
                self.send_response(404)
                self.end_headers()

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", 0), Handler)
    port = httpd.server_address[1]

    def serve():
        httpd.serve_forever()

    server_thread = threading.Thread(target=serve, daemon=True)
    server_thread.start()
    
    import urllib.parse
    safe_name = urllib.parse.quote(patient_name)
    if os.environ.get("SONA_DISABLE_BROWSER", "").lower() != "true":
        webbrowser.open(f"http://localhost:{port}/?name={safe_name}")
    
    print()
    print(f"{GREEN}{BOLD}[S.O.N.A]{RESET} Medical Hologram actively projecting on {CYAN}{BOLD}http://localhost:{port}{RESET}")
    print(f"{DIM}          Press Ctrl+C to terminate the life-support server.{RESET}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print(f"\n\n{YELLOW}[WARN]{RESET} Local server manually aborted. {DIM}Wiping bio-logs...{RESET}")
        httpd.shutdown()
        sys.exit(0)


def main():
    try:
        boot_diagnostic()
    except KeyboardInterrupt:
        print(f"\n\n{YELLOW}[WARN]{RESET} Boot aborted by user. {DIM}Wiping logs...{RESET}")
        sys.exit(1)


if __name__ == "__main__":
    main()
