"""Motor de voz local de Jarvis: Vosk (wake word), WebRTC VAD y Whisper."""

from collections import deque
from pathlib import Path
import ctypes
import gc
import json
import math
import os
import queue
import re
import signal
import sys
import threading
import time
import unicodedata
import wave


def configure_local_cuda_dlls():
    """Expone DLL de CUDA instaladas solo dentro del venv de voz."""
    if os.name != "nt":
        return
    packages = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    for relative in ("cublas/bin", "cudnn/bin"):
        folder = packages / relative
        if folder.exists():
            os.add_dll_directory(str(folder))
            os.environ["PATH"] = f"{folder}{os.pathsep}{os.environ.get('PATH', '')}"


configure_local_cuda_dlls()

import numpy as np
import psutil
import requests
import sounddevice as sd
try:
    import webrtcvad
except ImportError:
    webrtcvad = None
from vosk import KaldiRecognizer, Model, SetLogLevel


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
DATA = PROJECT / "backend" / "data"
SETTINGS_PATH = DATA / "voice_settings.json"
STATE_PATH = DATA / "local_voice_state.json"
TEMP_WAV = DATA / "local_voice_utterance.wav"
VOSK_PATH = ROOT / "models" / "vosk-model-small-es-0.42"
WHISPER_ROOT = ROOT / "models" / "faster-whisper"
VOICE_LEXICON_PATH = DATA / "voice_lexicon.json"
NODE_URL = os.getenv("JARVIS_NODE_URL", "http://127.0.0.1:3000")
SAMPLE_RATE = 16000
FRAME_MS = 30
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
FRAME_BYTES = FRAME_SAMPLES * 2
WAKE_WORDS = (
    "prendete", "prende", "prende te", "encendete", "encende",
    "despertate", "despierta", "desperta", "reactivate", "reactiva",
    "activate", "activa", "arriba", "levantate"
)
NAME_WORDS = ("jarvis", "yarvis", "charvis", "harvis")

audio_queue = queue.Queue(maxsize=300)
running = True
input_sample_rate = SAMPLE_RATE
resample_coordinates = {}
tts_active = threading.Event()
tts_lock = threading.Lock()
tts_generation = 0
tts_pending = deque()
tts_worker_running = False
server_tts_active = threading.Event()
tts_quiet_until = 0.0
instance_mutex_handle = None
device_cache = {"items": None, "checked_at": 0.0}


def acquire_single_instance():
    """Impide dos micrófonos simultáneos aunque el lanzador se ejecute dos veces."""
    global instance_mutex_handle
    if os.name != "nt":
        return True
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel32.CreateMutexW(None, False, "Local\\JarvisLocalVoiceEngine_Rodrigo")
    if not handle:
        return False
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        kernel32.CloseHandle(ctypes.c_void_p(handle))
        return False
    instance_mutex_handle = handle
    return True


def normalized(text):
    value = unicodedata.normalize("NFD", str(text or "").lower())
    return re.sub(r"\s+", " ", "".join(c for c in value if unicodedata.category(c) != "Mn")).strip()


def collapse_repeated_transcript(text):
    """Elimina bucles del decodificador sin alterar una frase normal."""
    tokens = re.findall(r"[\wáéíóúüñÁÉÍÓÚÜÑ]+", str(text or ""), flags=re.UNICODE)
    if len(tokens) < 3:
        return str(text or "").strip(), False
    comparable = [normalized(token) for token in tokens]
    output = []
    changed = False
    index = 0
    while index < len(tokens):
        best_size = 0
        best_repeats = 1
        maximum = min(14, (len(tokens) - index) // 2)
        for size in range(1, maximum + 1):
            block = comparable[index:index + size]
            repeats = 1
            cursor = index + size
            while comparable[cursor:cursor + size] == block:
                repeats += 1
                cursor += size
            if repeats >= 2 and size * repeats > best_size * best_repeats:
                best_size, best_repeats = size, repeats
        if best_repeats >= 2:
            output.extend(tokens[index:index + best_size])
            index += best_size * best_repeats
            changed = True
        else:
            output.append(tokens[index])
            index += 1
    if len(output) >= 3 and normalized(output[0]) in ("abri", "abre", "abrir") and normalized(output[-1]) == normalized(output[0]):
        output.pop()
        changed = True
    return " ".join(output).strip(), changed


def load_settings():
    defaults = {
        "localEngineEnabled": True,
        "localDeviceIndex": None,
        "whisperModel": "turbo",
        "whisperDevice": "cuda",
        "vadAggressiveness": 2,
        "speechStartFrames": 3,
        "endSilenceMs": 2200,
        "preRollMs": 450,
        "maxUtteranceSeconds": 45,
        "localConfidenceThreshold": 0.68,
        "noiseFloor": 0.015,
        "proximityMultiplier": 1.65,
    }
    try:
        defaults.update(json.loads(SETTINGS_PATH.read_text(encoding="utf-8")))
    except Exception:
        pass
    return defaults


def read_state():
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8")).get("state", "dormant")
    except Exception:
        return "dormant"


def write_state(state):
    DATA.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps({"state": state, "updatedAt": time.time()}, indent=2), encoding="utf-8")


