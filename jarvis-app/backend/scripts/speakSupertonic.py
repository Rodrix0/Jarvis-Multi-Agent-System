"""Offline M3 speech in a disposable process: no server, GPU or resident model."""
import argparse
import io
import json
import os
from pathlib import Path
import sys
import wave

os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, help='Save a WAV instead of playing (diagnostics).')
    args = parser.parse_args()
    sys.stdin.reconfigure(encoding='utf-8')
    text = sys.stdin.read().strip()
    if not text:
        return

    import numpy as np
    from supertonic import TTS
    from supertonic.utils import chunk_text

    model_dir = Path(os.environ['JARVIS_SUPERTONIC_MODEL_DIR'])
    # Identical voice, quality and speed to the M3 sample approved by the user.
    tts = TTS(model='supertonic-3', model_dir=model_dir, auto_download=False,
              intra_op_num_threads=2, inter_op_num_threads=1)
    style = tts.get_voice_style('M3')
    np.random.seed(42)
    writer = None
    try:
        if args.output:
            writer = wave.open(str(args.output), 'wb')
            writer.setparams((1, 2, tts.sample_rate, 0, 'NONE', 'not compressed'))
        # Bound memory for long replies while retaining full sentences together.
        for chunk in chunk_text(text, max_len=300):
            wav, _ = tts.synthesize(text=chunk, voice_style=style, lang='es',
                                    total_steps=12, speed=1.05,
                                    max_chunk_length=300, silence_duration=0.16)
            pcm = (np.clip(np.asarray(wav).reshape(-1), -1, 1) * 32767).astype('<i2').tobytes()
            if not pcm:
                raise RuntimeError('El motor no generó audio.')
            if writer:
                writer.writeframes(pcm)
            else:
                import winsound
                audio = io.BytesIO()
                with wave.open(audio, 'wb') as output:
                    output.setparams((1, 2, tts.sample_rate, 0, 'NONE', 'not compressed'))
                    output.writeframes(pcm)
                print(json.dumps({'event': 'playing', 'voice': 'M3'}), flush=True)
                # Synchronous playback keeps the queue/echo guard active until audio ends.
                winsound.PlaySound(audio.getvalue(), winsound.SND_MEMORY | winsound.SND_NODEFAULT)
    finally:
        if writer:
            writer.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Supertonic M3: {error}', file=sys.stderr, flush=True)
        sys.exit(1)
