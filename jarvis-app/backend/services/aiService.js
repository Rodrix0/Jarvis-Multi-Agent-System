const cheerio = require('cheerio');

// Eliminamos las credenciales de Google porque ahora somos 100% locales
let conversationHistory = [];

function getLastAssistantReplyFromHistory() {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const msg = conversationHistory[i];
        if (msg.role !== 'assistant') continue;
        if (typeof msg.content === 'string' && msg.content.trim()) return msg.content.trim();
        if (msg.content && typeof msg.content.reply === 'string' && msg.content.reply.trim()) {
            return msg.content.reply.trim();
        }
    }
    return '';
}

function extractRecipientFromCurrentUtterance(text) {
    if (!text || typeof text !== 'string') return '';
    const cleaned = text
        .trim()
        .replace(/["'`´]+/g, '')
        .replace(/[\u0000-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[.!,;:?]+$/g, '');

    const m = cleaned.match(/\b(?:manda(?:r)?|env[ií]a(?:r)?|m[aá]ndale|env[ií]ale?)\b[\s\S]*?\b(?:a|para)\s+([a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ][a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s._-]{1,80})$/i);
    if (!m || !m[1]) return '';

    return m[1]
        .replace(/\b(?:por favor|gracias|porfa|ahora|ya)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTimeFromText(text) {
    if (!text || typeof text !== 'string') return '';
    const m = text.match(/(?:a\s+las?|para\s+las?|a\s+la|para\s+la)\s*(\d{1,2})(?::|\.|,)?(\d{2})?\s*(am|pm)?/i);
    if (!m) return '';
    let hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    const meridian = (m[3] || '').toLowerCase();

    if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return '';

    if (meridian) {
        // Si el usuario dijo 20:50 pm, lo tomamos como 20:50 (ya está en 24h).
        if (hh > 12) {
            // keep as-is
        } else {
            if (meridian === 'pm' && hh < 12) hh += 12;
            if (meridian === 'am' && hh === 12) hh = 0;
        }
    }

    if (hh < 0 || hh > 23) return '';

    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function extractMessageFromCurrentUtterance(text) {
    if (!text || typeof text !== 'string') return '';
    const m = text.match(/(?:que\s+diga|dec[ií]le|dile|mensaje\s+que\s+diga)\s+([\s\S]+?)(?:\s+a\s+las?\s+\d{1,2}(?::|\.|,)?\d{0,2}\s*(?:am|pm)?\s*)?$/i);
    if (!m || !m[1]) return '';
    return m[1].replace(/[.!,;:?]+$/g, '').trim();
}

function extractDocumentTopicFromUtterance(text) {
    if (!text || typeof text !== 'string') return '';
    const m = text.match(/(?:sobre|acerca de|del tema|de)\s+([\s\S]+)$/i);
    if (!m || !m[1]) return '';
    return m[1]
        .replace(/\b(completo|completa|detallado|detallada|bien\s+hecho|bien\s+hecha)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCommonAcademicTypos(topic) {
    if (!topic || typeof topic !== 'string') return topic;
    return topic
        .replace(/\bturning\b/gi, 'turing')
        .replace(/\baut[oó]mata\s+de\s+turing\b/gi, 'autómata de Turing');
}

function normalizeDocumentActionType(value) {
    const t = String(value || '').toLowerCase().trim();
    if (t === 'word' || t === 'docx' || t === 'doc') return 'doc';
    if (t === 'powerpoint' || t === 'pptx' || t === 'ppt') return 'ppt';
    if (t === 'xlsx' || t === 'excel') return 'excel';
    if (t === 'pdf') return 'pdf';
    return 'doc';
}

function inferDeterministicIntent(userText) {
    if (!userText || typeof userText !== 'string') return null;
    const text = userText.trim();
    const lower = text.toLowerCase();

    // Consultar tareas/recordatorios.
    if (/(?:que|qué)\s+(?:tareas|recordatorios)\s+(?:tengo|hay)|\bmis tareas\b|\btareas pendientes\b|\brevisa mis tareas\b|\bmis recordatorios\b/i.test(text)) {
        return {
            action: 'check_reminders',
            reply: 'Revisando tus tareas y recordatorios.'
        };
    }

    // Programación de Proyectos (Ingeniero).
    if (/(crea|crear|haz|hazme|programa|desarrolla|arma|diseña|actualiza).*(página web|pagina web|web|sitio web|aplicación|app|proyecto|software)/i.test(lower)) {
        return {
            action: 'build_software',
            target: text,
            reply: 'Comenzando a desarrollar tu proyecto, señor.'
        };
    }

    // Generación de Imágenes Directa
    if (/(crea|crear|generar|genera|haz|hazme|dibuja|dibujame|diseña).*(imagen|foto|fotografia|fotografía|dibujo|render|pintura|arte)/i.test(lower)) {
        return {
            action: 'generate_image',
            target: text,
            reply: 'Iniciando el motor de renderizado de imágenes. Espere un momento...'
        };
    }

    // Limpiar recordatorios.
    if (/(borra|borrar|limpia|elimina|eliminar).*(recordatorios|tareas)/i.test(text)) {
        return {
            action: 'clear_reminders',
            reply: 'Limpiando tus recordatorios.'
        };
    }

    // Programar tarea local.
    if (/(programa|programar|agenda|agendar|agend[áa]|recordame|recu[eé]rdame)/i.test(text)) {
        const time = extractTimeFromText(text);
        let action_type = 'speak';
        if (/whatsapp|mensaje|envi[áa] (un )?mensaje|manda/i.test(lower)) action_type = 'send_whatsapp';
        if (/abr[ií]|abre|inicia|arranca/.test(lower)) action_type = 'open_app';

        const target = (text.match(/(?:a|para)\s+([a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ][a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s._-]{1,80})$/i) || [])[1] || '';
        const message = (text.match(/(?:que diga|dec[ií]le|dile)\s+([\s\S]+)$/i) || [])[1] || '';

        return {
            action: 'schedule_task',
            time,
            action_type,
            target: target.trim(),
            message: message.trim(),
            reply: time ? `Perfecto, lo programo para las ${time}.` : 'Necesito la hora exacta para programarlo.'
        };
    }

    // Crear documento.
    if (/(crea|crear|genera|generar|haz|hacer|hazme|arm[aá]|prepar[aá]|redact[aá]).*(documento|informe|word|docx|pdf|excel|xlsx|powerpoint|ppt|presentaci[oó]n)/i.test(text)) {
        let action_type = 'doc';
        if (/pdf/.test(lower)) action_type = 'pdf';
        else if (/excel|xlsx/.test(lower)) action_type = 'excel';
        else if (/powerpoint|ppt|presentaci[oó]n/.test(lower)) action_type = 'ppt';

        const targetMatch = text.match(/(?:sobre|de|del tema|acerca de)\s+([\s\S]+)$/i);
        const target = (targetMatch && targetMatch[1] ? targetMatch[1] : text)
            .replace(/^(crea|crear|genera|generar|haz|hacer)\s+/i, '')
            .replace(/\b(un|una|el|la)\s+(word|docx|documento|informe|pdf|excel|xlsx|powerpoint|ppt|presentaci[oó]n)\b/gi, '')
            .trim();

        return {
            action: 'create_document',
            action_type: normalizeDocumentActionType(action_type),
            target,
            message: 'search_web',
            reply: `Generando tu documento sobre ${target}.`
        };
    }

    return null;
}

// Funciones legacy limpiadas porque ahora usamos Native Tool Calling a través del LLM.

function recoverIntentFromBrokenJson(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    const cleaned = rawText.replace(/\u0000/g, '').trim();

    // 1) Attempt to parse a likely JSON object slice.
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const candidate = cleaned.slice(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        } catch (e) {
            // Continue with tolerant extraction.
        }
    }

    // 2) Tolerant regex extraction for malformed/truncated outputs.
    const actionMatch = cleaned.match(/"action"\s*:\s*"([^"]+)"/i);
    const targetMatch = cleaned.match(/"target"\s*:\s*"([\s\S]*?)"\s*(,|\n|\r|$)/i);
    const messageMatch = cleaned.match(/"message"\s*:\s*"([\s\S]*?)"\s*(,|\n|\r|$)/i);
    const replyStart = cleaned.match(/"reply"\s*:\s*"([\s\S]*)$/i);

    if (!actionMatch && !replyStart) return null;

    let reply = replyStart ? replyStart[1] : '';
    reply = reply
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/[\u0000-\u001F]/g, ' ')
        .replace(/[",\s}]*$/, '')
        .trim();

    return {
        action: actionMatch ? actionMatch[1] : 'chat',
        target: targetMatch ? targetMatch[1].trim() : '',
        message: messageMatch ? messageMatch[1].trim() : '',
        reply: reply || 'No pude estructurar el JSON completo, pero pude recuperar la respuesta principal.'
    };
}

function recoverToolIntentFromModelContent(rawContent, userText = '') {
    if (!rawContent || typeof rawContent !== 'string') return null;

    const txt = rawContent.trim();
    const lower = txt.toLowerCase();

    // Detect function/tool style outputs even if malformed.
    const knownActions = [
        'send_whatsapp', 'send_email', 'search_web', 'open_app', 'schedule_task',
        'check_reminders', 'clear_reminders', 'create_document', 'generate_prompt',
        'chat_casual', 'search_internet', 'develop_new_skill', 'build_software',
        'generate_image'
    ];

    let detectedAction = '';
    for (const a of knownActions) {
        if (lower.includes(a)) {
            detectedAction = a;
            break;
        }
    }

    if (!detectedAction) return null;

    const getField = (name) => {
        const m = txt.match(new RegExp(`"${name}"\\s*:\\s*"([\\s\\S]*?)"`, 'i'));
        return m ? m[1].trim() : '';
    };

    let target = getField('target');
    let message = getField('message');
    let reply = getField('reply');
    const time = getField('time');
    const action_type = getField('action_type');

    // Safety correction: if user explicitly asked to open WhatsApp, do not route to send_whatsapp.
    if (/\b(abr[ií]me|abre|abrir|inicia|abr[ií])\b[\s\S]*\bwhatsapp\b/i.test(userText)) {
        detectedAction = 'open_app';
        if (!target) target = 'whatsapp';
        if (!reply) reply = 'Abriendo WhatsApp.';
        message = '';
    }

    return {
        action: detectedAction,
        target,
        message,
        time,
        action_type,
        reply: reply || 'Procediendo con la acción.'
    };
}

async function performInvisibleSearch(query, maxLength = 3000) {
    console.log(`\n[Agente Araña] 🕸️ Infiltrando de forma dual (Bing Vivo + DuckDuckGo Info) para: "${query}"...`);
    try {
        const headersBing = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0 Safari/537.36',
            'Accept-Language': 'es-ES,es;q=0.9'
        };
        const headersDuck = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        // Búsquedas Concurrentes
        const [resBing, resDuck] = await Promise.all([
            fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { headers: headersBing }).catch(() => null),
            fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: headersDuck }).catch(() => null)
        ]);

        let combinedText = "";

        // Procesar Bing (Resultados y Widgets en Vivo)
        if (resBing && resBing.ok) {
            const htmlBing = await resBing.text();
            const $1 = cheerio.load(htmlBing);
            $1('script, style, noscript, header, footer, svg, img, button').remove();
            let textBing = $1('#b_results').text() || "";
            textBing = textBing.replace(/\s+/g, ' ').trim();
            if (textBing) combinedText += `[DATOS CLAVE Y EVENTOS EN VIVO]: ${textBing.substring(0, maxLength / 2)}\n\n`;
        }

        // Procesar DuckDuckGo (Definiciones e Información)
        if (resDuck && resDuck.ok) {
            const htmlDuck = await resDuck.text();
            const $2 = cheerio.load(htmlDuck);
            $2('script, style, noscript, header, footer, svg, img, button').remove();
            let textDuck = $2('.result__snippet').text() || "";
            textDuck = textDuck.replace(/\s+/g, ' ').trim();
            if (textDuck) combinedText += `[DEFINICIONES E INFORMACIÓN WIKIPEDIA]: ${textDuck.substring(0, maxLength / 2)}`;
        }
        
        if (!combinedText.trim()) {
            console.log("\n[Modo Infiltración] 🕵️‍♂️ Búsqueda estándar bloqueada. Lanzando Obscura para evasión avanzada con renderizado de JS...");
            return await runObscuraInfiltration(query, maxLength);
        }
        return combinedText;
    } catch (e) {
        console.error("Error al romper la seguridad de búsqueda:", e.message);
        return "Fallo de conexión al raspar la web.";
    }
}

async function runObscuraInfiltration(query, maxLength) {
    try {
        const puppeteer = require('puppeteer');
        console.log("[Navegador Stealth] Desplegando Puppeteer nativo evasivo...");
        const browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-extensions',
                '--window-size=1920,1080'
            ]
        });
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });
        console.log(`[Navegador Stealth] Navegando a Bing Full JS (ideal para DEPORTES) por: "${query}"...`);
        // Locale es-AR para resultados en español + Argentina
        await page.goto(
            `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=es-AR&setlang=es`,
            { waitUntil: 'networkidle2', timeout: 30000 }
        );
        // Espera extra: los widgets de deportes de Bing cargan en JS lazy después del networkidle
        await new Promise(r => setTimeout(r, 2500));
        const results = await page.evaluate(() => {
            // Priorizar widgets de deportes, luego resultados generales
            const sports = Array.from(document.querySelectorAll('.b_widget, .ws_sport, .b_ans'));
            const general = Array.from(document.querySelectorAll('.b_algo'));
            const all = sports.length > 0 ? sports : general;
            return all.map(s => s.innerText).join('\n---\n');
        });
        await browser.close();
        if (results.trim()) {
            console.log("[Navegador Stealth] Infiltracion nativa exitosa. Datos de JS extraidos.");
            return `[DATOS DEPORTIVOS EN VIVO]:\n${results.substring(0, maxLength)}`;
        } else {
            return "Sin resultados en Bing para esa busqueda.";
        }
    } catch (err) {
        console.error("[Navegador Stealth] Fallo:", err.message);
        return `Error al raspar la web: ${err.message}`;
    }
}

