# Reparación y verificación de Jarvis — 8 de septiembre de 2026

Jarvis quedó ejecutándose con el backend, el motor Python y el micrófono local disponibles. Está en modo descanso: se activa diciendo «Jarvis, prendete».

## Cambios comprobados

- **Volumen y brillo:** órdenes relativas («bajame el volumen», «subime el brillo»), consulta del nivel y valores absolutos, incluido 0%. Se usa la interfaz de audio de Windows y WMI para brillo, con lectura del resultado. La ejecución es asíncrona y no bloquea el servidor. Se contempla el retraso del controlador de brillo.
- **Interpretación:** una orden con números ya no se convierte indiscriminadamente en un cambio de volumen. Las órdenes para la PC y la TV se distinguen por el dispositivo explícito. Las aperturas simples tienen prioridad sobre la interpretación general.
- **Archivos y programas:** se preservan rutas, extensiones y URLs. Se buscan nombres exactos en subcarpetas de las carpetas personales, con límites de tiempo y profundidad. El lanzador deja de esperar las tuberías heredadas por aplicaciones gráficas. Los accesos directos conservan sus argumentos.
- **Netflix:** si responde el Broadlink, la apertura inicial utiliza la ruta de TV y encendido; si no responde, abre el navegador. «En el navegador» se respeta. Una sesión de Netflix ya activa evita repetir automáticamente el encendido. El botón IR de encendido es un interruptor; no permite conocer por sí solo si la TV ya estaba encendida fuera de Jarvis.
- **Recordatorios:** creación y consulta directas, sin depender de un modelo de lenguaje. Se usan fechas locales, se recuperan vencimientos después de una interrupción y los diarios no se repiten durante el mismo minuto. Los nuevos recordatorios hablados de la ruta anterior también se guardan en la agenda persistente.
- **Voz:** el vocabulario acústico deja de incluir errores de transcripción como ejemplos. Se redujo la búsqueda de Whisper de seis alternativas a dos; se precarga el modelo y se conserva para el siguiente comando. La espera de silencio se configuró en 1.050 ms. Hay una respuesta hablada ante errores de transcripción.
- **Respuesta hablada:** las respuestas cortas usan la voz local de Windows. La cola de notificaciones espera el final real de la voz y evita emitir el mismo recordatorio simultáneamente por el navegador y el servidor. Las respuestas largas conservan el proveedor previo.

## Pruebas realizadas

| Prueba | Resultado observado |
|---|---|
| Volumen de Windows | 100 → 90; 0 aceptado; restaurado a 100 al terminar esa prueba |
| Brillo de Windows | 50 → 60 → 50, confirmado mediante lectura WMI |
| WhatsApp Web | Orden de apertura aceptada en 296 ms en la prueba final; ventana identificada en una prueba anterior |
| Netflix sin Broadlink | Orden de apertura en navegador aceptada en 1.659 ms en la prueba final, incluyendo comprobación de disponibilidad |
| Archivo por ruta absoluta | Dos aperturas aceptadas en 764 y 448 ms |
| Calculadora | Lanzamiento y ventana observados en una prueba anterior |
| Recordatorio real | Creado en la agenda, disparado por el planificador y observado como completado; se eliminó solo el recordatorio de prueba |
| Voz de Windows | La solicitud de síntesis y reproducción terminó con `ok: true` |
| Reconocimiento de audio sintético | «Abrir WhatsApp.» en 0,72 s, confianza 0,686, Whisper turbo en CUDA |
| Pruebas automáticas | Suite principal, regresiones de comandos diarios y 27 pruebas existentes de apertura superadas |

Los tiempos de apertura y controles miden desde la recepción del texto hasta la respuesta del backend; no incluyen el dictado, la espera de silencio ni el tiempo de carga completo de una página. La prueba sintética de voz no sustituye una prueba con la voz real del usuario y su ruido ambiente.

Las aperturas reportan la aceptación del lanzador, sin presentar una ventana genérica del navegador como prueba de que una página determinada terminó de cargar.

## Límite físico pendiente

El Broadlink configurado no respondió y el descubrimiento de la red local devolvió cero dispositivos. Se probaron las dos decisiones de Netflix mediante simulación de disponibilidad; no se pudo verificar físicamente el encendido de la TV. Para esa parte el Broadlink debe estar accesible desde esta computadora.

No se garantiza abrir cualquier archivo sin excepción: los archivos necesitan una aplicación asociada y permisos de Windows. La búsqueda por nombre está acotada a las carpetas personales; una ruta absoluta permite abrir otros archivos accesibles. Los recordatorios requieren que el backend siga funcionando; al reiniciar recupera los vencidos.

## Ejemplos

- «Jarvis, prendete».
- «Abrir Netflix» o «Abrir Netflix en el navegador».
- «Abrir WhatsApp».
- «Bajame el volumen»; «volumen al 30»; «subime el brillo».
- «Abrir Mi Informe.pdf», o indicar la ruta completa.
- «Recordame tomar agua en diez minutos».
- «Recordame llamar mañana a las 18:30».
- «Qué recordatorios tengo».

Resultados de la última prueba del backend: `backend/data/diagnostics/daily-command-results.json`. Los registros operativos están en `logs/`. Las nuevas regresiones se ejecutan con `npm test` desde `backend/`.
