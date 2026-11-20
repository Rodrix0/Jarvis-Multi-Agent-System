# Voz local M3

En Windows, `ttsService` usa Supertonic 3 M3 por defecto cuando encuentra
el SDK y los pesos instalados. La interfaz web, el asistente de micrófono
y los recordatorios comparten esta salida y su cola de reproducción.

El proceso se crea por respuesta y termina al acabar de reproducirla.
No se abre VoiceStudio, no hay servidor TTS permanente y no se usa GPU.
La carga del modelo agrega aproximadamente dos segundos al comienzo de
cada respuesta. La prueba del motor aislado observó unos 510 MB de RAM
residente durante la síntesis; esto no mide el consumo total de Jarvis.

Configuración de la voz aprobada: M3, español, 12 pasos, velocidad 1.05,
dos hilos de CPU y semilla 42. El audio se reproduce completo por bloques
de frases mediante Windows, sin un límite artificial de duración por frase.

## Instalación local utilizada

- Python: `%APPDATA%/OmniVoice/engines/supertonic3/supertonic3/.venv/Scripts/python.exe`
- Pesos: `%LOCALAPPDATA%/OmniVoice/hf_cache/models--Supertone--supertonic-3/snapshots/724fb5abbf5502583fb520898d45929e62f02c0b`
- La licencia OpenRAIL-M fue aceptada por el usuario en VoiceStudio.

`JARVIS_SUPERTONIC_PYTHON` y `JARVIS_SUPERTONIC_MODEL_DIR` permiten cambiar
esas rutas. No se descargan pesos ni se instalan paquetes al hablar.
La instalación compartida debe conservarse para seguir usando M3.

Para volver a la voz de Windows, configurar `JARVIS_TTS_ENGINE=windows`.
Si falta el SDK/modelo, o falla la síntesis antes de comenzar el audio,
se usa System.Speech como respaldo local. Una respuesta parcialmente
reproducida no se repite automáticamente. La interrupción cierra el árbol
de procesos y descarta las respuestas pendientes.

## Validación

- `npm test`: incluye cola, respaldo, interrupción y prevención de audio duplicado.
- Prueba real por `ttsService.speak`: resultado `engine=supertonic3`, `voice=M3`.
- Prueba real de cancelación: proceso cerrado y ambas respuestas canceladas.
- `speakSupertonic.py --output ruta.wav`: genera una muestra sin reproducirla;
  recibe el texto UTF-8 por stdin y requiere `JARVIS_SUPERTONIC_MODEL_DIR`.
