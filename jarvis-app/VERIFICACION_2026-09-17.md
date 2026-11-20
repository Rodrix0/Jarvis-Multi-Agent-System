# Verificación de duplicados, voz y habilidades — 17/09/2026

## Fallos corregidos

- El panel declaraba caída la voz local después de 15 segundos, aunque su heartbeat llega cada 30. Ahora usa 90 segundos y el servidor rechaza la captura redundante del navegador cuando la voz local está conectada.
- Las frases nuevas cortaban la anterior en Python y Node. Ambos conservan el orden; sólo una interrupción explícita cancela el audio. Los recordatorios comparten el mismo reproductor.
- La detección acústica sin cancelación de eco confundía los altavoces con una interrupción. Queda desactivada por defecto. Durante una respuesta se puede decir «Jarvis pará» o «Jarvis apagate»; se requieren frases finales completas.
- El micrófono también consulta si habla el servidor, para no transcribir recordatorios o respuestas originadas desde el panel.
- Las órdenes locales quedan protegidas durante toda la tarea y seis segundos después. Una segunda protección en el ejecutor cubre documentos, archivos, carpetas, recordatorios, imágenes y aplicaciones recibidos por canales distintos. Desplazamientos y controles de volumen siguen admitiendo repeticiones.
- Los resultados de tareas largas permanecen consultables mientras trabajan y diez minutos después de finalizar.
- Las búsquedas explícitas en Stremio tienen prioridad sobre el contexto de navegador y TV. Se comprobó el protocolo registrado de la instalación local. La ruta sigue la [documentación oficial de enlaces de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deep-links.md).

## Pruebas realizadas

- `npm test`: núcleo, órdenes diarias, agenda, eficiencia y separación voz/pantalla. Nueva suite `test_voice_reliability.js`: cola de audio, cancelación, deduplicación concurrente y Stremio.
- `test_full_command_pipeline.js`: creación y lectura real de TXT, DOCX, PDF, XLSX y PPTX; carpetas, copia, traslado, renombrado y validación del catálogo, en una carpeta temporal.
- `test_open_app_fixes.js`: 27 comprobaciones de resolución de aplicaciones y ejecución única, con lanzador simulado.
- `test_research_documents.js`: búsqueda, documento con fuentes, destino, guardado posterior sin repetir búsqueda y fallo sin archivo vacío. Apertura simulada para evitar ventanas de prueba adicionales.
- `test_browser_session_continuity.js` y `test_browser_context_navigation.js`: navegador real sin interfaz, contenido controlado; reutilización de pestaña, desplazamientos, ordinales y selección bajo el cursor.
- `test_all_notifications.js` y `test_task_manager.js`: notificaciones y ciclo de vida de tareas.
- Python `test_wake_detection.py` y `test_speech_queue.py`: activación, rechazo de interrupciones falsas y orden completo de acuse/final.

## Ejecución contra el servidor real

`tests/live_reliability_probe.js`, habilitado explícitamente para esta prueba:

- Tres solicitudes simultáneas del mismo informe: **una aceptada, dos descartadas**.
- Respuesta HTTP inicial: **89 ms**. No mide el tiempo desde que empieza a hablar el usuario ni el tiempo hasta el primer sonido.
- Documento creado: **uno**, en **2.537 ms**, con una solicitud de apertura aceptada por Windows.
- Acuse y mensaje final reproducidos con el motor nativo: ambos terminaron con `spoken: true`, sin cancelación.
- Evidencia: `logs/acceptance/1789693766988/result.json`.
- Recordatorio `rem-c52d1714`: pasó a completado a las 22:10:18 locales; el contador de sesiones de audio pasó de dos a tres y luego quedó inactivo, sin interrupciones.
- «Buscá la serie Dark en Stremio»: Windows aceptó el lanzamiento de la búsqueda en 1,14 segundos. Esto verifica el enlace y el lanzamiento; no verifica reproducción, cuenta, complementos ni disponibilidad del título.
- Servidor y voz local quedaron en línea, voz en reposo, sin errores reportados.

## Alcance

Estas pruebas cubren los fallos descritos y los flujos indicados. No certifican todas las combinaciones de lenguaje, aplicaciones o equipos externos. Falta una prueba auditiva con la voz y el micrófono del usuario en su ambiente habitual. Tampoco se reprodujo una película completa ni se accionó la TV/BroadLink. No se modificó el generador de imágenes en esta revisión.
