const actionKernel = require('./actionKernelService');
const memoryService = require('./memoryService');
const modeService = require('./modeService');
const observerService = require('./observerService');
const systemService = require('./systemService');
const aiService = require('./aiService');
const tvService = require('./tvService');
const tvVoiceService = require('./tvVoiceService');
const informationDocumentService = require('./informationDocumentService');
const voiceLearningService = require('./voiceLearningService');
const financeService = require('./financeService');
const downloadService = require('./downloadService');

// --- V6 ENTERPRISE SERVICES ---
const fastCommandParser = require('./ai/fastCommandParser');
const emergencyService = require('./core/emergencyService');
const undoManager = require('./core/undoManager');
const explanationService = require('./core/explanationService');
const trashService = require('./core/trashService');
const memoryServiceV6 = require('./memory/memoryService');
const routineService = require('./automation/routineService');
const windowsControlService = require('./windowsControlService');

let registered = false;

function registerActions() {
    if (registered) return;
    registered = true;

    // Emergency Stop
    actionKernel.register({
        id: 'emergency.stop', name: 'Parada de emergencia', description: 'Detiene todos los procesos y silencia audio al instante.',
        parameters: {}, permission: 'standard', examples: ['Detener todo', 'Abortar'],
        execute: async () => emergencyService.triggerEmergencyStop('VOICE_COMMAND')
    });

    // Undo Global
    actionKernel.register({
        id: 'undo.last', name: 'Deshacer última acción', description: 'Revierte la última acción reversible realizada.',
        parameters: {}, permission: 'standard', examples: ['Deshacé lo último'],
        execute: async () => undoManager.undoLast('GLOBAL')
    });

    // Windows Audio
    actionKernel.register({
        id: 'audio.set-volume', name: 'Ajustar volumen', description: 'Ajusta el volumen de Windows de 0 a 100%.',
        parameters: { percent: 'Porcentaje de volumen (0-100)' }, permission: 'standard',
        execute: async ({ percent }) => windowsControlService.audio.setVolume(percent)
    });
    actionKernel.register({
        id: 'audio.toggle-mute', name: 'Silenciar audio', description: 'Alterna el silencio de Windows.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.audio.toggleMute()
    });

    // Windows Display
    actionKernel.register({
        id: 'display.set-brightness', name: 'Ajustar brillo', description: 'Ajusta el brillo de la pantalla de 0 a 100%.',
        parameters: { percent: 'Porcentaje de brillo' }, permission: 'standard',
        execute: async ({ percent }) => windowsControlService.display.setBrightness(percent)
    });
    actionKernel.register({
        id: 'display.screenshot', name: 'Captura de pantalla', description: 'Toma una captura de pantalla y la guarda en el Escritorio.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.display.takeScreenshot()
    });

    // Windows System Telemetry & Process
    actionKernel.register({
        id: 'system.get-battery', name: 'Consultar batería', description: 'Consulta el nivel y estado de la batería.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.power.getBatteryStatus()
    });
    actionKernel.register({
        id: 'system.get-top-consumers', name: 'Consultar consumo de RAM/CPU', description: 'Lista las 5 aplicaciones que más recursos consumen.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.process.getTopResourceConsumers()
    });
    actionKernel.register({
        id: 'system.get-disk-space', name: 'Consultar espacio en disco', description: 'Consulta el espacio disponible en discos.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.metrics.getDiskSpace()
    });
    actionKernel.register({
        id: 'clipboard.read', name: 'Leer portapapeles', description: 'Lee el texto actual del portapapeles.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.clipboard.readClipboard()
    });

    // File & Folder Operations with Rollback
    const fileOperationsService = require('./core/fileOperationsService');
    actionKernel.register({
        id: 'file.create', name: 'Crear archivo o documento', description: 'Crea un archivo (.txt, .docx) o nota en el Escritorio o carpeta.',
        parameters: { fileName: 'Nombre del archivo', content: 'Contenido opcional', format: 'txt o docx', folderName: 'Carpeta opcional', topic: 'Tema opcional' }, permission: 'standard',
        execute: async ({ fileName, content, format = 'txt', folderName, topic }) => fileOperationsService.createFile({ fileName, content, format, folderName, topic })
    });
    actionKernel.register({
        id: 'folder.create', name: 'Crear carpeta', description: 'Crea una carpeta en el Escritorio.',
        parameters: { folderName: 'Nombre de la carpeta' }, permission: 'standard',
        execute: async ({ folderName }) => fileOperationsService.createFolder({ folderName })
    });
    actionKernel.register({
        id: 'folder.delete', name: 'Eliminar carpeta', description: 'Mueve una carpeta a la papelera segura de Jarvis.',
        parameters: { folderName: 'Nombre de la carpeta' }, permission: 'standard',
        execute: async ({ folderName }) => fileOperationsService.deleteFolder(folderName)
    });
    actionKernel.register({
        id: 'file.delete', name: 'Mover archivo a papelera segura', description: 'Mueve un archivo a la papelera segura de Jarvis.',
        parameters: { filePath: 'Ruta o nombre del archivo' }, permission: 'standard',
        execute: async ({ filePath }) => trashService.moveToTrash(filePath)
    });
    actionKernel.register({
        id: 'file.restore', name: 'Restaurar archivo de papelera', description: 'Restaura un archivo previamente eliminado.',
        parameters: { identifier: 'Nombre del archivo' }, permission: 'standard',
        execute: async ({ identifier }) => trashService.restoreFromTrash(identifier)
    });

    // Memory V6
    actionKernel.register({
        id: 'memory.query-v6', name: 'Consultar memoria', description: 'Consulta recuerdos y preferencias almacenadas.',
        parameters: { topic: 'Tema a consultar' }, permission: 'standard',
        execute: async ({ topic }) => {
            const results = memoryServiceV6.queryMemory(topic, true);
            if (results.length === 0) return { message: `No tengo recuerdos registrados sobre "${topic}".` };
            const summary = results.map(r => `• ${r.value}`).join('\n');
            return { message: `Esto es lo que recuerdo sobre ${topic}:\n${summary}` };
        }
    });
    actionKernel.register({
        id: 'memory.forget-v6', name: 'Olvidar memoria', description: 'Olvida recuerdos sobre un tema específico.',
        parameters: { topic: 'Tema a olvidar' }, permission: 'standard',
        execute: async ({ topic }) => memoryServiceV6.forgetMemory(topic)
    });

    // Routines & Explanations
    actionKernel.register({
        id: 'routine.execute', name: 'Ejecutar rutina', description: 'Ejecuta una rutina de sistema configurada.',
        parameters: { routineName: 'Nombre de la rutina' }, permission: 'standard',
        execute: async ({ routineName }) => routineService.executeRoutine(routineName)
    });
    actionKernel.register({
        id: 'explain.query', name: 'Explicar decisión o historial', description: 'Explica decisiones operativas y muestra historial.',
        parameters: { query: 'Consulta de explicación' }, permission: 'standard',
        execute: async ({ query }) => {
            const explanation = await explanationService.explainDecision(query);
            return { message: explanation };
        }
    });

    actionKernel.register({
        id: 'voice.wake', name: 'Despertar a Jarvis', description: 'Sale del modo descanso y acepta órdenes hasta que el usuario lo apague.',
        parameters: {}, permission: 'standard', examples: ['Jarvis, prendete'],
        execute: async () => ({ message: 'Estoy en línea. ¿Qué necesitás?', data: { voiceState: 'awake' }, evidence: { stateChanged: true } })
    });
    actionKernel.register({
        id: 'voice.sleep', name: 'Poner a Jarvis en descanso', description: 'Ignora órdenes normales y conserva solamente la escucha de la frase de activación.',
        parameters: {}, permission: 'standard', examples: ['Jarvis, apagate'],
        execute: async () => ({ message: 'Entendido, entrando en modo espera.', data: { voiceState: 'dormant' }, evidence: { stateChanged: true } })
    });

    actionKernel.register({
        id: 'voice.correct', name: 'Corregir una transcripción',
        description: 'Aprende una corrección personal sin agregar el título a una lista fija.',
        parameters: { from: 'Texto entendido', to: 'Texto correcto' }, permission: 'memory-write',
        examples: ['No dije Lodo Hero, dije Dorohedoro'],
        execute: async ({ from, to }) => {
            memoryService.addCorrection(from, to);
            return { message: `Entendido. Cuando escuche “${from}”, lo corregiré como “${to}”.`, evidence: { stored: true, from, to } };
        }
    });

    actionKernel.register({
        id: 'memory.preference', name: 'Recordar una preferencia',
        description: 'Guarda solamente preferencias que el usuario pide recordar de forma explícita.',
        parameters: { key: 'Tema', value: 'Preferencia' }, permission: 'memory-write',
        examples: ['Recordá que prefiero Netflix en la tele'],
        execute: async ({ key, value }) => {
            const item = memoryService.addPreference(key, value, 'explicit-voice');
            return { message: 'Guardé esa preferencia. Podés verla o borrarla desde el panel de memoria.', data: item, evidence: { stored: true, id: item.id } };
        }
    });

    actionKernel.register({
        id: 'memory.clear', name: 'Borrar recuerdos',
        description: 'Borra una categoría o toda la memoria central.',
        parameters: { collection: 'preferences, corrections, conversations, summaries o all' },
        permission: 'destructive', confirmation: true,
        confirmationMessage: ({ collection }) => `¿Confirmás que querés borrar ${collection === 'all' ? 'toda la memoria' : collection}?`,
        examples: ['Borrá todas tus correcciones'],
        execute: async ({ collection = 'all' }) => {
            memoryService.clear(collection);
            return { message: 'Memoria borrada.', evidence: { collection, cleared: true } };
        }
    });

    // TV Volume and Learning Actions (BroadLink / TV)
    actionKernel.register({
        id: 'tv.set-volume', name: 'Ajustar volumen de la televisión',
        description: 'Ajusta el volumen exacto de la televisión por control BroadLink del 0 al 100%.',
        parameters: { percent: 'Porcentaje de volumen (0-100)' }, permission: 'physical-device',
        examples: ['Poné el volumen de la tele al 30', 'Volumen de la tele al 70%'],
        execute: async ({ percent }) => tvService.setVolume(percent)
    });
    actionKernel.register({
        id: 'tv.adjust-volume', name: 'Subir/Bajar volumen de la televisión',
        description: 'Sube o baja el volumen de la televisión por control BroadLink.',
        parameters: { delta: 'Diferencia de volumen (-100 a 100)' }, permission: 'physical-device',
        examples: ['Subí el volumen de la tele', 'Bajá el volumen de la tele 20'],
        execute: async ({ delta }) => tvService.adjustVolume(delta)
    });
    actionKernel.register({
        id: 'tv.get-volume', name: 'Consultar volumen de la televisión',
        description: 'Obtiene el volumen actual estimado de la televisión.',
        parameters: {}, permission: 'standard',
        examples: ['¿A cuánto está el volumen de la tele?', 'Volumen de la tele'],
        execute: async () => tvService.getVolume()
    });
    actionKernel.register({
        id: 'tv.calibrate-volume', name: 'Calibrar volumen de la televisión',
        description: 'Sincroniza el nivel actual del televisor con la memoria de Jarvis.',
        parameters: { level: 'Nivel actual en pantalla (0-100)' }, permission: 'standard',
        examples: ['El volumen de la tele está en 25', 'Calibrá el volumen de la tele a 15'],
        execute: async ({ level }) => tvService.calibrateVolume(level)
    });
    actionKernel.register({
        id: 'tv.learn-button', name: 'Aprender botón del control remoto',
        description: 'Pone al BroadLink en modo aprendizaje para capturar una tecla física (volup, voldown, power, etc.).',
        parameters: { button: 'Nombre del botón (volup, voldown, power, netflix, etc.)' }, permission: 'physical-device',
        examples: ['Aprendé subir volumen', 'Aprendé bajar volumen'],
        execute: async ({ button }) => {
            await tvService.learnButton(button);
            return { ok: true, message: `¡Excelente! Aprendí el botón ${button} del control remoto con éxito.` };
        }
    });

    actionKernel.register({
        id: 'tv.enter-netflix', name: 'Ingresar a perfil en Netflix',
        description: 'Presiona OK para ingresar al perfil de Rodri en Netflix.',
        parameters: {}, permission: 'physical-device',
        examples: ['Ingresá a Netflix', 'Entrá a mi cuenta de Netflix'],
        execute: async () => tvService.enterNetflixProfile()
    });
    actionKernel.register({
        id: 'tv.open-search', name: 'Abrir buscador de Netflix',
        description: 'Navega hacia el buscador de Netflix y abre el teclado en pantalla.',
        parameters: {}, permission: 'physical-device',
        examples: ['Andá a la búsqueda', 'Abrí el buscador de Netflix'],
        execute: async () => tvService.openNetflixSearch()
    });

    actionKernel.register({
        id: 'tv.control', name: 'Controlar TV y Netflix',
        description: 'Ejecuta únicamente una intención validada por el controlador de TV.',
        parameters: { intent: 'Intención estructurada de TV' }, permission: 'physical-device',
        dependencies: [{ id: 'broadlink', label: 'BroadLink configurado', check: async () => ({ available: await tvService.isAvailable(), detail: 'Debe estar en la misma red que la PC.' }) }],
        examples: ['Prendé la tele y abrí Netflix', 'Buscá The Walking Dead', 'Bajá dos veces'],
        execute: async ({ intent }, context) => {
            const message = await context.executeTvIntent(intent, context.onTvProgress);
            return { message, evidence: { intent: intent.action, deviceAccepted: true } };
        }
    });

    actionKernel.register({
        id: 'system.open', name: 'Abrir aplicación o sitio en la notebook',
        description: 'Abre una aplicación detectada o un sitio conocido y comprueba si el lanzador aceptó la orden.',
        parameters: { appName: 'Aplicación o sitio' }, permission: 'desktop-control',
        examples: ['Abrí Spotify', 'Abrí Netflix en la computadora'],
        execute: async ({ appName }) => {
            const success = await systemService.openApp(appName, modeService.getActiveMode().id);
            return success
                ? { message: `Abrí ${appName} en la computadora.`, evidence: { launcherAccepted: true, appName } }
                : { ok: false, message: `No pude abrir ${appName}.`, evidence: { launcherAccepted: false, appName } };
        }
    });

    actionKernel.register({
        id: 'system.media-search', name: 'Buscar contenido multimedia en la notebook',
        description: 'Abre directamente resultados de YouTube o Netflix en la computadora, sin pasar por el razonamiento general.',
        parameters: { platform: 'youtube o netflix', query: 'Canal, película, serie o video' }, permission: 'desktop-control',
        examples: ['Buscá el canal de Kurzgesagt en YouTube', 'Buscá The Walking Dead en Netflix en la compu'],
        execute: async ({ platform, query }) => {
            const success = await systemService.openMediaSearch(platform, query);
            const label = platform === 'youtube' ? 'YouTube' : 'Netflix';
            return success
                ? { message: `Abrí la búsqueda de ${query} en ${label} desde la computadora.`, evidence: { launcherAccepted: true, platform, query } }
                : { ok: false, message: `No pude abrir la búsqueda en ${label}.`, evidence: { launcherAccepted: false, platform, query } };
        }
    });

    actionKernel.register({
        id: 'document.create-info', name: 'Crear documento informativo en el Escritorio',
        description: 'Genera localmente un informe de Word cuando el usuario pide información sobre un tema.',
        parameters: { topic: 'Tema solicitado' }, permission: 'desktop-control',
        dependencies: [{ id: 'ollama', label: 'Motor local Ollama', check: () => true }],
        examples: ['Dame información sobre computación cuántica', 'Buscame info de Alan Turing'],
        execute: async ({ topic }) => {
            const result = await informationDocumentService.createOnDesktop(topic);
            return {
                message: `Preparé la información sobre ${topic} y guardé el documento en tu Escritorio como ${require('path').basename(result.filePath)}.`,
                data: { filePath: result.filePath },
                evidence: { fileCreated: true, filePath: result.filePath }
            };
        }
    });

    actionKernel.register({
        id: 'information.dollar', name: 'Consultar cotización del dólar',
        description: 'Consulta la cotización argentina actual y devuelve datos reales de compra y venta.',
        parameters: { type: 'oficial, blue, MEP, tarjeta u otro tipo opcional' },
        permission: 'standard', examples: ['¿Cuánto está el dólar?', 'Decime el dólar blue', 'Cotización del dólar MEP'],
        execute: async ({ type = '' }) => {
            const quote = await financeService.getDollarQuote(type);
            return { message: quote.message, evidence: { liveData: true, provider: 'DolarApi', type } };
        }
    });

    actionKernel.register({
        id: 'download.url', name: 'Descargar un enlace',
        description: 'Descarga localmente el enlace explícito entregado por el usuario.',
        parameters: { url: 'Enlace HTTP o HTTPS', audioOnly: 'Descargar solamente audio' },
        permission: 'desktop-control', examples: ['Descargame esto https://…', 'Bajá el audio de este enlace https://…'],
        execute: async ({ url, audioOnly = false }) => {
            if (!/^https?:\/\/\S+$/i.test(String(url || ''))) throw new Error('Necesito un enlace HTTP o HTTPS válido.');
            const directory = await downloadService.downloadMedia(url, Boolean(audioOnly));
            return {
                message: `Terminé la descarga y la guardé en ${directory}.`,
                data: { directory }, evidence: { downloadCompleted: true, directory, url }
            };
        }
    });

    actionKernel.register({
        id: 'system.learn-command', name: 'Enseñar un comando manual',
        description: 'Guarda una frase manual asociada a una aplicación; no genera variaciones automáticas.',
        parameters: { trigger: 'Frase', appName: 'Aplicación' }, permission: 'memory-write',
        examples: ['Cuando diga trabajo, abrí Visual Studio Code'],
        execute: async ({ trigger, appName }) => {
            systemService.saveCustomCommand(trigger, appName);
            return { message: `Guardé “${trigger}” para abrir ${appName}.`, evidence: { stored: true, trigger, appName } };
        }
    });

    actionKernel.register({
        id: 'observer.set', name: 'Modo observador',
        description: 'Activa o desactiva la lectura local de la ventana activa.',
        parameters: { enabled: 'Booleano' }, permission: 'screen-observation',
        examples: ['Activá el observador', 'Desactivá el observador'],
        execute: async ({ enabled }) => {
            const state = observerService.toggleObserver(Boolean(enabled));
            return { message: `Modo observador ${state ? 'activado' : 'desactivado'}.`, evidence: { enabled: state } };
        }
    });

    actionKernel.register({
        id: 'mode.activate', name: 'Activar modo', description: 'Cambia el modo de operación existente.',
        parameters: { modeId: 'ID o nombre' }, permission: 'standard', examples: ['Activá modo estudio'],
        execute: async ({ modeId }) => {
            const target = modeService.getAllModes().find(mode => mode.id === normalize(modeId) || normalize(mode.name) === normalize(modeId));
            if (!target || !modeService.setActiveMode(target.id)) return { ok: false, message: `No existe el modo ${modeId}.` };
            return { message: `Activé el modo ${target.name}.`, data: { modeId: target.id }, evidence: { active: modeService.getActiveMode().id === target.id } };
        }
    });

    actionKernel.register({
        id: 'assistant.respond', name: 'Comprensión general contextual',
        description: 'Responde libremente con el modo activo, el tema actual, recuerdos recientes y contexto de pantalla autorizado.',
        parameters: { text: 'Solicitud libre' }, permission: 'standard',
        dependencies: [{ id: 'ai-engine', label: 'Motor de IA', check: () => true }],
        examples: ['Explicame esto', 'Seguí con lo anterior', 'Ayudame con mi proyecto'],
        execute: async ({ text, referenceContext = [] }, context) => {
            const preferences = memoryService.snapshot().preferences;
            const memoryContext = referenceContext.length
                ? `Contexto de la conversación actual:\n${referenceContext.map(turn => `${turn.role}: ${turn.text}`).join('\n')}`
                : '';
            const preferenceContext = preferences.length
                ? `Preferencias que el usuario autorizó recordar:\n${preferences.map(item => `${item.key}: ${item.value}`).join('\n')}`
                : '';
            const screenContext = observerService.getScreenContext();
            const combined = [memoryContext, preferenceContext, screenContext].filter(Boolean).join('\n\n');
            const message = await aiService.getAIResponse(text, modeService.getActiveMode(), combined || null, context.inpaintingMask);
            // El texto sí fue producido, pero aiService todavía contiene herramientas
            // heredadas que no devuelven evidencia estructurada. Nunca las marcamos
            // como ejecución verificada hasta que migren a una acción propia.
            return { message, verified: false, evidence: { responseProduced: true, externalSideEffectsVerified: false, topic: memoryService.detectTopic(text) } };
        }
    });
}

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[!?;:¡¿]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseCorrection(text) {
    const match = String(text).match(/no\s+dije\s+[“"']?(.+?)[”"']?\s*,?\s*dije\s+[“"']?(.+?)[”"']?[.!]?$/i);
    return match && { from: match[1].trim(), to: match[2].trim() };
}

function parsePreference(text) {
    const match = String(text).match(/(?:record[aá]|acordate)(?:\s+de)?\s+que\s+(.+)/i);
    if (!match) return null;
    return { key: memoryService.detectTopic(match[1]), value: match[1].trim() };
}

function parseDesktopMediaSearch(text) {
    const clean = normalize(text);
    const wantsSearch = /\b(busca|buscame|buscar|encontra|encontrame|pone|poneme|reproduce|reproducime|quiero ver|mostrar)\b/.test(clean);
    if (!wantsSearch) return null;
    const wantsTv = /\b(tele|television|tv)\b/.test(clean);
    const wantsComputer = /\b(compu|computadora|pc|notebook|laptop)\b/.test(clean);
    let platform = '';
    if (/\byoutube\b/.test(clean) && !wantsTv) platform = 'youtube';
    if (/\bnetflix\b/.test(clean) && wantsComputer && !wantsTv) platform = 'netflix';
    if (!platform) return null;

    let query = clean
        .replace(/^.*?\b(?:busca|buscame|buscar|encontra|encontrame|pone|poneme|reproduce|reproducime|quiero ver|mostrar)\b\s*/, '')
        .replace(/\b(?:en|desde)\s+(?:mi\s+|la\s+)?(?:compu|computadora|pc|notebook|laptop)\b.*$/, '')
        .replace(/\b(?:en|por)\s+(?:youtube|netflix)\b/g, '')
        .replace(/\b(?:youtube|netflix)\b/g, '')
        .replace(/^\s*(?:el\s+canal|canal|la\s+pelicula|la\s+serie|pelicula|serie|video)\s+(?:de\s+)?/, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!query) return null;
    return { platform, query };
}

function parseInformationDocument(text) {
    const clean = String(text || '').trim();
    
    // Formas variadas: "quiero buscar información de...", "haceme un documento de...", "crear informe sobre...", etc.
    const match = clean.match(/(?:dame|busc(?:a|ame)|consegui(?:me)?|investiga|quiero\s+buscar|necesito)\s+(?:algo\s+de\s+)?(?:informaci[oó]n|info|datos)(?:\s+(?:detallada|completa|completos))?\s+(?:sobre|de|acerca\s+de)\s+(.+)/i)
        || clean.match(/(?:hac(?:e|eme)|cre(?:a|ame)|gener(?:a|ame)|redact(?:a|ame))\s+(?:un\s+)?(?:documento|informe|word|resumen|reporte|docx)(?:\s+(?:completo|detallado))?\s+(?:sobre|de|acerca\s+de)\s+(.+)/i)
        || clean.match(/^(?:informame|inf[oó]rmame)\s+(?:sobre|de)\s+(.+)/i);
        
    if (!match) return null;
    
    let topic = match[1]
        .replace(/\s+y\s+(?:guard(?:a|alo)|crea|gener[aá]|dej[aá]|dejalo|pon[eé]lo)(?:me)?\s+(?:un\s+)?(?:documento|word|docx|en\s+el\s+escritorio|en\s+mi\s+escritorio).*$/i, '')
        .replace(/\s+(?:en|para)\s+el\s+escritorio.*$/i, '')
        .replace(/[.!?]+$/, '')
        .trim();
        
    return topic.length >= 2 ? { topic } : null;
}

function parseDownload(text) {
    const raw = String(text || '');
    const url = raw.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;!?]+$/, '');
    if (!url || !/\b(descarga|descargar|descargame|baja|bajar|bajame|guarda|guardar|guardame)\b/i.test(normalize(raw))) return null;
    return { url, audioOnly: /\b(audio|musica|cancion|mp3)\b/i.test(normalize(raw)) };
}

