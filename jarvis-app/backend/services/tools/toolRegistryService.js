/**
 * Modular Contextual Tool Registry for Jarvis (Ítem 9)
 * Organiza las herramientas en 12 módulos especializados y selecciona dinámicamente
 * únicamente los módulos relevantes para el contexto actual, reduciendo los prompts
 * hasta en un 80% y eliminando errores de selección en el LLM.
 *
 * Módulos:
 *   Windows, Browser, TV, Spotify, Files, Email, WhatsApp,
 *   Office, Memory, Research, Python, Home
 */

class ToolRegistryService {
    constructor() {
        this.modules = new Map();
        this._registerDefaultModules();
    }

    /**
     * Registra un módulo temático con sus herramientas y patrones semánticos de activación.
     */
    registerModule(moduleId, { name, description, keywords = [], patterns = [], tools = [] }) {
        this.modules.set(moduleId.toLowerCase(), {
            id: moduleId.toLowerCase(),
            name,
            description,
            keywords: keywords.map(k => k.toLowerCase()),
            patterns,
            tools
        });
    }

    /**
     * Obtiene la definición de un módulo por su ID.
     */
    getModule(moduleId) {
        return this.modules.get(moduleId.toLowerCase()) || null;
    }

    /**
     * Lista todos los módulos registrados y su cantidad de herramientas.
     */
    listModules() {
        return [...this.modules.values()].map(m => ({
            id: m.id,
            name: m.name,
            description: m.description,
            toolCount: m.tools.length
        }));
    }

    /**
     * Obtiene el catálogo total de herramientas registradas en todos los módulos.
     */
    getAllTools() {
        const all = [];
        for (const m of this.modules.values()) {
            all.push(...m.tools);
        }
        return all;
    }

    /**
     * Selector Contextual Dinámico:
     * Analiza el prompt y contexto, y selecciona ÚNICAMENTE los módulos relevantes.
     * Ejemplo: "Poné Spotify" -> [Spotify, Windows (audio)]
     */
    selectToolsForPrompt(prompt = '', context = {}) {
        const clean = String(prompt || '').toLowerCase().trim();
        if (!clean && !context.forcedModules) {
            // Contexto vacío: herramientas mínimas base
            const winMod = this.getModule('windows');
            return winMod ? winMod.tools : [];
        }

        // Si se fuerzan módulos explícitamente en el contexto
        if (Array.isArray(context.forcedModules) && context.forcedModules.length > 0) {
            const selected = [];
            for (const modId of context.forcedModules) {
                const mod = this.getModule(modId);
                if (mod) selected.push(...mod.tools);
            }
            return selected;
        }

        const scoredModules = [];

        for (const mod of this.modules.values()) {
            let score = 0;

            // 1. Coincidencia por regex
            for (const pattern of mod.patterns) {
                if (pattern.test(clean)) {
                    score += 5;
                    break;
                }
            }

            // 2. Coincidencia por palabras clave
            for (const kw of mod.keywords) {
                if (clean.includes(kw)) {
                    score += 2;
                }
            }

            if (score > 0) {
                scoredModules.push({ module: mod, score });
            }
        }

        // Ordenar por relevancia descendente
        scoredModules.sort((a, b) => b.score - a.score);

        // Si hay coincidencia de Spotify o TV, incluir Windows secundariamente si se menciona volumen o sonido
        const hasMusicOrMedia = scoredModules.some(sm => ['spotify', 'tv'].includes(sm.module.id));
        const mentionsAudio = /\b(?:volumen|sonido|audio|mute|silencio|subi|baja)\b/i.test(clean);
        if (hasMusicOrMedia && mentionsAudio && !scoredModules.some(sm => sm.module.id === 'windows')) {
            const winMod = this.getModule('windows');
            if (winMod) scoredModules.push({ module: winMod, score: 2 });
        }

        // Tomar los top 1 a 3 módulos más relevantes
        const topModules = scoredModules.slice(0, 3).map(sm => sm.module);

        // Si no hubo coincidencias específicas, usar módulos de propósito general
        if (topModules.length === 0) {
            const winMod = this.getModule('windows');
            const memMod = this.getModule('memory');
            const fallback = [];
            if (winMod) fallback.push(...winMod.tools);
            if (memMod) fallback.push(...memMod.tools);
            return fallback;
        }

        // Combinar herramientas de los módulos seleccionados
        const selectedTools = [];
        const seenNames = new Set();
        for (const mod of topModules) {
            for (const tool of mod.tools) {
                if (!seenNames.has(tool.name)) {
                    seenNames.add(tool.name);
                    selectedTools.push(tool);
                }
            }
        }

        return selectedTools;
    }

