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
import webrtcvad
from faster_whisper import WhisperModel
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
tts_active = threading.Event()
tts_lock = threading.Lock()
tts_generation = 0
instance_mutex_handle = None


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


def devices():
    result = []
    try:
        host_apis = sd.query_hostapis()
        for index, device in enumerate(sd.query_devices()):
            if device.get("max_input_channels", 0) > 0:
                host_name = host_apis[device.get("hostapi", 0)].get("name", "")
                result.append({"index": index, "name": f"{device.get('name', f'Micrófono {index}')} · {host_name}", "defaultSampleRate": device.get("default_samplerate")})
    except Exception:
        pass
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
        tts_active.clear()
    try:
        requests.post(f"{NODE_URL}/api/tts/stop", timeout=2)
    except Exception:
        pass


def speak(text):
    """Habla sin bloquear el micrófono; 'apagate' puede interrumpir la salida."""
    if not text:
        return
    stop_speaking()
    with tts_lock:
        generation = tts_generation
        tts_active.set()

    def worker():
        try:
            requests.post(f"{NODE_URL}/api/tts/speak", json={"text": text}, timeout=max(15, len(text) / 8))
        except Exception as error:
            print(f"[Voz local] TTS no disponible: {error}")
        finally:
            with tts_lock:
                if generation == tts_generation:
                    tts_active.clear()

    threading.Thread(target=worker, daemon=True).start()


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
        time.sleep(7)