function parseDollar(text) {
    const clean = normalize(text);
    if (!/\b(dolar|cotizacion)\b/.test(clean)) return null;
    if (!/\b(cuanto|precio|cotizacion|valor|esta|decime|dame|consulta|consultame)\b/.test(clean)) return null;
    return { type: financeService.requestedDollarType(clean) };
}

async function resolve(text) {
    registerActions();
    let clean = String(text || '').trim();
    // Normalización fonética para términos comúnmente malinterpretados por STT
    clean = clean
        .replace(/\b(?:un\s+)?(?:tequi\s*te|tequiste|tequi|te\s+que\s+te|tequis|tx\s*t|t\s+x\s+t)\b/gi, 'txt')
        .replace(/\b(crear|creame|crea|hacer|haceme|hace|generar|genera)\s+(?:un\s+)?tequila\b/gi, '$1 un txt');
    const lower = normalize(clean);

    // 1. Wake & Sleep
    if (/^jarvis\s+(?:prendete|despertate|reactivate)$/.test(lower)) return { id: 'voice.wake', params: {} };
    if (/^jarvis\s+(?:apagate|dormite|modo descanso|entra en modo descanso)$/.test(lower)) return { id: 'voice.sleep', params: {} };

    // 2. Parada de Emergencia (Voz)
    if (/\b(?:detener todo|para todo|parar todo|abortar|emergencia|cancela todo|cancelar todo)\b/i.test(lower)) {
        return { id: 'emergency.stop', params: {} };
    }

    // 3. Deshacer Global (Undo)
    if (/\b(?:deshac(?:e|er)?|deshace lo ultimo|deshace eso|revertir|deshacer)\b/i.test(lower)) {
        return { id: 'undo.last', params: {} };
    }

    // 4. Fast Command Parser (Volumen, Brillo, Captura, Batería, Top RAM, Portapapeles, Espacio en Disco)
    const fastParsed = fastCommandParser.parse(clean);
    if (fastParsed.match) {
        return { id: fastParsed.action, params: fastParsed.params || {} };
    }

    // 5. Memoria V6 (Consultar, Olvidar)
    const memQueryMatch = lower.match(/(?:qu[eé]\s+record[aá]s|qu[eé]\s+sabes|qu[eé]\s+tenes\s+guardado)\s+(?:sobre|de|acerca\s+de)\s+(.+)/i);
    if (memQueryMatch) {
        return { id: 'memory.query-v6', params: { topic: memQueryMatch[1].trim() } };
    }
    const memForgetMatch = lower.match(/^(?:olvid[aá]|borr[aá]\s+lo\s+aprendido\s+sobre|olvidate\s+de)\s+(.+)/i);
    if (memForgetMatch) {
        return { id: 'memory.forget-v6', params: { topic: memForgetMatch[1].trim() } };
    }

    // 6. Explicabilidad e Historial
    if (/\b(?:qu[eé]\s+hiciste|ultimas\s+acciones|por\s+qu[eé]\s+me\s+preguntaste|explicame)\b/i.test(lower)) {
        return { id: 'explain.query', params: { query: clean } };
    }

    // 7. Sistema de Archivos y Carpetas (Crear, Borrar y Restaurar)
    
    // 7.1 Crear carpeta con archivo Word o TXT adentro (Comando compuesto)
    const folderAndFileMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|gener[aá]|generar)\s+(?:una\s+)?carpeta\s*(?:llamada|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|que\s+se\s+llame\s+|titulada|de\s+nombre\s+|de\s+)?\s*([a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]+?)\s+(?:y\s+)?(?:cre[aá]|crear|creame|hac[eé]|haceme|hacer|pon[eé]|poner|met[eé]|meter|redact[aá]|redactar)?\s*(?:dentro|adentro|en\s+ella)?\s*(?:un\s+|una\s+)?(word|documento|docx|txt|archivo(?:\s+de\s+texto)?|nota)\s*(?:llamado|con\s+nombre\s+(?:de\s+)?)?\s*([^\s:]+)?\s*(?:que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|sobre|acerca\s+de|diciendo|:)?\s*([\s\S]*)$/i);
    if (folderAndFileMatch) {
        let folderName = folderAndFileMatch[1].trim().replace(/^de\s+/i, '').replace(/[.!?]+$/, '').trim();
        const type = (folderAndFileMatch[2] || '').toLowerCase();
        let name = (folderAndFileMatch[3] || '').trim();
        let contentOrTopic = (folderAndFileMatch[4] || '').trim().replace(/^(?:diga|que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|sobre|acerca\s+de|diciendo|:)\s*/i, '').trim();
        const isWord = /word|docx|documento/i.test(type);
        const format = isWord ? 'docx' : 'txt';

        if (!name || /^(?:que|con|sobre|acerca|de|diga)$/i.test(name)) {
            name = isWord ? `Documento_${Date.now()}` : `Nota_${Date.now()}`;
        }
        return {
            id: 'file.create',
            params: {
                folderName,
                fileName: name,
                content: contentOrTopic,
                topic: contentOrTopic,
                format
            }
        };
    }

    // 7.2 Crear carpeta sola
    const createFolderMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|gener[aá]|generar)\s+(?:una\s+)?carpeta\s*(?:llamada|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|que\s+se\s+llame\s+|titulada|de\s+nombre\s+|de\s+)?\s*([a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]+)$/i);
    if (createFolderMatch && createFolderMatch[1]) {
        let folderName = createFolderMatch[1].trim().replace(/^de\s+/i, '').replace(/[.!?]+$/, '').trim();
        if (folderName) {
            return { id: 'folder.create', params: { folderName } };
        }
    }

    // 7.3 Eliminar carpeta
    const delFolderMatch = lower.match(/^(?:borr(?:ar|[aá]|ame)|elimin(?:ar|[aá]|ame)|sac(?:ar|[aá]|ame)|quit(?:ar|[aá]|ame)|mand(?:ar|[aá]|ame)\s+a\s+la\s+papelera)\s+(?:la\s+|esta\s+)?carpeta\s*(?:llamada|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|de\s+nombre\s+|titulada|de\s+)?\s*([a-zA-Z0-9_\-\.áéíóúñ ]+)$/i);
    if (delFolderMatch && delFolderMatch[1]) {
        let folderName = delFolderMatch[1].trim().replace(/^de\s+/i, '').replace(/[.!?]+$/, '').trim();
        if (folderName) {
            return { id: 'folder.delete', params: { folderName } };
        }
    }

    // 7.4 Creación de archivos TXT / Notas explícitos
    const createTxtMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|escrib[ií]|escribir|gener[aá]|generar)\s+(?:un\s+|una\s+)?(?:txt|archivo\s+de\s+texto|nota|texto)\s*(?:llamad[oa]|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|titulad[oa])?\s*([^\s:]+)?\s*(?:sobre|acerca\s+de|con\s+tema|que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|diciendo|:)?\s*([\s\S]*)$/i);
    if (createTxtMatch) {
        let possibleName = (createTxtMatch[1] || '').trim();
        let topicOrContent = (createTxtMatch[2] || '').trim();
        let fileName = '';
        let content = topicOrContent;

        if (possibleName && !/^(?:que|con|sobre|acerca|de)$/i.test(possibleName)) {
            fileName = possibleName.endsWith('.txt') ? possibleName : `${possibleName}.txt`;
        } else {
            if (/^(?:que|con|sobre|acerca|de)$/i.test(possibleName)) {
                content = `${possibleName} ${content}`.trim().replace(/^(?:que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|sobre|acerca\s+de|diciendo|:)\s*/i, '');
            }
            fileName = `Nota_${Date.now()}.txt`;
        }
        return { id: 'file.create', params: { fileName, content, topic: content, format: 'txt' } };
    }

    // 7.5 Creación de Word (.docx) explícito
    const createWordMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|redact[aá]|redactar|gener[aá]|generar)\s+(?:un\s+|una\s+)?(?:word|docx|documento\s+de\s+word|documento)\s*(?:llamad[oa]|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|titulad[oa])?\s*([^\s:]+)?\s*(?:sobre|acerca\s+de|con\s+tema|que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|:)?\s*([\s\S]*)$/i);
    if (createWordMatch) {
        let possibleName = (createWordMatch[1] || '').trim();
        let topicOrContent = (createWordMatch[2] || '').trim();
        let fileName = '';
        let content = topicOrContent;

        if (possibleName && !/^(?:que|con|sobre|acerca|de)$/i.test(possibleName)) {
            fileName = possibleName.endsWith('.docx') ? possibleName : `${possibleName}.docx`;
        } else {
            if (/^(?:que|con|sobre|acerca|de)$/i.test(possibleName)) {
                content = `${possibleName} ${content}`.trim().replace(/^(?:que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|sobre|acerca\s+de|diciendo|:)\s*/i, '');
            }
            fileName = `Documento_${Date.now()}.docx`;
        }
        return { id: 'file.create', params: { fileName, topic: content, content, format: 'docx' } };
    }

    // 7.6 Creación general de archivo
    const createFileMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|escrib[ií]|gener[aá])\s+(?:un\s+|una\s+)?(?:archivo|documento)\s*(?:llamado|con\s+nombre|titulado)?\s*([^\s:]+\.[a-zA-Z0-9]+|[a-zA-Z0-9_\-]+)\s*(?:que\s+diga|con\s+el\s+contenido|con\s+texto|diciendo|:)?\s*([\s\S]*)$/i);
    if (createFileMatch && createFileMatch[1]) {
        let name = createFileMatch[1].trim();
        let content = (createFileMatch[2] || '').trim();
        if (!name.includes('.')) name += '.txt';
        return { id: 'file.create', params: { fileName: name, content, format: 'txt' } };
    }

    // 7.7 Borrado inteligente de capturas / fotos / imágenes
    if (/\b(?:borr(?:ar|[aá]|ame)|elimin(?:ar|[aá]|ame)|sac(?:ar|[aá]|ame)|quit(?:ar|[aá]|ame)|mand(?:ar|[aá]|ame)\s+a\s+la\s+papelera)\s+(?:la\s+|las\s+|esta\s+)?(?:ultima\s+|última\s+)?(?:captura|screenshot|foto|fotos|imagen|imagenes|pantallazo)\b/i.test(lower)) {
        return { id: 'file.delete', params: { filePath: 'last_screenshot' } };
    }

    // 7.8 Borrado de archivos generales
    const delFileMatch = lower.match(/^(?:borr(?:ar|[aá]|ame)|elimin(?:ar|[aá]|ame)|sac(?:ar|[aá]|ame)|quit(?:ar|[aá]|ame)|mand(?:ar|[aá]|ame)\s+a\s+la\s+papelera)\s+(?:el\s+archivo\s+|la\s+foto\s+|la\s+imagen\s+|el\s+documento\s+|el\s+|la\s+)?([a-zA-Z0-9_\-\.áéíóúñ ]+?)(?:\s+de\s+mi\s+escritorio|\s+del\s+escritorio)?$/i);
    if (delFileMatch && delFileMatch[1]) {
        let target = delFileMatch[1].trim();
        if (target) {
            return { id: 'file.delete', params: { filePath: target } };
        }
    }

    // 7.9 Restaurar archivos
    const restoreFileMatch = lower.match(/^(?:recuper(?:ar|[aá]|ame)|restaur(?:ar|[aá]|ame))\s+(?:el\s+archivo\s+|la\s+carpeta\s+)?([a-zA-Z0-9_\-\.áéíóúñ ]+?)(?:\s+de\s+la\s+papelera)?$/i);
    if (restoreFileMatch && restoreFileMatch[1]) {
        return { id: 'file.restore', params: { identifier: restoreFileMatch[1].trim() } };
    }

    // 8. Rutinas (Modo Estudio, Modo Juego)
    if (/\b(?:modo\s+estudio|modo\s+juego)\b/i.test(lower)) {
        const rName = lower.includes('estudio') ? 'modo estudio' : 'modo juego';
        return { id: 'routine.execute', params: { routineName: rName } };
    }

    const correction = parseCorrection(clean);
    if (correction) return { id: 'voice.correct', params: correction };
    const preference = parsePreference(clean);
    if (preference) return { id: 'memory.preference', params: preference };

    const download = parseDownload(clean);
    if (download) return { id: 'download.url', params: download };

    const dollar = parseDollar(clean);
    if (dollar) return { id: 'information.dollar', params: dollar };

    const mediaSearch = parseDesktopMediaSearch(clean);
    if (mediaSearch) return { id: 'system.media-search', params: mediaSearch };

    const informationDocument = parseInformationDocument(clean);
    if (informationDocument) return { id: 'document.create-info', params: informationDocument };

    const tvIntent = tvVoiceService.parseTvIntent(clean);
    if (tvIntent) {
        if (tvIntent.action === 'cancel') return { id: 'emergency.stop', params: {} };
        if (tvIntent.action === 'set_volume') return { id: 'tv.set-volume', params: { percent: tvIntent.percent } };
        if (tvIntent.action === 'adjust_volume') return { id: 'tv.adjust-volume', params: { delta: tvIntent.delta } };
        if (tvIntent.action === 'get_volume') return { id: 'tv.get-volume', params: {} };
        if (tvIntent.action === 'calibrate_volume') return { id: 'tv.calibrate-volume', params: { level: tvIntent.level } };
        if (tvIntent.action === 'learn_button') return { id: 'tv.learn-button', params: { button: tvIntent.button } };
        if (tvIntent.action === 'toggle_mute') return { id: 'tv.toggle-mute', params: {} };
        if (tvIntent.action === 'enter_netflix') return { id: 'tv.enter-netflix', params: {} };
        if (tvIntent.action === 'open_search') return { id: 'tv.open-search', params: {} };

        if (tvIntent.action === 'open_pc') return { id: 'system.open', params: { appName: 'Netflix' } };
        const broadLinkAvailable = await tvService.isAvailable();
        if (!broadLinkAvailable) {
            tvVoiceService.deactivateSession();
            if (tvIntent.title) {
                return { id: 'system.media-search', params: { platform: 'netflix', query: tvIntent.title } };
            }
            if (['choose_device', 'netflix', 'continue_watching', 'search'].includes(tvIntent.action)) {
                return { id: 'system.open', params: { appName: 'Netflix' } };
            }
        }
        return { id: 'tv.control', params: { intent: tvIntent } };
    }
    if (tvVoiceService.isSessionActive() && !tvVoiceService.switchesAwayFromTv(clean)) {
        return { id: 'tv.control', params: { intent: { action: 'clarify' } } };
    }

    if (/\b(activar|activa|prende|encende)\b.*\b(observador|observacion)\b/.test(lower)) return { id: 'observer.set', params: { enabled: true } };
    if (/\b(desactivar|desactiva|apaga)\b.*\b(observador|observacion)\b/.test(lower)) return { id: 'observer.set', params: { enabled: false } };
    const mode = lower.match(/activar\s+(?:el\s+)?modo\s+(.+)/);
    if (mode) return { id: 'mode.activate', params: { modeId: mode[1] } };

    const sys = systemService.handleSystemCommand(clean);
    if (sys.isTraining) return { id: 'system.learn-command', params: { trigger: sys.trigger, appName: sys.appName } };
    if (sys.isSystemCommand) return { id: 'system.open', params: { appName: sys.appName } };

    const learned = voiceLearningService.resolveVerifiedPhrase(clean);
    if (learned) return learned;

    const refs = memoryService.resolveReferences(clean);
    return { id: 'assistant.respond', params: { text: clean, referenceContext: refs.context || [] } };
}

async function process(text, context = {}) {
    registerActions();
    const request = await resolve(text);
    memoryService.addTurn('user', text, { actionId: request.id });
    const result = await actionKernel.execute(request.id, request.params, context);
    voiceLearningService.recordVerifiedExecution({
        utterance: text, actionId: request.id, params: request.params, result
    });
    if (result.message) memoryService.addTurn('assistant', result.message, { actionId: request.id, status: result.status, verified: result.verified });
    return result;
}

registerActions();
module.exports = { process, resolve, describe: actionKernel.describe, execute: actionKernel.execute, confirm: actionKernel.confirm, cancelConfirmation: actionKernel.cancelConfirmation };
