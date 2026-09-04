import sys
import io
import asyncio
import os

# Configurar stdout/stdin en UTF-8 estricto
if sys.platform == "win32":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")

import edge_tts
import pygame

# Inicializar mixer de audio
pygame.mixer.init()

DEFAULT_VOICE = "es-AR-TomasNeural"

async def generate_and_play(text: str, voice: str = DEFAULT_VOICE, rate: str = "+0%", pitch: str = "+0Hz"):
    if not text.strip():
        return

    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    audio_data = bytearray()

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data.extend(chunk["data"])

    if not audio_data:
        return

    # Reproducir en memoria con pygame
    audio_stream = io.BytesIO(audio_data)
    pygame.mixer.music.load(audio_stream)
    pygame.mixer.music.play()

    while pygame.mixer.music.get_busy():
        pygame.time.Clock().tick(20)

def main():
    if len(sys.argv) > 1:
        # Texto pasado por argumento
        text = " ".join(sys.argv[1:])
        voice = DEFAULT_VOICE
    else:
        # Texto leído de stdin
        text = sys.stdin.read().strip()
        voice = DEFAULT_VOICE

    if not text:
        return

    asyncio.run(generate_and_play(text, voice=voice))

if __name__ == "__main__":
    main()