def warm_local_understanding():
    """Carga Qwen al despertar; no envía conversación ni audio."""
    try:
        requests.post(
            "http://127.0.0.1:11434/api/generate",
            json={
                "model": "qwen2.5:3b", "prompt": "Respondé OK.", "stream": False,
                "keep_alive": "5m", "options": {"num_predict": 2, "temperature": 0}
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


def audio_callback(indata, frames, callback_time, status):
    if status:
        print(f"[Voz local] Audio: {status}")
    try:
        mono = np.asarray(indata[:, 0], dtype=np.int16)
        if input_sample_rate != SAMPLE_RATE:
            output_length = int(round(len(mono) * SAMPLE_RATE / input_sample_rate))
            positions = np.linspace(0, len(mono) - 1, output_length)
            mono = np.interp(positions, np.arange(len(mono)), mono).astype(np.int16)
        payload = mono[:FRAME_SAMPLES].tobytes()
        if len(payload) == FRAME_BYTES:
            audio_queue.put_nowait(payload)
    except queue.Full:
        try:
            audio_queue.get_nowait()
            audio_queue.put_nowait(bytes(indata))
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
        self.vad = webrtcvad.Vad(int(self.settings["vadAggressiveness"]))
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
            "[unk]"
        ])
        self.barge_recognizer = KaldiRecognizer(self.wake_model, SAMPLE_RATE, barge_grammar)
        self.whisper = None
        self.wake_name_until = 0.0
        self.wake_word_until = 0.0
        self.last_state_check = 0.0

    def ensure_whisper(self):
        if self.whisper is not None:
            return
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
            self.whisper = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
                cpu_threads=threads,
                num_workers=1,
                download_root=str(WHISPER_ROOT),
                local_files_only=True,
            )
        self.whisper_device = device
        report_status(stage="ready", model=model_name, device=device, computeType=compute_type)

    def transcribe(self, frames):
        self.ensure_whisper()
        save_wav(frames)
        learned_terms = load_voice_lexicon()
        vocabulary_hint = ", ".join(learned_terms[:60])
        duration_seconds = len(frames) * FRAME_MS / 1000.0
        token_limit = max(24, min(192, int(duration_seconds * 6) + 18))
        segments, info = self.whisper.transcribe(
            str(TEMP_WAV), language="es", beam_size=6, best_of=6,
            temperature=0.0, condition_on_previous_text=False,
            repetition_penalty=1.15, no_repeat_ngram_size=3,
            max_new_tokens=token_limit,
            vad_filter=True, vad_parameters={"min_silence_duration_ms": 350},
            initial_prompt=(
                "Transcripción literal en español rioplatense. No repitas palabras ni inventes texto. "
                f"Vocabulario posible: {vocabulary_hint}"
            ),
            hotwords=" ".join(learned_terms[:80]),
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
            "model": self.settings.get("whisperModel", "turbo"),
            "device": getattr(self, "whisper_device", "unknown"),
            "meanRms": round(sum(frame_levels) / max(1, len(frame_levels)), 5),
            "peakRms": round(max(frame_levels, default=0), 5),
            "repetitionCollapsed": repetition_collapsed,
            "rawTokenCount": len(re.findall(r"\w+", raw_text, flags=re.UNICODE)),
        }

    def wake_detected(self, frame):
        if self.wake_recognizer.AcceptWaveform(frame):
            text = normalized(json.loads(self.wake_recognizer.Result()).get("text", ""))
        else:
            text = normalized(json.loads(self.wake_recognizer.PartialResult()).get("partial", ""))
        if not text:
            return False

        now = time.monotonic()
        # Frases directas y completas
        if any(p in text for p in ("jarvis prendete", "prendete jarvis", "jarvis despertate", "despertate jarvis", "hola jarvis", "hey jarvis", "ok jarvis")):
            self.wake_name_until = self.wake_word_until = 0.0
            self.wake_recognizer.Reset()
            return True

        has_wake = any(word in text for word in WAKE_WORDS)
        has_name = any(word in text for word in NAME_WORDS)

        # Si dijo cualquier palabra clave para despertar ("prendete", "despertate", "activa", "arriba")
        if has_wake:
            self.wake_name_until = self.wake_word_until = 0.0
            self.wake_recognizer.Reset()
            return True

        if has_name:
            self.wake_name_until = now + 2.5

        # Si dijo "jarvis" solo y limpio
        if text.strip() in ("jarvis", "hola jarvis", "hey jarvis"):
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
            text = normalized(json.loads(self.barge_recognizer.PartialResult()).get("partial", ""))
        if not text:
            return False, ""

        detected_words = (
            "para", "parate", "detente", "detene", "frena", "frenate",
            "callate", "silencio", "silenciate", "stop", "basta",
            "espera", "esperate", "corta", "cortala"
        )
        for w in detected_words:
            if w in text:
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

            if result.get("confirmation"):
                self.pending = result.get("text", text)
                speak(f"Entendí: {self.pending}. ¿Es correcto?")
                clear_audio_queue()
                self.suppress_until = time.monotonic() + 0.8
                return
            response_text = result.get("response") or result.get("result", {}).get("message") or result.get("error")
            voice_state = result.get("result", {}).get("data", {}).get("voiceState")
            if voice_state == "dormant":
                stop_speaking()
                self.state = "dormant"
                write_state(self.state)
                self.whisper = None
                gc.collect()
                threading.Thread(target=unload_local_understanding, daemon=True).start()
                clear_audio_queue()
                report_status(stage="dormant", state="dormant")
                return
            elif voice_state == "awake":
                self.state = "awake"
                write_state(self.state)
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
            threading.Thread(target=warm_local_understanding, daemon=True).start()

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
                            threading.Thread(target=warm_local_understanding, daemon=True).start()
                        else:
                            stop_speaking()
                            clear_audio_queue()
                            self.wake_recognizer.Reset()
                            self.sleep_recognizer.Reset()
                            self.suppress_until = time.monotonic() + 2.0
                            self.whisper = None
                            gc.collect()
                            threading.Thread(target=unload_local_understanding, daemon=True).start()
                if len(frame) != FRAME_BYTES or time.monotonic() < self.suppress_until:
                    continue

                now = time.monotonic()
                if now - self.last_state_check > 0.8:
                    self.last_state_check = now
                    disk_state = read_state()
                    if disk_state != self.state:
                        print(f"[Voz local] Estado sincronizado desde sistema: {disk_state}")
                        self.state = disk_state
                        if self.state == "dormant":
                            stop_speaking()
                            self.whisper = None
                            gc.collect()
                            threading.Thread(target=unload_local_understanding, daemon=True).start()
                            clear_audio_queue()
                            report_status(stage="dormant", state="dormant")
                        else:
                            threading.Thread(target=warm_local_understanding, daemon=True).start()
                            report_status(stage="awake", state="awake")

                if self.state == "dormant":
                    if self.wake_detected(frame):
                        self.state = "awake"
                        write_state(self.state)
                        report_status(stage="awake", state="awake")
                        threading.Thread(target=warm_local_understanding, daemon=True).start()
                        speak("Estoy en línea. ¿Qué necesitás?")
                        clear_audio_queue()
                        self.suppress_until = time.monotonic() + 1.0
                    continue

                # Mientras Jarvis habla no transcribimos su propia voz. Conservamos
                # un reconocedor mínimo y barato exclusivamente para interrumpirlo.
                if tts_active.is_set():
                    # 1. Apagado explícito hacia reposo ("apagate", "dormite")
                    if self.sleep_detected(frame):
                        stop_speaking()
                        self.state = "dormant"
                        self.pending = None
                        write_state(self.state)
                        self.whisper = None
                        gc.collect()
                        clear_audio_queue()
                        report_status(stage="dormant")
                        threading.Thread(target=unload_local_understanding, daemon=True).start()
                        tts_overlap_streak = 0
                        continue

                    # 2. Barge-in por palabra clave ("pará", "detente", "silencio", "stop", etc.)
                    is_barge, barge_word = self.barge_detected(frame)
                    if is_barge:
                        print(f"[Voz local] Barge-in detectado por palabra clave: {barge_word!r}")
                        trigger_barge_in(reason="keyword", detected=barge_word)
                        clear_audio_queue()
                        self.suppress_until = time.monotonic() + 0.15
                        tts_overlap_streak = 0
                        report_status(stage="listening", stageDetail=f"barge_in_{barge_word}")
                        continue

                    # 3. Barge-in acústico por voz humana sobre el audio
                    level = rms(frame)
                    is_speech = self.vad.is_speech(frame, SAMPLE_RATE)
                    if is_speech and level >= minimum_voice_level * 2.8:
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
        LocalVoiceEngine().run()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(f"[Voz local] Error fatal: {error}")
        report_status(online=False, stage="fatal", error=str(error))
        sys.exit(1)