def devices(force=False):
    now = time.monotonic()
    if not force and device_cache["items"] is not None and now - device_cache["checked_at"] < 300:
        return device_cache["items"]
    result = []
    try:
        host_apis = sd.query_hostapis()
        for index, device in enumerate(sd.query_devices()):
            if device.get("max_input_channels", 0) > 0:
                host_name = host_apis[device.get("hostapi", 0)].get("name", "")
                result.append({"index": index, "name": f"{device.get('name', f'Micrófono {index}')} · {host_name}", "defaultSampleRate": device.get("default_samplerate")})
    except Exception:
        pass
    device_cache["items"] = result
    device_cache["checked_at"] = now
    return result


def report_status(**extra):
    payload = {
        "online": True,
        "engine": "Vosk + WebRTC VAD + faster-whisper",
        "fullyLocal": True,
        "state": read_state(),
        "devices": devices(),
        "pid": os.getpid(),
        "error": None,
        **extra,
    }
    try:
        requests.post(f"{NODE_URL}/api/voice/local/status", json=payload, timeout=2)
    except Exception:
        pass


def stop_speaking():
    global tts_generation
    with tts_lock:
        tts_generation += 1
        tts_pending.clear()
        tts_active.clear()
    try:
        requests.post(f"{NODE_URL}/api/tts/stop", timeout=2)
    except Exception:
        pass


def speak(text):
    """Habla sin bloquear el micrófono; 'apagate' puede interrumpir la salida."""
    global tts_worker_running
    if not text:
        return
    with tts_lock:
        tts_pending.append((tts_generation, str(text)))
        tts_active.set()
        if tts_worker_running:
            return
        tts_worker_running = True

    def worker():
        global tts_worker_running, tts_quiet_until
        while True:
            with tts_lock:
                if not tts_pending:
                    tts_worker_running = False
                    tts_active.clear()
                    tts_quiet_until = time.monotonic() + 0.6
                    clear_audio_queue()
                    return
                generation, phrase = tts_pending.popleft()
                if generation != tts_generation:
                    continue
            try:
                response = requests.post(f"{NODE_URL}/api/tts/speak", json={"text": phrase}, timeout=1200)
                response.raise_for_status()
            except Exception as error:
                print(f"[Voz local] TTS no disponible: {error}")

    threading.Thread(target=worker, daemon=True).start()


def monitor_server_speech():
    """También suprime el eco de recordatorios y respuestas del panel."""
    global tts_quiet_until
    while running:
        try:
            speaking = requests.get(f"{NODE_URL}/api/tts/status", timeout=2).json().get("speaking", False)
            if speaking:
                server_tts_active.set()
            else:
                if server_tts_active.is_set():
                    tts_quiet_until = time.monotonic() + 0.6
                    clear_audio_queue()
                server_tts_active.clear()
        except Exception:
            server_tts_active.clear()
        time.sleep(0.3 if read_state() == "awake" else 1.0)


def trigger_immediate_emergency():
    stop_speaking()
    def async_stop():
        try:
            requests.post(f"{NODE_URL}/api/emergency-stop", json={"source": "VOICE_IMMEDIATE"}, timeout=3)
        except Exception as e:
            print(f"[Voz local] Error enviando emergency stop: {e}")
    threading.Thread(target=async_stop, daemon=True).start()
    speak("Parada de emergencia ejecutada. Cancelé todos los procesos.")


def trigger_barge_in(reason="keyword", detected=""):
    stop_speaking()
    def async_notify():
        try:
            requests.post(
                f"{NODE_URL}/api/tts/barge-in",
                json={"reason": reason, "metadata": {"detected": str(detected)}},
                timeout=2,
            )
        except Exception:
            pass
    threading.Thread(target=async_notify, daemon=True).start()



def clear_audio_queue():
    try:
        while True:
            audio_queue.get_nowait()
    except queue.Empty:
        pass


