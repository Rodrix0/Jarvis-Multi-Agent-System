# Optimización de rendimiento de Jarvis — 14/09/2026

## Resultado

Jarvis conserva sus acciones, memoria, recordatorios, navegación, voz y motores locales, pero ahora evita cargar o ejecutar componentes caros mientras están inactivos.

Mediciones realizadas en esta computadora:

- Interpretación determinista de 200 órdenes: mediana **0,072 ms**, p95 **0,162 ms**, máximo **9,535 ms**.
- Núcleo Node en ejecución: aproximadamente **121 MB de RAM física**.
- Motor Python general en reposo: aproximadamente **66 MB de RAM física**.
- Voz local dormida: aproximadamente **157 MB de RAM física**, con Vosk escuchando la activación y Whisper descargado.
- Ollama dormido: **0 modelos cargados**.
- Orden real «qué tareas tengo»: **36 ms** de punta a punta por HTTP local.
- Orden real para consultar volumen: **679 ms** en la primera llamada; la mayor parte corresponde al control de audio de Windows mediante PowerShell/CoreAudio.
- Generación fotográfica local verificada: perfil normal **36,8 s** con Forge cargado; perfil máximo **139,4 s** desde cero, incluido el arranque completo de Forge. Ambos entregan **1024×1024**.
- En 15 segundos de reposo, Node y Python general usaron **0,016 s de CPU** cada uno. La voz usó **0,781 s de CPU** para mantener activa la detección local de la palabra de activación.

## Cambios aplicados

- La telemetría del dashboard se inicia al conectar el panel y se detiene al cerrar el último panel.
- Los sondeos de GPU, Ollama, ComfyUI, BroadLink y otros servicios se reutilizan durante 30 segundos y las solicitudes simultáneas comparten una sola muestra.
- Socket.IO no comprime mensajes locales pequeños.
- El planificador de agenda pasó de consultar SQLite cada segundo a cada cinco segundos; la recuperación de recordatorios vencidos se mantiene.
- El planificador legado ya existente conserva su temporizador exacto al próximo recordatorio.
- Las búsquedas de archivos repetidas comparten trabajo y usan una caché acotada de resultados positivos y negativos.
- El índice de aplicaciones se mantiene en memoria y sólo se vuelve a leer si cambia en disco.
- La memoria conversacional evita releer y parsear el archivo JSON en cada acceso, manteniendo escritura atómica.
- `aiService`, DOCX y Puppeteer se cargan únicamente al usarlos.
- La lista de habilidades Python se conserva cinco minutos y un motor Python temporalmente inaccesible no agrega 1,5 segundos a cada respuesta.
- El router de modelos ahora aplica de verdad los límites de tokens y la temperatura calculados para cada tipo de consulta.
- Los modelos de Ollama se descargan después de dos minutos de inactividad en chat y después de 90 segundos en comprensión de voz.
- El motor Python ya no importa ChromaDB, LlamaIndex, RAG ni el agente de desarrollo al arrancar. Los carga ante una orden de programación o edición.
- Whisper, CTranslate2 y CUDA se cargan al despertar, permanecen listos durante la conversación y se liberan dos minutos después de dormir.
- La voz consulta dispositivos de audio cada cinco minutos, informa estado cada 30 segundos y reutiliza las coordenadas de remuestreo del micrófono.
- La escucha dormida exige «Jarvis» y una orden de activación en la misma frase final; palabras ambientales o saludos aislados ya no cargan Whisper ni despiertan el asistente.
- El navegador controlado por Jarvis conserva contexto durante 30 minutos y se cierra después de ese tiempo sin actividad. Su historial de descargas queda limitado a 50 entradas.
- Las solicitudes de imágenes tienen una ruta determinista propia, por lo que mencionar una imagen «para un proyecto» ya no puede activar el creador de proyectos.
- Las imágenes generadas y editadas aparecen dentro del panel de Jarvis; ya no se ejecuta el comando externo que abría el visor o el Explorador de Windows.
- Stable Diffusion Forge libera el modelo de la GPU al finalizar y, si Jarvis lo inició, cierra el servidor después de dos minutos sin uso.
- El inicio de Forge conserva registros acotados en `logs/forge.*.log` y reintenta una vez si Windows falla transitoriamente al inicializar CUDA o una DLL.
- Forge usa su gestión automática de VRAM y prepara en inglés los pedidos visuales hechos en español. Conserva el tipo solicitado —foto, dibujo, ilustración o pintura— y aplica un perfil fotográfico con colores naturales, contraste moderado y CFG 5 cuando corresponde.
- La salida vuelve a ser 1024×1024 y el perfil se adapta a la orden. Una foto normal usa una base SDXL de 768 px y 24 pasos; ilustraciones usan 640 px y 20 pasos. Si se pide «4K», «máxima calidad» o «alta resolución», conserva el render SDXL directo de 1024 px y 30 pasos que usaban las imágenes antiguas. «Rápido», «borrador» o «vista previa» selecciona 512 px y 12 pasos.
- El monitor proactivo revisa CPU cada minuto y procesos vigilados cada 15 segundos.
- La animación 3D usa 5 FPS en reposo, 30 FPS mientras escucha o habla, y se detiene cuando la página está oculta.