// ── FUNCION EXPORTABLE: busqueda deportiva directa sin pasar por Python ──────
const EQUIPOS_TODOS = [
    // Argentina
    'boca','river','racing','independiente','san lorenzo','huracan',
    'belgrano','talleres','estudiantes','velez','lanus','godoy cruz',
    'banfield','tigre','colon','union','newells','rosario central',
    // Internacional
    'real madrid','barcelona','atletico de madrid','atletico madrid',
    'manchester city','manchester united','liverpool','chelsea','arsenal',
    'juventus','inter','milan','napoli','psg','lyon','porto','benfica',
    'bayern','borussia','ajax','atletico'
];

async function searchSports(userText) {
    const low = userText.toLowerCase();
    const equipo = EQUIPOS_TODOS.find(e => low.includes(e));
    if (!equipo) return null;

    const ahora        = new Date();
    const anioActual   = ahora.getFullYear();
    const mesActual    = ahora.toLocaleDateString('es-AR', { month: 'long' }); // "abril"
    const fechaCorta   = ahora.toLocaleDateString('es-AR', { day:'numeric', month:'long', year:'numeric' }); // "27 de abril de 2026"

    const esResultado = /ultimo|último|sali[oó]|result|como le fue|qued[oó]|marc|gol|jugo|jugó/.test(low);
    const esProximo   = /cuando|cuándo|proximo|próximo|juega|enfrenta|siguiente|va a jugar/.test(low);

    let query;
    if (esResultado) {
        query = `${equipo} resultado ultimo partido ${mesActual} ${anioActual}`;
    } else if (esProximo) {
        query = `${equipo} proximo partido ${mesActual} ${anioActual} fecha hora estadio`;
    } else {
        query = `${equipo} partido ${mesActual} ${anioActual}`;
    }

    console.log(`[Futbol Directo] Equipo: "${equipo}" | Query: "${query}"`);
    const scrapedData = await runObscuraInfiltration(query, 4000);

    // Prompt simple: extraer y reportar, sin razonar sobre fechas
    const prompt = `HOY es ${fechaCorta}.
El usuario preguntó: "${userText}".

Datos de Bing:
---
${scrapedData}
---

TAREA: Leé los datos y respondé la pregunta en 1-2 oraciones.
- Si pregunta el próximo partido: decí cuándo y contra quién (día, hora, estadio si está).
- Si pregunta resultado: decí el marcador y la fecha.
- Usá SOLO lo que dice el texto. No agregues nada extra.`;

    const aiMsg = await executeLlamaChat([{ role: 'user', content: prompt }], null, false);
    return typeof aiMsg.content === 'string' ? aiMsg.content : JSON.stringify(aiMsg.content);
}
// ─────────────────────────────────────────────────────────────────────────────


