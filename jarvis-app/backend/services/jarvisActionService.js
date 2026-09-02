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

    // File Trash & Rollback
    actionKernel.register({
        id: 'file.delete', name: 'Mover archivo a papelera segura', description: 'Mueve un archivo a la papelera segura de Jarvis.',
        parameters: { filePath: 'Ruta o nombre del archivo' }, permission: 'standard',
        execute: async ({ filePath }) => {
            const os = require('os');
            const path = require('path');
            const target = path.isAbsolute(filePath) ? filePath : path.join(os.homedir(), 'Desktop', filePath);
            return trashService.moveToTrash(target);
        }
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
    const clean = String(text || '').trim();
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

    // 7. Papelera & Archivos (Borrar y Recuperar)
    const delFileMatch = lower.match(/^(?:borr[aá]|elimin[aá]|mand[aá]\s+a\s+la\s+papelera)\s+(?:el\s+archivo\s+)?([a-zA-Z0-9_\-\. ]+?)(?:\s+de\s+mi\s+escritorio|\s+del\s+escritorio)?$/i);
    if (delFileMatch && delFileMatch[1]) {
        return { id: 'file.delete', params: { filePath: delFileMatch[1].trim() } };
    }
    const restoreFileMatch = lower.match(/^(?:recuper[aá]|restaur[aá])\s+(?:el\s+archivo\s+)?([a-zA-Z0-9_\-\. ]+?)(?:\s+de\s+la\s+papelera)?$/i);
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