## Ajustes opcionales

Los valores predeterminados son equilibrados. Se pueden cambiar mediante variables de entorno:

- `JARVIS_DASHBOARD_INTERVAL_MS` — intervalo del panel conectado; predeterminado 5000 ms.
- `JARVIS_VRAM_CACHE_MS` y `JARVIS_SERVICE_HEALTH_CACHE_MS` — caché de telemetría; predeterminado 30000 ms.
- `JARVIS_AGENDA_POLL_MS` — comprobación de agenda SQLite; predeterminado 5000 ms.
- `JARVIS_BROWSER_IDLE_MS` — cierre del navegador autónomo; predeterminado 30 minutos.
- `JARVIS_FORGE_IDLE_MS` — cierre del generador de imágenes iniciado por Jarvis; predeterminado 2 minutos.
- `JARVIS_IMAGE_QUALITY`, `JARVIS_IMAGE_BASE_SIZE`, `JARVIS_IMAGE_OUTPUT_SIZE` y `JARVIS_IMAGE_STEPS` — permiten fijar el perfil (`fast`, `quality` o `maximum`) y sus parámetros; sin configuración se seleccionan automáticamente desde la orden.
- `JARVIS_VOICE_HEARTBEAT_SECONDS` — estado del motor de voz; predeterminado 30 segundos.
- `JARVIS_WHISPER_IDLE_UNLOAD_SECONDS` — descarga de Whisper dormido; predeterminado 120 segundos.
- `OLLAMA_CHAT_KEEP_ALIVE` — retención de modelos de conversación; predeterminado 2 minutos.
- `OLLAMA_VOICE_KEEP_ALIVE` — retención del modelo auxiliar de voz; predeterminado 90 segundos.

## Verificación

- `npm test`: núcleo, órdenes diarias, eficiencia y formato de voz/pantalla aprobados.
- Sintaxis Node y Python aprobada.
- Diagnóstico real de voz: Vosk y Whisper cargaron correctamente con modelos locales.
- Carga diferida del agente de desarrollo comprobada con un proyecto activo.
- Pruebas integradas sobre el servidor real: voz local en línea, consulta de volumen y consulta de tareas correctas.
- Generación real comprobada con Juggernaut XL: pedido en español, ubicación lunar correcta, color natural, ampliación a 1024×1024, liberación de VRAM y cierre automático de Forge.

## Voz, búsquedas y documentos — 16/09/2026

- Las órdenes locales normales responden primero con una confirmación hablada y continúan en segundo plano. Abrir, buscar, crear, investigar y generar ya no bloquean el micrófono hasta terminar.
- Jarvis anuncia el tipo de trabajo: por ejemplo, «Okey, jefe. Me pongo a investigar y preparar el documento» y, al finalizar, confirma que el documento está abierto en pantalla.
- Las tareas de voz pueden consultarse por un identificador local hasta completar, fallar o pedir un dato faltante; los comandos de dormir, despertar y detención de emergencia siguen ejecutándose de inmediato.
- Se aceptan fórmulas naturales como «me podés crear», imperativos con tilde y errores frecuentes de dictado como `dpcumento`, sin enviarlos por error al creador de software.
- Los informes buscan primero fuentes web, leen el contenido útil de las páginas, sintetizan localmente con citas y nunca crean un documento vacío si no encuentran evidencia.
- Los informes usan por defecto una redacción extractiva verificable: seleccionan oraciones completas de hasta seis fuentes, citan cada bloque y no cargan Ollama. La búsqueda web tarda aproximadamente **1 s** y se evita el riesgo de que un modelo pequeño mezcle fechas. La síntesis generativa queda disponible mediante `JARVIS_DOCUMENT_AI_SYNTHESIS=true`.
- Los documentos Word usan estilos de títulos, texto justificado, listas y enlaces externos clicables. Una validación del archivo real confirmó encabezados limpios y seis vínculos a las fuentes.
- La confirmación del ejemplo «Créame un dpcumento sobre las películas de Spider-Man» llegó en **114 ms**.
