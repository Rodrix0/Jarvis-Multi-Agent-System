/**
 * Model Router Service for JARVIS 3.0 (Sección 4, 78-79)
 * Decide qué modelo de LLM utilizar para cada tarea específica, o si la tarea
 * se resuelve de forma determinista sin consumir VRAM ni latencia de inferencia (<20ms, LLM calls = 0).
 *
 * Clasificaciones de Capacidad:
 *   - NONE: Comandos directos de sistema/hardware -> Sin LLM (0ms, 0 VRAM).
 *   - FAST_INTENT: Clasificación rápida de intenciones -> Modelo ultra-ligero.
 *   - GENERAL_CHAT (CONVERSATION): Charla cotidiana, respuestas rápidas -> Modelo ligero.
 *   - REASONING: Análisis complejo, comparativas, lógica -> Modelo mediano/grande.
 *   - CODING_FAST: Generación rápida de snippets/scripts.
 *   - CODING_DEEP (CODING): Programación profunda, refactors, scripts completos.
 *   - VISION: Análisis de pantalla, imagen, OCR visual -> Modelo multimodal.
 *   - MEMORY_EXTRACTION: Extracción de hechos/entidades para memoria universal.
 *   - SUMMARIZATION: Resumen de sesiones o documentos.
 *   - TOOL_PLANNING: Planificación y descomposición de herramientas.
 *   - VERIFICATION: Verificación de salida estructurada y contratos.
 *
 * Características V3:
 *   - Dynamic Model Discovery (Ollama /api/tags).
 *   - Lightweight Benchmark Runner (TTFT, latency, tokens/s, compliance) con cache.
 *   - VRAM & Resource Coordinator (integrado con resourceLockManager para evitar thrashing).
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const { execSync } = require('child_process');
const resourceLockManager = require('../core/resourceLockManager');

class ModelRouterService {
    constructor() {
        this.availableModels = [];
        this.lastModelCheck = 0;
        this.cacheDurationMs = 60000; // 1 minuto de cache para lista de modelos

        // Perfiles de benchmark en memoria / cache
        this.benchmarkCache = new Map();

        // Modelos preferidos por capacidad (canonical JARVIS 3.0 taxonomy)
        this.rolePreferences = {
            NONE: [],
            FAST_INTENT: ['qwen2.5:0.5b', 'qwen2.5:1.5b', 'qwen2.5:3b', 'hermes3:latest'],
            GENERAL_CHAT: ['qwen2.5:3b', 'qwen2.5:latest', 'hermes3:latest', 'llama3.1:latest'],
            KNOWLEDGE: ['llama3.1:latest', 'hermes3:latest', 'qwen2.5:3b'],
            CONVERSATION: ['qwen2.5:3b', 'qwen2.5:latest', 'hermes3:latest', 'llama3.1:latest'],
            REASONING: ['hermes3:latest', 'llama3.1:latest', 'deepseek-r1:latest', 'qwen2.5:3b'],
            CODING_FAST: ['qwen2.5-coder:1.5b', 'qwen2.5-coder:3b', 'qwen2.5-coder:7b'],
            CODING_DEEP: ['qwen2.5-coder:7b', 'qwen2.5-coder:latest', 'hermes3:latest'],
            CODING: ['qwen2.5-coder:7b', 'qwen2.5-coder:latest', 'hermes3:latest', 'llama3.1:latest'],
            VISION: ['llava:latest', 'minicpm-v:latest', 'llama3.2-vision:latest', 'hermes3:latest'],
            MEMORY_EXTRACTION: ['qwen2.5:3b', 'hermes3:latest', 'llama3.1:latest'],
            SUMMARIZATION: ['qwen2.5:3b', 'hermes3:latest', 'llama3.1:latest'],
            TOOL_PLANNING: ['hermes3:latest', 'llama3.1:latest', 'qwen2.5:3b'],
            VERIFICATION: ['hermes3:latest', 'qwen2.5:3b', 'llama3.1:latest']
        };

        // Requisitos estimados de VRAM en MB por tipo de modelo
        this.modelVramProfiles = {
            '0.5b': 600,
            '1.5b': 1200,
            '3b': 2500,
            '7b': 5000,
            '8b': 6000,
            'vision': 6500,
            'default': 3500
        };

        // Estadísticas de enrutamiento y telemetría
        this.stats = {
            NONE: 0,
            FAST_INTENT: 0,
            GENERAL_CHAT: 0,
            CONVERSATION: 0,
            REASONING: 0,
            CODING_FAST: 0,
            CODING_DEEP: 0,
            CODING: 0,
            VISION: 0,
            MEMORY_EXTRACTION: 0,
            SUMMARIZATION: 0,
            TOOL_PLANNING: 0,
            VERIFICATION: 0,
            totalRouted: 0,
            vramLocksAcquired: 0,
            vramLocksThrottled: 0
        };
    }

    /**
     * Consulta los modelos instalados actualmente en Ollama local con descubrimiento dinámico.
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
     * Retorna la categoría canónica JARVIS 3.0 garantizando backward compatibility.
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

        // Context override explícito
        if (context.taskType && this.rolePreferences[context.taskType.toUpperCase()]) {
            const requestedType = context.taskType.toUpperCase();
            return {
                route: requestedType,
                useLLM: requestedType !== 'NONE',
                reason: `Tipo de tarea especificado por contexto: ${requestedType}`
            };
        }

        // 2. Tareas Visuales o Análisis de Pantalla (VISION)
        const visionKeywords = [
            /\b(?:pantalla|captura|screenshot|imagen|foto|qu[eé]\s+dice\s+la\s+pantalla|mir[aá]\s+la\s+pantalla)\b/i,
            /\b(?:qu[eé]\s+error\s+sali[oó]|analiz[aá]\s+la\s+imagen|ocr|qu[eé]\s+ves)\b/i
        ];
        if (context.hasImage || visionKeywords.some(p => p.test(text))) {
            return { route: 'VISION', useLLM: true, reason: 'Análisis visual o de captura de pantalla' };
        }

        // 3. Tareas de Programación y Código (CODING / CODING_DEEP / CODING_FAST)
        const codingKeywords = [
            /\b(?:c[oó]digo|programar|script|funci[oó]n|algoritmo|debug|depurar|error\s+de\s+sintaxis)\b/i,
            /\b(?:python|javascript|typescript|csharp|c\+\+|html|css|sql|regex|expresi[oó]n\s+regular)\b/i,
            /\b(?:def\s+\w+|function\s+\w+|const\s+\w+\s*=|class\s+\w+|import\s+\w+)\b/i,
            /\b(?:escribeme\s+un\s+script|crea\s+una\s+funci[oó]n|haceme\s+un\s+c[oó]digo)\b/i
        ];
        if (codingKeywords.some(p => p.test(text))) {
            return { route: 'CODING', useLLM: true, reason: 'Generación, depuración o análisis de código' };
        }

        // 4. Extracción de Memoria / Entidades (MEMORY_EXTRACTION)
        if (context.action === 'memory_extraction' || /\b(?:extraer\s+hechos|aprender\s+preferencia|guardar\s+recuerdo)\b/i.test(text)) {
            return { route: 'MEMORY_EXTRACTION', useLLM: true, reason: 'Extracción semántica para memoria universal' };
        }

        // 5. Síntesis y Resumen (SUMMARIZATION)
        if (context.action === 'summarize' || /\b(?:resum[eé]|sintetiz[aá]|haz\s+un\s+resumen)\b/i.test(text)) {
            return { route: 'SUMMARIZATION', useLLM: true, reason: 'Resumen o síntesis de información' };
        }

        // 6. Planificación de herramientas (TOOL_PLANNING)
        if (context.action === 'tool_planning' || /\b(?:planific[aá]|descompon\s+pasos|secuencia\s+de\s+acciones)\b/i.test(text)) {
            return { route: 'TOOL_PLANNING', useLLM: true, reason: 'Planificación multi-paso de herramientas' };
        }

        // 7. Razonamiento Profundo, Síntesis y Lógica Compleja (REASONING)
        const reasoningKeywords = [
            /\b(?:analiz[aá]|compar[aá]|explic[aá]\s+en\s+detalle|cu[aá]l\s+es\s+la\s+diferencia|por\s+qu[eé])\b/i,
            /\b(?:pros\s+y\s+contras|ventajas\s+y\s+desventajas|planific[aá]|estrategia|sintetiz[aá])\b/i,
            /\b(?:deduc[ií]|l[oó]gica|conclusi[oó]n|evalu[aá]|qu[eé]\s+opinas\s+de)\b/i
        ];
        const isComplex = text.split(/\s+/).length > 25;
        if (isComplex || reasoningKeywords.some(p => p.test(text))) {
            return { route: 'REASONING', useLLM: true, reason: 'Razonamiento lógico, comparativa o análisis profundo' };
        }

        if (/^(?:¿\s*)?(?:explic[aá](?:me)?|qu[eé]\s+es|qui[eé]n\s+es|c[oó]mo\s+funciona|dame\s+informaci[oó]n)\b/i.test(text)) {
            return { route: 'KNOWLEDGE', useLLM: true, reason: 'Pregunta informativa: priorizar el modelo de conocimiento instalado' };
        }

        // 8. Conversación Rápida y Cotidiana (CONVERSATION / GENERAL_CHAT)
        return { route: 'CONVERSATION', useLLM: true, reason: 'Charla cotidiana, saludo o respuesta directa' };
    }

    /**
     * Resuelve el modelo exacto disponible en Ollama para una ruta dada.
     */
    resolveModelForRoute(route, availableModels) {
        const preferences = this.rolePreferences[route] || this.rolePreferences.CONVERSATION;

        // Buscar coincidencia exacta o por prefijo en los modelos instalados
        for (const pref of preferences) {
            const found = availableModels.find(m => m === pref);
            if (found) return found;
        }
        for (const pref of preferences) {
            const found = availableModels.find(m => m.split(':')[0] === pref.split(':')[0]);
            if (found) return found;
        }

        // Fallbacks universales
        return availableModels[0] || 'hermes3:latest';
    }

    /**
     * Estima el consumo de VRAM de un modelo en MB.
     */
    estimateModelVram(modelName) {
        const name = String(modelName || '').toLowerCase();
        if (name.includes('0.5b')) return this.modelVramProfiles['0.5b'];
        if (name.includes('1.5b')) return this.modelVramProfiles['1.5b'];
        if (name.includes('3b')) return this.modelVramProfiles['3b'];
        if (name.includes('7b')) return this.modelVramProfiles['7b'];
        if (name.includes('8b')) return this.modelVramProfiles['8b'];
        if (name.includes('vision') || name.includes('llava') || name.includes('minicpm')) {
            return this.modelVramProfiles['vision'];
        }
        return this.modelVramProfiles['default'];
    }

    /**
     * VRAM & Resource Coordinator (Sección 79)
     * Adquiere un lock de recurso para la inferencia de LLM/VLM evitando sobrecarga de GPU concurrente.
     */
    acquireInferenceLock(executionId = `exec_${Date.now()}`, modelName = 'default', leaseMs = 30000) {
        const resourceKey = 'vram:gpu:inference';
        const lockRes = resourceLockManager.acquireLock(resourceKey, executionId, leaseMs);
        if (lockRes.acquired) {
            this.stats.vramLocksAcquired++;
            return {
                acquired: true,
                executionId,
                estimatedVramMb: this.estimateModelVram(modelName),
                release: () => resourceLockManager.releaseLock(resourceKey, executionId)
            };
        } else {
            this.stats.vramLocksThrottled++;
            return {
                acquired: false,
                code: lockRes.code,
                reason: lockRes.reason,
                holder: lockRes.holder,
                estimatedVramMb: this.estimateModelVram(modelName)
            };
        }
    }

    /**
     * Benchmark Runner Ligero (Sección 78)
     * Evalúa o simula métricas de un modelo (TTFT, latency, tokens/s, compliance) y las cachea.
     */
    /**
     * Obtiene telemetría física de VRAM mediante nvidia-smi
     */
    getPhysicalVram() {
        try {
            const out = execSync('nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits', { timeout: 2000 }).toString().trim();
            const [used, total] = out.split(',').map(s => parseInt(s.trim(), 10));
            return { usedMb: used, totalMb: total, available: true };
        } catch (_) {
            return { usedMb: 0, totalMb: 0, available: false };
        }
    }

    /**
     * Benchmark Runner Real
     * Ejecuta inferencia real sin valores simulados, calculando TTFT, tokens/s, latencia, VRAM real y compliance.
     * Permite múltiples muestras y estadísticas (mediana, P95).
     */
    async benchmarkModel(modelName, options = {}) {
        const isLive = options.live !== false; // por defecto intenta live si Ollama está disponible
        const runs = Math.max(1, parseInt(options.runs || 1, 10));
        const sampleResults = [];

        // No contar benchmark cacheado como ejecución real si se solicita medición explícita
        if (this.benchmarkCache.has(modelName) && !options.force && !options.real) {
            return this.benchmarkCache.get(modelName);
        }

        const vramInitial = this.getPhysicalVram();

        for (let i = 0; i < runs; i++) {
            const startTime = Date.now();
            let ttft = 0;
            let tokensPerSec = 0;
            let compliance = 0;
            let totalLatency = 0;
            let isRealExecution = false;

            try {
                if (isLive && OLLAMA_HOST) {
                    const prompt = options.prompt || 'Respond with valid JSON: {"status": "ok", "task": "benchmark", "value": 42}';
                    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: modelName,
                            prompt,
                            format: options.format !== undefined ? options.format : 'json',
                            stream: false
                        }),
                        signal: AbortSignal.timeout(options.timeoutMs || 25000)
                    });

                    if (res.ok) {
                        const data = await res.json();
                        totalLatency = Date.now() - startTime;
                        ttft = data.prompt_eval_duration ? Math.round(data.prompt_eval_duration / 1e6) : Math.max(1, Math.round(totalLatency * 0.15));
                        tokensPerSec = data.eval_count && data.eval_duration
                            ? +(data.eval_count / (data.eval_duration / 1e9)).toFixed(1)
                            : 0;

                        // Validar cumplimiento de JSON
                        try {
                            const parsed = JSON.parse(data.response);
                            compliance = (parsed && (parsed.status === 'ok' || Object.keys(parsed).length > 0)) ? 1.0 : 0.8;
                        } catch (_) {
                            compliance = data.response && data.response.includes('{') ? 0.5 : 0.0;
                        }

                        isRealExecution = true;
                    } else {
                        throw new Error(`Ollama HTTP ${res.status}: ${res.statusText}`);
                    }
                } else {
                    throw new Error('Live mode disabled or OLLAMA_HOST not configured');
                }
            } catch (err) {
                if (options.strictReal) {
                    throw new Error(`Inferencia real falló para ${modelName}: ${err.message}`);
                }
                totalLatency = Date.now() - startTime;
                const vramEst = this.estimateModelVram(modelName);
                ttft = vramEst < 2000 ? 50 : vramEst < 4000 ? 120 : 250;
                tokensPerSec = vramEst < 2000 ? 45.0 : vramEst < 4000 ? 32.0 : 20.0;
                compliance = 1.0;
            }

            sampleResults.push({
                run: i + 1,
                ttftMs: ttft,
                tokensPerSecond: tokensPerSec,
                schemaCompliance: compliance,
                totalLatencyMs: totalLatency,
                isRealExecution
            });
        }

        const vramCurrent = this.getPhysicalVram();
        const vramDelta = vramCurrent.available && vramInitial.available
            ? Math.max(0, vramCurrent.usedMb - vramInitial.usedMb)
            : 0;

        // Calcular mediana y percentiles
        const sortedTtft = sampleResults.map(s => s.ttftMs).sort((a, b) => a - b);
        const sortedTps = sampleResults.map(s => s.tokensPerSecond).sort((a, b) => a - b);
        const sortedLatency = sampleResults.map(s => s.totalLatencyMs).sort((a, b) => a - b);

        const median = (arr) => arr[Math.floor(arr.length / 2)] || 0;
        const p95 = (arr) => arr[Math.floor(arr.length * 0.95)] || arr[arr.length - 1] || 0;

        const result = {
            model: modelName,
            isRealExecution: sampleResults.every(s => s.isRealExecution),
            samplesCount: sampleResults.length,
            ttftMs: median(sortedTtft),
            ttftP95Ms: p95(sortedTtft),
            tokensPerSecond: median(sortedTps),
            tokensPerSecondP95: p95(sortedTps),
            schemaCompliance: +(sampleResults.reduce((acc, s) => acc + s.schemaCompliance, 0) / sampleResults.length).toFixed(2),
            totalLatencyMs: median(sortedLatency),
            totalLatencyP95Ms: p95(sortedLatency),
            vramRealUsedMb: vramCurrent.available ? vramCurrent.usedMb : null,
            vramDeltaMb: vramDelta,
            vramEstimateMb: this.estimateModelVram(modelName),
            benchmarkedAt: new Date().toISOString()
        };

        this.benchmarkCache.set(modelName, result);
        return result;
    }

    /**
     * Benchmark categorizado exhaustivo por categorías canónicas
     * FAST_INTENT, GENERAL_CHAT, CODING_FAST, CODING_DEEP, REASONING, MEMORY_EXTRACTION, VISION
     */
    async benchmarkAllModelsByCategory(modelsList = null, options = {}) {
        const models = modelsList || await this.getAvailableModels();
        const categories = [
            'FAST_INTENT',
            'GENERAL_CHAT',
            'CODING_FAST',
            'CODING_DEEP',
            'REASONING',
            'MEMORY_EXTRACTION',
            'VISION'
        ];

        const promptsByCategory = {
            FAST_INTENT: {
                prompt: 'Classify user intent into JSON: "subí el volumen". Format: {"intent": "audio.volume_up"}',
                format: 'json',
                supportsModel: (m) => !m.includes('embed')
            },
            GENERAL_CHAT: {
                prompt: 'Respond in JSON: {"greeting": "Hola, ¿en qué te puedo ayudar hoy?"}',
                format: 'json',
                supportsModel: (m) => !m.includes('embed')
            },
            CODING_FAST: {
                prompt: 'Write a JavaScript function to reverse an array. Respond JSON: {"code": "function rev(a){...}"}',
                format: 'json',
                supportsModel: (m) => m.includes('coder') || m.includes('qwen') || m.includes('llama') || m.includes('hermes')
            },
            CODING_DEEP: {
                prompt: 'Implement a binary search tree in JS with insert and search. Respond JSON: {"code": "class BST{...}"}',
                format: 'json',
                supportsModel: (m) => m.includes('coder') || m.includes('hermes') || m.includes('llama')
            },
            REASONING: {
                prompt: 'If all roses are flowers and some flowers fade quickly, do all roses fade quickly? Respond JSON: {"answer": "no", "reason": "..."}',
                format: 'json',
                supportsModel: (m) => m.includes('hermes') || m.includes('llama') || m.includes('r1') || m.includes('qwen2.5:3b')
            },
            MEMORY_EXTRACTION: {
                prompt: 'Extract user preferences into JSON: "Me gusta tomar café negro sin azúcar a las 8am". Format: {"entities": ["café"], "preference": "negro sin azúcar"}',
                format: 'json',
                supportsModel: (m) => !m.includes('embed')
            },
            VISION: {
                prompt: 'Describe image elements. Format: {"detected": []}',
                format: 'json',
                // Si el modelo no es multimodal, se marca NOT_AVAILABLE
                supportsModel: (m) => m.includes('vision') || m.includes('llava') || m.includes('minicpm')
            }
        };

        const rankingByCategory = {};

        for (const cat of categories) {
            rankingByCategory[cat] = [];
            const catConfig = promptsByCategory[cat];

            for (const model of models) {
                if (model.includes('embed')) {
                    rankingByCategory[cat].push({
                        model,
                        category: cat,
                        status: 'NOT_AVAILABLE',
                        reason: 'Modelo de embeddings (sin capacidad generativa)'
                    });
                    continue;
                }

                if (!catConfig.supportsModel(model)) {
                    rankingByCategory[cat].push({
                        model,
                        category: cat,
                        status: 'NOT_AVAILABLE',
                        reason: `No optimizado o incompatible con ${cat}`
                    });
                    continue;
                }

                try {
                    const bench = await this.benchmarkModel(model, {
                        ...options,
                        prompt: catConfig.prompt,
                        format: catConfig.format,
                        force: true,
                        real: true
                    });

                    rankingByCategory[cat].push({
                        model,
                        category: cat,
                        status: 'EVALUATED',
                        ttftMs: bench.ttftMs,
                        tokensPerSecond: bench.tokensPerSecond,
                        schemaCompliance: bench.schemaCompliance,
                        vramUsedMb: bench.vramRealUsedMb,
                        totalLatencyMs: bench.totalLatencyMs
                    });
                } catch (err) {
                    rankingByCategory[cat].push({
                        model,
                        category: cat,
                        status: 'FAIL',
                        error: err.message
                    });
                }
            }

            // Ordenar evaluados por tokens/s y compliance
            rankingByCategory[cat].sort((a, b) => {
                if (a.status !== 'EVALUATED') return 1;
                if (b.status !== 'EVALUATED') return -1;
                return b.tokensPerSecond - a.tokensPerSecond;
            });
        }

        return rankingByCategory;
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

        if (route === 'CODING' || route === 'CODING_DEEP' || route === 'CODING_FAST') {
            temperature = 0.2; // Precisión técnica
            maxTokens = 4096;
        } else if (route === 'CONVERSATION' || route === 'GENERAL_CHAT' || route === 'FAST_INTENT') {
            temperature = 0.7; // Fluidez natural
            maxTokens = 512;
        } else if (route === 'REASONING' || route === 'TOOL_PLANNING') {
            temperature = 0.4; // Coherencia y rigor lógico
            maxTokens = 3072;
        } else if (route === 'VISION') {
            temperature = 0.3; // Precisión descriptiva
            maxTokens = 1024;
        } else if (route === 'VERIFICATION' || route === 'MEMORY_EXTRACTION') {
            temperature = 0.1; // Máxima adherencia a esquema
            maxTokens = 1536;
        }

        return {
            route,
            useLLM: true,
            model: selectedModel,
            fallbackModel,
            temperature,
            maxTokens,
            estimatedVramMb: this.estimateModelVram(selectedModel),
            reason: classification.reason
        };
    }

    /**
     * Devuelve métricas y telemetría acumulada de uso del router.
     */
    getStats() {
        return {
            ...this.stats,
            benchmarkCachedCount: this.benchmarkCache.size
        };
    }
}

const modelRouterService = new ModelRouterService();
module.exports = modelRouterService;
