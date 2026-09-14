# Navegación encadenada por voz

Jarvis puede abrir una ventana visible de Chrome/Edge y mantener el contexto entre órdenes. Numera los enlaces o videos visibles usando la estructura real de la página; vuelve a leerlos después de navegar o desplazarse.

## Ejemplos

- «Buscá UCP» → «Entrá al primer link» → «Hacé clic en [texto del enlace]».
- «Entrá a YouTube y buscá La Cobra» → «Bajá» → «Mirá, quiero el segundo».
- «Mostrame las opciones», «Subí», «Volvé», «Terminá la navegación por voz».
- «Ingresá» busca un único control visible llamado «Ingresar». Si no existe o hay varios, pide precisar el control; no inventa un destino.

Los números se conservan en un registro acumulativo de resultados de la página: no vuelven a empezar en uno al bajar. Las etiquetas se muestran solo sobre los elementos visibles. Si se pide un resultado todavía no cargado, Jarvis avanza durante un tiempo limitado para buscarlo. El registro cambia al navegar a otra URL y conserva hasta 2.000 elementos; una página que reemplaza o reordena resultados puede requerir volver a identificar el objetivo. «Bajá» desplaza una pantalla aproximadamente, no descarga videos.

## Comprensión contextual y mouse

Las indicaciones que no resuelven los comandos directos se interpretan con el modelo local, junto con el historial de navegación, los resultados conocidos, la posición de desplazamiento y el elemento señalado. El modelo devuelve una operación estructurada y el ejecutor la valida; no se agregan variantes de frases para cada ordinal.

Para «ese», se identifica el enlace, botón o tarjeta de video bajo el cursor mediante eventos del puntero y la estructura actual de la página. Se contemplan miniaturas de YouTube y marcos de la página. Si el mouse está fuera del contenido, no apunta a un control o cambia a otro enlace durante la interpretación, Jarvis pide precisar el objetivo en lugar de adivinar.

Se comprobó con Chrome la selección del resultado 22 fuera de pantalla, la conservación de índices al desplazarse y la apertura del resultado 25 señalando su miniatura. El modelo local resolvió lenguaje libre para avanzar, seleccionar el vigesimosegundo y elegir el elemento señalado. La evaluación midió entre 194 y 873 ms de interpretación en esa prueba; no garantiza la misma latencia ni acierto para cualquier frase.

Pruebas adicionales: `test_browser_context_navigation`. Evidencia de interpretación: [evaluación semántica](backend/data/diagnostics/voice-navigation/semantic-evaluation.json).

## Alcance

Se controla la ventana abierta por esta función, no cualquier pestaña del navegador personal ni cualquier aplicación del escritorio. Es una sesión independiente; puede requerir iniciar sesión en los sitios. Los avisos de acceso y verificaciones del sitio deben resolverse en su ventana.

La búsqueda web común usa Bing. «Entrá a Google» sigue disponible, pero durante la prueba Google mostró una verificación de tráfico y el controlador la comunica como intervención pendiente. No se cuenta ese aviso como resultado.

Las órdenes para TV conservan prioridad en su contexto. Las búsquedas explícitas de información y creación de documentos conservan su recorrido. Todas las entradas a YouTube, incluida «Abrí YouTube», usan la misma sesión controlada. Repetir la apertura conserva los resultados y el desplazamiento de la pestaña existente. Las búsquedas posteriores mantienen YouTube como destino; pedir un canal usa su filtro de canales. El contexto dura mientras quede una pestaña controlada abierta, hasta terminar la navegación o cambiar a TV. No se recupera después de reiniciar el servidor.

## Pruebas

- Chrome contra páginas locales: elegir segundo enlace, pulsar Ingresar, desplazarse, renovar resultados, rechazar un ordinal inexistente y terminar la sesión.
- Recorrido real UCP → primer resultado → `https://www.ucp.edu.ar/` comprobado.
- Entrada real del backend de voz: YouTube + búsqueda, 3.306 ms; bajar, 555 ms; elegir el segundo, 2.092 ms, con navegación a una URL de reproducción. No incluye dictado ni tiempo de silencio del micrófono.
- Pasaron las suites `test_voice_navigation`, `core.test`, `test_full_command_pipeline`, `test_daily_commands`, `test_canonical_llm`, `test_research_documents` y `test_tv_learning`.

Evidencia: [UCP](backend/data/diagnostics/voice-navigation/ucp-final.json), [entrada de voz](backend/data/diagnostics/voice-navigation/voice-final.json), [numeración visual](backend/data/diagnostics/voice-navigation/ucp-screen.png).

## Verificación de continuidad (13 de septiembre de 2026)

Se comprobó en YouTube real el recorrido abrir → buscar un canal → abrir otra vez → bajar → subir, con una sola pestaña y conservando la URL de resultados al repetir la apertura. El desplazamiento medido pasó de 0 a 640 píxeles y volvió a 0. Evidencia: [recorrido real](backend/data/diagnostics/browser-session/live.json).

La suite `test_browser_session_continuity` comprueba también las rutas anteriores de apertura, la búsqueda en el campo del sitio, el desplazamiento dentro de contenedores y el cambio de contexto hacia TV. El ejecutor confirma el movimiento real y avisa al alcanzar un extremo.

La selección verifica los ordinales expresados por el usuario mediante composición de unidades, decenas, centenas y millares (hasta 2.000), evitando aceptar errores numéricos del modelo. La suite `test_spanish_ordinals` cubre ordinales separados y unidos, y referencias ambiguas.

La verificación final de la entrada de voz completó siete órdenes consecutivas en YouTube real: abrir, buscar canal, repetir apertura y desplazarse en ambos sentidos con lenguaje libre. Los canales mantuvieron su numeración sin incluir videos de la transición del filtro. Evidencia: [entrada de voz final](backend/data/diagnostics/browser-session/http-final.json).

Durante esta verificación, la GPU dejó de responder y Ollama quedó bloqueado. Se recuperó el servicio; el modelo continuó en CPU. Con el contexto reducido, las indicaciones libres tardaron entre 3,8 y 5,9 segundos; la reapertura y el desplazamiento directo, aproximadamente 0,5 segundos. Estas mediciones empiezan con texto reconocido, sin incluir el dictado. El servicio de voz informó `listening` al finalizar. No se realizó una prueba hablada por el usuario ni se reparó el controlador de GPU.
