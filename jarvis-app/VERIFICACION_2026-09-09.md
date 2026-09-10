# Revisión integral de Jarvis — 9 de septiembre de 2026

El servidor, el motor Python y la voz local quedaron iniciados con las correcciones. El catálogo publicado contiene 132 acciones. Se revisaron las rutas compartidas de interpretación, ejecución, confirmación y verificación, además de las familias de funciones detalladas abajo. El resultado consolidado de las pruebas automáticas es **61 suites aprobadas**, incluyendo una ejecución conjunta de 59 y las repeticiones de las suites afectadas por los últimos ajustes.

Esto no certifica todas las acciones contra todos los programas, archivos o dispositivos posibles. Las pruebas físicas, las simuladas y las conexiones pendientes se distinguen a continuación.

## Reparaciones

- Comandos cotidianos por rutas directas: apertura, archivos, carpetas, escritorio, volumen, brillo y recordatorios. Se preservan rutas absolutas, extensiones, tildes, nombres compuestos y el contenido dictado.
- Aperturas de aplicaciones sin esperar que termine el programa gráfico; búsqueda acotada en carpetas personales y accesos directos. WhatsApp se abre en navegador. Netflix comprueba Broadlink y usa el navegador cuando no responde.
- Creación y lectura de TXT, DOCX, PDF, XLSX y PPTX con formatos reales. Copia, traslado y cambio de nombre conservan archivos existentes. Se corrigió el lector PDF y la ubicación informada al crear archivos fuera del escritorio.
- Agenda persistente con fechas locales, recuperación de vencidos y prevención de recordatorios duplicados. Ajustes de volumen y brillo con lectura posterior del valor de Windows.
- El intérprete de IA puede ejecutar herramientas del catálogo real de Jarvis. Los errores de herramientas y verificaciones fallidas llegan al usuario como errores, sin respuestas falsas de tarea completada.
- Confirmación por voz y panel; el PIN se transmite al servidor y puede reintentarse. Las pruebas de acciones sensibles usaron ejecutores simulados.
- Home Assistant informa la falta de conexión en lugar de simular dispositivos activos. El volumen de TV se presenta como estimado: infrarrojo no permite leer el valor real.
- Automatización de ventanas mediante UI Automation, OCR de Windows, portapapeles con Unicode y llamadas de procesos sin interpolación de argumentos en el intérprete de comandos.
- Arranque de Forge en segundo plano, tiempos máximos de espera, errores de cambio de modelo y liberación de VRAM. Reconocimiento de voz local precargado y respuestas cortas mediante la voz de Windows.
- Separación entre charla breve y preguntas informativas; selección exacta del modelo instalado antes de considerar otros tamaños. En la comparación local, Qwen y Hermes cometieron un error factual que Llama corrigió. Esto mejora esa ruta, pero no convierte las respuestas del modelo en información verificada con fuentes.

## Cobertura automática

Las 61 suites incluyen comandos y archivos, catálogo y llamadas de IA, confirmaciones, memoria y perfiles, agenda y tareas persistentes, recuperación de reinicios, planificación y verificación, automatizaciones, circuitos de recuperación, métricas y registros, permisos y sandbox, secretos, habilidades, código, Git, snapshots, plantillas, contexto, Home Assistant, investigación, navegador, portapapeles y activación/reposo de voz.

Cada suite se ejecuta con copias de los servicios y datos de prueba separados de la información operativa. Los servicios externos y el envío de mensajes se simulan donde corresponde. La prueba de navegador usa Chrome real contra una página local de prueba. El portapapeles usa un sustituto en memoria para conservar el contenido que el usuario tenía copiado.

- [Resultados consolidados](backend/data/diagnostics/full-audit/audit-final.json)
- [Ejecución conjunta de 59 suites](backend/data/diagnostics/full-audit/audit-59.json)
- [Catálogo de 132 acciones](backend/data/diagnostics/full-audit/catalog-final.json)
- Repetición: `node backend/tests/run_isolated_audit.js` desde la carpeta del proyecto. Un fallo o tiempo agotado produce código de salida distinto de cero.

## Comprobaciones reales en esta computadora

| Función | Resultado |
|---|---|
| Crear un TXT mediante la entrada de voz transcripta | Archivo creado, contenido comprobado; 56 ms |
| Leer el TXT por ruta absoluta | Texto exacto; 26 ms |
| Listar el escritorio | Listado recibido; 34 ms |
| Consultar volumen y brillo | Lecturas nativas correctas; 518 y 680 ms |
| Abrir WhatsApp | Lanzamiento aceptado; 716 ms |
| Abrir Netflix sin Broadlink | Lanzamiento en navegador aceptado; 2.279 ms |
| Pregunta informativa | Respuesta correcta en la consulta comprobada; 16.678 ms |
| Interacción con ventana Windows de prueba | Localizar ventana, escribir Unicode, leerlo y pulsar botón: aprobado |
| OCR sobre imagen sintética | Texto `ERROR Missing component 123` reconocido |
| Spotify | Token existente renovado y consulta de API HTTP 200 |
| Generación de imagen | Forge iniciado, PNG válido generado y VRAM liberada; 88,3 s incluyendo arranque y carga |
| Voz local | Servicio online, sin error; Whisper turbo/CUDA observado durante la revisión |

Los tiempos de comandos comienzan al recibir el texto: no incluyen el dictado ni la espera de silencio. La apertura confirma el lanzamiento, no la carga completa de cada página. La imagen de prueba usa 256×256 y un paso; no mide el tiempo ni la calidad de una generación habitual de 1024×1024 y 30 pasos.

Las modificaciones reales de volumen/brillo, el disparo de un recordatorio, la síntesis de voz y el audio sintético de reconocimiento están documentados en la [verificación anterior](VERIFICACION_2026-09-08.md). En esta última pasada solo se consultaron los niveles, conservando la configuración actual del usuario.

Evidencias: [comandos y controles](backend/data/diagnostics/full-audit/live-final.json), [aperturas y respuesta final](backend/data/diagnostics/full-audit/live-final-additional.json), [imagen](backend/data/diagnostics/full-audit/image-result.json), [OCR](backend/data/diagnostics/full-audit/ocr-result.json), [conexiones](backend/data/diagnostics/full-audit/connections.json).

## Lo que sigue pendiente de conexión o prueba física

- **Broadlink:** el dispositivo configurado no respondió a la comprobación final; el descubrimiento anterior tampoco encontró dispositivos. No se pudo comprobar el encendido físico de la TV. Debe quedar accesible desde la computadora en la red local.
- **Home Assistant:** falta una conexión configurada con credenciales válidas. Las pruebas de sus órdenes son simuladas; no se accionaron dispositivos reales.
- **Mensajes y acciones sensibles:** no se enviaron mensajes reales ni se apagó/reinició la computadora para probarlos. Se verificaron sus rutas, parámetros y confirmaciones con pruebas aisladas.
- **Portapapeles:** se revisó el puente de Windows y se probó la lógica con contenido simulado; no se reemplazaron las imágenes/archivos que el usuario tenía copiados.

Los archivos fuera de las carpetas personales pueden abrirse mediante una ruta absoluta accesible. La búsqueda por nombre tiene límites de profundidad, tiempo y cantidad para evitar bloquear Jarvis. Los programas requieren instalación o una asociación válida de Windows. Los recordatorios requieren el servidor activo; al reiniciar recuperan vencimientos.
