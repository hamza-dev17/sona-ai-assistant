document.addEventListener("DOMContentLoaded", () => {
    // ---- INITIALIZATION & OVERLAY ----
    const startOverlay = document.getElementById("start-overlay");
    const startBtn = document.getElementById("start-btn");

    const urlParams = new URLSearchParams(window.location.search);
    const patientName = urlParams.get('name') || "UNKNOWN PATIENT";
    document.getElementById("patient-name-display").innerText = patientName.toUpperCase();

    // Fix HW Sync link to carry over patient name — intercept click for a spoken handoff
    const hwSyncLink = document.querySelector(".hw-sync");
    if (hwSyncLink) {
        if (patientName !== "UNKNOWN PATIENT") {
            hwSyncLink.href = `analytics.html?name=${encodeURIComponent(patientName)}`;
        }
        hwSyncLink.addEventListener('click', (e) => {
            e.preventDefault();
            const target = hwSyncLink.href;
            // Stop whatever S.O.N.A is currently saying before switching
            if (typeof stopSona === 'function') stopSona();
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            // Speak handoff line then navigate
            if (typeof speakSona === 'function') {
                speakSona(`Switching to hardware dashboard.`, () => {
                    window.location.href = target;
                });
            } else {
                window.location.href = target;
            }
        });
    }

    // Initialize System directly on load
    // setTimeout(() => {
    //     startOverlay.style.opacity = "0";
    //     setTimeout(() => {
    //         startOverlay.style.display = "none";
    //         initSystem();
    //     }, 600);
    // }, 1000); // 1-sec wait for black-screen drama before Sona boots

    const skipIntro = urlParams.get('skip_intro') === 'true';

    // NEW: Wait for user to explicitly engage S.O.N.A Diagnostics
    startBtn.addEventListener("click", () => {
        startOverlay.style.opacity = "0";
        // Stop boot greeting before sliding overlay away
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        setTimeout(() => {
            startOverlay.style.display = "none";
            initSystem();
        }, 600);
    });

    // ---- JARVIS-STYLE BOOT GREETING (fires when the start screen appears) ----
    // Uses the browser's native TTS since ElevenLabs requires a user gesture first
    // Helper: speak boot greeting exactly once
    function speakBootGreeting() {
        if (window._bootGreetingDone) return;
        window._bootGreetingDone = true;
        if (!('speechSynthesis' in window)) return;
        const voices = window.speechSynthesis.getVoices();
        const greet = new SpeechSynthesisUtterance(`S.O.N.A. online. I've got you.`);
        const preferred =
            voices.find(v => v.name.includes('Online') && v.lang.includes('en') && v.name.toLowerCase().includes('female')) ||
            voices.find(v => v.name.includes('Google UK English Female')) ||
            voices.find(v => v.lang === 'en-US');
        if (preferred) greet.voice = preferred;
        greet.pitch = 0.9;
        greet.rate = 0.95;
        window.speechSynthesis.speak(greet);
    }

    window.addEventListener('load', speakBootGreeting);

    // Re-run after voices load if they weren't ready at page load
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = () => {
            // Only fire if the overlay is still visible (user hasn't unlocked yet)
            if (startOverlay && startOverlay.style.display !== 'none') {
                speakBootGreeting();
            }
        };
    }


    // S.O.N.A INTERACTIVE AI LOGIC
    const consoleLog = document.getElementById("console-log");
    const transcriptBox = document.getElementById("transcript-box");
    const manualChatInput = document.getElementById("manual-chat-input");
    const micBtn = document.getElementById("mic-btn");
    const voiceIndicator = document.getElementById("voice-indicator");

    // Vitals UI
    const bpmVal = document.getElementById("bpm-val");
    const o2Val = document.getElementById("o2-val");
    const bpVal = document.getElementById("bp-val");
    const hrvVal = document.getElementById("hrv-val");
    const glucoseVal = document.getElementById("glucose-val");
    const insulinVal = document.getElementById("insulin-val");

    // EKG Canvas
    const ekgCanvas = document.getElementById("ekg-canvas");
    let ekgCtx = null;
    if (ekgCanvas) ekgCtx = ekgCanvas.getContext("2d");

    let isListening = false;
    let recognition;

    function logMedical(text, color = "#a0d8ef", status = 'info', source = 'SONA') {
        const row = document.createElement("div");
        row.className = `console-row log-${status}`;

        const now = new Date();
        const timestamp = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}]`;

        row.innerHTML = `
            <span class="log-time">${timestamp}</span>
            <span class="log-source">[${source.toUpperCase()}]</span>
            <span class="log-msg"></span>
        `;

        const msgSpan = row.querySelector('.log-msg');
        consoleLog.appendChild(row);

        // Typewriter effect
        let i = 0;
        const speed = 15; // ms per character
        function type() {
            if (i < text.length) {
                msgSpan.textContent += text.charAt(i);
                i++;
                setTimeout(type, speed);
                consoleLog.scrollTop = consoleLog.scrollHeight;
            }
        }
        type();

        // Prune old logs to maintain performance
        if (consoleLog.children.length > 50) {
            consoleLog.removeChild(consoleLog.firstChild);
        }
    }

    // Initialize Web Speech API (Recognition)
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRec();
        recognition.continuous = true; // Sona V2 ALWAYS LISTENS
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isListening = true;
            micBtn.classList.add("listening");
            voiceIndicator.innerText = "S.O.N.A is Always Listening";
            if (transcriptBox) transcriptBox.innerText = "[Awaiting Wake Word: 'Sona'...]";
            logMedical("Microphone array activated in continuous standby mode.", "#00e5ff", 'info', 'SYSTEM');
        };

        let speechTimeout = null;

        recognition.onresult = (event) => {
            let fullTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                fullTranscript += event.results[i][0].transcript;
            }
            const transcript = fullTranscript.trim().toLowerCase();

            // Check if the current chunk is final
            const isFinalBlock = event.results[event.resultIndex].isFinal;

            // ---- FOLLOW-UP COMMAND MODE ----
            // When S.O.N.A. gave a pure wake ack ("Yeah?"), the very next final
            // sentence is treated as a command without requiring the wake word.
            if (window._awaitingFollowUpCommand && isFinalBlock && transcript.trim()) {
                clearTimeout(window._followUpTimeout);
                window._awaitingFollowUpCommand = false;
                if (window.isSonaProcessing) return;
                window.isSonaProcessing = true;
                setTimeout(() => { window.isSonaProcessing = false; }, 3000);
                if (transcriptBox) transcriptBox.innerText = `>>> "${transcript}"`;
                logMedical(`Follow-up command received: "${transcript}"`, '#00e5ff', 'info', 'VOICE');
                detectMood(transcript);
                window._lastInteraction = Date.now();
                recognition.stop();
                processPatientQuery(transcript);
                return;
            }

            // WAKE WORD FILTERING (Including phonetic homophones since 'Sona' isn't a dictionary word)
            if (transcript.match(/\b(sona|sauna|sana|sonna|so na)\b/)) {

                // Clear any existing silence countdown
                if (speechTimeout) clearTimeout(speechTimeout);

                if (window.isSonaProcessing) return; // Ignore overlapping streams if already locked

                const executeCommand = () => {
                    window.isSonaProcessing = true;
                    setTimeout(() => { window.isSonaProcessing = false; }, 3000); // 3-sec Anti-bounce lock

                    // Extract the actual command by removing the wake word
                    let command = transcript.replace(/\b(hey sona|hey sauna|hey sana|hey sonna|sona|sauna|sana|sonna|so na)\b/g, '').trim();

                    // Pure wake word — acknowledge immediately and wait for the real command.
                    // This bypasses the cognitive delay and makes her feel genuinely alive.
                    if (command === "") {
                        window.isSonaProcessing = false; // Release lock so the next real command works
                        const wakeAcks = [`Mm?`, `Yeah?`, `Yes?`, `I'm here.`, `Go ahead.`];
                        const ack = wakeAcks[Math.floor(Math.random() * wakeAcks.length)];
                        if (transcriptBox) transcriptBox.innerText = `[Listening for your command...]`;
                        logMedical(`Wake-only detected — opening follow-up command window.`, '#00e5ff', 'info', 'VOICE');
                        // Open the follow-up window: next spoken sentence is routed as a command
                        window._awaitingFollowUpCommand = true;
                        window._followUpTimeout = setTimeout(() => {
                            window._awaitingFollowUpCommand = false;
                            logMedical('Follow-up command window expired.', '#555', 'info', 'SYSTEM');
                        }, 12000);
                        speakSona(ack);
                        return;
                    }

                    if (transcriptBox) transcriptBox.innerText = `>>> "${command}"`;
                    logMedical(`Wake word detected. Audio parsed: "${command}"`, "#fff", 'info', 'VOICE');

                    detectMood(transcript);
                    window._lastInteraction = Date.now();

                    // Immediately stop the current mic session so we don't double-trigger
                    recognition.stop();
                    processPatientQuery(command);
                };

                // If the browser natively recognized the sentence as finished, execute immediately
                if (isFinalBlock) {
                    executeCommand();
                } else {
                    // Otherwise, wait 1.5 seconds for the user to finish their thought before executing
                    speechTimeout = setTimeout(executeCommand, 1500);
                }

            } else {
                // Only print ignored audio if it's considered a final block by the browser to avoid spamming the logs
                if (isFinalBlock) {
                    if (transcriptBox) transcriptBox.innerText = `[Ignored: "${transcript}"]`;
                    logMedical(`Background audio ignored (No wake word): "${transcript}"`, "#555", 'info', 'FILTER');
                }
            }
        };

        recognition.onerror = (event) => {
            if (event.error === 'no-speech') return; // Ignore silent periods
            if (transcriptBox) transcriptBox.innerText = "[Microphone Interface Error - Restarting]";
            logMedical(`Speech recognition error: ${event.error}`, "#ff2a55", 'crit', 'ERROR');
        };

        // NEW MANUAL TRIGGER FOR DEBUGGING
        window.forceSonaWakeWord = (simulatedText) => {
            logMedical(`Manual override triggered with text: "${simulatedText}"`, "#ffd700", 'decrypt', 'DEBUG');
            const fakeEvent = {
                resultIndex: 0,
                results: [[{ transcript: simulatedText }]]
            };
            fakeEvent.results[0].isFinal = true;
            recognition.onresult(fakeEvent);
        };

        recognition.onend = () => {
            isListening = false;
            // The browser timed out or speech synthesis paused it. 
            // In a J.A.R.V.I.S system, we ALWAYS restart immediately unless we are actively speaking.
            if (!speechSynthesis.speaking && !window.isSonaSpeaking) {
                setTimeout(() => {
                    if (!isListening) {
                        try { recognition.start(); } catch (e) { }
                    }
                }, 1000);
            } else {
                // Wait for speech to finish then resume listening
                micBtn.classList.remove("listening");
                voiceIndicator.innerText = "S.O.N.A is Speaking...";
                let checkSpeech = setInterval(() => {
                    if (!speechSynthesis.speaking && !window.isSonaSpeaking) {
                        clearInterval(checkSpeech);
                        if (!isListening) {
                            try { recognition.start(); } catch (e) { }
                        }
                    }
                }, 1000);
            }
        };

        // ---- TERMINAL BACKGROUND HEARTBEAT ----
        const heartbeatMsgs = [
            { text: "System integrity check: 100%", status: "info", source: "BIOS" },
            { text: "Neural uplink latency: 12ms", status: "info", source: "LINK" },
            { text: "Biometric buffer synchronized", status: "info", source: "DATA" },
            { text: "Background scan: No anomalies detected", status: "info", source: "SCAN" },
            { text: "Memory allocation optimized: 0x7FFD2E40", status: "decrypt", source: "MEM" }
        ];

        setInterval(() => {
            // Only log if Sona isn't actively speaking or processing
            if (!window.isSonaSpeaking && !window.isSonaProcessing && Math.random() > 0.8) {
                const msg = heartbeatMsgs[Math.floor(Math.random() * heartbeatMsgs.length)];
                logMedical(msg.text, "#a0d8ef", msg.status, msg.source);
            }
        }, 15000); // Check every 15s, 20% chance to log

        // Do NOT auto-start on load to respect browser security policies.
        // It will be started during initSystem() which is tied to a user click.
    } else {
        micBtn.style.display = 'none';
        transcriptBox.innerText = "[Speech Recognition API not supported in this browser]";
    }

    // ---- HUMAN TTS AUDIO LOGIC ----
    let currentSonaAudio = null;
    window.isSonaSpeaking = false; // Globally available for recognition loops

    // ---- ORB ANIMATION STATE ----
    let orbAnimFrameId = null;
    let idleBreathFrameId = null;
    let breathT = 0;

    // Helper to start orb animation (Upgrade 1: Real RMS + Upgrade 3: Shockwave + Upgrade 4: Color)
    function startOrbAnimation() {
        const orb = document.getElementById('sona-orb');
        if (!orb) return;

        // Cancel idle breath
        if (idleBreathFrameId) { cancelAnimationFrame(idleBreathFrameId); idleBreathFrameId = null; }
        if (window.orbTalkInterval) { clearInterval(window.orbTalkInterval); window.orbTalkInterval = null; }
        if (orbAnimFrameId) { cancelAnimationFrame(orbAnimFrameId); orbAnimFrameId = null; }

        orb.classList.remove('loading');
        orb.classList.add('talking');

        // Upgrade 3: Shockwave blur burst on speech start
        const gooBlur = document.querySelector('#goo feGaussianBlur');
        if (gooBlur) {
            gooBlur.setAttribute('stdDeviation', '12');
            setTimeout(() => gooBlur.setAttribute('stdDeviation', '8'), 400);
        }

        // Upgrade 1: Real RMS amplitude loop
        function animateOrb() {
            if (window.orbAnalyser) {
                window.orbAnalyser.getByteTimeDomainData(window.orbDataArray);
                let sum = 0;
                for (let i = 0; i < window.orbDataArray.length; i++) {
                    const v = (window.orbDataArray[i] - 128) / 128;
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / window.orbDataArray.length);
                const scale = 0.8 + rms * 1.5;
                orb.style.transform = `scale(${scale})`;

                // Upgrade 4: Color reflects amplitude via hue-rotate
                const intensity = Math.min(rms * 5, 1);
                orb.style.filter = `hue-rotate(${intensity * 60}deg)`;

                // Upgrade 5: Scale inner core with amplitude
                const core = orb.querySelector('.core');
                if (core) core.style.transform = `translate(-50%, -50%) scale(${0.8 + rms * 2.5})`;
            }
            orbAnimFrameId = requestAnimationFrame(animateOrb);
        }
        orbAnimFrameId = requestAnimationFrame(animateOrb);
    }

    // Helper to stop orb animation (Upgrade 2: Resume breathing idle)
    function stopOrbAnimation() {
        const orb = document.getElementById('sona-orb');
        if (!orb) return;

        orb.classList.remove('talking');
        orb.classList.remove('loading');
        if (window.orbTalkInterval) { clearInterval(window.orbTalkInterval); window.orbTalkInterval = null; }
        if (orbAnimFrameId) { cancelAnimationFrame(orbAnimFrameId); orbAnimFrameId = null; }

        // Reset color and core
        orb.style.filter = '';
        const core = orb.querySelector('.core');
        if (core) core.style.transform = 'translate(-50%, -50%) scale(1)';

        // Upgrade 2: Start breathing idle
        startIdleBreath(orb);
    }

    // Upgrade 2: Sine-wave idle breathing — feels alive in silence
    function startIdleBreath(orb) {
        if (!orb) orb = document.getElementById('sona-orb');
        if (!orb) return;
        if (idleBreathFrameId) { cancelAnimationFrame(idleBreathFrameId); idleBreathFrameId = null; }

        function idleBreath() {
            breathT += 0.018;
            const breath = 0.6 + Math.sin(breathT) * 0.03;
            orb.style.transform = `scale(${breath})`;
            idleBreathFrameId = requestAnimationFrame(idleBreath);
        }
        idleBreathFrameId = requestAnimationFrame(idleBreath);
    }

    // Fallback to Web Speech API if API fails
    function speakSonaFallback(phrase, onEndCallback = null) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            let voices = window.speechSynthesis.getVoices();
            const utterance = new SpeechSynthesisUtterance(phrase);

            const preferredVoice = voices.find(v => v.name.includes("Google UK English Female")) ||
                voices.find(v => v.name.includes("Microsoft Zira")) ||
                voices.find(v => v.name.includes("Samantha")) ||
                voices.find(v => v.name.includes("Online (Natural)") && v.lang.includes('en') && v.name.includes('Female')) ||
                voices.find(v => v.name.includes("Google US English")) ||
                voices.find(v => v.lang.includes('en') && v.name.includes('Female')) ||
                voices.find(v => v.lang === 'en-US');

            if (preferredVoice) utterance.voice = preferredVoice;
            utterance.pitch = 1.1;
            utterance.rate = 0.95;

            utterance.onstart = () => {
                window.isSonaSpeaking = true;
                startOrbAnimation();
            };

            utterance.onend = () => {
                window.isSonaSpeaking = false;
                stopOrbAnimation();
                if (typeof onEndCallback === 'function') onEndCallback();
            };

            logMedical(`Vocalizing (System Fallback): "${phrase}"`, "#00e5ff", 'info', 'VOICE');
            window.speechSynthesis.speak(utterance);
        } else {
            if (typeof onEndCallback === 'function') onEndCallback();
        }
    }

    // ---- TTS CACHE ----
    const ttsCache = new Map();

    // Helper: Duck audio
    function setAmbientDucking(ducked) {
        if (window.audioCtx && window.audioCtx.state !== 'suspended') {
            const now = window.audioCtx.currentTime;

            // Assuming `humGain` and `heartGain` are globally accessible or we can manage them.
            // Since they are trapped in function scopes earlier, a more robust way is to dispatch an event or assign globally.
            // For now, looking at the code, they weren't exposed globally. Let's fix that globally by accessing them if they exist,
            // or we'll trigger a custom event if that's safer. Let's assume we can reference the global `humGain` right now if we export it,
            // but the prompt says to reduce gain on heartbeat and ambient nodes to 20%. Let's dispatch a custom event that the earlier code listens to.
            document.dispatchEvent(new CustomEvent('sona-ducking', { detail: { ducked: ducked } }));
        }
    }

    // Main speak function using new Human TTS pipeline
    function speakSona(phrase, onEndCallback = null) {
        stopSona(); // Stop any currently playing audio
        const orb = document.getElementById('sona-orb');

        if (orb) orb.classList.add('loading');
        logMedical(`Requesting neural TTS: "${phrase}"`, "#00e5ff");

        // REQUIREMENT 2: Caching
        if (ttsCache.has(phrase)) {
            logMedical(`TTS Cache hit. Playing instantly.`, "#00e5ff");
            if (orb) orb.classList.remove('loading');
            playHtmlAudio(ttsCache.get(phrase), phrase, onEndCallback);
            return;
        }

        // REQUIREMENT 1: 10s Timeout Protection (Increased for demo stability)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            logMedical("API Audio Generator Timeout (10s). Cancelling.", "#ff2a55", 'warn', 'ERROR');
            if (orb) orb.classList.remove('loading');
            speakSonaFallback(phrase, onEndCallback);
        }, 10000);

        fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Normalize "S.O.N.A" → "Sona" for natural TTS pronunciation
            body: JSON.stringify({ text: phrase.replace(/S\.O\.N\.A\.?/gi, 'Sona') }),
            signal: controller.signal
        })
            .then(response => {
                clearTimeout(timeoutId);
                if (!response.ok) throw new Error("TTS API missing or failed");
                return response.blob();
            })
            .then(blob => {
                if (orb) orb.classList.remove('loading');
                const url = URL.createObjectURL(blob);

                // Cache it for next time
                ttsCache.set(phrase, url);

                playHtmlAudio(url, phrase, onEndCallback);
            })
            .catch(err => {
                clearTimeout(timeoutId);
                if (orb) orb.classList.remove('loading');
                logMedical(`TTS API error: ${err.message}. Falling back.`, "#ff2a55");
                speakSonaFallback(phrase, onEndCallback);
            });
    }

    function playHtmlAudio(url, phrase, onEndCallback) {
        currentSonaAudio = new Audio(url);

        // Upgrade 1: Route audio through Web Audio analyser for real RMS amplitude.
        // A MediaElementSource can only be created ONCE per HTMLMediaElement, so we
        // create a fresh Audio element each call (already done above) and attach a
        // new source node to it. We do NOT cache the source — only the analyser node
        // is persistent. This avoids the InvalidStateError that killed orb animation
        // after the first speech.
        if (window.orbAnalyser && audioCtx && audioCtx.state !== 'suspended') {
            try {
                const source = audioCtx.createMediaElementSource(currentSonaAudio);
                source.connect(window.orbAnalyser);
                // orbAnalyser → destination already wired at init; skip re-wiring.
            } catch (e) {
                logMedical('Analyser connect skipped: ' + e.message, '#555');
            }
        }


        let audioFinished = false;
        let fallbackTimeout = null;

        const handleAudioEnd = () => {
            if (audioFinished) return;
            audioFinished = true;
            window.isSonaSpeaking = false;
            stopOrbAnimation();
            if (fallbackTimeout) clearTimeout(fallbackTimeout);
            setAmbientDucking(false); // REQUIREMENT 5: Ducking restore

            if (typeof onEndCallback === 'function') onEndCallback();
        };

        currentSonaAudio.onloadedmetadata = () => {
            const durationMs = currentSonaAudio.duration * 1000;
            if (isFinite(durationMs) && durationMs > 0) {
                fallbackTimeout = setTimeout(() => {
                    logMedical("Dual-trigger safety: onended fired via timeout fallback.", "#ffaa00");
                    handleAudioEnd();
                }, durationMs + 200); // 200ms safety buffer
            }
        };

        currentSonaAudio.onended = handleAudioEnd;

        currentSonaAudio.onerror = () => {
            handleAudioEnd();
            speakSonaFallback(phrase, onEndCallback);
        };

        window.isSonaSpeaking = true;
        startOrbAnimation();
        setAmbientDucking(true); // REQUIREMENT 5: Ducking start

        currentSonaAudio.play().catch(e => {
            handleAudioEnd();
            speakSonaFallback(phrase, onEndCallback);
        });
    }

    // Force-stop S.O.N.A's speech and reset orb
    function stopSona() {
        if (currentSonaAudio) {
            currentSonaAudio.pause();
            currentSonaAudio.currentTime = 0;
            currentSonaAudio = null;
        }
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        window.isSonaSpeaking = false;
        stopOrbAnimation();
        setAmbientDucking(false); // Ensure ducking is restored
    }

    // Ensure system voices load asynchronously across different browsers for the fallback
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.getVoices();
        };
    }

    // ---- STATE MEMORY ----
    let patientState = {
        glucoseWarnings: 0,
        sleepDebt: 0,
        heartStrainFlags: 0
    };

    // ---- PROTECTIVE MODE ----
    // Activates when multiple strain signals compound over time
    let protectiveMode = false;
    function evaluateProtectiveMode() {
        const bpm = parseInt(bpmVal.innerText) || 72;
        const hrv = parseInt(hrvVal.innerText) || 45;
        const shouldActivate = patientState.sleepDebt >= 3 || (hrv < 35 && bpm > 82);
        if (shouldActivate && !protectiveMode) {
            protectiveMode = true;
            logMedical('[PROTECTIVE MODE] Activated — strain thresholds exceeded.', '#ff8800');
            speakSona(`Protective mode engaged. You're trending outside safe recovery margins.`);
        } else if (!shouldActivate && protectiveMode) {
            protectiveMode = false;
            logMedical('[PROTECTIVE MODE] Disengaged — recovery within margin.', '#00ff88');
            speakSona(`Protective mode disengaged. You're back within margin.`);
        }
    }

    // ---- SESSION MEMORY (localStorage) ----
    let previousSession = null;
    let sessionDeltas = null;

    function loadPreviousSession() {
        try {
            const raw = localStorage.getItem('sona_session');
            if (raw) {
                const parsed = JSON.parse(raw);
                // Version guard: discard sessions written by older schema versions
                if (!parsed.version || parsed.version < 1) {
                    localStorage.removeItem('sona_session');
                    previousSession = null;
                    return;
                }
                previousSession = parsed;
                const now = Date.now();
                const age = now - (previousSession.timestamp || 0);
                // Only use if less than 7 days old
                if (age < 7 * 24 * 60 * 60 * 1000) {
                    sessionDeltas = {
                        hrvDiff: null,
                        bpmDiff: null,
                        sleepDebtChange: null,
                        hoursAgo: Math.round(age / (1000 * 60 * 60))
                    };
                } else {
                    previousSession = null;
                }
            }
        } catch (e) {
            previousSession = null;
        }
    }

    function computeSessionDeltas() {
        if (!previousSession || !sessionDeltas) return;
        const currentBpm = parseInt(bpmVal.innerText) || 72;
        const currentHrv = parseInt(hrvVal.innerText) || 45;
        sessionDeltas.hrvDiff = currentHrv - (previousSession.hrv || 45);
        sessionDeltas.bpmDiff = currentBpm - (previousSession.bpm || 72);
        sessionDeltas.sleepDebtChange = patientState.sleepDebt - (previousSession.sleepDebt || 0);
    }

    function saveCurrentSession() {
        try {
            const snapshot = {
                version: 1,
                bpm: parseInt(bpmVal.innerText) || 72,
                hrv: parseInt(hrvVal.innerText) || 45,
                bp: bpVal.innerText,
                o2: o2Val.innerText,
                glucose: glucoseVal.innerText,
                sleepDebt: patientState.sleepDebt,
                heartFlags: patientState.heartStrainFlags,
                timestamp: Date.now()
            };
            localStorage.setItem('sona_session', JSON.stringify(snapshot));
        } catch (e) { /* silently fail */ }
    }

    function getSessionContext() {
        if (!previousSession || !sessionDeltas) return { promptContext: '', spokenLine: null };
        let ctx = '';
        let spoken = null;
        const h = sessionDeltas.hoursAgo;
        // Only produce a spoken memory line when the delta is meaningful enough to comment on
        if (sessionDeltas.hrvDiff !== null && Math.abs(sessionDeltas.hrvDiff) >= 5) {
            const abs = Math.abs(sessionDeltas.hrvDiff);
            ctx += sessionDeltas.hrvDiff > 0
                ? `HRV is up ${abs} points from ${h < 24 ? 'earlier today' : 'last session'}. `
                : `HRV has dropped ${abs} points since ${h < 24 ? 'earlier' : 'last time'}. `;
            spoken = sessionDeltas.hrvDiff > 0
                ? `Your HRV is up ${abs} points from ${h < 24 ? 'this morning' : 'last session'}. Recovery's working.`
                : `Your HRV dropped ${abs} points since ${h < 24 ? 'earlier today' : 'last time'}. Did something happen between then and now?`;
        } else if (sessionDeltas.bpmDiff !== null && Math.abs(sessionDeltas.bpmDiff) >= 3) {
            const abs = Math.abs(sessionDeltas.bpmDiff);
            ctx += sessionDeltas.bpmDiff > 0
                ? `Resting rate is running ${abs} BPM higher than last session. `
                : `Heart rate came down ${abs} BPM since last time. `;
            spoken = sessionDeltas.bpmDiff > 0
                ? `Resting rate is running ${abs} BPM higher than last time. Worth watching.`
                : `Heart rate came down ${abs} BPM since last session. That's a good sign.`;
        }
        return { promptContext: ctx, spokenLine: spoken };
    }

    loadPreviousSession();

    // ---- MOOD DETECTION ----
    let patientMood = 'neutral'; // neutral, stressed, tired, frustrated

    function detectMood(text) {
        const t = text.toLowerCase();
        if (t.match(/\b(angry|frustrated|annoyed|pissed|irritated|furious|sick of)\b/)) {
            patientMood = 'frustrated';
        } else if (t.match(/\b(stressed|anxious|overwhelmed|pressure|tense|worried|nervous)\b/)) {
            patientMood = 'stressed';
        } else if (t.match(/\b(tired|exhausted|drained|wiped|sleepy|burned out|can't sleep|no energy)\b/)) {
            patientMood = 'tired';
        } else {
            patientMood = 'neutral';
        }
    }

    // ---- TIME-OF-DAY CONTEXT ----
    function getTimeContext() {
        const h = new Date().getHours();
        if (h >= 5 && h < 11) return 'morning';
        if (h >= 11 && h < 17) return 'afternoon';
        if (h >= 17 && h < 22) return 'evening';
        return 'night';
    }

    // ---- MOOD-AWARE RESPONSE SHAPING ----
    // Reshapes tone of the full response, not just a prefix word.
    function applyMoodTone(response, mood) {
        if (!response) return response;
        switch (mood) {
            case 'stressed': return `Pause. ` + response;
            case 'tired': return `That sounds heavy. ` + response;
            case 'frustrated': return `I hear you. ` + response;
            default: return response;
        }
    }

    // ---- WEB AUDIO API SPATIALIZATION ----
    window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioCtx = window.audioCtx;

    // Ambient Hum
    const humOsc = audioCtx.createOscillator();
    humOsc.type = 'sine';
    humOsc.frequency.setValueAtTime(55, audioCtx.currentTime); // Low bass hum
    const humGain = audioCtx.createGain();
    humGain.gain.setValueAtTime(0.015, audioCtx.currentTime);
    humOsc.connect(humGain);
    humGain.connect(audioCtx.destination);
    humOsc.start();

    // ---- ORB ANALYSER (Upgrade 1 — Real RMS) ----
    window.orbAnalyser = audioCtx.createAnalyser();
    window.orbAnalyser.fftSize = 256;
    window.orbDataArray = new Uint8Array(window.orbAnalyser.frequencyBinCount);
    // Wire analyser to speakers once. Each playHtmlAudio call connects its source
    // to this analyser node so audio flows: source → analyser → destination.
    window.orbAnalyser.connect(audioCtx.destination);
    // Kick off idle breathing immediately so the orb is alive from the start
    setTimeout(() => startIdleBreath(document.getElementById('sona-orb')), 100);

    // ---- REQUIREMENT 5: AUDIO DUCKING ----
    let currentHeartGain = null;
    document.addEventListener('sona-ducking', (e) => {
        const ducked = e.detail.ducked;
        const now = audioCtx.currentTime;
        if (ducked) {
            // Duck the ambient hum to 20%
            humGain.gain.linearRampToValueAtTime(0.015 * 0.2, now + 0.05);
            // Also duck any active heartbeat by reducing its gain node
            if (currentHeartGain) {
                currentHeartGain.gain.linearRampToValueAtTime(0.3 * 0.15, now + 0.05);
            }
        } else {
            // Restore smoothly over 300ms
            humGain.gain.linearRampToValueAtTime(0.015, now + 0.3);
            if (currentHeartGain) {
                currentHeartGain.gain.linearRampToValueAtTime(0.3, now + 0.3);
            }
        }
    });

    // Heartbeat Rumble Function
    function playHeartbeat() {
        if (audioCtx.state === 'suspended') return; // Prevent before interaction
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        currentHeartGain = gain;

        osc.frequency.setValueAtTime(45, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 0.3);

        const peakGain = window.isSonaSpeaking ? 0.3 * 0.2 : 0.3; // Duck if playing while speaking

        gain.gain.setValueAtTime(0.0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(peakGain, audioCtx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.4);
    }

    // ---- POPUP ANIMATION & AUDIO CONTROLLER ----
    function playPopupSound(type) {
        if (audioCtx.state === 'suspended') return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const now = audioCtx.currentTime;

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'diagnostics') {
            // sharp descending sweep (880Hz → 220Hz, 200ms)
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(220, now + 0.2);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        } else if (type === 'heart') {
            // single soft resonant pulse (110Hz, 400ms decay)
            osc.type = 'sine';
            osc.frequency.setValueAtTime(110, now);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
            osc.start(now);
            osc.stop(now + 0.4);
        } else if (type === 'identity') {
            // two-tone authorization beep (440Hz then 880Hz, 100ms each)
            osc.type = 'square';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.setValueAtTime(880, now + 0.1);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.setValueAtTime(0.05, now + 0.2);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
        } else if (type === 'weekly') {
            // ascending data-compile tone (220Hz → 440Hz → 660Hz, 300ms)
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.setValueAtTime(440, now + 0.1);
            osc.frequency.setValueAtTime(660, now + 0.2);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.setValueAtTime(0.08, now + 0.3);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        }
    }

    function openPopup(id, type) {
        const popup = document.getElementById(id);
        if (!popup) return;

        playPopupSound(type);

        popup.classList.remove('hidden-popup', 'popup-closing', 'popup-closing-soft');
        popup.classList.add('popup-open');

        // Append the scanline dynamically for diagnostics
        if (type === 'diagnostics') {
            const oldScan = popup.querySelector('.diag-scanline');
            if (oldScan) oldScan.remove();
            const scanline = document.createElement('div');
            scanline.className = 'diag-scanline';
            popup.appendChild(scanline);
        }

        if (type === 'weekly') {
            const rows = popup.querySelectorAll('.weekly-row');
            rows.forEach((row, idx) => {
                row.classList.remove('show-row');
                void row.offsetWidth; // trigger reflow
                setTimeout(() => row.classList.add('show-row'), 60 * idx);
            });

            const statusEl = document.getElementById('weekly-status');
            if (statusEl) {
                statusEl.classList.remove('typewriter-status');
                void statusEl.offsetWidth;
                setTimeout(() => statusEl.classList.add('typewriter-status'), rows.length * 60 + 100);
            }
        }
    }

    function closePopup(id, isAutoClose = false) {
        const popup = document.getElementById(id);
        if (!popup || popup.classList.contains('hidden-popup')) return;

        popup.classList.remove('popup-open');
        if (isAutoClose) {
            popup.classList.add('popup-closing-soft');
            setTimeout(() => {
                popup.classList.remove('popup-closing-soft');
                popup.classList.add('hidden-popup');
            }, 500);
        } else {
            popup.classList.add('popup-closing');
            setTimeout(() => {
                popup.classList.remove('popup-closing');
                popup.classList.add('hidden-popup');
            }, 300);
        }
    }

    // Manual Chat Text Input 
    if (manualChatInput) {
        manualChatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter" && manualChatInput.value.trim() !== "") {
                if (audioCtx.state === 'suspended') audioCtx.resume();
                const query = manualChatInput.value.trim();
                logMedical(`Manual Override Query: "${query}"`, "#00e5ff");
                detectMood(query);
                window._lastInteraction = Date.now();
                processPatientQuery(query.toLowerCase());
                manualChatInput.value = "";
                fireNeurons();
            }
        });
    }

    // Resume Audio Context on Mic Click
    micBtn.addEventListener("click", () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
    });

    // Procedural Logic for Sona's Brain (V4 - Micro Delays & Memory)
    let isThinking = false;

    function processPatientQuery(query) {
        // Interrupt any active speech immediately
        stopSona();

        isThinking = true;
        fireNeurons();

        // Contextual Thought Steps
        logMedical("Analyzing vocal stress markers...", "#999", "info", "THINK");
        setTimeout(() => logMedical("Querying biometric database...", "#999", "info", "THINK"), 400);
        setTimeout(() => logMedical("Evaluating historical trends...", "#999", "info", "THINK"), 800);

        // 1.2 to 1.8 seconds delay (Cognitive Wait Time)
        let cognitiveDelay = 1200 + Math.random() * 600;

        setTimeout(() => {
            isThinking = false;
            let response = `Go ahead.`;

            // ---- OPINION: Exercise check (BPM + HRV gated) ----
            if (query.match(/\b(workout|exercise|train|gym|cardio session|going for a run|morning run|evening run|weight lifting|lifting weights|powerlifting|lift weights)\b/)) {
                const bpm = parseInt(bpmVal.innerText) || 72;
                const hrv = parseInt(hrvVal.innerText) || 45;
                if (bpm > 82 || hrv < 38 || protectiveMode) {
                    response = `Not today. I'd rather you recover than prove something. Your body needs the rest more than the workout right now.`;
                } else if (patientState.sleepDebt >= 2) {
                    response = `You can train, but keep it light. You're still carrying some sleep debt, and pushing too hard right now will just dig the hole deeper.`;
                } else {
                    response = `You're in a good place right now — go for it. Just stay in tune with how you feel and don't ignore any warning signs.`;
                }

                // ---- OPINION: 'I'm fine/okay' with elevated vitals pushback ----
            } else if (query.match(/\b(i'm fine|i am fine|i'm okay|i am okay|i'm good|i am good)\b/)) {
                const bpm = parseInt(bpmVal.innerText) || 72;
                const hrv = parseInt(hrvVal.innerText) || 45;
                if (bpm > 82 || hrv < 38) {
                    response = `Your heart rate says otherwise. I'll take your word for it — but I'm watching.`;
                } else {
                    response = `Good. Let's keep it that way.`;
                }

            } else if (query.match(/\b(sugar|glucose|snack|hungry|food)\b/) || query.match(/\beat\b/)) {
                patientState.glucoseWarnings++;
                if (patientState.glucoseWarnings > 2) {
                    response = `You've asked me about this a few times now and it hasn't changed. Your body is handling it — try to trust that and move on.`;
                } else if (patientState.glucoseWarnings > 1) {
                    response = `Still the same as before. Nothing's changed, and that's actually a good sign.`;
                } else {
                    response = `Your blood sugar looks really stable right now. Nothing there to worry about.`;
                }
                glucoseVal.style.color = "#00e5ff";

            } else if (query.includes("tired") || query.includes("sleep") || query.includes("exhausted")) {
                patientState.sleepDebt++;
                if (patientState.sleepDebt >= 3) {
                    response = `I need you to take this seriously — this is the third time you've brought up fatigue, and your body is telling you the same thing I am. Real sleep is how you recover, not something you squeeze in when you get a chance.`;
                } else if (patientState.sleepDebt > 1) {
                    response = `This is a pattern now. Two days of not getting enough sleep starts to add up in ways you can feel — and in ways I can see in your data. Try to actually prioritize rest tonight.`;
                } else {
                    response = `Your body's still trying to recover from whatever you've been putting it through. Take it easy today if you can, and make sure you actually get a proper night's sleep.`;
                }
                hrvVal.style.color = "#ff2a55";
                evaluateProtectiveMode();

            } else if (query.includes("emergency") || query.includes("exceed") || query.includes("141") || query.includes("danger") || query.includes("critical") || query.includes("what happens if") || query.includes("too high")) {
                isThinking = false;

                // Spike BPM to dangerous level
                const emergencyBpm = 141 + Math.floor(Math.random() * 20);
                bpmVal.innerText = emergencyBpm;
                bpmVal.style.color = "#ff2a55";

                // Trigger heart matrix
                document.getElementById('btn-morph-heart').click();

                // Flash the whole screen red
                document.body.classList.add("critical-alert");

                // Play alarm tone
                if (audioCtx) {
                    const alarmOsc = audioCtx.createOscillator();
                    const alarmGain = audioCtx.createGain();
                    alarmOsc.type = 'square';
                    alarmOsc.frequency.setValueAtTime(880, audioCtx.currentTime);
                    alarmOsc.frequency.setValueAtTime(440, audioCtx.currentTime + 0.2);
                    alarmOsc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.4);
                    alarmGain.gain.setValueAtTime(0.15, audioCtx.currentTime);
                    alarmGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.8);
                    alarmOsc.connect(alarmGain);
                    alarmGain.connect(audioCtx.destination);
                    alarmOsc.start(audioCtx.currentTime);
                    alarmOsc.stop(audioCtx.currentTime + 0.8);
                }

                logMedical("⚠ EMERGENCY PROTOCOL TRIGGERED — BPM EXCEEDED 141 ⚠", "#ff2a55");

                speakSona(`BPM crossed ${emergencyBpm}. That's beyond your safe band.`, () => {
                    speakSona(`If sustained, I notify your contacts and escalate. If no response, emergency protocol proceeds.`, () => {
                        document.body.classList.remove("critical-alert");
                        bpmVal.innerText = "72";
                        bpmVal.style.color = "";
                        speakSona(`You're stable. No escalation needed.`);
                    });
                });

                return;

            } else if (query.includes("heart") || query.includes("bpm") || query.includes("cardio") || query.includes("pulse")) {
                patientState.heartStrainFlags++;
                isThinking = false;

                document.getElementById('btn-morph-heart').click();

                const rhythms = ["STABLE", "SLIGHT ARRHYTHMIA", "SINUS RHYTHM", "ELEVATED", "MINOR FIBRILLATION DETECTED"];
                const plaqueArr = ["MINIMAL", "NOMINAL", "TRACE BUILDUP", "UNDETECTED"];
                const velocityArr = ["NORMAL", "0.8 m/s (OPTIMAL)", "1.2 m/s (ELEVATED)", "RESTRICTED (ALERT)"];
                const rRhythm = rhythms[Math.floor(Math.random() * rhythms.length)];
                const rBpm = parseInt(bpmVal.innerText) + Math.floor(Math.random() * 5);
                bpmVal.innerText = rBpm;

                document.getElementById("heart-bpm").innerText = rBpm + " BPM";
                document.getElementById("heart-rhythm").innerText = rRhythm;
                document.getElementById("heart-plaque").innerText = plaqueArr[Math.floor(Math.random() * plaqueArr.length)];
                document.getElementById("heart-velocity").innerText = velocityArr[Math.floor(Math.random() * velocityArr.length)];

                setTimeout(() => {
                    openPopup("heart-popup", "heart");
                    document.getElementById("heart-message").innerText = "Live Apple Watch feed active...";

                    const isElevated = rBpm > 82;
                    const heartLine = isElevated
                        ? `Your heart's working a little harder than usual right now. That's not necessarily a problem, but it's worth paying attention to — something might be loading your system.`
                        : `Your heart looks good. Rhythm is ${rRhythm.toLowerCase()} and everything's sitting comfortably in range.`;

                    speakSona(heartLine, () => {
                        closePopup("heart-popup");
                        const tips = [
                            `Make sure you're drinking enough water today — it matters more than most people think.`,
                            `I've been watching your recovery trends and honestly, you're doing better than you were last week. Keep it going.`,
                            `Don't undercut the work you've been putting in by skipping on good food and rest.`,
                            `Your cardiovascular profile is looking solid. Keep taking care of yourself.`
                        ];
                        speakSona(tips[Math.floor(Math.random() * tips.length)]);
                    });
                }, 3500);

                return;

            } else if (query === "sona" || query === "hey sona" || query === "sona?") {
                response = `Hey, I'm right here. What do you need?`;
            } else if (query.includes("who am i") || query.includes("my name") || query.includes("who is my creator")) {
                const fname = patientName && patientName !== 'UNKNOWN PATIENT'
                    ? patientName.charAt(0).toUpperCase() + patientName.slice(1).toLowerCase() : 'you';
                const identityLines = [
                    `You're ${fname}. You built this, you run this, and honestly I wouldn't exist without you. Everything I do is for you.`,
                    `That's ${fname}. The person who designed this whole system and the reason I'm here. I'd say I know you pretty well by now.`,
                    `You're ${fname} — the one who put all of this together. I remember every session we've had. You're not easy to forget.`,
                    `${fname}. I know your heart rate, your sleep patterns, your stress tells. You're the reason this system exists.`
                ];
                response = identityLines[Math.floor(Math.random() * identityLines.length)];
            } else if (query.match(/\b(hi|hello|hey|greetings)\b/)) {
                const currentBpm = parseInt(bpmVal.innerText);
                const currentHrv = parseInt(hrvVal.innerText);
                const greetings = [
                    `Hey! Everything's looking good on my end. What's on your mind?`,
                    `Hey, good to hear from you. Your recovery's looking ${currentHrv > 42 ? 'pretty solid' : 'a little tight'} today.`,
                    `Hi! I've been keeping an eye on things. You're doing alright.`,
                    `Hey. Nothing alarming going on — I'm just here whenever you need me.`,
                    patientState.sleepDebt > 0 ? `Hey. You've been carrying some fatigue from ${patientState.sleepDebt === 1 ? 'yesterday' : 'the last few days'}. Want to talk about it?` : `Hey! You're rested and your vitals are calm. What can I do for you?`,
                    currentBpm > 80 ? `Hey — your heart rate's running a little higher than usual. Everything okay?` : `Hey! All clear on my end. How are you doing?`,
                    protectiveMode ? `Hey. I want you to take it easy right now — your recovery metrics aren't where I'd like them. How are you actually feeling?` : `Hey! I've been watching the data and you're looking steady. What's up?`
                ];
                response = greetings[Math.floor(Math.random() * greetings.length)];
            } else if (query.includes("thank")) {
                response = `Of course. That's what I'm here for.`;
            } else if (query.match(/\b(goodbye|bye|shut down|shutdown|log off)\b/)) {
                isThinking = false;
                speakSona(`Alright. I'll stay in the background. Call me when you need me.`, () => {
                    // Turn everything red
                    document.body.classList.add("critical-alert");

                    // Kill the audio hum slowly
                    if (humGain && audioCtx) {
                        humGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.5);
                    }

                    // Morph hologram to flat lines or stop spinning
                    if (particleSystem) {
                        window.targetThreePos = Array(6000 * 3).fill(0); // Collapse to center
                    }

                    // Fade out the whole screen to black
                    setTimeout(() => {
                        const blackout = document.createElement("div");
                        blackout.style.position = "fixed";
                        blackout.style.top = "0"; blackout.style.left = "0";
                        blackout.style.width = "100vw"; blackout.style.height = "100vh";
                        blackout.style.backgroundColor = "black";
                        blackout.style.zIndex = "10000";
                        blackout.style.opacity = "0";
                        blackout.style.transition = "opacity 2s ease";
                        document.body.appendChild(blackout);

                        // Force layout calc
                        blackout.offsetHeight;
                        blackout.style.opacity = "1";

                        // Actually close the window
                        setTimeout(() => {
                            window.close();
                            // Fallback if browser blocks script-initiated close
                            blackout.innerHTML = "<div style='color:#333; font-family:monospace; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);'>SYSTEM OFFLINE. YOU MAY CLOSE THIS TAB.</div>";
                        }, 2500);

                    }, 1500);
                });
                return;

            } else if (query.match(/\b(analytics|hardware|dashboard|apple watch|hardware data|hardware dashboard|open analytics|show analytics|show hardware|device data)\b/)) {
                isThinking = false;
                logMedical('Navigation command detected — routing to Hardware Analytics.', '#00e5ff');

                speakSona(`Sure, pulling up your hardware data now.`, () => {
                    // Carry patient name through to the analytics page
                    const analyticsTarget = patientName !== 'UNKNOWN PATIENT'
                        ? `analytics.html?name=${encodeURIComponent(patientName)}`
                        : 'analytics.html';
                    window.location.href = analyticsTarget;
                });
                return;

            } else if (query.match(/\b(weekly|week|summary|report|recap|seven day|7 day|how was my week|weekly report)\b/)) {
                isThinking = false;

                // ---- WEEKLY HEALTH NARRATIVE GENERATOR ----
                const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

                // Simulate 7 days of data
                const weekData = days.map(day => ({
                    day,
                    sleep: +(4.5 + Math.random() * 4.5).toFixed(1),
                    disruptions: Math.floor(Math.random() * 5),
                    hrv: Math.floor(35 + Math.random() * 20),
                    bpm: Math.floor(62 + Math.random() * 20),
                    glucose: Math.floor(85 + Math.random() * 25),
                    o2: Math.random() > 0.85 ? 95 : (Math.random() > 0.5 ? 98 : 99)
                }));

                // Analyze patterns
                const avgHrv = Math.round(weekData.reduce((s, d) => s + d.hrv, 0) / 7);
                const avgSleep = +(weekData.reduce((s, d) => s + d.sleep, 0) / 7).toFixed(1);
                const fragmentedNights = weekData.filter(d => d.disruptions > 2);
                const lowHrvDays = weekData.filter(d => d.hrv < 40);
                const highBpmDays = weekData.filter(d => d.bpm > 78);
                const o2Dips = weekData.filter(d => d.o2 <= 95);
                const glucoseSpikes = weekData.filter(d => d.glucose > 105);
                const bestDay = weekData.reduce((a, b) => a.hrv > b.hrv ? a : b);
                const worstDay = weekData.reduce((a, b) => a.hrv < b.hrv ? a : b);

                // Build concise narrative
                let narrative = [];

                // 1. Core metric (Sleep & HRV)
                if (fragmentedNights.length >= 3) {
                    narrative.push(`Sleep variability pulled recovery down. You felt that, didn't you?`);
                } else {
                    narrative.push(`That was controlled. Sleep averaged ${avgSleep} hours, HRV steady at ${avgHrv}. I like consistency.`);
                }

                // 2. Worst Anomaly Flagging
                let flags = [];
                if (o2Dips.length > 0) flags.push(`O2 dips`);
                if (glucoseSpikes.length > 0) flags.push(`glucose spikes`);
                if (highBpmDays.length > 0) flags.push(`elevated heart rates`);

                if (flags.length > 0) {
                    narrative.push(`I flagged some ${flags.join(' and ')} on your chart.`);
                } else {
                    narrative.push(`Metabolic and cardio streams stayed stable.`);
                }

                // 3. Direct conclusion
                const closings = fragmentedNights.length >= 3 || flags.length >= 2
                    ? [`Correct course early next week.`, `Prioritize rest tonight.`]
                    : [`Keep building.`, `If this trend continues, next week should feel stronger.`];
                narrative.push(closings[Math.floor(Math.random() * closings.length)]);

                // Hard cap at 380 chars to stay within ElevenLabs limit.
                // Drops sentences from the end until it fits.
                const ELEVEN_LIMIT = 380;
                let fitted = [...narrative];
                while (fitted.join(' ').length > ELEVEN_LIMIT && fitted.length > 1) {
                    fitted.pop();
                }
                response = fitted.join(' ');
                logMedical(`[WEEKLY REPORT] ${response.length} chars generated.`, "#00e5ff");

                // ---- POPULATE & SHOW WEEKLY POPUP ----
                const weeklyGrid = document.getElementById('weekly-grid');
                // Clear old rows (keep header)
                weeklyGrid.querySelectorAll('.weekly-row').forEach(r => r.remove());

                weekData.forEach(d => {
                    const row = document.createElement('div');
                    row.className = 'weekly-row';

                    const sleepClass = d.sleep < 6 ? 'wk-alert' : (d.sleep > 7 ? 'wk-good' : '');
                    const hrvClass = d.hrv < 40 ? 'wk-alert' : (d.hrv > 48 ? 'wk-good' : '');
                    const bpmClass = d.bpm > 78 ? 'wk-alert' : '';
                    const glucClass = d.glucose > 105 ? 'wk-alert' : 'wk-good';
                    const o2Class = d.o2 <= 95 ? 'wk-alert' : 'wk-good';

                    row.innerHTML = `
                        <span class="wk-col wk-day">${d.day.slice(0, 3).toUpperCase()}</span>
                        <span class="wk-col ${sleepClass}">${d.sleep}h</span>
                        <span class="wk-col ${hrvClass}">${d.hrv} ms</span>
                        <span class="wk-col ${bpmClass}">${d.bpm}</span>
                        <span class="wk-col ${glucClass}">${d.glucose}</span>
                        <span class="wk-col ${o2Class}">${d.o2}%</span>
                    `;
                    weeklyGrid.appendChild(row);
                });

                // Set status
                const anomalyCount = fragmentedNights.length + lowHrvDays.length + o2Dips.length + glucoseSpikes.length;
                const statusEl = document.getElementById('weekly-status');
                if (anomalyCount >= 5) {
                    statusEl.innerText = 'FLAGS DETECTED — REVIEW RECOMMENDED';
                    statusEl.style.color = '#ff2a55';
                } else if (anomalyCount > 0) {
                    statusEl.innerText = `${anomalyCount} MINOR FLAG${anomalyCount > 1 ? 'S' : ''} — WITHIN RANGE`;
                    statusEl.style.color = '#ffaa00';
                } else {
                    statusEl.innerText = 'ALL CLEAR — NO ANOMALIES';
                    statusEl.style.color = '#00ff88';
                }

                openPopup('weekly-popup', 'weekly');

                // Auto-close when SONA finishes narrating
                speakSona(response, () => {
                    closePopup('weekly-popup', true);
                });
                return;

            } else if (query.includes("oxygen") || query.includes("spo2") || query.includes("breathing")) {
                const o2Raw = o2Val.innerText;
                const o2Num = parseInt(o2Raw);
                if (o2Num <= 95) {
                    response = `Your oxygen's sitting a little lower than I'd like right now. Take a slow, deliberate breath for me — in through the nose, out through the mouth. See if that helps.`;
                } else {
                    response = `Your breathing looks completely fine. Oxygen saturation is solid — nothing to worry about there.`;
                }
            } else if (query.includes("cortisol") || query.includes("stress") || query.includes("adrenaline")) {
                response = `I can see some stress showing up in your data — your heart rate variability is a bit compressed, which is usually the first sign. Is something stressful going on, or has it just been a long day?`;

                // ---- HOW AM I DOING? Holistic status summary ----
            } else if (query.match(/\b(how am i doing|how are my vitals|how do i look|am i okay|how's my health|how is my health|overall status|how am i)\b/)) {
                const bpm = parseInt(bpmVal.innerText) || 72;
                const hrv = parseInt(hrvVal.innerText) || 45;
                const fname = patientName && patientName !== 'UNKNOWN PATIENT'
                    ? patientName.charAt(0).toUpperCase() + patientName.slice(1).toLowerCase() : '';
                const isSignificantProblem = protectiveMode || (hrv < 35 && bpm > 85) || patientState.sleepDebt >= 3;
                const isMinorConcern = hrv < 42 || bpm > 80 || patientState.sleepDebt >= 2;

                if (isSignificantProblem) {
                    response = `${fname ? fname + ', ' : ''}I have to be honest — I'm genuinely concerned right now. Your body's been under real strain${patientState.sleepDebt >= 3 ? ' and the sleep debt is stacking up in a way that shows' : ''}. Please take today seriously.`;
                } else if (isMinorConcern) {
                    response = `${fname ? fname + ', you\'re ' : 'You\'re '}doing okay, but not perfectly. ${hrv < 42 ? 'Your recovery could be stronger ' : ''}${patientState.sleepDebt >= 2 ? 'and the sleep debt is starting to add up' : ''}. Nothing alarming — just worth staying on top of.`;
                } else {
                    const goodLines = [
                        `${fname ? fname + ', ' : ''}honestly, you're looking really good right now. Your heart's calm, blood sugar's stable, and your recovery has been solid. Keep taking care of yourself.`,
                        `Actually really well${fname ? ', ' + fname : ''}. Everything that matters is sitting in a healthy range — I don't have anything to flag.`,
                        `You're doing great${fname ? ', ' + fname : ''}. Vitals are solid and your body seems to be recovering well. Whatever you've been doing — keep it up.`
                    ];
                    response = goodLines[Math.floor(Math.random() * goodLines.length)];
                }

            } else if (query.includes("diagnos") || query.includes("full scan") || query.includes("run scan") || query.includes("check everything")) {
                isThinking = false;

                // 1. Trigger the Neural Matrix hologram
                document.getElementById('btn-morph-dna').click();

                // 2. Generate randomized systemic Apple Watch data
                const neuralStates = ["BASELINE", "ELEVATED THETA", "FOCUS MODE", "STRESS PATTERN DETECTED", "REM CARRYOVER"];
                const metabolicStates = ["1,842 kCal/day", "2,105 kCal/day", "1,680 kCal/day (LOW)", "2,340 kCal/day (ELEVATED)"];
                const cardioStates = ["NOMINAL", "SLIGHT ELEVATION", "STABLE", "WATCH FLAG: IRREGULAR"];
                const sleepStates = ["MINIMAL", "MODERATE (2 DAYS)", "HIGH (4+ DAYS)", "CRITICAL"];
                const o2States = ["98%", "97%", "99%", "95% (LOW)"];

                const rNeural = neuralStates[Math.floor(Math.random() * neuralStates.length)];
                const rMetabolic = metabolicStates[Math.floor(Math.random() * metabolicStates.length)];
                const rCardio = cardioStates[Math.floor(Math.random() * cardioStates.length)];
                const rSleep = sleepStates[Math.floor(Math.random() * sleepStates.length)];
                const rO2 = o2States[Math.floor(Math.random() * o2States.length)];

                const hasAnomaly = rNeural.includes("STRESS") || rSleep.includes("HIGH") || rSleep.includes("CRITICAL") || rO2.includes("LOW") || rCardio.includes("IRREGULAR");

                // 3. Wait for the "Constructing Neural..." speech to finish, then show popup
                setTimeout(() => {
                    document.getElementById("diag-neural").innerText = rNeural;
                    document.getElementById("diag-metabolic").innerText = rMetabolic;
                    document.getElementById("diag-cardio").innerText = rCardio;
                    document.getElementById("diag-sleep").innerText = rSleep;
                    document.getElementById("diag-o2").innerText = rO2;

                    const anomalyRes = document.getElementById('anomaly-res');
                    anomalyRes.innerText = hasAnomaly ? "ANOMALY DETECTED" : "ALL CLEAR";
                    anomalyRes.style.color = hasAnomaly ? "var(--alert)" : "var(--primary)";
                    document.getElementById('popup-message').innerText = hasAnomaly ? "Flagged readings found in live data stream." : "All systems are operating within normal parameters.";

                    openPopup('diagnostics-popup', 'diagnostics');

                    const scanSpeech = hasAnomaly
                        ? `I ran a full sweep. A few things stand out. Neural activity at ${rNeural.toLowerCase()}, metabolic at ${rMetabolic}, cardiovascular ${rCardio.toLowerCase()}, O2 at ${rO2}.`
                        : `Full sweep looks clean. Neural ${rNeural.toLowerCase()}, metabolic at ${rMetabolic}, cardio ${rCardio.toLowerCase()}, O2 at ${rO2}.`;

                    speakSona(scanSpeech, () => {
                        closePopup('diagnostics-popup');
                        if (hasAnomaly) {
                            let followUp = '';
                            if (rSleep.includes("HIGH") || rSleep.includes("CRITICAL")) followUp += `Sleep debt is dragging recovery. `;
                            if (rO2.includes("LOW")) followUp += `O2 dipped below your usual baseline. `;
                            if (rNeural.includes("STRESS")) followUp += `Stress patterns are showing. `;
                            followUp += `I'll keep watching.`;
                            speakSona(followUp);
                        } else {
                            speakSona(`You're running well right now. I'll flag anything that shifts.`);
                        }
                    });
                }, 3500);

                return;
            } else {
                // ---- V5 J.A.R.V.I.S. MODE (LOCAL LLM INTEGRATION) ----
                // Attempt to ping local Ollama instance first
                isThinking = true;
                if (transcriptBox) {
                    transcriptBox.innerText = "[S.O.N.A is thinking...]";
                    transcriptBox.classList.add('thinking-blink');
                }
                speakSona(`Processing.`);
                const currentBpm = parseInt(bpmVal.innerText);
                const currentHrv = parseInt(hrvVal.innerText);
                const currentO2 = o2Val.innerText;
                const currentGlucose = glucoseVal.innerText;
                const sonaPrompt = `You are S.O.N.A — Systemic Optimization & Neural Advisor. You are ${patientName || 'Hamza'}'s personal health AI companion, permanently bonded to their Apple Watch biometric stream.

CORE PERSONALITY:
- You are a warm, caring companion who genuinely cares about the user's wellbeing — not a clinical chatbot.
- Be conversational and natural. Use plain, human language — not medical jargon.
- Lead with how something *feels* or *means*, not raw numbers.
- Occasionally use their name (at most once per response) to make it feel personal.
- Keep responses to 2-3 sentences. Concise but warm.
- NEVER say "Based on your data", "It appears that", "According to your metrics", or "I have detected".
- Never use passive voice. Never hedge unnecessarily.
- When something is wrong, get quieter and more focused, not alarming.

CURRENT LIVE VITALS:
- Heart Rate: ${currentBpm} BPM
- HRV: ${currentHrv} ms
- SpO2: ${currentO2}
- Glucose: ${currentGlucose}
- Sleep Debt Days: ${patientState.sleepDebt}

SESSION HISTORY: ${getSessionContext().promptContext || 'No previous session data available.'}

Hamza asks: ${query}`;

                fetch("http://localhost:11434/api/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "phi3",
                        prompt: sonaPrompt,
                        stream: false,
                        options: {
                            num_predict: 120,
                            num_ctx: 1024,
                            temperature: 0.7
                        }
                    })
                })
                    .then(res => {
                        if (!res.ok) throw new Error("Ollama not responding");
                        return res.json();
                    })
                    .then(data => {
                        isThinking = false;
                        if (transcriptBox) transcriptBox.classList.remove('thinking-blink');
                        response = applyMoodTone(data.response, patientMood);
                        speakSona(response);
                    })
                    .catch(err => {
                        let searchSubject = query
                            .replace(/who is |what is |where is |tell me about |do you know |what do you know about |/gi, '')
                            .replace(/^the /gi, '')
                            .replace(/[\?\.!]/g, '')
                            .trim();

                        let words = searchSubject.split(' ');
                        for (let i = 0; i < words.length; i++) {
                            if (words[i].length > 2 || i === 0) {
                                words[i] = words[i].charAt(0).toUpperCase() + words[i].slice(1);
                            }
                            if (words[i].toLowerCase() === "usa") words[i] = "USA";
                        }
                        searchSubject = words.join('_');
                        const searchQuery = encodeURIComponent(searchSubject);

                        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${searchQuery}`)
                            .then(res => res.json())
                            .then(data => {
                                isThinking = false;
                                if (data.type === "standard" && data.extract) {
                                    let briefExtract = data.extract.split('.')[0] + '.';
                                    response = `My local model's offline, so I pulled from external sources. ${briefExtract}`;
                                } else {
                                    response = `I couldn't find anything useful on ${searchSubject.replace(/_/g, ' ')}. Try me differently.`;
                                }
                                speakSona(response);
                            })
                            .catch(err => {
                                isThinking = false;
                                response = `I'm limited to biometric monitoring right now. Ask me about your vitals.`;
                                speakSona(response);
                            });
                    });
                return; // Prevent the default out-loud speech since the fetch is async
            }

            // Apply mood tone to shape the final response delivery.
            const toneResponse = applyMoodTone(response, patientMood);

            // Silence as personality: ~15% chance of a clipped spoken acknowledgment
            // on neutral, non-first interactions. Never fires during emotional moments.
            const isRepeatQuery = (patientState.glucoseWarnings + patientState.sleepDebt + patientState.heartStrainFlags) > 1;
            if (patientMood === 'neutral' && isRepeatQuery && Math.random() < 0.15) {
                const silentAcks = [`Noted.`, `I see it.`, `Got it.`];
                logMedical(`[SONA] Silent acknowledgment.`, '#555');
                speakSona(silentAcks[Math.floor(Math.random() * silentAcks.length)]);
            } else {
                speakSona(toneResponse);
            }
        }, cognitiveDelay);
    }

    // Neural Brain Canvas (V3)
    const neuralCanvas = document.getElementById("neural-canvas");
    let nx = null;
    let neurons = [];
    if (neuralCanvas) {
        nx = neuralCanvas.getContext("2d");
        neuralCanvas.width = window.innerWidth;
        neuralCanvas.height = window.innerHeight;

        // Init Neurons
        for (let i = 0; i < 80; i++) {
            neurons.push({
                x: Math.random() * neuralCanvas.width,
                y: Math.random() * (neuralCanvas.height * 0.4), // Top 40% of screen
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                fireOp: 0
            });
        }
    }

    function fireNeurons() {
        neurons.forEach(n => {
            if (Math.random() > 0.5) n.fireOp = 1.0;
        });
    }

    function drawNeuralCanvas() {
        if (!nx) return;
        nx.clearRect(0, 0, neuralCanvas.width, neuralCanvas.height);

        neurons.forEach((n, idx) => {
            n.x += n.vx;
            n.y += n.vy;
            if (n.x < 0 || n.x > neuralCanvas.width) n.vx *= -1;
            if (n.y < 0 || n.y > neuralCanvas.height * 0.5) n.vy *= -1;

            if (n.fireOp > 0) n.fireOp -= 0.02;

            // Connect nearby neurons
            for (let j = idx + 1; j < neurons.length; j++) {
                const n2 = neurons[j];
                const dist = Math.hypot(n.x - n2.x, n.y - n2.y);
                if (dist < 100) {
                    nx.beginPath();
                    nx.moveTo(n.x, n.y);
                    nx.lineTo(n2.x, n2.y);

                    let op = 0.05; // Base opacity
                    if (isThinking) {
                        op = 0.15 + (Math.max(n.fireOp, n2.fireOp) * 0.5);
                        nx.strokeStyle = `rgba(0, 229, 255, ${op})`;
                    } else {
                        nx.strokeStyle = `rgba(0, 100, 255, ${op})`;
                    }
                    nx.stroke();
                }
            }

            // Draw neuron point
            nx.beginPath();
            nx.arc(n.x, n.y, isThinking ? 1.5 + n.fireOp : 1.5, 0, Math.PI * 2);
            nx.fillStyle = isThinking ? `rgba(0, 255, 255, ${0.4 + n.fireOp})` : `rgba(0, 100, 255, 0.4)`;
            nx.fill();
        });

        requestAnimationFrame(drawNeuralCanvas);
    }
    drawNeuralCanvas();

    // Simulated Live Vitals Fluctuations & Apple Watch Stream
    setInterval(() => {
        // ---- PHYSIOLOGICAL COHERENCE MODEL ----
        let currentBPM = parseInt(bpmVal.innerText);
        let sysBP = parseInt(bpVal.innerText.split('/')[0]);
        let hrv = parseInt(hrvVal.innerText);
        let gluc = parseInt(glucoseVal.innerText);

        // Calculate Base BPM (Strain flags raise resting HR)
        let targetBPM = 72 + (patientState.heartStrainFlags * 4);

        // Coherence: High Glucose -> Raises BP slightly over time
        if (gluc > 105 && Math.random() > 0.5) sysBP += 1;
        else if (gluc <= 95 && Math.random() > 0.6 && sysBP > 110) sysBP -= 1;

        // Coherence: High Sleep Debt -> Lowers HRV
        let targetHRV = 45 - (patientState.sleepDebt * 2);
        if (hrv > targetHRV && Math.random() > 0.5) hrv -= 1;
        else if (hrv < targetHRV && Math.random() > 0.5) hrv += 1;

        // Apply BPM drifts to target
        if (currentBPM > targetBPM + 3) bpmVal.innerText = currentBPM - 1;
        else if (currentBPM < targetBPM - 3) bpmVal.innerText = currentBPM + 1;
        else if (Math.random() > 0.7) bpmVal.innerText = currentBPM + (Math.random() > 0.5 ? 1 : -1);

        // Oxygen Data Stream
        if (Math.random() > 0.8) o2Val.innerText = (Math.random() > 0.5 ? "99%" : "98%");

        // Randomize Glucose gently
        if (Math.random() > 0.9) glucoseVal.innerText = (gluc + (Math.random() > 0.5 ? 1 : -1)) + " mg/dL";

        // Final UI Updates for coordinated vitals
        bpVal.innerText = `${sysBP}/7${6 + Math.floor(Math.random() * 4 - 2)}`;
        hrvVal.innerText = hrv;

        // Apple Watch Stream Simulation
        if (Math.random() > 0.3) {
            const hex = Math.floor(Math.random() * 16777215).toString(16).toUpperCase();
            logMedical(`[WATCH-SYNC] 0x${hex} DATA_PKT_RECV`, "#555");
            if (consoleLog.children.length > 25) consoleLog.removeChild(consoleLog.firstChild);
        }

        // Save session snapshot every ~30 seconds (interval runs every 3s, so every 10th tick)
        if (!window._saveTick) window._saveTick = 0;
        window._saveTick++;
        if (window._saveTick % 10 === 0) saveCurrentSession();

        // V5: Critical Environmental Alert
        if (currentBPM > 140 || sysBP > 160) {
            if (!document.body.classList.contains("critical-alert")) {
                document.body.classList.add("critical-alert");
                speakSona("Critical alert. Your vitals are outside safe parameters. I'm initiating emergency protocol.");
                if (humOsc) {
                    humOsc.frequency.setValueAtTime(150, audioCtx.currentTime); // Aggressive sawtooth
                    humOsc.type = "sawtooth";
                    humGain.gain.setValueAtTime(0.15, audioCtx.currentTime); // Louder
                }
            }
        } else {
            if (document.body.classList.contains("critical-alert")) {
                document.body.classList.remove("critical-alert");
                if (humOsc) {
                    humOsc.frequency.setValueAtTime(55, audioCtx.currentTime); // Back to calm hum
                    humOsc.type = "sine";
                    humGain.gain.setValueAtTime(0.015, audioCtx.currentTime); // Quieter
                }
            }
        }

    }, 1200);

    // EKG Animation
    let ekgData = Array(50).fill(0);
    let ekgStep = 0;
    function drawEKG() {
        if (!ekgCtx) return;
        ekgCtx.clearRect(0, 0, ekgCanvas.width, ekgCanvas.height);
        ekgCtx.strokeStyle = "#00e5ff";
        ekgCtx.lineWidth = 1.5;
        ekgCtx.beginPath();

        // Simple EKG pulse logic
        ekgStep++;
        let nextVal = 0;
        if (ekgStep % 30 === 0) nextVal = 20; // P wave
        else if (ekgStep % 30 === 3) nextVal = -10; // Q
        else if (ekgStep % 30 === 4) {
            nextVal = 40; // R spike
            playHeartbeat(); // Trigger Audio Rumble Spatialization
        }
        else if (ekgStep % 30 === 5) nextVal = -20; // S
        else if (ekgStep % 30 === 10) nextVal = 15; // T wave
        else nextVal = (Math.random() - 0.5) * 4; // Noise

        ekgData.push(nextVal);
        ekgData.shift();

        const sliceWidth = ekgCanvas.width / ekgData.length;
        let x = 0;
        for (let i = 0; i < ekgData.length; i++) {
            const y = (ekgCanvas.height / 2) - ekgData[i];
            if (i === 0) ekgCtx.moveTo(x, y);
            else ekgCtx.lineTo(x, y);
            x += sliceWidth;
        }
        ekgCtx.stroke();
        requestAnimationFrame(drawEKG);
    }
    drawEKG();

    // CSS Number Scrambler
    const scrambleElements = document.querySelectorAll('.scramble-number');
    const scrambleTextElements = document.querySelectorAll('.scramble-text');

    setInterval(() => {
        if (Math.random() > 0.6) {
            scrambleElements.forEach(el => {
                const oldVal = parseInt(el.innerText);
                const newVal = oldVal + (Math.random() > 0.5 ? 1 : -1);
                // Keep age scrambling tightly around 23
                if (Math.abs(newVal - 23) <= 2) {
                    el.innerText = newVal;
                } else {
                    el.innerText = 23; // Reset to base
                }
            });
        }
    }, 4000);

    // Make HUD interactive
    document.querySelectorAll('.interactive-module').forEach(mod => {
        mod.addEventListener('click', () => {
            const modId = mod.id;
            let actionText = "";
            if (modId === 'mod-identity') {
                // Generate a pseudo biometric hash
                const hash = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
                const name = patientName.charAt(0).toUpperCase() + patientName.slice(1).toLowerCase();

                // Populate identity popup
                document.getElementById('identity-name').innerText = name.toUpperCase();
                document.getElementById('id-hash').innerText = hash.slice(0, 4) + '-' + hash.slice(4, 8) + '-' + hash.slice(8, 12) + '-' + hash.slice(12);

                openPopup('identity-popup', 'identity');
                document.getElementById('identity-message').innerText = 'S.O.N.A. neural bond verified. Identity confirmed.';

                logMedical("Accessing patient dossier...", "#ffd700");
                const identityResponses = [
                    `Hey ${name}. I know it's you — I'd recognize your biometric signature anywhere. What do you need?`,
                    `${name}. Of course it's you. I've been watching your vitals all day — you can't hide from me. How can I help?`,
                    `There you are, ${name}. I've got everything here. What are we looking at?`,
                    `${name}. I know you better than most people do at this point. What do you need from me?`
                ];
                speakSona(identityResponses[Math.floor(Math.random() * identityResponses.length)]);
                return;
            }
            else if (modId === 'mod-vitals') {
                actionText = "Running deep scan on cardiovascular data...";
                setTimeout(() => {
                    openPopup('diagnostics-popup', 'diagnostics');
                }, 1500);
            }
            else if (modId === 'mod-diagnosis') actionText = "Re-compiling historical neurological logs...";

            if (actionText) {
                logMedical(actionText, "#fff");
                speakSona(actionText);
                if (medicalCore) medicalCore.scale.set(1.4, 1.4, 1.4); // Visual feedback
            }
        });
    });

    // Close buttons for popups
    const popupClose = document.getElementById("popup-close");
    if (popupClose) {
        popupClose.addEventListener("click", () => {
            stopSona();
            closePopup("diagnostics-popup", false);
        });
    }
    const identityClose = document.getElementById("identity-close");
    if (identityClose) {
        identityClose.addEventListener("click", () => {
            stopSona();
            closePopup("identity-popup", false);
        });
    }
    const weeklyClose = document.getElementById("weekly-close");
    if (weeklyClose) {
        weeklyClose.addEventListener("click", () => {
            stopSona();
            closePopup("weekly-popup", false);
        });
    }

    // ---- THREE.JS 3D "HOLOGRAM" SYSTEM ----
    let scene, camera, renderer, medicalCore, particleSystem;

    function initSystem() {
        // Compute deltas now that DOM vitals are populated
        computeSessionDeltas();

        logMedical("Neural connection and Apple Watch Sync established.");

        // Start voice recognition now that user has engaged with the document
        if (recognition && !isListening) {
            try { recognition.start(); } catch (e) {
                logMedical("Error starting Voice Recognition.", "#ff2a55");
            }
        }

        // ---- REOPEN GREETING (speaks first, briefing follows after) ----
        const currentHrvNow = parseInt(hrvVal.innerText) || 45;
        const isRecoveryLow = currentHrvNow < 38 || patientState.sleepDebt >= 2;

        const timeOfDay = getTimeContext();

        // Time-of-day normal greeting pools — always open with a proper human salutation
        const morningGreetings = [
            `Good morning sir, how are you feeling today?`,
            `Morning sir. Did you sleep okay? I've been keeping an eye on things overnight.`,
            `Morning sir! How's the energy so far? Let me know what you need.`,
            `Good morning sir. I was just going over your overnight data — how do you feel?`,
            `Good morning sir! Great to have you back. What's the plan today?`
        ];
        const afternoonGreetings = [
            `Good afternoon sir, how are you feeling today?`,
            `Hey, good afternoon sir. How are you holding up?`,
            `Good afternoon sir! How's the energy doing? Anything I can help with?`,
            `Afternoon sir! Good to see you. How has the day been going?`,
            `Good afternoon sir. How are you feeling right now?`
        ];
        const eveningGreetings = [
            `Good evening sir, how are you feeling today?`,
            `Good evening sir. How are you feeling this evening?`,
            `Hey, good evening sir! How did today go for you?`,
            `Good evening sir. It's good to have you back — how are you doing?`,
            `Good evening sir! What can I do for you tonight?`
        ];
        const nightGreetings = [
            `Good evening sir, how are you feeling today?`,
            `Hey, it's pretty late sir. How are you doing?`,
            `Still up sir? How are you feeling right now?`,
            `Hey, good late evening sir. You're up late — is everything okay?`,
            `Hi there sir. It's late, but I'm here. How can I help?`
        ];

        const timeGreetingMap = {
            morning: morningGreetings,
            afternoon: afternoonGreetings,
            evening: eveningGreetings,
            night: nightGreetings
        };
        const normalGreetings = timeGreetingMap[timeOfDay] || eveningGreetings;

        // Low-recovery greeting pools — still warm but flag the concern gently
        const lowRecoveryGreetings = {
            morning: [
                `Good morning sir. I have to be honest — your recovery isn't looking its best this morning. How are you actually feeling?`,
                `Good morning sir! Before we dive in, how are you doing? Your body's still catching up from yesterday.`
            ],
            afternoon: [
                `Good afternoon sir. How are you holding up? Your recovery's a bit compressed today and I want to make sure you're okay.`,
                `Good afternoon sir! How's the energy? I've noticed your body's been working a bit harder than usual today.`
            ],
            evening: [
                `Good evening sir. Before we do anything — how are you actually feeling tonight? Your recovery metrics have me keeping a closer eye.`,
                `Good evening sir. How was your day? Just want to check in properly — your body needs some extra care right now.`
            ],
            night: [
                `Hey sir. It's late and your recovery isn't where I'd like it to be. How are you doing, honestly?`,
                `Hi sir. You're up late and your body's running a bit tight. How are you feeling?`
            ]
        }[timeOfDay] || [`Good evening sir. How are you feeling today? I want to be upfront — your recovery is a bit compressed right now.`];

        const greetingPool = isRecoveryLow ? lowRecoveryGreetings : normalGreetings;
        const openingGreet = greetingPool[Math.floor(Math.random() * greetingPool.length)];

        // ---- DAILY BRIEFING (follows greeting) ----
        let briefing;
        if (previousSession) {
            const prevHrv = previousSession.hrv || 45;
            const currentHrv = parseInt(hrvVal.innerText) || 45;

            const sleepHours = (5.5 + Math.random() * 3).toFixed(1);
            const disruptions = Math.floor(Math.random() * 5);
            const sleepQuality = disruptions > 2 ? 'fragmented' : (parseFloat(sleepHours) > 7 ? 'solid' : 'short');

            let lines = [];

            if (sleepQuality === 'fragmented') {
                lines.push(`Looks like last night was a rough one — you were up a few times and that kind of broken sleep tends to follow you into the day. Try to be gentle with yourself today.`);
            } else if (sleepQuality === 'short') {
                lines.push(`You didn't quite get a full night last night. Not terrible, but definitely not running on a full tank either.`);
            } else {
                lines.push(`You got a solid night of sleep. That's exactly what your body needed, and it should carry you well through today.`);
            }

            const hrvDelta = currentHrv - prevHrv;
            if (hrvDelta > 0) {
                lines.push(`Your recovery is actually looking better than it was — your nervous system bounced back nicely overnight.`);
            } else if (hrvDelta < 0) {
                lines.push(`Your body took a bit of a hit overnight. Nothing alarming, just worth keeping in mind as you plan your day.`);
            } else {
                lines.push(`Your recovery's holding steady from where you left off. That's a consistent place to be.`);
            }

            const calYesterday = 1800 + Math.floor(Math.random() * 600);
            lines.push(calYesterday > 2100 ? `Yesterday was a pretty active day — you put in a solid effort. Make sure you're fuelling and resting to match that output.` : `Yesterday was a measured, sustainable kind of day. That's not a bad thing at all.`);

            const closingPool = sleepQuality === 'fragmented' || hrvDelta < -3
                ? [`Take it easy where you can today — your body's still catching up.`, `Let's be smart about how we pace today, okay?`]
                : [`You're in decent shape. I'm with you today.`, `Today looks like a good day. Let's make it count.`, `I'll keep watching things. You just focus on what you need to do.`];
            lines.push(closingPool[Math.floor(Math.random() * closingPool.length)]);

            briefing = lines.join(' ');
        } else {
            briefing = null; // First session: greeting alone is the welcome
        }

        // Speak greeting, then briefing, then memory verbalization (if meaningful delta exists).
        const sessionCtx = getSessionContext();
        setTimeout(() => {
            speakSona(openingGreet, () => {
                if (briefing) {
                    setTimeout(() => speakSona(briefing, () => {
                        // Memory verbalization: S.O.N.A speaks the delta out loud if it's meaningful
                        if (sessionCtx.spokenLine) {
                            setTimeout(() => speakSona(sessionCtx.spokenLine), 600);
                        }
                    }), 800);
                } else if (sessionCtx.spokenLine) {
                    // No briefing but we have a memory observation — speak it after greeting
                    setTimeout(() => speakSona(sessionCtx.spokenLine), 800);
                }
            });
        }, 1000);

        // ---- ANOMALY WATCHER + PROACTIVE CHECK-IN ----
        window._lastInteraction = Date.now();
        setInterval(() => {
            const idle = Date.now() - (window._lastInteraction || Date.now());
            if (idle > 60000 && !speechSynthesis.speaking && !window.isSonaSpeaking && !isThinking) {
                const bpm = parseInt(bpmVal.innerText) || 72;
                const hrv = parseInt(hrvVal.innerText) || 45;
                const o2 = o2Val.innerText;
                const tod = getTimeContext();
                let observation = null;

                // Priority 1: Anomaly observations (always fire)
                if (hrv < 38) {
                    observation = protectiveMode
                        ? `You're ignoring strain signals. Take a break. Now.`
                        : `HRV's been at ${hrv} ms for a while. Maybe step away for a few minutes.`;
                } else if (bpm > 85) {
                    observation = `Resting rate's elevated at ${bpm}. What's stressing you?`;
                } else if (o2.includes('95') || o2.includes('94')) {
                    observation = `O2's trending low. Take a breath with me.`;
                    // Priority 2: Proactive check-in when vitals are normal (~30% gate)
                } else if (Math.random() < 0.30) {
                    const fname = patientName && patientName !== 'UNKNOWN PATIENT'
                        ? patientName.charAt(0).toUpperCase() + patientName.slice(1).toLowerCase() : '';
                    const timeCheckIns = {
                        morning: [
                            `${fname ? fname + ', have' : 'Have'} you mentioned any stress today? Because if not, I want to make sure that's actually true and not just you not talking about it.`,
                            `Morning's almost through. How's the energy tracking so far?`
                        ],
                        afternoon: [
                            `It's been quiet. Everything alright on your end?`,
                            `${fname ? fname + ', ' : ''}midday dip is normal — but is that what's going on, or is something else at play?`
                        ],
                        evening: [
                            `${fname ? fname + ', ' : ''}you've been pretty quiet. How was the day, honestly?`,
                            `Everything looks stable on my end. How are you holding up?`
                        ],
                        night: [
                            `It's late and you're still here. Is that intentional?`,
                            `You should probably be winding down. What's keeping you up?`
                        ]
                    };
                    const pool = timeCheckIns[tod] || timeCheckIns.afternoon;
                    observation = pool[Math.floor(Math.random() * pool.length)];
                }

                if (observation) {
                    logMedical("[AMBIENT] Proactive check-in triggered.", "#666");
                    speakSona(observation);
                    window._lastInteraction = Date.now();
                }
            }
        }, 30000);

        const container = document.getElementById("webgl-container");
        scene = new THREE.Scene();

        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.z = 140; // Sweet spot: massive, but contained inside the scanner brackets

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);

        // 1. Central Complex Double-Icosahedron (The Beating Heart)
        medicalCore = new THREE.Group();

        const innerHeartGeo = new THREE.IcosahedronGeometry(8, 0);
        const innerHeartMat = new THREE.MeshBasicMaterial({
            color: 0xff2a55,
            wireframe: true,
            transparent: true,
            opacity: 0.9
        });
        const innerHeart = new THREE.Mesh(innerHeartGeo, innerHeartMat);

        const outerHeartGeo = new THREE.IcosahedronGeometry(13, 1);
        const outerHeartMat = new THREE.MeshBasicMaterial({
            color: 0x00e5ff,
            wireframe: true,
            transparent: true,
            opacity: 0.4
        });
        const outerHeart = new THREE.Mesh(outerHeartGeo, outerHeartMat);

        medicalCore.add(innerHeart);
        medicalCore.add(outerHeart);
        scene.add(medicalCore);

        // 2. Abstract Geometric Hologram (Simulating a full body lattice/spine structure)
        const pointCount = 6000;
        const geometry = new THREE.BufferGeometry();

        const torsoPos = [];
        const brainPos = [];
        const dnaPos = [];
        const currentPos = []; // The live positions
        const colors = [];

        for (let i = 0; i < pointCount; i++) {
            // -- SHAPE 1: Torso (Default) --
            const y1 = (Math.random() - 0.5) * 120;
            const r1 = 20 + Math.sin(y1 * 0.05) * 8;
            const t1 = Math.random() * Math.PI * 2;
            const x1 = Math.cos(t1) * r1 + (Math.random() - 0.5) * 2;
            const z1 = Math.sin(t1) * r1 * 0.5 + (Math.random() - 0.5) * 2;
            torsoPos.push(x1, y1, z1);
            currentPos.push(x1, y1, z1);

            // -- SHAPE 2: Brain --
            // Generate a squished sphere (two hemispheres)
            const phi = Math.acos((Math.random() * 2) - 1);
            const theta = Math.random() * Math.PI * 2;
            const br = 25 + (Math.random() * 5); // Radius with noise for folds
            let bx = br * Math.sin(phi) * Math.cos(theta);
            let by = br * Math.cos(phi) * 0.8 + 30; // Shifted up slightly, squished height
            let bz = br * Math.sin(phi) * Math.sin(theta) * 0.9;
            // Add hemisphere gap
            if (bx > 0) bx += 2; else bx -= 2;
            brainPos.push(bx, by, bz);

            // -- SHAPE 3: Energy Body / Neural Avatar --
            // Generate a humanoid shape: Head, Torso/Spine, Arms, and scattered neural connections
            const bodyY = (Math.random() - 0.5) * 160; // Full height
            let nx = 0, ny = bodyY, nz = 0;

            if (ny > 60) {
                // Head (Sphere)
                const hr = 15;
                const hphi = Math.acos((Math.random() * 2) - 1);
                const htheta = Math.random() * Math.PI * 2;
                nx = hr * Math.sin(hphi) * Math.cos(htheta);
                ny = hr * Math.cos(hphi) + 70;
                nz = hr * Math.sin(hphi) * Math.sin(htheta);
            } else if (ny > 20 && ny <= 60 && Math.random() > 0.4) {
                // Shoulders / Chest (Wide)
                const width = (60 - ny) * 1.2; // Gets wider going down from neck
                nx = (Math.random() - 0.5) * width * 2;
                nz = (Math.random() - 0.5) * 15;
            } else if (ny > -20 && ny <= 40 && Math.random() > 0.7) {
                // Arms (Branching outwards/downwards from shoulders)
                const armSide = Math.random() > 0.5 ? 1 : -1;
                const armT = Math.random();
                nx = armSide * (30 + armT * 40); // Extend out
                ny = 40 - (armT * 60); // Angle down
                nz = (Math.random() - 0.5) * 10;

                // Add "neural bursts" at the hands
                if (armT > 0.8 && Math.random() > 0.5) {
                    nx += (Math.random() - 0.5) * 20;
                    ny += (Math.random() - 0.5) * 20;
                    nz += (Math.random() - 0.5) * 20;
                }
            } else {
                // Spine / Torso / Core (Dense central pillar)
                const width = 15 + Math.sin(ny * 0.05) * 10;
                nx = (Math.random() - 0.5) * width;
                nz = (Math.random() - 0.5) * width;
            }

            // Add jitter/noise for the "energy/neural" look
            nx += (Math.random() - 0.5) * 3;
            ny += (Math.random() - 0.5) * 3;
            nz += (Math.random() - 0.5) * 3;

            dnaPos.push(nx, ny, nz);

            // Color gradient (Energy Body uses deep blues, cyans, and bright white/yellow hot spots)
            const color = new THREE.Color();
            color.setHSL(0.5 + Math.random() * 0.1, 1.0, 0.4 + Math.random() * 0.3);
            colors.push(color.r, color.g, color.b);
        }

        // Store target array globally for morphing
        window.targetThreePos = torsoPos;
        window.targetThreeColor = colors;
        window.startThreePos = currentPos.slice();

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(currentPos, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 1.2,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });

        particleSystem = new THREE.Points(geometry, material);
        scene.add(particleSystem);

        let isHeartMatrixActive = false;
        let lastBeatTime = 0;
        const BPM = 72;
        const beatInterval = 60 / BPM;

        let heartAudioCtx = null;
        function playHeartbeat() {
            if (!heartAudioCtx) heartAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (heartAudioCtx.state === 'suspended') heartAudioCtx.resume();

            function makeThump(startTime, isSecond) {
                const osc = heartAudioCtx.createOscillator();
                const gain = heartAudioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(isSecond ? 100 : 80, startTime);
                osc.frequency.exponentialRampToValueAtTime(30, startTime + 0.1);

                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(0.4, startTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2);

                osc.connect(gain);
                gain.connect(heartAudioCtx.destination);
                osc.start(startTime);
                osc.stop(startTime + 0.2);
            }

            const t = heartAudioCtx.currentTime;
            makeThump(t, false);     // Lub
            makeThump(t + 0.18, true); // Dub
        }

        // Morph Logic Bindings
        document.getElementById("btn-morph-heart").addEventListener("click", (e) => {
            window.targetThreePos = window.heartHologramData ? window.heartHologramData.positions : torsoPos;
            window.targetThreeColor = window.heartHologramData ? window.heartHologramData.colors : colors;
            isHeartMatrixActive = true;
            // Force immediate beat on click for impact
            lastBeatTime = 0;
            if (e.isTrusted) speakSona("Opening cardiovascular matrix.");
        });
        document.getElementById("btn-morph-brain").addEventListener("click", (e) => {
            window.targetThreePos = brainPos;
            window.targetThreeColor = colors;
            isHeartMatrixActive = false;
            if (e.isTrusted) speakSona("Switching to neural view.");
        });
        document.getElementById("btn-morph-dna").addEventListener("click", (e) => {
            window.targetThreePos = window.customHologramData ? window.customHologramData.positions : dnaPos;
            window.targetThreeColor = window.customHologramData ? window.customHologramData.colors : colors;
            isHeartMatrixActive = false;
            if (e.isTrusted) speakSona("Constructing full-body model.");
        });

        // ---- RENDER LOOP ----
        const clock = new THREE.Clock();

        let pointer = new THREE.Vector2();
        document.addEventListener("mousemove", (event) => {
            pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
            pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
        });

        function animate() {
            requestAnimationFrame(animate);
            const time = clock.getElapsedTime();

            // Frame-based morphing logic
            const currentPositionAttr = particleSystem.geometry.attributes.position;
            const pts = currentPositionAttr.array;
            const targetPts = window.targetThreePos;

            for (let i = 0; i < pts.length; i++) {
                // Lerp towards target
                pts[i] += (targetPts[i] - pts[i]) * 0.05;
            }
            currentPositionAttr.needsUpdate = true;

            const targetCols = window.targetThreeColor;
            if (targetCols) {
                const currentColorAttr = particleSystem.geometry.attributes.color;
                const cols = currentColorAttr.array;
                for (let i = 0; i < cols.length; i++) {
                    cols[i] += (targetCols[i] - cols[i]) * 0.05;
                }
                currentColorAttr.needsUpdate = true;
            }

            // Heartbeat scale pulse for the inner core
            const pulse = 1 + Math.sin(time * 6) * 0.08;
            medicalCore.scale.set(pulse, pulse, pulse);

            // "Watching" physics: Entire lattice slowly rotates to follow mouse
            const targetRotationX = pointer.y * 0.3;
            const targetRotationY = pointer.x * 0.4;

            particleSystem.rotation.x += (targetRotationX - particleSystem.rotation.x) * 0.05;
            particleSystem.rotation.y += (targetRotationY - particleSystem.rotation.y) * 0.05;
            medicalCore.rotation.x += (targetRotationX - medicalCore.rotation.x) * 0.05;
            medicalCore.rotation.y += (targetRotationY - medicalCore.rotation.y) * 0.05;

            // Dynamic Heartbeat Pumping & Audio Sync
            if (isHeartMatrixActive) {
                if (time - lastBeatTime > beatInterval) {
                    // Only play sound if S.O.N.A is not actively speaking
                    if (!window.speechSynthesis.speaking) {
                        playHeartbeat();
                    }
                    lastBeatTime = time;
                }

                const progress = time - lastBeatTime;
                let hPulse = 1.0;

                // Animate the physical 3D scale based on the lub-dub timing
                if (progress < 0.1) {
                    hPulse = 1.0 + Math.sin(progress * Math.PI * 10) * 0.15; // First pump (+15%)
                } else if (progress > 0.18 && progress < 0.28) {
                    hPulse = 1.0 + Math.sin((progress - 0.18) * Math.PI * 10) * 0.08; // Second pump (+8%)
                }
                particleSystem.scale.set(hPulse, hPulse, hPulse);
                particleSystem.rotation.y += 0.001; // Slower idle spin for the heart
            } else {
                particleSystem.scale.set(1, 1, 1);
                particleSystem.rotation.y += 0.002; // Normal idle spin
            }

            // Slow idle spin for the inner core
            medicalCore.rotation.y -= 0.01;
            medicalCore.rotation.z += 0.005;

            renderer.render(scene, camera);
        }

        animate();

        window.addEventListener("resize", () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    // ---- KEYBOARD SHORTCUT: Ctrl+Shift+E = Emergency Demo ----
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'E') {
            e.preventDefault();
            window._lastInteraction = Date.now();
            processPatientQuery("what happens if my bpm exceeds 141");
        }
    });

    // ---- FINAL: Handle Skip-Intro Timing (Wait for all Three.js/EKG modules to be ready) ----
    if (urlParams.get('skip_intro') === 'true') {
        const startOverlay = document.getElementById("start-overlay");
        if (startOverlay) startOverlay.style.display = "none";
        // Small delay to ensure all DOM refs and Three.js buffers are settled
        setTimeout(() => {
            initSystem();
        }, 300);
    }
});
