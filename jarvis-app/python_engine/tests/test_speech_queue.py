import sys
import threading
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import voice_assistant as voice

started = []
release = threading.Event()
finished = threading.Event()

class Response:
    def raise_for_status(self):
        pass

def post(url, json=None, **kwargs):
    assert url.endswith('/api/tts/speak'), 'ordinary replies must not stop previous speech'
    started.append(json['text'])
    if len(started) == 1:
        assert release.wait(3)
    else:
        finished.set()
    return Response()

voice.requests.post = post
voice.speak('Okey, jefe. Me pongo a trabajar.')
voice.speak('Terminé. El documento está listo.')
time.sleep(0.1)
assert len(started) == 1
assert voice.tts_active.is_set()
release.set()
assert finished.wait(3)
deadline = time.monotonic() + 3
while voice.tts_active.is_set() and time.monotonic() < deadline:
    time.sleep(0.01)
assert not voice.tts_active.is_set()
assert started == ['Okey, jefe. Me pongo a trabajar.', 'Terminé. El documento está listo.']
print('OK: acuse y final completos, un solo trabajador, sin detener el audio anterior.')
