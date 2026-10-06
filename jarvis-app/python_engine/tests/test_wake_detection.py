import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from voice_assistant import LocalVoiceEngine


class FakeRecognizer:
    def __init__(self, phrases):
        self.phrases = iter(phrases)
        self.current = ""

    def AcceptWaveform(self, _frame):
        self.current = next(self.phrases)
        return True

    def Result(self):
        return json.dumps({"text": self.current})

    def Reset(self):
        return None


def engine_for(*phrases):
    engine = LocalVoiceEngine.__new__(LocalVoiceEngine)
    engine.wake_recognizer = FakeRecognizer(phrases)
    engine.wake_name_until = 0.0
    engine.wake_word_until = 0.0
    return engine


assert engine_for("activa").wake_detected(b"audio") is False
assert engine_for("arriba").wake_detected(b"audio") is False
assert engine_for("hola jarvis").wake_detected(b"audio") is False
assert engine_for("jarvis").wake_detected(b"audio") is False
assert engine_for("jarvis prendete").wake_detected(b"audio") is True

print("OK: la activación exige Jarvis y una orden de despertar en la misma frase.")

for phrase, expected in [("preparar", False), ("para", False), ("para el documento", False), ("jarvis para", True), ("jarvis apagate", True)]:
    engine = LocalVoiceEngine.__new__(LocalVoiceEngine)
    engine.barge_recognizer = FakeRecognizer([phrase])
    assert engine.barge_detected(b"audio")[0] is expected, phrase
print("OK: la voz propia no interrumpe; Jarvis pará y Jarvis apagate sí.")