    /**
     * Formatea las herramientas al estándar de Function Calling compatible con Ollama.
     */
    formatForOllama(tools = []) {
        return tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: {
                    type: 'object',
                    properties: t.parameters || {},
                    required: t.required || []
                }
            }
        }));
    }

    /**
     * Inicialización de los 12 módulos de herramientas especializados.
     */
    _registerDefaultModules() {
        // 1. WINDOWS
        this.registerModule('windows', {
            name: 'Windows Control',
            description: 'Control de ventanas, audio del sistema, brillo, métricas y UI Automation.',
            keywords: ['volumen', 'sonido', 'brillo', 'ventana', 'minimiza', 'maximiza', 'cerrar', 'pestaña', 'bateria', 'pantalla'],
            patterns: [/\b(?:volumen|audio|sonido|mute|brillo|pantalla|ventana|pestaña|escritorio)\b/i],
            tools: [
                { name: 'windows_set_volume', description: 'Ajusta el volumen del sistema Windows (0-100%)', parameters: { percent: { type: 'number', description: 'Porcentaje de volumen' } }, required: ['percent'] },
                { name: 'windows_toggle_mute', description: 'Silencia o reactiva el audio del sistema', parameters: {} },
                { name: 'windows_minimize_window', description: 'Minimiza la ventana activa', parameters: {} },
                { name: 'windows_maximize_window', description: 'Maximiza la ventana activa', parameters: {} },
                { name: 'windows_close_window', description: 'Cierra la ventana activa', parameters: {} },
                { name: 'windows_take_screenshot', description: 'Toma una captura de pantalla', parameters: {} },
                { name: 'windows_ui_inspect', description: 'Inspecciona controles semánticos de la ventana activa mediante UI Automation', parameters: { window: { type: 'string' } } }
            ]
        });

        // 2. BROWSER
        this.registerModule('browser', {
            name: 'Browser Automation',
            description: 'Navegación web autónoma con Playwright y Chrome.',
            keywords: ['navegador', 'chrome', 'web', 'sitio', 'pagina', 'click', 'scroll', 'formulario', 'link', 'enlace'],
            patterns: [/\b(?:navega|abre\s+(?:la\s+web|la\s+pagina|el\s+sitio)|scroll|click\s+en|pagina\s+web)\b/i],
            tools: [
                { name: 'browser_open', description: 'Abre una URL en el navegador autónomo', parameters: { url: { type: 'string' } }, required: ['url'] },
                { name: 'browser_click', description: 'Hace clic en un elemento web por selector o texto', parameters: { selector: { type: 'string' } }, required: ['selector'] },
                { name: 'browser_type', description: 'Escribe en un campo de formulario web', parameters: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] },
                { name: 'browser_get_text', description: 'Lee el texto de una página web', parameters: { selector: { type: 'string' } } },
                { name: 'browser_scroll', description: 'Desplaza la página web verticalmente', parameters: { direction: { type: 'string', enum: ['down', 'up'] }, amount: { type: 'number' } } },
                { name: 'browser_close', description: 'Cierra la sesión de navegación autónoma', parameters: {} }
            ]
        });

        // 3. TV
        this.registerModule('tv', {
            name: 'TV Control',
            description: 'Control de televisión inteligente y BroadLink IR.',
            keywords: ['tele', 'television', 'tv', 'smart tv', 'netflix tele', 'volumen tele'],
            patterns: [/\b(?:tele|television|tv)\b/i],
            tools: [
                { name: 'tv_set_volume', description: 'Ajusta el volumen absoluto de la TV', parameters: { percent: { type: 'number' } }, required: ['percent'] },
                { name: 'tv_adjust_volume', description: 'Sube o baja el volumen relativo de la TV', parameters: { delta: { type: 'number' } }, required: ['delta'] },
                { name: 'tv_get_volume', description: 'Consulta el volumen actual de la TV', parameters: {} },
                { name: 'tv_toggle_mute', description: 'Silencia o desilencia la TV', parameters: {} },
                { name: 'tv_enter_netflix', description: 'Abre Netflix en la TV', parameters: {} }
            ]
        });

        // 4. SPOTIFY
        this.registerModule('spotify', {
            name: 'Spotify Music',
            description: 'Control de reproducción y búsqueda musical en Spotify.',
            keywords: ['spotify', 'musica', 'cancion', 'tema', 'playlist', 'reproducir', 'pausar', 'artista'],
            patterns: [/\b(?:spotify|musica|cancion|tema|playlist|reproduc(?:e|ir)|paus(?:a|ar))\b/i],
            tools: [
                { name: 'spotify_play', description: 'Inicia o reanuda la reproducción en Spotify', parameters: { query: { type: 'string', description: 'Canción o artista opcional' } } },
                { name: 'spotify_pause', description: 'Pausa la reproducción en Spotify', parameters: {} },
                { name: 'spotify_next', description: 'Avanza a la siguiente canción', parameters: {} },
                { name: 'spotify_previous', description: 'Vuelve a la canción anterior', parameters: {} },
                { name: 'spotify_search', description: 'Busca canciones, álbumes o artistas', parameters: { query: { type: 'string' } }, required: ['query'] }
            ]
        });

        // 5. FILES
        this.registerModule('files', {
            name: 'Files & Folders',
            description: 'Operaciones del sistema de archivos y papelera segura.',
            keywords: ['archivo', 'carpeta', 'fichero', 'borrar', 'crear archivo', 'papelera', 'guardar'],
            patterns: [/\b(?:archivo|carpeta|nota|crear\s+archivo|borrar\s+archivo|papelera)\b/i],
            tools: [
                { name: 'file_create', description: 'Crea un archivo en el Escritorio o carpeta especificada', parameters: { fileName: { type: 'string' }, content: { type: 'string' } }, required: ['fileName'] },
                { name: 'file_delete', description: 'Mueve un archivo a la papelera segura de Jarvis', parameters: { filePath: { type: 'string' } }, required: ['filePath'] },
                { name: 'folder_create', description: 'Crea una carpeta en el Escritorio', parameters: { folderName: { type: 'string' } }, required: ['folderName'] },
                { name: 'folder_delete', description: 'Mueve una carpeta a la papelera segura', parameters: { folderName: { type: 'string' } }, required: ['folderName'] },
                { name: 'file_read', description: 'Lee el contenido de un archivo de texto', parameters: { filePath: { type: 'string' } }, required: ['filePath'] }
            ]
        });

        // 6. EMAIL
        this.registerModule('email', {
            name: 'Email Management',
            description: 'Gestión y redacción de correos electrónicos.',
            keywords: ['email', 'correo', 'mail', 'gmail', 'outlook', 'bandeja'],
            patterns: [/\b(?:email|correo|mail|gmail|outlook)\b/i],
            tools: [
                { name: 'email_send', description: 'Envía un correo electrónico', parameters: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
                { name: 'email_read_latest', description: 'Lee los últimos correos recibidos', parameters: { count: { type: 'number' } } },
                { name: 'email_search', description: 'Busca correos por remitente o asunto', parameters: { query: { type: 'string' } }, required: ['query'] }
            ]
        });

        // 7. WHATSAPP
        this.registerModule('whatsapp', {
            name: 'WhatsApp Messaging',
            description: 'Envío directo de mensajes y gestión de chats de WhatsApp.',
            keywords: ['whatsapp', 'mensaje', 'contacto', 'mandale', 'escribile'],
            patterns: [/\b(?:whatsapp|wpp|mensaje\s+a|mandale\s+un\s+mensaje)\b/i],
            tools: [
                { name: 'whatsapp_send_message', description: 'Envía un mensaje de WhatsApp a un contacto', parameters: { contact: { type: 'string' }, message: { type: 'string' } }, required: ['contact', 'message'] },
                { name: 'whatsapp_open_chat', description: 'Abre la conversación de un contacto en WhatsApp', parameters: { contact: { type: 'string' } }, required: ['contact'] },
                { name: 'whatsapp_get_history', description: 'Consulta el historial de mensajes recientes', parameters: { contact: { type: 'string' } } }
            ]
        });

        // 8. OFFICE
        this.registerModule('office', {
            name: 'Office Documents',
            description: 'Generación y edición de documentos Word, PDF, Excel y presentaciones.',
            keywords: ['word', 'docx', 'pdf', 'excel', 'xlsx', 'powerpoint', 'informe', 'documento', 'presentacion'],
            patterns: [/\b(?:word|docx|pdf|excel|xlsx|powerpoint|ppt|informe|documento)\b/i],
            tools: [
                { name: 'office_create_word', description: 'Genera un documento Word (.docx) formal con formato', parameters: { title: { type: 'string' }, topic: { type: 'string' } }, required: ['title'] },
                { name: 'office_create_pdf', description: 'Genera un documento en formato PDF', parameters: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title'] },
                { name: 'office_create_excel', description: 'Crea una planilla de cálculo Excel (.xlsx)', parameters: { fileName: { type: 'string' }, sheets: { type: 'object' } }, required: ['fileName'] }
            ]
        });

        // 9. MEMORY
        this.registerModule('memory', {
            name: 'Memory & Profile',
            description: 'Consulta y almacenamiento en memoria episódica y perfil del usuario.',
            keywords: ['recordar', 'recuerda', 'olvidar', 'preferencia', 'perfil', 'memoria', 'acordate'],
            patterns: [/\b(?:record(?:a|ar)|acordate|preferencia|mi\s+perfil|guardar\s+en\s+memoria)\b/i],
            tools: [
                { name: 'memory_store', description: 'Almacena un recuerdo o preferencia en memoria persistente', parameters: { topic: { type: 'string' }, content: { type: 'string' } }, required: ['topic', 'content'] },
                { name: 'memory_query', description: 'Consulta recuerdos y preferencias almacenadas', parameters: { query: { type: 'string' } }, required: ['query'] },
                { name: 'memory_get_profile', description: 'Obtiene el perfil consolidado del usuario', parameters: {} }
            ]
        });

        // 10. RESEARCH
        this.registerModule('research', {
            name: 'Deep Web Research',
            description: 'Investigación analítica multi-fuente, deduplicación y síntesis comparativa.',
            keywords: ['investiga', 'averigua', 'comparar', 'benchmarks', 'precios', 'fuentes', 'estudio'],
            patterns: [/\b(?:investig(?:a|ar)|averigu(?:a|ar)|comparativa|benchmarks?|analisis\s+de\s+mercado)\b/i],
            tools: [
                { name: 'research_query', description: 'Ejecuta investigación analítica multi-fuente con subconsultas y consenso', parameters: { question: { type: 'string' } }, required: ['question'] },
                { name: 'research_synthesize', description: 'Sintetiza múltiples fuentes sobre un tópico', parameters: { topic: { type: 'string' } }, required: ['topic'] }
            ]
        });

        // 11. PYTHON
        this.registerModule('python', {
            name: 'Python Engine',
            description: 'Ejecución segura de código Python, cálculos matemáticos y análisis de datos.',
            keywords: ['python', 'script', 'calcular', 'algoritmo', 'ejecutar codigo', 'dataframe'],
            patterns: [/\b(?:python|script\s+de\s+python|calcul(?:a|ar)|ejecut(?:a|ar)\s+c[oó]digo)\b/i],
            tools: [
                { name: 'python_execute', description: 'Ejecuta un script o función en el entorno seguro de Python', parameters: { code: { type: 'string' } }, required: ['code'] },
                { name: 'python_calculate', description: 'Evalúa una expresión matemática o estadística', parameters: { expression: { type: 'string' } }, required: ['expression'] }
            ]
        });

        // 12. HOME
        this.registerModule('home', {
            name: 'Smart Home IoT',
            description: 'Domótica y control de dispositivos inteligentes del hogar.',
            keywords: ['luces', 'luz', 'enchufe', 'aire', 'termostato', 'habitacion', 'casa'],
            patterns: [/\b(?:luces?|enchufe|termostato|aire\s+acondicionado|domotica|casa)\b/i],
            tools: [
                { name: 'home_toggle_light', description: 'Enciende o apaga las luces de una habitación', parameters: { room: { type: 'string' }, state: { type: 'boolean' } }, required: ['room', 'state'] },
                { name: 'home_set_thermostat', description: 'Ajusta la temperatura del termostato', parameters: { temperature: { type: 'number' } }, required: ['temperature'] },
                { name: 'home_get_status', description: 'Consulta el estado de los dispositivos del hogar', parameters: {} }
            ]
        });
    }
}

const toolRegistryService = new ToolRegistryService();
module.exports = toolRegistryService;