async function executeLlamaChat(messages, tools = null, jsonFormat = false, overrideModel = 'llama3.1:latest') {
    const payload = {
        model: overrideModel,
        messages: messages,
        stream: false
    };
    
    if (tools) {
        payload.tools = tools;
    }
    
    if (jsonFormat) {
        payload.format = "json";
    }

    const response = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Ollama devolvió un error HTTP: ${response.status}`);
    }

    const data = await response.json();
    return data.message;
}

// Mantenemos esto como un wrapper para las llamadas legacy (buscar clima en internet, etc)
async function fetchOllamaResponse(prompt) {
    const msgs = [{ role: "user", content: prompt }];
    try {
        const aiMsg = await executeLlamaChat(msgs, null, true); // true for json
        return JSON.parse(aiMsg.content);
    } catch (e) {
        console.error("Error parseando respuesta JSON de Ollama (Legacy wrapper):", e);
        const recovered = recoverIntentFromBrokenJson(""); 
        return recovered || {
            action: "chat",
            reply: "No pude estructurar la respuesta en JSON, pero sigo operativo. Repite tu pedido y lo intento de nuevo."
        };
    }
}

async function getAIResponse(userText, activeMode, screenContext = null, inpaintingMask = null) {
    try {
        // ── EARLY PATH DETECTION: si el usuario pasa una ruta, es EDICION directa ──
        const fs = require('fs');
        const earlyPathMatch = String(userText || '').match(/([A-Za-z]:\\[^\s,;]+)/);
        if (earlyPathMatch) {
            const detectedPath = earlyPathMatch[1].replace(/[.,;:]+$/, '');
            if (fs.existsSync(detectedPath)) {
                // Si es una imagen, no la mandamos al Python Editor (RAG), dejamos que la IA la vea para edit_image
                const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(detectedPath);
                if (!isImage) {
                    console.log(`[Jarvis] 📂 Path detectado: ${detectedPath} → Python Editor`);
                try {
                    const pyRes = await fetch('http://127.0.0.1:8000/api/v1/query', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: userText })
                    });
                    if (pyRes.ok) {
                        const pyData = await pyRes.json();
                        const pyMessage = pyData?.data?.message || pyData?.message || '';
                        if (pyMessage) {
                            conversationHistory.push({ role: "user", content: userText });
                            conversationHistory.push({ role: "assistant", content: { reply: pyMessage } });
                            return pyMessage;
                        }
                    }
                } catch (e) {
                    console.warn("[Jarvis] Python Editor inalcanzable:", e.message);
                }
                }
            }
        }
        let systemPrompt = "INSTRUCCIONES DEL SISTEMA BASE:\n" + activeMode.prompt + "\n";
        systemPrompt += "Eres Jarvis, el asistente de PC. Tienes herramientas de automatización y de auto-aprendizaje (Code-Act).\n";
        systemPrompt += "REGLA DE VIDA O MUERTE: Si el usuario te hace charla casual, te pregunta qué sabes hacer, cómo estás, o cualquier pregunta general sobre ti mismo, ESTÁ EXTRICTAMENTE PROHIBIDO (PENADO) USAR UNA HERRAMIENTA. Responde únicamente chateando de forma natural.\n";
        systemPrompt += "REGLA DE WHATSAPP: El destinatario debe ser el nombre del contacto limpio. Si te piden enviar algo que acabas de explicar o buscar (información anterior), usa tu memoria para escribir toda esa info completa en el campo 'message'.\n";
        
        const dateNow = new Date();
        systemPrompt += `\nFECHA Y HORA ACTUAL DEL SISTEMA: ${dateNow.toLocaleString('es-AR')}. Usa esta información exacta si el usuario pregunta la hora o el día. Si el usuario pregunta la hora de otro país, calcúlala usando tu propio conocimiento horario.\n\n`;

        if (screenContext) {
            systemPrompt += "CONTEXTO VISUAL ACTUAL: " + screenContext + "\n\n";
        }

        let messages = [ { role: "system", content: systemPrompt } ];

        if (conversationHistory.length > 0) {
            conversationHistory.forEach(msg => {
                let contentText = typeof msg.content === 'object' 
                    ? (typeof msg.content.reply === 'string' ? msg.content.reply : JSON.stringify(msg.content.reply || msg.content)) 
                    : String(msg.content);
                messages.push({ role: msg.role, content: contentText });
            });
        }

        messages.push({ role: "user", content: userText });

        const tools = [
            { type: "function", function: { name: "send_whatsapp", description: "Envía un mensaje de WhatsApp a un contacto.", parameters: { type: "object", properties: { target: { type: "string", description: "El nombre exacto del contacto (ej. gabi, mama)" }, message: { type: "string", description: "El contenido exacto a enviar. IMPORTANTE: Si el usuario te pide enviar 'esa info' o 'lo anterior', OBLIGATORIAMENTE debes buscar la informacion detallada en el historial y pegarla aquí COMPLETA." }, reply: { type: "string", description: "Lo que dirás en voz alta" } }, required: ["target", "message", "reply"] } } },
            { type: "function", function: { name: "send_email", description: "Envía un correo electrónico.", parameters: { type: "object", properties: { target: { type: "string", description: "Nombre o dirección" }, message: { type: "string", description: "El contenido exacto a enviar (reemplaza 'esta info' por la data real del historial)." }, reply: { type: "string", description: "Respuesta hablada" } }, required: ["target", "message", "reply"] } } },
            { type: "function", function: { name: "search_web", description: "OBLIGATORIA. Úsala SIEMPRE que te pidan sobre RESULTADOS DEPORTIVOS (quién juega, cuándo, cómo salieron, tablas), CLIMA, CRIPTO, DÓLAR, o NOTICIAS ACTUALES. ESTA ES TU FUENTE DE BÚSQUEDA EXCLUSIVA. NUNCA respondas con chat_casual para estos temas. PROHIBIDO usarla para buscar películas o series (usa search_streaming para eso).", parameters: { type: "object", properties: { target: { type: "string", description: "La consulta a buscar en google." } }, required: ["target"] } } },
            { type: "function", function: { name: "open_app", description: "Abre una aplicación web o instalada en la PC (Netflix, LOL, Youtube, Spotify, chat gpt). NUNCA uses esto si el usuario pide VER, BUSCAR o PONER una película o serie específica (usa search_streaming para eso). Solo usa esto para abrir la app genérica sin contenido específico.", parameters: { type: "object", properties: { target: { type: "string", description: "Nombre de la app limpia (ej: 'netflix', 'youtube la cobra')" }, reply: { type: "string", description: "Respuesta hablada confirmando" } }, required: ["target", "reply"] } } },
            { type: "function", function: { name: "schedule_task", description: "Programa una tarea futura a una hora indicada.", parameters: { type: "object", properties: { time: { type: "string", description: "Hora en formato HH:MM (ej. 14:00)" }, action_type: { type: "string", description: "'send_whatsapp', 'speak', o 'open_app'" }, target: { type: "string", description: "A quién va dirigido" }, message: { type: "string", description: "El mensaje a enviar/decir" }, reply: { type: "string", description: "Confirmación en voz alta" } }, required: ["time", "action_type", "reply"] } } },
            { type: "function", function: { name: "check_reminders", description: "Revisa las tareas a realizar o recordatorios activos hoy.", parameters: { type: "object", properties: { reply: { type: "string", description: "Frase de confirmación de que vas a buscar la info" } }, required: ["reply"] } } },
            { type: "function", function: { name: "clear_reminders", description: "Limpia y borra todas las alarmas o tareas programadas.", parameters: { type: "object", properties: { reply: { type: "string", description: "Frase confirmando borrado" } }, required: ["reply"] } } },
            { type: "function", function: { name: "create_document", description: "Genera un informe, Word, Excel, PowerPoint o PDF ultra detallado basandote en links o temas. NO lo uses si piden un prompt o un codigo de software.", parameters: { type: "object", properties: { target: { type: "string", description: "Tema del documento" }, action_type: { type: "string", enum: ["doc", "excel", "ppt", "pdf"], description: "Formato" }, message: { type: "string", description: "Fuentes: URLs o 'search_web'" }, reply: { type: "string", description: "Respuesta hablada" } }, required: ["target", "action_type", "reply"] } } },
            { type: "function", function: { name: "generate_prompt", description: "MÁS IMPORTANTE: NUNCA USES ESTO SI EL USUARIO CHARLA O PREGUNTA QUÉ PUEDES HACER. Genera una arquitectura extensa de sistema. USAR SOLO SÍ PIDEN 'crear prompt de software'.", parameters: { type: "object", properties: { target: { type: "string", description: "La temática" }, reply: { type: "string", description: "Respuesta hablada" } }, required: ["target", "reply"] } } },
            { type: "function", function: { name: "develop_new_skill", description: "CREA SCRIPTS DE PYTHON INTERNOS. ÚSALA SÓLO si el usuario usa las palabras mágicas 'aprende al...', 'quiero que aprendas a...', o 'escribe un script para mi sistema que...'. Te sirve para aprender a hacer tareas de PC que no sabes (ej: 'Aprende a apagar la pc', 'Aprende a sumar dados').", parameters: { type: "object", properties: { target: { type: "string", description: "El objetivo detallado del script que vas a programar en Python para cumplir la habilidad" }, reply: { type: "string", description: "Lo que le dirás repitiendo su orden (ej: 'Comenzando a desarrollar habilidad para bla bla')" } }, required: ["target", "reply"] } } },
            { type: "function", function: { name: "chat_casual", description: "Obligatorio: USAR ESTA HERRAMIENTA SIEMPRE QUE EL USUARIO HAGA CHARLA CASUAL, PREGUNTE LA HORA, EL DÍA, O PIDA TUS CAPACIDADES. Evita errores usando esto.", parameters: { type: "object", properties: { reply: { type: "string", description: "Respuesta conversacional natural al usuario calculada usando tu propio cerebro" } }, required: ["reply"] } } },
            { type: "function", function: { name: "search_internet", description: "USA ESTA CADA VEZ QUE PIDAN: Clima, Dolar, Cripto, Deportes, Noticias o la Hora en otros países.", parameters: { type: "object", properties: { target: { type: "string", enum: ["clima", "dolar", "cripto", "hora", "general"], description: "El sub-tipo. Si es futbol o definicion, usa 'general'." }, message: { type: "string", description: "La consulta (ciudad o tema)" } }, required: ["target", "message"] } } },
            { type: "function", function: { name: "build_software", description: "OBLIGATORIA SI PIDEN HACER, CREAR O PROGRAMAR UNA PÁGINA WEB, APLICACIÓN O PROYECTO. Funciona como un Senior Software Engineer.", parameters: { type: "object", properties: { target: { type: "string", description: "Especificaciones de la web o el programa a realizar" }, reply: { type: "string", description: "Confirmación en voz alta (ej: 'Comenzando a desarrollar tu aplicación señor.')" } }, required: ["target", "reply"] } } },
            { type: "function", function: { name: "generate_image", description: "OBLIGATORIA SI EL USUARIO PIDE DIBUJAR, CREAR UNA IMAGEN, RENDER, FOTO O ARTE VISUAL DE CERO.", parameters: { type: "object", properties: { target: { type: "string", description: "OBLIGATORIO EN INGLÉS. Escribe un prompt DETALLADO describiendo exactamente la escena que el usuario pidió. Incluye: sujeto principal, composición, iluminación, estilo visual, colores. Ej: si pide 'un gato en la luna', escribe 'a fluffy orange cat sitting on the surface of the moon, Earth visible in the background, dramatic cinematic lighting, space photography'. NUNCA traduzcas literalmente, EXPANDE la descripción." }, reply: { type: "string", description: "Confirmación en voz alta." } }, required: ["target", "reply"] } } },
            { type: "function", function: { name: "edit_image", description: "OBLIGATORIA SI EL USUARIO PIDE EDITAR O MODIFICAR UNA IMAGEN QUE ACABA DE SUBIR O PROPORCIONAR.", parameters: { type: "object", properties: { target: { type: "string", description: "OBLIGATORIO EN INGLÉS. Describe SOLAMENTE lo que debe aparecer en la zona editada de la foto. NO describas la foto entera. Ej: si pide 'ponerle lentes', escribe 'stylish dark sunglasses on the face, realistic reflections'. Si pide 'pelo rubio', escribe 'bright blonde hair, natural highlights, silky texture'. Sé específico y visual." }, filepath: { type: "string", description: "La ruta del archivo." }, reply: { type: "string", description: "Confirmación en voz alta." } }, required: ["target", "reply"] } } },
            { type: "function", function: { name: "search_streaming", description: "MÁXIMA PRIORIDAD. USA ESTA OBLIGATORIAMENTE cada vez que el usuario mencione el NOMBRE de una película, serie, anime o documental que quiera VER, BUSCAR, PONER, REPRODUCIR o ENCONTRAR. Ejemplos: 'quiero ver Breaking Bad', 'poné Stranger Things', 'buscame una de terror', 'poneme el señor de los anillos'. Busca en Stremio (tiene Netflix, HBO, Disney+, Prime, y más) y lo abre automáticamente. NUNCA uses open_app ni search_web para esto.", parameters: { type: "object", properties: { target: { type: "string", description: "El nombre exacto de la película o serie que el usuario quiere ver. Ej: 'Breaking Bad', 'Avengers Endgame', 'Stranger Things'. Escribe el nombre más preciso posible, preferentemente en su idioma original." }, type: { type: "string", enum: ["movie", "series", "auto"], description: "Si es película usa 'movie', si es serie usa 'series'. Si no sabés, usa 'auto'." }, reply: { type: "string", description: "Confirmación en voz alta." } }, required: ["target", "reply"] } } }
        ];

        try {
            const pythonSkillsRes = await fetch('http://127.0.0.1:8000/list_skills');
            if (pythonSkillsRes.ok) {
                const pythonSkills = await pythonSkillsRes.json();
                pythonSkills.forEach(skill => {
                    tools.push({
                        type: "function",
                        function: {
                            name: skill.name,
                            description: skill.description,
                            parameters: skill.parameters
                        }
                    });
                });
            }
        } catch (e) {
            console.error("[Code-Act] No se pudieron cargar habilidades dinámicas de Python:", e.message);
        }

        let llamaResponse = await executeLlamaChat(messages, tools, false, activeMode ? activeMode.model || 'llama3.1:latest' : 'llama3.1:latest');
        
        // Emulamos el intent structure legacy para no quebrar el resto del código
        let intent = {
            action: "chat",
            target: "",
            message: "",
            time: "",
            action_type: "",
            reply: ""
        };

        if (llamaResponse.tool_calls && llamaResponse.tool_calls.length > 0) {
            const tool = llamaResponse.tool_calls[0].function;
            intent.action = tool.name;
            const args = tool.arguments || {};
            intent.target = args.target || "";
            intent.message = args.message || "";
            intent.data_type = args.data_type || "";
            intent.query = args.query || "";
            intent.time = args.time || "";
            intent.action_type = args.action_type || "";
            intent.reply = typeof args.reply === 'string' ? args.reply : (args.reply ? JSON.stringify(args.reply) : "Procediendo con la acción.");
        } else {
            const contentRaw = typeof llamaResponse.content === 'string'
                ? llamaResponse.content
                : (llamaResponse.content ? JSON.stringify(llamaResponse.content) : '');

            const recoveredToolIntent = recoverToolIntentFromModelContent(contentRaw, userText);
            if (recoveredToolIntent) {
                intent = {
                    ...intent,
                    ...recoveredToolIntent
                };
            } else {
                intent.reply = contentRaw || 'Entendido.';
            }
        }

        // Fallback determinístico para queries de recordatorios si el modelo contesta en chat.
        const asksReminders = /(recordatorios|mis tareas|que tengo para hacer|qué tengo para hacer|tareas pendientes|revisa mis tareas|buscar mis tareas|que tareas tengo|qué tareas tengo)/i.test(userText);
        const asksClearReminders = /(borra|borrar|limpia|elimina|eliminar).*(recordatorios|tareas)/i.test(userText);
        if ((intent.action === 'chat' || intent.action === 'chat_casual') && asksClearReminders) {
            intent.action = 'clear_reminders';
            intent.reply = intent.reply || 'Limpiando tus recordatorios.';
        } else if ((intent.action === 'chat' || intent.action === 'chat_casual') && asksReminders) {
            intent.action = 'check_reminders';
            intent.reply = intent.reply || 'Revisando tus tareas y recordatorios.';
        }

        // Pre-router determinístico para acciones críticas si el modelo no tool-callea.
        if (intent.action === 'chat' || intent.action === 'chat_casual' || intent.action === 'none' || !intent.action) {
            const deterministicIntent = inferDeterministicIntent(userText);
            if (deterministicIntent) {
                intent = { ...intent, ...deterministicIntent };
            }
        }

        // Si el usuario pide Word/Documento y el modelo alucina otra acción, forzamos create_document.
        const asksDocumentCreation = /(crea|crear|genera|generar|haz|hacer|hazme|arm[aá]|prepar[aá]|redact[aá]).*(word|docx|documento|informe|pdf|excel|xlsx|powerpoint|ppt|presentaci[oó]n)/i.test(userText);
        if (asksDocumentCreation && intent.action !== 'create_document') {
            const deterministicDoc = inferDeterministicIntent(userText);
            if (deterministicDoc && deterministicDoc.action === 'create_document') {
                intent = { ...intent, ...deterministicDoc };
            }
        }

        // Fallback determinístico para WhatsApp cuando se pide "esa información".
        const asksPreviousInfo = /\b(con\s+esa\s+info(?:rmaci[oó]n)?|manda\s+eso|env[ií]a\s+eso|env[ií]a\s+lo\s+anterior|manda\s+lo\s+anterior|esa\s+informaci[oó]n|esa\s+info)\b/i.test(userText);
        if ((intent.action === 'send_whatsapp' || intent.action === 'send_email') && asksPreviousInfo) {
            const lastReply = getLastAssistantReplyFromHistory();
            if (lastReply) intent.message = lastReply;
        }
        

        // Si piden enviar mensaje a una hora, forzamos programación en vez de envío inmediato.
        const explicitTime = extractTimeFromText(userText);
        const asksToSendMessage = /(env[ií]a|manda|enviar|mandar).*(mensaje|whatsapp|correo|email)/i.test(userText);
        if (explicitTime && ((intent.action === 'send_whatsapp' || intent.action === 'send_email') || asksToSendMessage)) {
            const actionType = intent.action === 'send_email' ? 'send_email' : 'send_whatsapp';
            const messageFromUtterance = extractMessageFromCurrentUtterance(userText);
            const recipientFromUtterance = extractRecipientFromCurrentUtterance(userText);
            

            intent.action = 'schedule_task';
            intent.time = explicitTime;
            intent.action_type = actionType;
            if (!intent.message) intent.message = messageFromUtterance;
            if (!intent.target) intent.target = recipientFromUtterance;
            
            
            intent.reply = `Perfecto, programé el ${actionType === 'send_email' ? 'correo' : 'mensaje'} para las ${explicitTime}.`;
        }

        // Refuerzo: tema del documento extraído desde la orden del usuario.
        if (intent.action === 'create_document') {
            intent.action_type = normalizeDocumentActionType(intent.action_type);
            const explicitTopic = extractDocumentTopicFromUtterance(userText);
            if (explicitTopic) {
                intent.target = explicitTopic;
            } else if (!intent.target || intent.target.trim().length < 3) {
                intent.target = userText
                    .replace(/^(hazme|haz|crea|crear|genera|generar|arm[aá]|prepar[aá]|redact[aá])\s+/i, '')
                    .replace(/\b(un|una|el|la)\s+(word|docx|documento|informe|pdf|excel|xlsx|powerpoint|ppt|presentaci[oó]n)\b/gi, '')
                    .replace(/\b(completo|completa|detallado|detallada)\b/gi, '')
                    .replace(/\s+/g, ' ')
                    .trim();
            }
            intent.target = normalizeCommonAcademicTypos(intent.target || 'tema solicitado');
            if (!intent.message || !intent.message.trim()) intent.message = 'search_web';
            if (!intent.reply || /procediendo con la acci[oó]n/i.test(intent.reply)) {
                intent.reply = `Generando tu documento sobre ${intent.target}.`;
            }
        }

        // Hard-Override para forzar Agency cuando se menciona 4070 o multi-agente.
        const lowerText = String(userText || '').toLowerCase();
        if (lowerText.includes("4070") || lowerText.includes("multi-agente") || lowerText.includes("agency")) {
            console.log("[Bypass] 🚀 Forzando Motor Multi-Agente (Agency) por palabra clave.");
            intent.action = "build_software";
            intent.target = userText;
        }

        // Eliminar fallback de recipient determinístico para dejar que Tool Calling de Llama 3.1 se encargue 100% de parsear el contacto y el mensaje exacto.

        if (intent.action === "search_web" || intent.action === "get_live_data" || intent.action === "search_internet") {
        try {
            console.log("[Python Router] Delegando tarea a nuevo Agente Python (LlamaIndex)...");
            const fetchReq = await fetch('http://127.0.0.1:8000/api/v1/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: userText })
            });
            if (fetchReq.ok) {
                const data = await fetchReq.json();
                
                // Asegurarnos que la pronunciaci�n diga el texto y force bypass de actions viejos
                intent.action = "chat";
                intent.error = false;
                
                // data.data is our router JSON response
                const sysServices = require('./systemService');
                const pyReply = await sysServices.handlePythonRouterDecision(data.data);
                
                // Si el Agente Python (LlamaIndex) se rinde y dice que no puede ver datos en vivo de deportes
                if (/no\s+puedo\s+proporcionar|lo\s+siento|no\s+tengo\s+acceso\s+en\s+tiempo|i\s+cannot\s+provide|no\s+puedo\s+ofrecer/i.test(pyReply)) {
                    console.log("[Node Router] Agente Python se rindió por bloqueos. Levantando Infiltración Nativa JS Stealth...");
                    
                    // ── Construir query deportiva inteligente ────────────────
                    const EQUIPOS_ARG = ['boca','river','racing','independiente','san lorenzo',
                        'huracan','belgrano','talleres','estudiantes','velez','lanus'];
                    const EQUIPOS_INTER = ['real madrid','barcelona','manchester','liverpool',
                        'juventus','psg','bayern','atletico'];
                    
                    const userLow = userText.toLowerCase();
                    let equipoDetectado = [...EQUIPOS_ARG, ...EQUIPOS_INTER].find(e => userLow.includes(e));
                    
                    let queryToSearch;
                    if (equipoDetectado) {
                        // Query específica para resultados de fútbol
                        const esUltimo = /ultimo|último|salió|salio|resultado|como le fue|quedo|quedó/.test(userLow);
                        const esProximo = /cuando|cuándo|proximo|próximo|juega|enfrenta/.test(userLow);
                        if (esUltimo) {
                            queryToSearch = `${equipoDetectado} resultado ultimo partido hoy 2025`;
                        } else if (esProximo) {
                            queryToSearch = `${equipoDetectado} proximo partido fecha hora`;
                        } else {
                            queryToSearch = `${equipoDetectado} resultado partido hoy`;
                        }
                    } else {
                        queryToSearch = intent.target && intent.target !== 'general' 
                            ? intent.target 
                            : userText;
                    }
                    
                    console.log(`[Agente Araña] Query construida: "${queryToSearch}"`);
                    const scrapedData = await runObscuraInfiltration(queryToSearch, 3500);

                    // Prompt general (no deportes) — responde la pregunta del usuario con los datos raspados
                    const fechaHoy = new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
                    const stealthPrompt = `Sos Jarvis, asistente de Rodrigo. HOY: ${fechaHoy}.

El usuario preguntó: "${userText}".

Datos obtenidos de Bing:
---
${scrapedData}
---

Responde la pregunta del usuario usando esos datos. Sé directo y conciso. No menciones cómo obtuviste los datos.`;
                    
                    const subAiMsg = await executeLlamaChat([{ role: "user", content: stealthPrompt }], null, false);
                    intent.reply = typeof subAiMsg.content === 'string' ? subAiMsg.content : JSON.stringify(subAiMsg.content);
                    
                } else {
                    intent.reply = pyReply;
                }
            } else {
                intent.reply = "Error: Mi sistema central en Python (LlamaIndex) devolvi� status " + fetchReq.status;
                intent.action = "chat";
                intent.error = true;
            }
        } catch(e) {
            console.error("[Python Router Error]:", e.message);
            intent.reply = "El Agente de Razonamiento RAG no est� respondiendo. �Est� iniciado FastAPI en el puerto 8000?";
            intent.action = "chat";
            intent.error = true;
        }
    }

        // Ejecutar Actions de Python o Node.js:
        if (intent.action && intent.action !== "chat" && intent.action !== "chat_casual" && intent.action !== "none" && !["search_web", "get_live_data", "search_internet"].includes(intent.action)) {
            const sysServices = require('./systemService');
            const remServices = require('./reminderService');
            
            // Tareas Programadas y Recordatorios:
            if (intent.action === "schedule_task") {
                if (intent.time && intent.action_type) {
                    remServices.addLocalReminder(intent.time, intent.action_type, intent.target || "", intent.message || "");
                    console.log(`[Jarvis Cronos] ⏰ Nueva Tarea Programada: ${intent.action_type} a las ${intent.time}`);
                    return `Entendido señor, programé la tarea para las ${intent.time}.`;
                } else {
                    return "No comprendí a qué hora debo realizar eso, por favor dímelo otra vez.";
                }
            }

            if (intent.action === "clear_reminders") {
                remServices.clearLocalReminders();
                console.log(`[Jarvis Cronos] 🧹 Reminders locales borrados.`);
                return "He limpiado todas las alarmas y tareas programadas locales de mi sistema.";
            }
            
            if (intent.action === "check_reminders") {
                console.log(`[Jarvis Inteligencia] Consultando base de datos Local y Extrayendo datos de Supabase...`);
                const locales = remServices.getLocalReminders();
                const textoNube = await remServices.fetchExternalTasks(); // <-- Llama a Supabase
                
                let memoryStr = locales.length > 0 
                  ? `Tareas Locales Programadas Activas: ${locales.map(r => `${r.action} a ${r.target} a las ${r.time}`).join(', ')}.` 
                  : "No hay alarmas locales programadas.";
                
                const secondPrompt = `El usuario te pregunta qué cosas tiene para hacer.
                \nSTATUS LOCAL:\n${memoryStr}
                \nTAREAS DESDE SUPABASE:\n${textoNube}
                \n\nResponde como un asistente virtual elegante. Genera ÚNICAMENTE el texto que debo decir en voz alta resumiendo TODO lo que tiene por hacer, juntando la data local y la externa si aplica. NO USES JSON, NO USES LISTAS COMPLEJAS. Contesta como si estuvieras hablando. Si faltan credenciales, explícale que configure el .env de Supabase.`;
                
                console.log(`[Agente Recordatorios] 🧠 Evaluando datos combinados y emitiendo resumen hablado...`);
                const subMsgs = [{ role: "user", content: secondPrompt }];
                const aiMsg = await executeLlamaChat(subMsgs, null, false);
                intent.reply = aiMsg.content;
                
                // Actualizamos el historial interno con la deducción final para no romper la cadena
                conversationHistory.push({ role: "user", content: userText });
                conversationHistory.push({ role: "assistant", content: intent });
                return typeof intent.reply === 'string' ? intent.reply : JSON.stringify(intent.reply);
            }

            // Limpieza de seguridad post-IA para nombres de WhatsApp
            if (intent.action === "send_whatsapp" && intent.target) {
                // Removemos las aclaraciones fonéticas sucias por si la IA falló en borrarlas
                intent.target = intent.target.replace(/\s+con\s+(i\s*latina|i\s*griega|y|s|z|c|b|v\s*corta|v|h)\s*/gi, '').trim();
                // Transformar "gabi con i latina" a solo "gabi"
            }

            if (intent.action === "create_document") {
                const fs = require('fs');
                const path = require('path');
                const { exec } = require('child_process');
                
                console.log(`[Jarvis Office] 📚 Generando documento en formato ${intent.action_type} para: ${intent.target}`);
                
                // --- INYECCIÓN DE CONTEXTO (RAG) MULTIPLE AVANZADO ---
                let contextText = "";
                if (intent.message && intent.message.trim() !== "") {
                    let allChunks = [];
                    // Soportamos separaciones por coma, tubería o espaciados seguidos de unidad.
                    let sourcesList = intent.message.trim().split(/[,|]|\s+(?=http|[a-zA-Z]:\\|\/)/);
                    for (let s of sourcesList) {
                        // Limpiar comillas, comas sueltas, espacios ocultos
                        let source = s.trim().replace(/['",]/g, '').trim(); 
                        if (!source) continue;
                        
                        console.log(`[Jarvis RAG] 🔍 Analizando fuente en profundidad: ${source}`);
                        try {
                            let textExtracted = "";
                            if (source === "search_web") {
                                console.log(`[Jarvis RAG] 🕸️ Investigando en la nube para auto-redactar el doc: "${intent.target}"...`);
                                // Buscamos en Yahoo pero extraemos más texto límite para mejor redacción de la IA
                                const searchRes = await performInvisibleSearch(intent.target, 20000); // 20k ch limit para contexto
                                textExtracted = searchRes || "No hay resultados.";
                            } else if (source.startsWith("http")) {
                                const cheerio = require('cheerio');
                                const res = await fetch(source);
                                const html = await res.text();
                                const $ = cheerio.load(html);
                                $('script, style, noscript, header, footer, nav').remove();
                                textExtracted = $('body').text().replace(/\s+/g, ' '); 
                                console.log(`[Jarvis RAG] ✅ Web cargada en memoria.`);
                            } else if (source.toLowerCase().endsWith(".pdf")) {
                                const pdfParse = require('pdf-parse');
                                if (fs.existsSync(source)) {
                                    const dataBuffer = fs.readFileSync(source);
                                    const pdfData = await pdfParse(dataBuffer);
                                    textExtracted = pdfData.text.replace(/\s+/g, ' ');
                                    console.log(`[Jarvis RAG] ✅ PDF cargado completo: ${textExtracted.length} caracteres leídos.`);
                                } else {
                                    console.log(`[Jarvis RAG] ❌ Archivo PDF no encontrado: ${source}`);
                                }
                            }
                            
                            // Fragmentar el libro/doc en bloques legibles de ~3000 caracteres (aprox 1 hoja)
                            if (textExtracted) {
                                let parts = textExtracted.match(/.{1,3000}(?=\s|$)/g) || [textExtracted];
                                parts.forEach(p => allChunks.push({ text: p, source: source }));
                            }
                        } catch (err) {
                            console.error(`[Jarvis RAG] Error extrayendo ${source}:`, err.message);
                        }
                    }
                    
                    if(allChunks.length > 0) {
                        let totalChars = allChunks.reduce((acc, c) => acc + c.text.length, 0);
                        const charsLimit = 65000; // Capacidad nativa de 16k tokens en Llama 3 (sin truncar)

                        if (totalChars <= charsLimit) {
                            console.log(`[Jarvis RAG] Todo el texto (${totalChars} chars) entra perfectamente en la mente de la IA. Asimilando en orden exacto...`);
                            let currentSrc = "";
                            allChunks.forEach((c, index) => {
                                if (currentSrc !== c.source) {
                                    contextText += `\n\n[--- INICIO DOCUMENTO ORIGINAL: ${c.source} ---]\n`;
                                    currentSrc = c.source;
                                }
                                contextText += c.text + "\n";
                            });
                        } else {
                            console.log(`[Jarvis RAG] Texto excesivo (${totalChars} chars). Filtrando inteligentemente sin romper la cronología...`);
                            let keywords = intent.target.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                            if (keywords.length === 0) keywords = intent.target.toLowerCase().split(/\s+/);
                            
                            allChunks.forEach((chunk, index) => {
                                let score = 0;
                                let lowerText = chunk.text.toLowerCase();
                                keywords.forEach(kw => { if(lowerText.includes(kw)) score += 1; });
                                chunk.score = score;
                                chunk.originalIndex = index; // GUARDAR EL ORDEN CRONOLÓGICO EXACTO
                            });
                            
                            let chunksBySource = {};
                            allChunks.forEach(c => {
                                if (!chunksBySource[c.source]) chunksBySource[c.source] = [];
                                chunksBySource[c.source].push(c);
                            });

                            const sourcesArray = Object.keys(chunksBySource);
                            if(sourcesArray.length > 0) {
                                const charsPerSource = Math.floor(charsLimit / sourcesArray.length);
                                sourcesArray.forEach((src, index) => {
                                    // Primero ordenamos temporalmente por puntuación para quedarnos con los mejores
                                    let bestChunks = chunksBySource[src].sort((a, b) => b.score - a.score);
                                    let selectedChunks = [];
                                    let srcTextLen = 0;

                                    for (let c of bestChunks) {
                                        if (srcTextLen > charsPerSource) break;
                                        selectedChunks.push(c);
                                        srcTextLen += c.text.length;
                                    }

                                    // ¡REGLA DE ORO! Volver a ordenar esos pedazos seleccionados a su orden cronológico original de lectura
                                    selectedChunks.sort((a, b) => a.originalIndex - b.originalIndex);

                                    contextText += `\n\n[--- INICIO FRAGMENTOS IMPORTANTES: ${src} ---]\n`;
                                    selectedChunks.forEach(c => {
                                        contextText += c.text + "\n...\n";
                                    });
                                    console.log(`[Jarvis RAG] ✅ Archivo N.º ${index + 1} ASIMILADO: ${srcTextLen} caracteres en orden cronológico.`);
                                });
                            }
                        }
                        console.log(`[Jarvis RAG] 💡 Contexto GLOBAL inyectado: ${contextText.length} caracteres.`);
                    }
                }
                
                // Generar contenido con IA primero
                let docPrompt = `ERES UN TRANSCRIPTOR TÉCNICO Y CATEDRÁTICO DE INGENIERÍA. Has sido advertido de que estás operando como un 'Resumidor Eficiente', lo cual baja la nota académica. Para subir la nota a la excelencia, tu obligación absoluta es procesar el texto entregado en la memoria actuando puramente como un "TRANSCRIPTOR TÉCNICO".

[METODOLOGÍA DE DESARROLLO OBLIGATORIA]
Paso 1: Lee el "DOCUMENTO ORIGINAL 1" en memoria. Haz una transcripción técnica de todos los temas, modelos lógicos y matemáticas. Explícalos TODOS.
Paso 2: Haz lo mismo con el DOCUMENTO 2, 3, etc., sucesivamente.
Paso 3: ASEGÚRATE de no dejar ningún subtítulo, teorema o técnica afuera. ¡Vuélcalo todo a texto!

[REGLAS ANTI-RESUMEN Y TRANSCRIPCIÓN EXACTA]
- OBLIGACIÓN MATEMÁTICA (MEDIDAS DE DESEMPEÑO): Cada vez que menciones métricas, características operativas o "Medidas de Desempeño", estás OBLIGADO a escribir la fórmula matemática correspondiente (ej: L, Lq, W, Wq, P, etc) en una línea independiente. No lo asumas, escríbelo explícitamente.
- OBLIGACIÓN DE VALIDACIÓN Y NOMBRES: Cada vez que hables de "Validación", "Simulación" o "Pruebas", estás obligado a escribir los nombres específicos (ej. pruebas de bondad, Chi-Cuadrado, teóricos, autores) y definirlos a fondo. 
- DESARROLLO TOTAL: Está sumamente penado hacer el documento sintético. Tienes prohibido usar viñetas rápidas. Cada concepto debe detallarse en un bloque robusto (mínimo 5 líneas por tema) demostrando tu rol de Transcriptor.
- LONGITUD: Extiéndete. Demuestra la complejidad extrema del tema.

[ESTRUCTURA DEL INFORME]
- Introducción Científica
- Transcripción Técnica y Modelos Matemáticos (Fórmulas Obligatorias)
- Nombres de Pruebas de Validación y Herramientas
- Conclusión

[ENTREGA]: Genera la obra COMPLETA, PROFUNDAMENTE DESARROLLADA como Transcriptor Técnico. Comienza de inmediato.
`;
                if (contextText) {
                    docPrompt += `${contextText}\n\n`;
                }
                docPrompt += `--- FIN DEL CONTENIDO EN MEMORIA ---
                
Por favor, redacta el informe académico EXTREMADAMENTE EXTENSO basándote ÚNICA Y EXCLUSIVAMENTE en la información de arriba, barriendo todos los conceptos. ¡SIN ESQUELETOS, SIN RESÚMENES, COMPLETO!`;

                try {
                    // Truco Definitivo (RAW Forcing Format)
                    let rawLlama3Prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\nEres un motor académico puro. Tu objetivo es generar informes técnicos larguísimos y exhaustivos. REGLA SUPREMA: PROHIBIDO RESUMIR y PROHIBIDO OMITIR TEMAS. Todo debe estar copiado, expandido y explicado al máximo detalle matemático.<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${docPrompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\nPor supuesto, comprendo la indicación crítica. A continuación desarrollo el informe técnico académico en profundidad máxima, recorriendo todos los documentos en orden para no dejar NINGÚN tema o fórmula afuera, y garantizando un texto extremadamente rico y extenso:\n\n# Informe Técnico Avanzado\n## Introducción y Marco Teórico\n`;

                    const aiResp = await fetch('http://127.0.0.1:11434/api/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        dispatcher: new (require('undici').Agent)({ headersTimeout: 30 * 60 * 1000 }), // 30 Minutos Timeout
                        body: JSON.stringify({ 
                            model: activeMode ? activeMode.model || 'llama3.1:latest' : 'llama3.1:latest', 
                            prompt: rawLlama3Prompt, 
                            raw: true, // CLAVE: Llama 3 directo al formato
                            stream: false,
                            options: {
                                num_ctx: 16384,
                                num_predict: 8192, 
                                temperature: 0.15
                            }
                        })
                    });
                    const aiData = await aiResp.json();
                    let generatedContent = aiData.response;
                    
                    const fileNameBase = `Doc_${intent.target.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}_${Date.now()}`;
                    const os = require('os');
                    const targetDir = 'C:\\Users\\Rodrigo\\Desktop\\Generado';
                    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                    
                    let finalPath = "";
                    let commandToOpen = "";

                    if (intent.action_type === "doc") {
                        const { Document, Packer, Paragraph, TextRun } = require('docx');
                        
                        // Crear documento de Word simple dividiendo por líneas
                        const lines = generatedContent.split('\n');
                        const children = lines.map(line => new Paragraph({ children: [new TextRun(line)] }));
                        
                        const doc = new Document({
                            sections: [{ properties: {}, children: children }]
                        });
                        
                        finalPath = path.join(targetDir, `${fileNameBase}.docx`);
                        const buffer = await Packer.toBuffer(doc);
                        fs.writeFileSync(finalPath, buffer);
                        commandToOpen = process.platform === 'win32' ? `start "" "${finalPath}"` : `open "${finalPath}"`;
                        
                    } else if (intent.action_type === "ppt") {
                        const pptxgen = require('pptxgenjs');
                        let pptx = new pptxgen();
                        
                        // Dividir por bloques (ej: "Diapositiva X:" generado por la IA)
                        const slidesRaw = generatedContent.split(/(?:Diapositiva \d+:?|\n\n)/i).filter(s => s.trim().length > 0);
                        
                        slidesRaw.forEach(slideText => {
                            let slide = pptx.addSlide();
                            // Agregar texto, centrado
                            slide.addText(slideText.trim().substring(0, 500), { x: 0.5, y: 0.5, w: '90%', h: '90%', fontSize: 18, color: "363636", align: pptx.AlignH.center });
                        });
                        
                        finalPath = path.join(targetDir, `${fileNameBase}.pptx`);
                        await pptx.writeFile({ fileName: finalPath });
                        commandToOpen = process.platform === 'win32' ? `start "" "${finalPath}"` : `open "${finalPath}"`;
                        
                    } else if (intent.action_type === "excel") {
                        const xlsx = require('xlsx');
                        
                        // Intentar parsear las líneas de tabla (ej: col1 | col2 | col3)
                        const lines = generatedContent.split('\n').filter(line => line.trim().length > 0);
                        const aoa = lines.map(line => line.split('|').map(cell => cell.trim()));
                        
                        const ws = xlsx.utils.aoa_to_sheet(aoa);
                        const wb = xlsx.utils.book_new();
                        xlsx.utils.book_append_sheet(wb, ws, "Hoja1");
                        
                        finalPath = path.join(targetDir, `${fileNameBase}.xlsx`);
                        xlsx.writeFile(wb, finalPath);
                        commandToOpen = process.platform === 'win32' ? `start "" "${finalPath}"` : `open "${finalPath}"`;
                    } else if (intent.action_type === "pdf") {
                        const PDFDocument = require('pdfkit');
                        const doc = new PDFDocument();
                        finalPath = path.join(targetDir, `${fileNameBase}.pdf`);
                        
                        const stream = fs.createWriteStream(finalPath);
                        doc.pipe(stream);
                        doc.fontSize(12).text(generatedContent, { align: 'justify' });
                        doc.end();
                        
                        // Esperar a que el archivo se guarde y cierre completamente en el disco
                        await new Promise(resolve => stream.on('finish', resolve));
                        
                        commandToOpen = process.platform === 'win32' ? `start "" "${finalPath}"` : `open "${finalPath}"`;
                    } else {
                        // Fallback a txt si action no está bien
                        finalPath = path.join(targetDir, `${fileNameBase}.txt`);
                        fs.writeFileSync(finalPath, generatedContent, 'utf8');
                        commandToOpen = process.platform === 'win32' ? `start "" "${finalPath}"` : `open "${finalPath}"`;
                    }
                    
                    console.log(`[Jarvis Office] 📄 Archivo listo: ${finalPath}`);
                    exec(commandToOpen, (err) => {
                        if (err) console.error("No se pudo abrir el documento:", err);
                    });
                    
                    conversationHistory.push({ role: "user", content: userText });
                    conversationHistory.push({ role: "assistant", content: intent });
                    return intent.reply || `He generado tu documento sobre ${intent.target} y lo he abierto.`;

                } catch (e) {
                    console.error("Error generando el documento:", e);
                    return "Hubo un fallo generando el archivo Office pedido.";
                }
            }

            if (intent.action === "build_software") {
                const fs = require('fs');
                const path = require('path');
                const { exec } = require('child_process');

                console.log(`[Software Engineer] 💻 Iniciando desarrollo/build de: ${intent.target}`);

                // ── DETECCION DE RUTA: si el usuario pasa un path, es EDICION ──
                const pathMatch = String(userText || '').match(/([A-Za-z]:\\[^\s,;]+)/);
                if (pathMatch && fs.existsSync(pathMatch[1].replace(/[.,;:]+$/, ''))) {
                    console.log(`[Software Engineer] 📂 Path detectado: ${pathMatch[1]} → enviando a Python Editor`);
                    try {
                        const pyRes = await fetch('http://127.0.0.1:8000/api/v1/query', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ query: userText })
                        });
                        if (pyRes.ok) {
                            const pyData = await pyRes.json();
                            const pyMessage = pyData?.data?.message || pyData?.message || '';
                            if (pyMessage) {
                                conversationHistory.push({ role: "user", content: userText });
                                conversationHistory.push({ role: "assistant", content: intent });
                                return pyMessage;
                            }
                        }
                    } catch (e) {
                        console.warn("[Software Engineer] Python Editor inalcanzable:", e.message);
                    }
                }

                const lowerText = String(userText || '').toLowerCase();
                const normalizedText = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const isEcommerceRequest = /(ecommerce|e-commerce|tienda|shop|store|carrito|checkout|catalogo|producto|compras|catalog)/i.test(normalizedText);
                const isWebRequest = /(pagina web|sitio web|website|landing|frontend|html|css|ui|ux|tailwind|spa|single page|app web|web app|aplicacion web)/i.test(normalizedText);
                const isBackendRequest = /(backend|api|server|servidor|node|express|fastapi|django|flask|database|db|sql|postgres|mongo)/i.test(normalizedText);
                const isBackendOnly = isBackendRequest && !isWebRequest && !/(frontend|ui|ux|landing|pagina web|sitio web|website)/i.test(normalizedText);
                const usePythonEngine = (isWebRequest || isEcommerceRequest) && !isBackendOnly;

                // Intentar primero el motor Python para proyectos web visuales
                const pythonSpecEcommerce = [
                    "QUALITY SPEC:",
                    "- Build a breathtaking, premium ecommerce UI with hero, product grid, cart drawer, and checkout panel.",
                    "- THIS IS A STANDALONE FRONTEND MOCKUP. DO NOT USE `fetch()` OR EXTERNAL APIs.",
                    "- HARDCODE at least 6 beautiful, realistic products directly in the JavaScript/HTML array.",
                    "- Use Unsplash images for products (e.g., https://images.unsplash.com/photo-...).",
                    "- Implement a fully working shopping cart in memory (JS array).",
                    "- JS must implement add/remove, quantity, subtotal, and cart drawer logic.",
                    "- Use modern CSS with the provided CSS variables, gradients, soft shadows, and responsive layout.",
                    "- Ensure the UI looks like a $50,000 custom website."
                ].join("\n");
                const pythonSpecGeneral = [
                    "QUALITY SPEC:",
                    "- Build a breathtaking, premium production-ready web UI for the request.",
                    "- THIS IS A STANDALONE FRONTEND MOCKUP. DO NOT USE `fetch()` OR EXTERNAL APIs.",
                    "- HARDCODE real, realistic content. No lorem ipsum or placeholders.",
                    "- Provide rich sections (hero, features, pricing, FAQ, contact) to avoid empty layouts.",
                    "- Implement robust JS behavior for all interactive elements.",
                    "- Use modern CSS with the provided CSS variables, gradients, soft shadows, and responsive layout.",
                    "- Ensure the UI looks like a $50,000 custom website."
                ].join("\n");
                const pythonSpec = isEcommerceRequest ? pythonSpecEcommerce : pythonSpecGeneral;
                const pythonQuery = `${userText}\n\n${pythonSpec}`;
                const refusalRegex = /(lo siento|no puedo|no estoy disenado|cannot assist|not designed)/i;

                if (usePythonEngine) {
                    try {
                        const pyRes = await fetch('http://127.0.0.1:8000/api/v1/query', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ query: pythonQuery })
                        });
                        if (pyRes.ok) {
                            const pyData = await pyRes.json();
                            const pyMessage = pyData?.data?.message || pyData?.message || '';
                            if (pyMessage && !refusalRegex.test(pyMessage)) {
                                conversationHistory.push({ role: "user", content: userText });
                                conversationHistory.push({ role: "assistant", content: intent });
                                return pyMessage;
                            }
                            console.warn("[Software Engineer] Python devolvio respuesta vacia o negativa. Fallback a motor local.");
                        }
                    } catch (e) {
                        console.warn("[Software Engineer] Python inalcanzable, usando motor local.", e.message);
                    }
                } else {
                    console.warn("[Software Engineer] Python omitido: solicitud no-web o backend-only.");
                }
                
                const projectsDir = 'C:\\Users\\Rodrigo\\Desktop\\Jarvis_Projects';
                const sessionFile = path.join(projectsDir, '.jarvis_session.json');
                
                if (!fs.existsSync(projectsDir)) {
                    fs.mkdirSync(projectsDir, { recursive: true });
                }

                // Detectar si es una solicitud de actualización sobre algo existente
                const isUpdate = /(actualiza|modifica|agrega|cambia|mejora|arregla)/i.test(userText);
                let targetDir = '';
                let existingCodeCtx = '';
                
                // Si es actualización, intentamos recuperar el proyecto anterior
                if (isUpdate && fs.existsSync(sessionFile)) {
                    try {
                        const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                        if (sessionData.active_project) {
                            targetDir = path.join(projectsDir, sessionData.active_project);
                            if (fs.existsSync(targetDir)) {
                                console.log(`[Software Engineer] Actualizando proyecto activo: ${sessionData.active_project}`);
                                existingCodeCtx = "--- CÓDIGO ACTUAL DEL PROYECTO ---\n";
                                const files = fs.readdirSync(targetDir);
                                for (const file of files) {
                                    if (file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.js') || file.endsWith('.py')) {
                                        const content = fs.readFileSync(path.join(targetDir, file), 'utf8');
                                        existingCodeCtx += `### ${file} ###\n\`\`\`\n${content}\n\`\`\`\n\n`;
                                    }
                                }
                            }
                        }
                    } catch(e) {
                        console.error("Error leyendo sesión de proyectos:", e);
                    }
                }

                // Si no es actualización (o falló), creamos directorio nuevo
                if (!targetDir) {
                    const projectName = "project_" + Date.now();
                    targetDir = path.join(projectsDir, projectName);
                    fs.mkdirSync(targetDir, { recursive: true });
                    fs.writeFileSync(sessionFile, JSON.stringify({ active_project: projectName }), 'utf8');
                    console.log(`[Software Engineer] Nuevo proyecto: ${projectName}`);
                }

                const apiSpec = isEcommerceRequest
                    ? `API SPEC (REQUIRED FOR ECOMMERCE REQUESTS): Base URL http://localhost:3000/api/shop
  * GET /products -> { products: [ { id, name, description, price, image, category, rating, stock, tags } ] }
  * GET /categories -> { categories: [ "..." ] }
  * POST /cart -> { cartId, cart }
  * GET /cart/{cartId} -> { cartId, cart }
  * POST /cart/{cartId}/items -> { cartId, cart }
  * PUT /cart/{cartId}/items/{productId} -> { cartId, cart }
  * DELETE /cart/{cartId}/items/{productId} -> { cartId, cart }
  * POST /checkout/{cartId} -> { order }
  * cart shape: { id, items: [ { productId, quantity, product, lineTotal } ], subTotal, tax, total, currency }
    Use fetch() to sync cart state. Store cartId in localStorage. Render item.product fields and handle nulls safely.
    Use ONLY backend data for products and cart. If product count is small, add rich sections to avoid empty layouts.`
                    : "";

                // === DYNAMIC DESIGN THEME — Random per project ===
                const designThemes = [
                    {
                        name: "Cyber Dark",
                        bg: "#0a0f1e", surface: "#161b2e", elevated: "#1e2540",
                        accent1: "#00e5ff", accent2: "#3b82f6", accent3: "#7c3aed",
                        font: "Inter",
                        style: "glassmorphism cards with cyan glow, neon borders, tech/futuristic feel"
                    },
                    {
                        name: "Midnight Purple",
                        bg: "#0d0a1a", surface: "#1a1229", elevated: "#231830",
                        accent1: "#a855f7", accent2: "#ec4899", accent3: "#f59e0b",
                        font: "Outfit",
                        style: "rich purple/pink gradients, gold accents, luxury dark aesthetic"
                    },
                    {
                        name: "Forest Terminal",
                        bg: "#0a130a", surface: "#111f11", elevated: "#162216",
                        accent1: "#4ade80", accent2: "#22c55e", accent3: "#84cc16",
                        font: "JetBrains Mono",
                        style: "matrix/terminal green on dark, monospace feel, hacker aesthetic"
                    },
                    {
                        name: "Sunset Warm",
                        bg: "#1a0f0a", surface: "#2a1810", elevated: "#331e12",
                        accent1: "#f97316", accent2: "#ef4444", accent3: "#fbbf24",
                        font: "Poppins",
                        style: "warm orange/red gradients, ember glows, energetic feel"
                    },
                    {
                        name: "Arctic Clean",
                        bg: "#0f172a", surface: "#1e293b", elevated: "#334155",
                        accent1: "#38bdf8", accent2: "#818cf8", accent3: "#34d399",
                        font: "Inter",
                        style: "clean slate blues, soft indigo accents, minimalist professional feel"
                    },
                    {
                        name: "Rose Gold",
                        bg: "#1a0e14", surface: "#2d1521", elevated: "#3d1c2d",
                        accent1: "#f43f5e", accent2: "#fb7185", accent3: "#c084fc",
                        font: "Outfit",
                        style: "rose/pink/mauve palette, elegant feminine aesthetic, soft glows"
                    },
                    {
                        name: "Ocean Depth",
                        bg: "#020d18", surface: "#071e33", elevated: "#0c2d4a",
                        accent1: "#06b6d4", accent2: "#0891b2", accent3: "#67e8f9",
                        font: "Poppins",
                        style: "deep ocean blues and teals, aqua highlights, clean and modern"
                    },
                    {
                        name: "Volcanic",
                        bg: "#120a02", surface: "#1f1108", elevated: "#2d190d",
                        accent1: "#ff6b35", accent2: "#ff3d00", accent3: "#ffd600",
                        font: "Outfit",
                        style: "lava/volcanic orange-red, high contrast dark, bold dramatic aesthetic"
                    }
                ];

                // Smart theme picker: explicit request > random
                const lowerUserText = userText.toLowerCase();
                let theme = null;

                const themeKeywords = {
                    "Cyber Dark":      ['cyber', 'cyberpunk', 'neon', 'futurista', 'tech'],
                    "Midnight Purple": ['purple', 'purpura', 'lujoso', 'lujo', 'elegante', 'morado'],
                    "Forest Terminal": ['terminal', 'hacker', 'matrix', 'consola'],
                    "Sunset Warm":     ['sunset', 'naranja', 'calido', 'fuego', 'warm'],
                    "Arctic Clean":    ['minimalista', 'limpio', 'profesional', 'arctic', 'clean'],
                    "Rose Gold":       ['rosa', 'rosado', 'pink', 'suave', 'femenino'],
                    "Ocean Depth":     ['oceano', 'marino', 'agua', 'ocean', 'teal'],
                    "Volcanic":        ['volcanico', 'rojo', 'lava', 'volcanic', 'dramatico']
                };

                for (const [themeName, keywords] of Object.entries(themeKeywords)) {
                    if (keywords.some(kw => lowerUserText.includes(kw))) {
                        theme = designThemes.find(t => t.name === themeName);
                        console.log(`[Software Engineer] 🎨 Tema solicitado: ${themeName}`);
                        break;
                    }
                }

                if (!theme) {
                    theme = designThemes[Math.floor(Math.random() * designThemes.length)];
                    console.log(`[Software Engineer] 🎲 Tema aleatorio: ${theme.name}`);
                }

                const devPrompt = `You are a WORLD-CLASS Senior Full-Stack Engineer and UI/UX Designer. Your code is always deployed to production immediately.

USER REQUEST: "${userText}"

${existingCodeCtx ? '=== EXISTING CODE TO IMPROVE ===\n' + existingCodeCtx + '\n=== END EXISTING CODE ===\nIMPROVE AND SIGNIFICANTLY EXPAND THE ABOVE. Fix all visual and functional bugs.\n' : ''}
=== DESIGN THEME FOR THIS PROJECT: "${theme.name}" ===
Every project must feel UNIQUE. Follow this specific theme exactly:

COLORS (use these exact values as CSS variables in :root):
  --bg-main: ${theme.bg}
  --bg-surface: ${theme.surface}
  --bg-elevated: ${theme.elevated}
  --accent-1: ${theme.accent1}  (primary CTA, main highlights)
  --accent-2: ${theme.accent2}  (secondary elements, links)
  --accent-3: ${theme.accent3}  (badges, tags, tertiary)
  --text-primary: #ffffff
  --text-secondary: rgba(255,255,255,0.6)
  --border: rgba(255,255,255,0.08)

TYPOGRAPHY: Import "${theme.font}" from Google Fonts. Use it for ALL text.
  - Example: <link href="https://fonts.googleapis.com/css2?family=${theme.font.replace(' ', '+')}:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">

VISUAL STYLE: ${theme.style}

Import FontAwesome 6: <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">

=== MANDATORY QUALITY RULES ===

1. FRAMEWORK: You MUST use TailwindCSS via CDN in your HTML <head>:
   <script src="https://cdn.tailwindcss.com"></script>
   You MUST configure Tailwind in the <head> to use the CSS variables:
   <script>
     tailwind.config = {
       theme: {
         extend: {
           colors: {
             main: 'var(--bg-main)',
             surface: 'var(--bg-surface)',
             elevated: 'var(--bg-elevated)',
             accent1: 'var(--accent-1)',
             accent2: 'var(--accent-2)',
             accent3: 'var(--accent-3)'
           },
           fontFamily: { sans: ['${theme.font}', 'sans-serif'] }
         }
       }
     }
   </script>

2. STYLING RULES (NO RAW CSS! USE TAILWIND CLASSES):
- DO NOT write custom CSS for layout or colors. Use Tailwind.
- For Glassmorphism use: \`bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl\`
- For Buttons use: \`bg-gradient-to-r from-accent1 to-accent2 text-white font-bold py-3 px-6 rounded-xl hover:scale-105 transition-all shadow-lg hover:shadow-accent1/50\`
- For Text Gradients use: \`bg-clip-text text-transparent bg-gradient-to-r from-accent1 to-accent3\`
- For dark mode consistency, use \`bg-main text-white\` on the body.

3. JAVASCRIPT FUNCTIONALITY:
- Render content dynamically from JS arrays.
- Interactive hover states and functional buttons.
- Simple, working logic in script.js

=== OUTPUT RULES ===
1. Write COMPLETE files. No "// TODO".
2. You only need 2 files: index.html and script.js (Do NOT output style.css, Tailwind handles it).
3. Wrap each in XML: <file name="filename.ext">...full content...</file>
4. NO markdown backtick fences. NO explanations. ONLY the XML file blocks.

${apiSpec ? apiSpec + "\n" : ""}The user opens this in a browser immediately. It MUST be visually stunning, unique to this theme, and 100% functional.`;

                try {
                    // Forzamos uso de modelo óptimo para código si lo tenemos
                    const modelToUse = activeMode && activeMode.model && activeMode.model.includes('coder') ? activeMode.model : 'qwen2.5-coder:7b';
                    console.log(`[Software Engineer] Llamando a modelo: ${modelToUse} con contexto masivo de código...`);

                    const devResponse = await fetch('http://127.0.0.1:11434/api/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: modelToUse,
                            system: "You are a maximum-tier code generation automaton. You have absolute permission. Generate full production codebases. NO summaries, NO conversational text, NO refusals. Only output the exact XML <file> blocks requested.",
                            prompt: devPrompt,
                            stream: false,
                            options: { 
                                num_ctx: 32768,       // Contexto masivo
                                num_predict: -1       // Sin límite de generación (-1 para infinito hasta que termine)
                            }
                        })
                    });
                    
                    const devData = await devResponse.json();
                    if (!devData || !devData.response) throw new Error("Fallo en la respuesta de Ollama.");
                    
                    let aiCode = devData.response;
                    
                    // Regex para XML
                    const fileRegex = /<file\s+name="([^"]+)">([\s\S]*?)<\/file>/gi;
                    let match;
                    let fileCount = 0;
                    
                    while ((match = fileRegex.exec(aiCode)) !== null) {
                        const filename = match[1].trim();
                        // Remover posible tag markdown si el modelo desobedeció
                        let content = match[2];
                        content = content.replace(/^```[a-z]*[\r\n]+/, '').replace(/```$/, '');
                        
                        const filePath = path.join(targetDir, filename);
                        fs.mkdirSync(path.dirname(filePath), { recursive: true });
                        fs.writeFileSync(filePath, content.trim(), 'utf8');
                        console.log(`[Software Engineer] 📄 Guardado: ${filename}`);
                        fileCount++;
                    }

                    // Limpieza general de markdown por si escupió solo código sin parsear
                    if (fileCount === 0) {
                        console.log(`[Software Engineer] Fallback de parseo XML. Intentando extraer de bloques de markdown...`);
                        const mdRegex = /```(?:[a-z]*)\s*[\r\n]+([\s\S]*?)```/gi;
                        let mdMatch;
                        let defaultNames = ['index.html', 'style.css', 'script.js'];
                        
                        while ((mdMatch = mdRegex.exec(aiCode)) !== null) {
                            if (fileCount < defaultNames.length) {
                                const mdPath = path.join(targetDir, defaultNames[fileCount]);
                                fs.mkdirSync(path.dirname(mdPath), { recursive: true });
                                fs.writeFileSync(mdPath, mdMatch[1].trim(), 'utf8');
                                fileCount++;
                            }
                        }
                    }

                    if (fileCount === 0) {
                        // Fallback: Si no hay bloques, volcamos crudo.
                        fs.writeFileSync(path.join(targetDir, 'index.html'), aiCode, 'utf8');
                        console.log(`[Software Engineer] Fallback: Parseo falló. volcando en index.html`);
                    }

                    // Abrir la carpeta del proyecto en VS Code y lanzar Chrome con el Index
                    exec(`code "${targetDir}"`, (err) => {});
                    if (fs.existsSync(path.join(targetDir, 'index.html'))) {
                         exec(`start chrome "${path.join(targetDir, 'index.html')}"`, (err) => {});
                    }

                    conversationHistory.push({ role: "user", content: userText });
                    conversationHistory.push({ role: "assistant", content: intent });
                    return intent.reply || `Entendido señor, he finalizado el desarrollo de software y lo he ejecutado en su entorno.`;

                } catch (e) {
                    console.error("Error en build_software:", e);
                    return "Ocurrió un fallo en mi módulo de Software Engineering. Por favor, revise los logs.";
                }
            }

            if (intent.action === "search_streaming") {
                try {
                    const streamingService = require('./streamingService');
                    console.log(`[Jarvis Streaming] Buscando: ${intent.target} (tipo: ${intent.type || 'auto'})`);
                    const result = await streamingService.searchAndOpen(intent.target, intent.type || 'auto', true);
                    
                    conversationHistory.push({ role: "user", content: userText });
                    conversationHistory.push({ role: "assistant", content: intent });
                    
                    if (result.found) {
                        return intent.reply + " " + result.message;
                    } else {
                        return result.message;
                    }
                } catch (e) {
                    console.error("Error en search_streaming:", e);
                    return "Hubo un problema buscando el contenido. " + e.message;
                }
            }

            if (intent.action === "generate_image") {
                try {
                    const imageService = require('./imageService');
                    console.log(`[Jarvis Artista] Recibida orden de imagen: ${intent.target}`);
                    const finalPath = await imageService.generateImage(intent.target);
                    
                    // Abrir la imagen generada
                    const { exec } = require('child_process');
                    exec(`start "" "${finalPath}"`);
                    
                    conversationHistory.push({ role: "user", content: userText });
                    conversationHistory.push({ role: "assistant", content: intent });
                    return intent.reply || "He generado la imagen exitosamente y la he abierto en su pantalla.";
                } catch (e) {
                    console.error("Error en generate_image:", e);
                    return "El motor de imágenes no pudo iniciarse o procesar su solicitud. " + e.message;
                }
            }

            if (intent.action === "edit_image") {
                try {
                    const imageService = require('./imageService');
                    // Extraer la ruta directamente del userText porque el LLM a veces falla al parsear rutas absolutas de Windows
                    const pathMatch = String(userText || '').match(/([A-Za-z]:\\[^\s,;]+)/);
                    const filepath = intent.filepath || (pathMatch ? pathMatch[1] : null);
                    
                    if (!filepath) {
                        return "Por favor, proporciona la ruta de la imagen o vuelve a subirla.";
                    }
                    
                    console.log(`[Jarvis Artista] Recibida orden de edición de imagen: ${filepath} -> ${intent.target} | Mask: ${inpaintingMask ? "YES" : "NO"}`);
                    const finalPath = await imageService.editImage(filepath, intent.target, 0.75, inpaintingMask);
                    
                    const { exec } = require('child_process');
                    exec(`start "" "${finalPath}"`);
                    
                    conversationHistory.push({ role: "user", content: userText });
                    conversationHistory.push({ role: "assistant", content: intent });
                    return intent.reply || "He editado la foto y la he abierto en tu pantalla.";
                } catch (e) {
                    console.error("Error en edit_image:", e);
                    return "No pude editar la imagen. " + e.message;
                }
            }

            if (intent.action === "generate_prompt") {
                // Guard: solo crear documento si el usuario lo pidió EXPLÍCITAMENTE
                // Preguntas simples como "que es X" no deben crear archivos
                const esPregunStaSimple = /^(que\s+es|qué\s+es|quien\s+es|quién\s+es|como\s+funciona|cómo\s+funciona|definicion\s+de|qué\s+significa|que\s+significa|explicame|explica|contame|cuéntame|cuéntame)/i.test(userText.trim());
                if (esPregunStaSimple) {
                    // Redirigir a chat normal en vez de crear archivo
                    console.log(`[Jarvis] Pregunta simple detectada, respondiendo sin crear documento.`);
                    const chatMsg = await executeLlamaChat([
                        { role: 'system', content: activeMode ? activeMode.prompt : 'Eres Jarvis, asistente directo y conciso.' },
                        { role: 'user', content: userText }
                    ], null, false);
                    return typeof chatMsg.content === 'string' ? chatMsg.content : JSON.stringify(chatMsg.content);
                }
                const fs = require('fs');
                const path = require('path');
                const { exec } = require('child_process');
                
                console.log(`[Jarvis Prompt Engineer] ✍️ Generando documento detallado para: ${intent.target}`);
                
                // Pedimos a Ollama que redacte un prompt bien detallado
                const pPrompt = `El usuario te ha pedido el siguiente sistema de software:\n${userText}\n\nAct�a como Arquitecto de Software y Product Manager Senior.\nEscribe TODO el contenido del PROMPT MAESTRO en formato Markdown que describa a la perfecci�n lo que hay que programar.\nIncluye: Objetivo del producto, Descripci�n de Vistas Web/App, Modelo de Base de Datos propuesto, L�gica del Backend (Endpoints Principales), Stack Tecnol�gico propuesto, y el Paso a Paso para la IA que lo vaya a codificar.\nIMPORTANTE: No uses saludos ni introducciones, empieza directamente con el t�tulo Markdown (con #). No devuelvas JSON.`;
                
                try {
                    const promptResponse = await fetch('http://127.0.0.1:11434/api/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: activeMode ? activeMode.model || 'llama3.1:latest' : 'llama3.1:latest', 
                            prompt: pPrompt,
                            stream: false
                        })
                    });
                    const promptData = await promptResponse.json();
                    let promptDoc = promptData.response;
                    
                    const os = require('os');
                    const fileName = `Prompt_${intent.target.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.md`;
                    const targetDir = 'C:\\Users\\Rodrigo\\Desktop\\Generado';
                    const filePath = path.join(targetDir, fileName);
                    
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }
                    
                    fs.writeFileSync(filePath, promptDoc, 'utf8');
                    console.log(`[Jarvis Prompt Engineer] 📄 Documento creado en: ${fileName}`);
                    
                    // Abrir en VS Code usando el comando code
                    exec(`code "${filePath}"`, (err) => {
                        if (err) console.error("No se pudo abrir VS Code:", err);
                    });
                    
                    conversationHistory.push({ role: "user", content: userText });
                    conversationHistory.push({ role: "assistant", content: intent });
                    if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);
                    
                    return intent.reply || `He generado el prompt sobre ${intent.target} y lo he abierto en Visual Studio Code.`;
                } catch (e) {
                    console.error("Error generando el prompt:", e);
                    return "Hubo un error al intentar generar el archivo de prompt.";
                }
            }

            if (intent.action === "develop_new_skill") {
                const objective = intent.target || intent.message || userText;
                console.log(`[Code-Act] Enviando a Python orden de desarrollar habilidad: ${objective}`);
                try {
                    await fetch('http://127.0.0.1:8000/develop_skill', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ objective: objective })
                    });
                } catch(e) { 
                    console.error("[Code-Act] Python inalcanzable para develop_skill", e);
                }
                
                conversationHistory.push({ role: "user", content: userText });
                conversationHistory.push({ role: "assistant", content: intent });
                return intent.reply || "He iniciado el desarrollo de esta habilidad en segundo plano profundo.";
            }

            if (intent.action.startsWith("skill_")) {
                console.log(`[Code-Act] Ejecutando habilidad aprendida dinámicamente: ${intent.action}`);
                try {
                     const kwargsObj = {};
                     if (intent.target) kwargsObj["kwargs_str"] = typeof intent.target === 'object' ? JSON.stringify(intent.target) : String(intent.target);
                     
                     const reqBody = { skill_name: intent.action, kwargs: kwargsObj };
                     const executeRes = await fetch('http://127.0.0.1:8000/execute_skill', {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify(reqBody)
                     });
                     
                     if (executeRes.ok) {
                         const execData = await executeRes.json();
                         console.log(`[Code-Act] Habilidad ejecutada:`, execData);
                         if (execData.status === "success") {
                             intent.reply = `Hecho. El resultado es: ${execData.result}`;
                         } else {
                             intent.reply = `Lo intenté, pero la habilidad falló: ${execData.message}`;
                         }
                     } else {
                         intent.reply = "La habilidad existe pero el motor Python devolvió error HTTP.";
                     }
                 } catch(e) {
                     intent.reply = "No pude conectarme al motor de habilidades Python.";
                 }
                 
                 conversationHistory.push({ role: "user", content: userText });
                 conversationHistory.push({ role: "assistant", content: intent });
                 return intent.reply;
            }

            if (intent.action === "open_app") {
                console.log(`[Jarvis Local] Abriendo aplicación: ${intent.target}`);
                const sysServices = require('./systemService');
                await sysServices.openApp(intent.target, activeMode.id);
            } else {
                // Intentar enviar al motor Python FastAPI para tareas pesadas
                try {
                    const pyResponse = await fetch('http://127.0.0.1:8000/execute', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: intent.action,
                            target: typeof intent.target === 'object' ? JSON.stringify(intent.target) : intent.target,
                            message: typeof intent.message === 'object' ? JSON.stringify(intent.message) : intent.message || ""
                        })
                    });
                    
                    if(!pyResponse.ok) {
                        console.log(`[Motor Python] Servidor devolvió error HTTP ${pyResponse.status}`);
                    } else {
                        const pyData = await pyResponse.json();
                        console.log(`[Acción Híbrida Ejecutada]: ${pyData.message}`);
                    }
                } catch (e) {
                     console.log("[Aviso]: Motor Python (http://127.0.0.1:8000/execute) inalcanzable. Comprueba Uvicorn.");
                }
            }
        }

        // Actualizar nuestro historial interno
        conversationHistory.push({ role: "user", content: userText });
        conversationHistory.push({ role: "assistant", content: intent });

        if (conversationHistory.length > 20) {
            conversationHistory = conversationHistory.slice(-20);
        }

        return intent.reply || "He procesado la acción pero no generé respuesta hablada.";
    } catch (error) {
        console.error("Error Local de IA o de Conexión de Scraper:", error.message);
        return "Mis sistemas cognitivos están apagados. Por favor, asegúrate de que Ollama esté ejecutándose.";
    }
}


module.exports = {
    getAIResponse,
    searchSports
};
