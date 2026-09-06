/**
 * Model Router Service for Jarvis
 * Decide qué modelo de LLM utilizar para cada tarea específica, o si la tarea
 * se resuelve de forma determinista sin consumir VRAM ni latencia de inferencia.
 *
 * Mapeo estratégico:
 *   - NONE: Comandos directos de sistema/hardware -> Sin LLM (0ms, 0 VRAM).
 *   - CONVERSATION: Charla cotidiana, respuestas rápidas -> Modelo pequeño (qwen2.5:3b).
 *   - REASONING: Análisis complejo, comparativas, lógica -> Modelo mediano/grande (hermes3:latest / llama3.1).
 *   - CODING: Programación, scripts, depuración, regex -> Modelo coder (qwen2.5-coder:7b).
 *   - VISION: Análisis de pantalla, imagen, OCR visual -> Modelo visión / multimodal.
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

class ModelRouterService {
    constructor() {
        this.availableModels = [];
        this.lastModelCheck = 0;
        this.cacheDurationMs = 60000; // 1 minuto de cache para lista de modelos

        // Modelos preferidos por rol
        this.rolePreferences = {
            CONVERSATION: ['qwen2.5:3b', 'qwen2.5:latest', 'hermes3:latest', 'llama3.1:latest'],
            CODING: ['qwen2.5-coder:7b', 'qwen2.5-coder:latest', 'hermes3:latest', 'llama3.1:latest'],
            REASONING: ['hermes3:latest', 'llama3.1:latest', 'qwen2.5:3b'],
            VISION: ['hermes3:latest', 'llama3.1:latest', 'llava:latest', 'minicpm-v:latest']
        };

        // Estadísticas de enrutamiento
        this.stats = {
            NONE: 0,
            CONVERSATION: 0,
            REASONING: 0,
            CODING: 0,
            VISION: 0,
            totalRouted: 0
        };
    }

    /**
     * Consulta los modelos instalados actualmente en Ollama local.
     */
    async getAvailableModels(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.availableModels.length > 0 && (now - this.lastModelCheck < this.cacheDurationMs)) {
            return this.availableModels;
        }

        try {
            const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
                signal: AbortSignal.timeout(2000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.models && Array.isArray(data.models)) {
                    this.availableModels = data.models.map(m => m.name);
                    this.lastModelCheck = now;
                    return this.availableModels;
                }
            }
        } catch (_) {
            // Ollama no responde o fuera de línea
        }

        // Fallback si no se pudo conectar
        if (this.availableModels.length === 0) {
            this.availableModels = ['hermes3:latest', 'qwen2.5:3b', 'qwen2.5-coder:7b', 'llama3.1:latest'];
        }
        return this.availableModels;
    }

    /**
     * Clasifica semánticamente la intención y determina la ruta óptima.
     */
    classifyTask(prompt = '', context = {}) {
        const text = String(prompt || '').toLowerCase().trim();

        // 1. Detección de comandos directos deterministas (NONE: No requiere LLM)
        if (context.actionId || context.isDeterministic) {
            return { route: 'NONE', useLLM: false, reason: 'Acción directa del ActionKernel' };
        }

        const deterministicPatterns = [
            /\b(?:sub[ií]|baj[aá]|pon[eé]|ajust[aá]|cambi[aá])\s+(?:el\s+)?volumen\b/i,
            /\b(?:silenci[aá]|mute[aá]|activ[aá]\s+el\s+sonido|desmute[aá])\b/i,
            /\b(?:minimiz[aá]|maximiz[aá]|cerr[aá]|abr[ií]|achic[aá]|agrand[aá])\s+(?:la\s+)?(?:ventana|pestaña|app|aplicaci[oó]n|todo)\b/i,
            /\b(?:mand[aá](?:le)?|envi[aá](?:le)?|escrib[ií](?:le)?)\b.*\b(?:mensaje|whatsapp)\b/i,
            /\b(?:d[oó]lar\s+blue|d[oó]lar\s+oficial|d[oó]lar\s+mep|cotizaci[oó]n\s+del\s+d[oó]lar)\b/i,
            /\b(?:cu[aá]nto\s+est[aá]|precio)\s+(?:del\s+)?d[oó]lar\b/i,
            /\b(?:qu[eé]\s+hora\s+es|qu[eé]\s+d[ií]a\s+es|fecha\s+de\s+hoy)\b/i,
            /\b(?:cre[aá]|borr[aá]|elimin[aá])\s+(?:la\s+)?(?:carpeta|archivo|nota)\b/i
        ];

        for (const pattern of deterministicPatterns) {
            if (pattern.test(text)) {
                return { route: 'NONE', useLLM: false, reason: 'Comando determinista de sistema sin necesidad de LLM' };
            }
        }

        // 2. Tareas de Programación y Código (CODING)
        const codingKeywords = [
            /\b(?:c[oó]digo|programar|script|funci[oó]n|algoritmo|debug|depurar|error\s+de\s+sintaxis)\b/i,
            /\b(?:python|javascript|typescript|csharp|c\+\+|html|css|sql|regex|expresi[oó]n\s+regular)\b/i,
            /\b(?:def\s+\w+|function\s+\w+|const\s+\w+\s*=|class\s+\w+|import\s+\w+)\b/i,
            /\b(?:escribeme\s+un\s+script|crea\s+una\s+funci[oó]n|haceme\s+un\s+c[oó]digo)\b/i
        ];
        if (codingKeywords.some(p => p.test(text))) {
            return { route: 'CODING', useLLM: true, reason: 'Generación, depuración o análisis de código' };
        }

        // 3. Tareas Visuales o Análisis de Pantalla (VISION)
        const visionKeywords = [
            /\b(?:pantalla|captura|screenshot|imagen|foto|qu[eé]\s+dice\s+la\s+pantalla|mir[aá]\s+la\s+pantalla)\b/i,
            /\b(?:qu[eé]\s+error\s+sali[oó]|analiz[aá]\s+la\s+imagen|ocr|qu[eé]\s+ves)\b/i
        ];
        if (context.hasImage || visionKeywords.some(p => p.test(text))) {
            return { route: 'VISION', useLLM: true, reason: 'Análisis visual o de captura de pantalla' };
        }

        // 4. Razonamiento Profundo, Síntesis y Lógica Compleja (REASONING)
        const reasoningKeywords = [
            /\b(?:analiz[aá]|compar[aá]|explic[aá]\s+en\s+detalle|cu[aá]l\s+es\s+la\s+diferencia|por\s+qu[eé])\b/i,
            /\b(?:pros\s+y\s+contras|ventajas\s+y\s+desventajas|planific[aá]|estrategia|sintetiz[aá])\b/i,
            /\b(?:deduc[ií]|l[oó]gica|conclusi[oó]n|evalu[aá]|qu[eé]\s+opinas\s+de)\b/i
        ];
        const isComplex = text.split(/\s+/).length > 25;
        if (isComplex || reasoningKeywords.some(p => p.test(text))) {
            return { route: 'REASONING', useLLM: true, reason: 'Razonamiento lógico, comparativa o análisis profundo' };
        }

        // 5. Conversación Rápida y Cotidiana (CONVERSATION)
        return { route: 'CONVERSATION', useLLM: true, reason: 'Charla cotidiana, saludo o respuesta directa' };
    }

    /**
     * Resuelve el modelo exacto disponible en Ollama para una ruta dada.
     */
    resolveModelForRoute(route, availableModels) {
        const preferences = this.rolePreferences[route] || this.rolePreferences.CONVERSATION;

        // Buscar coincidencia exacta o por prefijo en los modelos instalados
        for (const pref of preferences) {
            const found = availableModels.find(m => m === pref || m.startsWith(pref.split(':')[0]));
            if (found) return found;
        }

        // Fallbacks universales
        return availableModels[0] || 'hermes3:latest';
    }

    /**
     * Método principal de enrutamiento: clasifica la tarea y devuelve la configuración de modelo óptima.
     */
    async route(prompt = '', context = {}) {
        const classification = this.classifyTask(prompt, context);
        const route = classification.route;

        this.stats[route] = (this.stats[route] || 0) + 1;
        this.stats.totalRouted++;

        if (!classification.useLLM) {
            return {
                route: 'NONE',
                useLLM: false,
                model: null,
                fallbackModel: null,
                temperature: 0,
                maxTokens: 0,
                reason: classification.reason
            };
        }

        const available = await this.getAvailableModels();
        const selectedModel = this.resolveModelForRoute(route, available);

        // Fallback model diferente al seleccionado
        let fallbackModel = 'hermes3:latest';
        if (selectedModel === 'hermes3:latest') {
            fallbackModel = available.find(m => m.includes('llama3.1') || m.includes('qwen')) || available[0];
        }

        // Parámetros de generación adaptados al rol
        let temperature = 0.7;
        let maxTokens = 2048;

        if (route === 'CODING') {
            temperature = 0.2; // Precisión técnica
            maxTokens = 4096;
        } else if (route === 'CONVERSATION') {
            temperature = 0.7; // Fluidez natural
            maxTokens = 512;
        } else if (route === 'REASONING') {
            temperature = 0.4; // Coherencia y rigor lógico
            maxTokens = 3072;
        } else if (route === 'VISION') {
            temperature = 0.3; // Precisión descriptiva
            maxTokens = 1024;
        }

        return {
            route,
            useLLM: true,
            model: selectedModel,
            fallbackModel,
            temperature,
            maxTokens,
            reason: classification.reason
        };
    }

    /**
     * Devuelve métricas de uso del router.
     */
    getStats() {
        return { ...this.stats };
    }
}

const modelRouterService = new ModelRouterService();
module.exports = modelRouterService;