def load_voice_lexicon():
    """Carga vocabulario aprendido sin depender de internet ni reiniciar Node."""
    try:
        payload = json.loads(VOICE_LEXICON_PATH.read_text(encoding="utf-8"))
        terms = payload.get("terms", [])
        return [str(term).strip() for term in terms if 2 < len(str(term).strip()) <= 100][:180]
    except Exception:
        return [
            "Jarvis", "BroadLink", "WhatsApp", "Netflix", "YouTube", "Discord",
            "Spotify", "Chrome", "The Walking Dead", "Haikyu", "Dorohedoro",
        ]


def heartbeat():
    while running:
        report_status(stage="listening")
        time.sleep(max(15, int(os.getenv("JARVIS_VOICE_HEARTBEAT_SECONDS", "30"))))


def warm_local_understanding():
    """Carga Qwen al despertar; no envía conversación ni audio."""
    try:
        requests.post(
            "http://127.0.0.1:11434/api/generate",
            json={
                "model": "qwen2.5:3b", "prompt": "Respondé OK.", "stream": False,
                "keep_alive": os.getenv("OLLAMA_VOICE_KEEP_ALIVE", "90s"),
                "options": {"num_predict": 2, "temperature": 0}
            },
            timeout=90,
        )
    except Exception as error:
        print(f"[Voz local] Ollama no pudo precargarse: {error}")


def unload_local_understanding():
    try:
        requests.post(
            "http://127.0.0.1:11434/api/generate",
            json={"model": "qwen2.5:3b", "prompt": "", "stream": False, "keep_alive": 0},
            timeout=10,
        )
    except Exception:
        pass


def send_to_jarvis(text, confidence, confirmed=False):
    payload = {
        "text": text,
        "confidence": confidence,
        "alternatives": [{"transcript": text, "confidence": confidence}],
        "source": "local-whisper",
        "confirmed": confirmed,
    }
    try:
        response = requests.post(f"{NODE_URL}/api/process_speech_local", json=payload, timeout=180)
        body = response.json()
        if response.status_code == 409:
            return {"confirmation": True, **body}
        response.raise_for_status()
        return body
    except Exception as error:
        return {"error": str(error), "response": "No pude comunicarme con el núcleo de Jarvis."}


def wait_for_jarvis_job(job_id, timeout_seconds=900):
    """Espera una tarea aceptada sin bloquear el micrófono ni el acuse inicial."""
    deadline = time.monotonic() + timeout_seconds
    while running and time.monotonic() < deadline:
        try:
            response = requests.get(f"{NODE_URL}/api/voice/local/jobs/{job_id}", timeout=5)
            body = response.json()
            if body.get("status") in ("completed", "failed", "missing"):
                return body
        except Exception as error:
            print(f"[Voz local] Esperando tarea {job_id}: {error}")
        time.sleep(0.45)
    return {
        "status": "failed",
        "error": "timeout",
        "response": "La tarea sigue demorando más de lo esperado. Revisá el panel para ver su estado.",
        "result": {"ok": False, "status": "failed", "verified": False},
    }


def wait_until_speech_finishes(timeout_seconds=10):
    deadline = time.monotonic() + timeout_seconds
    while tts_active.is_set() and time.monotonic() < deadline:
        time.sleep(0.05)


def audio_callback(indata, frames, callback_time, status):
    if status:
        print(f"[Voz local] Audio: {status}")
    try:
        mono = np.asarray(indata[:, 0], dtype=np.int16)
        if input_sample_rate != SAMPLE_RATE:
            output_length = int(round(len(mono) * SAMPLE_RATE / input_sample_rate))
            cache_key = (len(mono), output_length)
            if cache_key not in resample_coordinates:
                resample_coordinates[cache_key] = (
                    np.linspace(0, len(mono) - 1, output_length),
                    np.arange(len(mono)),
                )
            positions, source_positions = resample_coordinates[cache_key]
            mono = np.interp(positions, source_positions, mono).astype(np.int16)
        payload = mono[:FRAME_SAMPLES].tobytes()
        if len(payload) == FRAME_BYTES:
            audio_queue.put_nowait(payload)
    except queue.Full:
        try:
            audio_queue.get_nowait()
            audio_queue.put_nowait(payload)
        except queue.Empty:
            pass


def rms(frame):
    samples = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
    return float(math.sqrt(np.mean(samples * samples)) / 32768.0) if samples.size else 0.0


def save_wav(frames):
    DATA.mkdir(parents=True, exist_ok=True)
    with wave.open(str(TEMP_WAV), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(SAMPLE_RATE)
        target.writeframes(b"".join(frames))


class LocalVoiceEngine:
    def __init__(self):
        SetLogLevel(-1)
        self.settings = load_settings()
        self.state = read_state()
        self.pending = None
        self.suppress_until = 0.0
        if webrtcvad is not None:
            self.vad = webrtcvad.Vad(int(self.settings.get("vadAggressiveness", 2)))
        else:
            class EnergyVad:
                def __init__(self, mode=2):
                    self.threshold = 0.015 if mode == 2 else 0.02
                def is_speech(self, frame, sample_rate=16000):
                    return rms(frame) > self.threshold
            self.vad = EnergyVad(int(self.settings.get("vadAggressiveness", 2)))
        if not VOSK_PATH.exists():
            raise RuntimeError(f"Falta el modelo Vosk: {VOSK_PATH}")
        self.wake_model = Model(str(VOSK_PATH))
        wake_grammar = json.dumps([
            *NAME_WORDS, *WAKE_WORDS,
            "jarvis prendete", "prendete jarvis", "jarvis despertate", "despertate jarvis",
            "hola jarvis", "hey jarvis", "che jarvis", "ok jarvis",
            "jarvis reactivate", "jarvis activa", "activa jarvis", "jarvis encendete",
            "[unk]"
        ])
        self.wake_recognizer = KaldiRecognizer(self.wake_model, SAMPLE_RATE, wake_grammar)
        sleep_grammar = json.dumps([
            "apagate", "apaga", "jarvis apagate", "apagate jarvis",
            "dormite", "duerme", "jarvis dormite", "dormite jarvis",
            "modo descanso", "descanso", "a dormir", "a descansar",
            "reposo", "modo reposo", "[unk]"
        ])
        self.sleep_recognizer = KaldiRecognizer(self.wake_model, SAMPLE_RATE, sleep_grammar)
        barge_grammar = json.dumps([
            "para", "parate", "detente", "detene", "frena", "frenate",
            "callate", "silencio", "silenciate", "stop", "basta",
            "espera", "esperate", "corta", "cortala", "jarvis para",
            "jarvis parate", "jarvis detente", "jarvis callate",
            "jarvis stop", "jarvis silencio", "no para", "no espera",
            "jarvis apagate", "jarvis dormite",
            "[unk]"
        ])
        self.barge_recognizer = KaldiRecognizer(self.wake_model, SAMPLE_RATE, barge_grammar)
        self.whistle = None
        try:
            import needle
            self.whistle = needle.Whistle()
            print("[Voz local] [Whistle-CPU] Motor ultrarrapido (16.9 MB) listo para Fast-Path.", flush=True)
        except Exception as error:
            print(f"[Voz local] Whistle no disponible ({error}). Se usará Whisper estándar.", flush=True)
        self.whisper = None
        self.whisper_lock = threading.Lock()
        self.whisper_release_timer = None
        self.wake_name_until = 0.0
        self.wake_word_until = 0.0

    def ensure_whisper(self):
        self.cancel_whisper_release()
        with self.whisper_lock:
            self._load_whisper()

    def cancel_whisper_release(self):
        timer = self.whisper_release_timer
        self.whisper_release_timer = None
        if timer:
            timer.cancel()

    def schedule_whisper_release(self):
        """Libera el modelo grande tras un rato dormido, sin penalizar pausas breves."""
        self.cancel_whisper_release()
        delay = max(30, int(os.getenv("JARVIS_WHISPER_IDLE_UNLOAD_SECONDS", "120")))
        timer = threading.Timer(delay, self.release_whisper)
        timer.daemon = True
        self.whisper_release_timer = timer
        timer.start()

    def release_whisper(self):
        with self.whisper_lock:
            model = self.whisper
            self.whisper = None
            self.whisper_release_timer = None
        if model is not None:
            del model
            gc.collect()
            report_status(stage="dormant", whisperLoaded=False)

    def warm_whisper(self):
        try:
            self.ensure_whisper()
        except Exception as error:
            print(f"[Voz local] No pude precargar Whisper: {error}", flush=True)

    def _load_whisper(self):
        if self.whisper is not None:
            return
        # CTranslate2/CUDA reservan mucha memoria aun sin transcribir. Cargarlos
        # recién al despertar mantiene el detector Vosk liviano en reposo.
        from faster_whisper import WhisperModel
        model_name = self.settings.get("whisperModel", "turbo")
        requested_device = self.settings.get("whisperDevice", "cuda")
        device = "cuda" if requested_device in ("cuda", "auto") else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        threads = max(2, min(6, (psutil.cpu_count(logical=False) or 4) - 2))
        report_status(stage="loading-whisper", model=model_name, device=device)
        try:
            self.whisper = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
                cpu_threads=threads,
                num_workers=1,
                download_root=str(WHISPER_ROOT),
                local_files_only=True,
            )
        except Exception as error:
            if device != "cuda":
                raise
            print(f"[Voz local] CUDA no disponible ({error}). Uso CPU int8 como respaldo.")
            device, compute_type = "cpu", "int8"
            model_name = "small"  # Cached CPU model avoids running large-v3-turbo on the CPU.
            self.whisper = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
                cpu_threads=threads,
                num_workers=1,
                download_root=str(WHISPER_ROOT),
                local_files_only=True,
            )
        warm_segments, _ = self.whisper.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), language="es", beam_size=1, condition_on_previous_text=False)
        list(warm_segments)
        self.whisper_model_name = model_name
        self.whisper_device = device
        report_status(stage="ready", model=model_name, device=device, computeType=compute_type)

    def transcribe(self, frames):
        save_wav(frames)
        learned_terms = load_voice_lexicon()

        # 1. Fast-Path Ultrarrápido con Whistle en CPU (~60 ms)
        if self.whistle is not None and self.settings.get("sttEngine", "hybrid") in ("hybrid", "whistle"):
            try:
                base_keywords = [
                    "WhatsApp", "YouTube", "Netflix", "Spotify", "Chrome", "Discord", "Bloc de notas",
                    "abrir", "cerrar", "crear carpeta", "crear archivo", "nueva carpeta", "nuevo txt",
                    "buscar", "dólar", "cuánto está el dólar", "clima", "qué clima hace", "temperatura",
                    "volumen", "subir volumen", "bajar volumen", "brillo", "silencio", "mutear",
                    "minimizar", "maximizar", "escritorio", "mostrar escritorio", "nueva pestaña",
                    "recordame", "recordatorio", "consultar recordatorios", "estado de la computadora",
                    "espacio en disco", "procesos que más consumen", "leer portapapeles", "explicar decisión"
                ]
                keywords = list(dict.fromkeys(base_keywords + learned_terms[:30]))
                t_w0 = time.time()
                w_res = self.whistle.transcribe(str(TEMP_WAV), language="es", keywords=keywords)
                w_text = (w_res.get("text") or "").strip()
                ttft = w_res.get("ttft_ms", 0)
                dt_ms = (time.time() - t_w0) * 1000
                if w_text and len(w_text) >= 2:
                    print(f"[Voz local] [Whistle-CPU] Fast-Path ({dt_ms:.1f}ms, TTFT: {ttft}ms): '{w_text}'", flush=True)
                    text, repetition_collapsed = collapse_repeated_transcript(w_text)
                    frame_levels = [rms(frame) for frame in frames]
                    return text, 0.94, {
                        "language": "es",
                        "duration": len(frames) * FRAME_MS / 1000.0,
                        "segments": 1,
                        "model": "whistle-cpu-16.9mb",
                        "device": "cpu",
                        "meanRms": round(sum(frame_levels) / max(1, len(frame_levels)), 5),
                        "peakRms": round(max(frame_levels, default=0), 5),
                        "repetitionCollapsed": repetition_collapsed,
                        "rawTokenCount": len(re.findall(r"\w+", w_text, flags=re.UNICODE)),
                        "ttft_ms": ttft,
                        "provider": "whistle-cpu"
                    }
            except Exception as w_err:
                print(f"[Voz local] Whistle error ({w_err}); pasando a Whisper.", flush=True)

        # 2. Deep-Path Fallback con Whisper (GPU / Turbo)
        self.ensure_whisper()
        vocabulary_hint = ", ".join(learned_terms[:24])
        duration_seconds = len(frames) * FRAME_MS / 1000.0
        token_limit = max(24, min(192, int(duration_seconds * 6) + 18))
        segments, info = self.whisper.transcribe(
            str(TEMP_WAV), language="es", beam_size=2, best_of=1,
            temperature=0.0, condition_on_previous_text=False,
            repetition_penalty=1.15, no_repeat_ngram_size=3,
            max_new_tokens=token_limit,
            vad_filter=True, vad_parameters={"min_silence_duration_ms": 350},
            initial_prompt=(
                "Abrir WhatsApp. Abrir Netflix. Subir el brillo. Bajar el volumen. "
                f"{vocabulary_hint}."
            ),
            no_speech_threshold=0.55,
            hallucination_silence_threshold=1.0,
        )
        completed = list(segments)
        raw_text = " ".join(segment.text.strip() for segment in completed).strip()
        text, repetition_collapsed = collapse_repeated_transcript(raw_text)
        log_probability = sum(segment.avg_logprob for segment in completed) / max(1, len(completed))
        no_speech = sum(segment.no_speech_prob for segment in completed) / max(1, len(completed))
        acoustic_probability = math.exp(min(0.0, log_probability)) if completed else 0.0
        language_probability = float(getattr(info, "language_probability", 1.0) or 1.0)
        confidence = max(0.01, min(0.96, acoustic_probability * (1.0 - no_speech) * language_probability)) if completed else 0.0
        frame_levels = [rms(frame) for frame in frames]
        return text, confidence, {
            "language": info.language, "duration": info.duration, "segments": len(completed),
            "model": getattr(self, "whisper_model_name", self.settings.get("whisperModel", "turbo")),
            "device": getattr(self, "whisper_device", "unknown"),
            "meanRms": round(sum(frame_levels) / max(1, len(frame_levels)), 5),
            "peakRms": round(max(frame_levels, default=0), 5),
            "repetitionCollapsed": repetition_collapsed,
            "rawTokenCount": len(re.findall(r"\w+", raw_text, flags=re.UNICODE)),
        }

    def wake_detected(self, frame):
        # Las hipótesis parciales de una gramática pequeña suelen convertir una
        # conversación cualquiera en "activa" o "arriba". Esperamos una frase
        # final y exigimos el nombre de Jarvis junto a la activación.
        if not self.wake_recognizer.AcceptWaveform(frame):
            return False
        text = normalized(json.loads(self.wake_recognizer.Result()).get("text", ""))
        if not text:
            return False

        has_wake = any(re.search(rf"\b{re.escape(word)}\b", text) for word in WAKE_WORDS)
        has_name = any(re.search(rf"\b{re.escape(word)}\b", text) for word in NAME_WORDS)
        if has_name and has_wake:
            self.wake_name_until = self.wake_word_until = 0.0
            self.wake_recognizer.Reset()
            return True

        return False

    def sleep_detected(self, frame):
        if self.sleep_recognizer.AcceptWaveform(frame):
            text = normalized(json.loads(self.sleep_recognizer.Result()).get("text", ""))
        else:
            text = normalized(json.loads(self.sleep_recognizer.PartialResult()).get("partial", ""))
        if not text:
            return False

        # No apagar si se está hablando de apagar la tele o luces
        if any(dev in text for dev in ("tele", "television", "tv", "luz", "aire")):
            return False

        detected = any(w in text for w in (
            "apagate", "apaga", "dormite", "duerme", "modo descanso",
            "descanso", "a dormir", "a descansar", "reposo", "modo reposo"
        ))
        if detected:
            self.sleep_recognizer.Reset()
        return detected

    def barge_detected(self, frame):
        if self.barge_recognizer.AcceptWaveform(frame):
            text = normalized(json.loads(self.barge_recognizer.Result()).get("text", ""))
        else:
            return False, ""
        if not text:
            return False, ""

        detected_words = (
            "para", "parate", "detente", "detene", "frena", "frenate",
            "callate", "silencio", "silenciate", "stop", "basta",
            "espera", "esperate", "corta", "cortala", "apagate", "dormite"
        )
        for w in detected_words:
            if re.fullmatch(r"(?:jarvis|yarvis|charvis|harvis)\s+" + w, text):
                self.barge_recognizer.Reset()
                return True, w
        return False, ""

    def handle_transcript(self, text, confidence, metadata):
        if not text:
            return
        print(f"[Voz local] {text!r} confianza={confidence:.2f}")
        report_status(stage="understood", transcript=text, confidence=confidence, metadata=metadata)
        clean = normalized(text)

        # 0. Parada de Emergencia Inmediata (Prioridad Absoluta)
        if re.search(r"\b(?:deten(?:er)?\s+todo|par(?:ar)?\s+todo|abortar|emergencia|cancel(?:ar)?\s+todo|detente|parate|cancela|detene|parar)\b", clean):
            trigger_immediate_emergency()
            clear_audio_queue()
            self.suppress_until = time.monotonic() + 0.5
            return

        def async_execution():
            if self.pending:
                if re.search(r"\b(si|sí|correcto|exacto|confirmo)\b", clean):
                    original = self.pending
                    self.pending = None
                    result = send_to_jarvis(original, 1.0, confirmed=True)
                elif re.search(r"\b(no|cancela|cancelar)\b", clean) and "dije" not in clean:
                    self.pending = None
                    speak("Cancelado. Volvé a decirme la orden completa.")
                    return
                else:
                    corrected = re.sub(r"^.*?\bdije\b\s*", "", text, flags=re.I).strip() or text
                    original = self.pending
                    self.pending = None
                    try:
                        requests.post(f"{NODE_URL}/api/memory/corrections", json={"from": original, "to": corrected}, timeout=3)
                    except Exception:
                        pass
                    result = send_to_jarvis(corrected, 1.0, confirmed=True)
            else:
                result = send_to_jarvis(text, confidence)

            background_job_id = result.get("backgroundJobId")
            if background_job_id:
                speak(result.get("response") or "Okey, jefe. Me pongo a trabajar.")
                result = wait_for_jarvis_job(background_job_id)
                # Si la acción terminó muy rápido, dejamos terminar el acuse para
                # que la respuesta final no lo corte a mitad de frase.
                wait_until_speech_finishes()

            if result.get("confirmation"):
                self.pending = result.get("text", text)
                speak(f"Entendí: {self.pending}. ¿Es correcto?")
                clear_audio_queue()
                self.suppress_until = time.monotonic() + 0.8
                return
            if result.get("error"):
                # Si el núcleo se reinicia o deja de responder, no seguimos
                # interpretando conversación ambiente como órdenes autónomas.
                self.state = "dormant"
                self.pending = None
                write_state(self.state)
                self.schedule_whisper_release()
                clear_audio_queue()
                report_status(stage="dormant", state="dormant", stageDetail="node_unavailable")
                speak("Perdí la conexión con el núcleo. Quedé en reposo.")
                return
            response_text = result.get("response") or result.get("result", {}).get("message") or result.get("error")
            voice_state = result.get("result", {}).get("data", {}).get("voiceState")
            if voice_state == "dormant":
                stop_speaking()
                self.state = "dormant"
                write_state(self.state)
                self.schedule_whisper_release()
                threading.Thread(target=unload_local_understanding, daemon=True).start()
                clear_audio_queue()
                report_status(stage="dormant", state="dormant")
                return
            elif voice_state == "awake":
                self.state = "awake"
                write_state(self.state)
                self.cancel_whisper_release()
                report_status(stage="awake", state="awake")

            speak(response_text)
            clear_audio_queue()
            self.suppress_until = time.monotonic() + 0.9

        # Desacoplar ejecución para que el micrófono y el bucle de audio nunca se congelen
        threading.Thread(target=async_execution, daemon=True).start()

    def run(self):
        global input_sample_rate
        device = self.settings.get("localDeviceIndex")
        device = int(device) if str(device).isdigit() else None
        if device is None:
            # En notebooks, el predeterminado de Windows puede apuntar a un jack
            # de auriculares sin micrófono. Priorizamos el arreglo integrado.
            host_apis = sd.query_hostapis()
            for index, candidate in enumerate(sd.query_devices()):
                host_name = host_apis[candidate.get("hostapi", 0)].get("name", "")
                if (candidate.get("max_input_channels", 0) > 0
                        and "Microphone Array" in candidate.get("name", "")
                        and "WASAPI" in host_name):
                    device = index
                    break
        if device is None:
            for api in sd.query_hostapis():
                if "WASAPI" in api.get("name", "") and api.get("default_input_device", -1) >= 0:
                    device = api["default_input_device"]
                    break
        device_info = sd.query_devices(device, "input")
        input_sample_rate = int(device_info.get("default_samplerate", SAMPLE_RATE))
        input_blocksize = input_sample_rate * FRAME_MS // 1000
        pre_frames = max(1, int(self.settings["preRollMs"] / FRAME_MS))
        end_frames = max(4, int(self.settings["endSilenceMs"] / FRAME_MS))
        max_frames = int(self.settings["maxUtteranceSeconds"] * 1000 / FRAME_MS)
        minimum_voice_level = max(0.006, min(0.08, float(self.settings.get("noiseFloor", 0.015))))
        pre_roll = deque(maxlen=pre_frames)
        utterance = []
        voiced_streak = 0
        silent_streak = 0
        tts_overlap_streak = 0
        capturing = False
        report_status(stage="listening", device=device)
        if self.state == "awake":
            threading.Thread(target=self.warm_whisper, daemon=True).start()

        with sd.InputStream(
            samplerate=input_sample_rate, blocksize=input_blocksize, device=device,
            channels=1, dtype="int16", callback=audio_callback,
        ):
            state_check_frames = 0
            while running:
                frame = audio_queue.get()
                state_check_frames += 1
                if state_check_frames >= 33:
                    state_check_frames = 0
                    external_state = read_state()
                    if external_state != self.state:
                        self.state = external_state
                        self.pending = None
                        report_status(stage=self.state)
                        if self.state == "awake":
                            threading.Thread(target=self.warm_whisper, daemon=True).start()
                        else:
                            stop_speaking()
                            clear_audio_queue()
                            self.wake_recognizer.Reset()
                            self.sleep_recognizer.Reset()
                            self.suppress_until = time.monotonic() + 2.0
                            self.schedule_whisper_release()
                            threading.Thread(target=unload_local_understanding, daemon=True).start()
                if len(frame) != FRAME_BYTES or time.monotonic() < self.suppress_until:
                    continue

                if self.state == "dormant":
                    if self.wake_detected(frame):
                        self.state = "awake"
                        write_state(self.state)
                        self.cancel_whisper_release()
                        report_status(stage="awake", state="awake")
                        threading.Thread(target=self.warm_whisper, daemon=True).start()
                        speak("Estoy en línea. ¿Qué necesitás?")
                        clear_audio_queue()
                        self.suppress_until = time.monotonic() + 1.0
                    continue

                # Mientras Jarvis habla no transcribimos su propia voz. Conservamos
                # un reconocedor mínimo y barato exclusivamente para interrumpirlo.
                if tts_active.is_set() or server_tts_active.is_set():
                    # 2. Barge-in por palabra clave ("pará", "detente", "silencio", "stop", etc.)
                    is_barge, barge_word = self.barge_detected(frame)
                    if is_barge:
                        print(f"[Voz local] Barge-in detectado por palabra clave: {barge_word!r}")
                        trigger_barge_in(reason="keyword", detected=barge_word)
                        if barge_word in ("apagate", "dormite"):
                            self.state = "dormant"
                            self.pending = None
                            write_state(self.state)
                            self.schedule_whisper_release()
                            report_status(stage="dormant")
                        clear_audio_queue()
                        self.suppress_until = time.monotonic() + 0.15
                        tts_overlap_streak = 0
                        report_status(stage="listening", stageDetail=f"barge_in_{barge_word}")
                        continue

                    # 3. Barge-in acústico por voz humana sobre el audio
                    level = rms(frame)
                    is_speech = self.vad.is_speech(frame, SAMPLE_RATE)
                    if self.settings.get("acousticBargeInEnabled", False) and is_speech and level >= minimum_voice_level * 2.8:
                        tts_overlap_streak += 1
                        if tts_overlap_streak >= 4:  # ~120ms continuos de voz
                            print(f"[Voz local] Barge-in acústico detectado (RMS={level:.3f})")
                            trigger_barge_in(reason="acoustic_vad", detected="voice_overlap")
                            clear_audio_queue()
                            self.suppress_until = time.monotonic() + 0.10
                            tts_overlap_streak = 0
                            capturing = True
                            utterance = [frame]
                            silent_streak = 0
                            report_status(stage="recording", level=level, bargeIn=True)
                    else:
                        tts_overlap_streak = max(0, tts_overlap_streak - 1)

                    continue
                else:
                    tts_overlap_streak = 0

                if time.monotonic() < tts_quiet_until:
                    capturing = False
                    utterance = []
                    pre_roll.clear()
                    voiced_streak = 0
                    continue

                is_voice = self.vad.is_speech(frame, SAMPLE_RATE)
                level = rms(frame)
                is_near_voice = is_voice and level >= minimum_voice_level
                pre_roll.append(frame)
                if not capturing:
                    voiced_streak = voiced_streak + 1 if is_near_voice else 0
                    if voiced_streak >= int(self.settings["speechStartFrames"]):
                        capturing = True
                        utterance = list(pre_roll)
                        silent_streak = 0
                        report_status(stage="recording", level=level)
                else:
                    utterance.append(frame)
                    silent_streak = 0 if is_voice else silent_streak + 1
                    if silent_streak >= end_frames or len(utterance) >= max_frames:
                        capturing = False
                        voiced_streak = 0
                        captured = utterance[:-silent_streak] if silent_streak else utterance
                        utterance = []
                        if len(captured) * FRAME_MS >= 450:
                            try:
                                text, confidence, metadata = self.transcribe(captured)
                                self.handle_transcript(text, confidence, metadata)
                                clear_audio_queue()
                            except Exception as error:
                                print(f"[Voz local] Error de transcripción: {error}")
                                report_status(stage="error", error=str(error))
                                speak("No pude transcribir esa frase. Repetila, por favor.")


def stop(*_):
    global running
    running = False


if __name__ == "__main__":
    if "--diagnose" in sys.argv:
        print(json.dumps({"devices": devices(), "voskModel": VOSK_PATH.exists(), "whisperRoot": WHISPER_ROOT.exists()}, indent=2, ensure_ascii=False))
        engine = LocalVoiceEngine()
        engine.ensure_whisper()
        print("LOCAL_VOICE_DIAGNOSTIC_OK")
        sys.exit(0)
    if not acquire_single_instance():
        print("[Voz local] Ya existe una instancia activa; no se inicia otra.")
        sys.exit(0)
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    write_state(read_state())
    try:
        threading.Thread(target=heartbeat, daemon=True).start()
        threading.Thread(target=monitor_server_speech, daemon=True).start()
        LocalVoiceEngine().run()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(f"[Voz local] Error fatal: {error}")
        report_status(online=False, stage="fatal", error=str(error))
        sys.exit(1)
