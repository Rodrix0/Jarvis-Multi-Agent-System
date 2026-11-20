/**
 * structuredOutputService.js
 * 
 * Capa de Salidas Estructuradas Estrictas para JARVIS 3.0 (Sección 3).
 * 
 * Capacidades:
 * - Esquemas formales JSON Schema para todas las decisiones operativas:
 *   Intent, Planner, ToolCall, Verification, Memory, AppAction, TVAction, etc.
 * - Validación estricta de tipos, arrays, enums, rangos y campos requeridos.
 * - Bucle de autoreparación controlado (máximo 1 intento con feedback de error).
 * - Métricas de observabilidad en tiempo real:
 *   structured_output_success_rate, schema_validation_failure, schema_repair_count.
 * - Tolerancia cero a alucinaciones de parámetros y texto libre para decisiones de sistema.
 */

class StructuredOutputService {
    constructor() {
        this.schemas = this._initSchemas();
        this.metrics = {
            total_validations: 0,
            successful_validations: 0,
            schema_validation_failure: 0,
            schema_repair_count: 0,
            repaired_success_count: 0
        };
    }

    _initSchemas() {
        return {
            // === ESQUEMAS NATIVOS JARVIS 3.0 (Sección 3) ===

            // 1. Intent: Detección y clasificación de intención
            Intent: {
                type: 'object',
                properties: {
                    intent: { type: 'string' },
                    target: { type: 'string' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
                    requiresLLM: { type: 'boolean' },
                    parameters: { type: 'object' }
                },
                required: ['intent', 'confidence']
            },

            // 2. Planner: Plan de ejecución jerárquico
            Planner: {
                type: 'object',
                properties: {
                    goal: { type: 'string' },
                    risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
                    steps: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                action: { type: 'string' },
                                status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'skipped'] },
                                parameters: { type: 'object' }
                            },
                            required: ['id', 'action']
                        }
                    }
                },
                required: ['goal', 'steps']
            },

            // 3. ToolCall: Invocación determinística de herramienta
            ToolCall: {
                type: 'object',
                properties: {
                    tool: { type: 'string' },
                    arguments: { type: 'object' },
                    correlationId: { type: 'string' }
                },
                required: ['tool', 'arguments']
            },

            // 4. Verification: Evidencia operacional de éxito/fracaso
            Verification: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    evidence: {
                        type: 'array',
                        items: { type: 'string' }
                    },
                    reason: { type: 'string' }
                },
                required: ['success', 'confidence', 'evidence']
            },

            // 5. Memory: Extracción estructurada de recuerdos universales
            Memory: {
                type: 'object',
                properties: {
                    shouldPersist: { type: 'boolean' },
                    memoryType: {
                        type: 'string',
                        enum: ['raw', 'working', 'episodic', 'semantic', 'preference', 'operational', 'procedural', 'entity', 'temporal', 'consolidated']
                    },
                    importance: { type: 'number', minimum: 0, maximum: 1 },
                    entities: { type: 'array', items: { type: 'string' } },
                    facts: { type: 'array', items: { type: 'string' } },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['shouldPersist', 'memoryType', 'importance']
            },

            // === ESQUEMAS RETROCOMPATIBLES JARVIS 2.0 ===

            AppAction: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['open_app', 'close_app', 'minimize_window', 'maximize_window', 'switch_tab', 'set_volume']
                    },
                    target: { type: 'string' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    params: { type: 'object' }
                },
                required: ['action', 'target', 'confidence']
            },

            TVAction: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: [
                            'tv_set_volume', 'tv_adjust_volume', 'tv_get_volume',
                            'tv_calibrate_volume', 'tv_toggle_mute', 'tv_enter_netflix',
                            'tv_open_app', 'tv_learn_button'
                        ]
                    },
                    percent: { type: 'number', minimum: 0, maximum: 100 },
                    delta: { type: 'number' },
                    target: { type: 'string' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['action', 'confidence']
            },

            FileAction: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['file_create', 'file_delete', 'folder_create', 'folder_delete', 'file_read']
                    },
                    fileName: { type: 'string' },
                    folderName: { type: 'string' },
                    content: { type: 'string' },
                    format: { type: 'string', enum: ['txt', 'docx', 'pdf', 'xlsx', 'none'] },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['action', 'confidence']
            },

            BrowserAction: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['browser_open', 'browser_click', 'browser_type', 'browser_get_text', 'browser_scroll', 'browser_close']
                    },
                    url: { type: 'string' },
                    selector: { type: 'string' },
                    text: { type: 'string' },
                    direction: { type: 'string', enum: ['down', 'up', 'bottom', 'top'] },
                    amount: { type: 'number' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['action', 'confidence']
            },

            MemoryAction: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['memory_store', 'memory_query', 'memory_delete', 'profile_update']
                    },
                    topic: { type: 'string' },
                    content: { type: 'string' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['action', 'topic', 'confidence']
            },

            ResearchAction: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['research_query', 'web_search', 'synthesize_topic']
                    },
                    topic: { type: 'string' },
                    depth: { type: 'string', enum: ['quick', 'deep', 'comparative'] },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['action', 'topic', 'confidence']
            },

            UnifiedAction: {
                type: 'object',
                properties: {
                    domain: {
                        type: 'string',
                        enum: ['app', 'tv', 'file', 'browser', 'memory', 'research', 'chat']
                    },
                    action: { type: 'string' },
                    target: { type: 'string' },
                    parameters: { type: 'object' },
                    reply: { type: 'string' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['domain', 'action', 'confidence']
            }
        };
    }

    getSchema(schemaName) {
        const schema = this.schemas[schemaName];
        if (!schema) {
            throw new Error(`Esquema estructurado desconocido: "${schemaName}". Disponibles: ${Object.keys(this.schemas).join(', ')}`);
        }
        return schema;
    }

    /**
     * Valida un objeto contra un esquema estructurado (soporta arrays, booleanos, enums y tipos anidados).
     */
    validate(data, schemaName) {
        this.metrics.total_validations++;

        if (!data || typeof data !== 'object') {
            this.metrics.schema_validation_failure++;
            return {
                ok: false,
                errors: ['Los datos deben ser un objeto JSON válido.']
            };
        }

        const schema = this.getSchema(schemaName);
        const errors = [];

        // 1. Validar campos requeridos
        for (const req of (schema.required || [])) {
            if (data[req] === undefined || data[req] === null || (typeof data[req] === 'string' && data[req].trim() === '')) {
                errors.push(`Campo requerido ausente o vacío: "${req}".`);
            }
        }

        // 2. Validar tipos y propiedades
        for (const [propName, propDef] of Object.entries(schema.properties || {})) {
            const val = data[propName];
            if (val === undefined || val === null) continue;

            // Booleano
            if (propDef.type === 'boolean') {
                if (typeof val !== 'boolean') {
                    errors.push(`El campo "${propName}" debe ser booleano (true/false).`);
                }
            }

            // Numérico
            if (propDef.type === 'number') {
                if (typeof val !== 'number' || Number.isNaN(val)) {
                    errors.push(`El campo "${propName}" debe ser un número.`);
                } else {
                    if (propDef.minimum !== undefined && val < propDef.minimum) {
                        errors.push(`El campo "${propName}" (${val}) es menor al mínimo permitido (${propDef.minimum}).`);
                    }
                    if (propDef.maximum !== undefined && val > propDef.maximum) {
                        errors.push(`El campo "${propName}" (${val}) es mayor al máximo permitido (${propDef.maximum}).`);
                    }
                }
            }

            // String y Enums
            if (propDef.type === 'string') {
                if (typeof val !== 'string') {
                    errors.push(`El campo "${propName}" debe ser texto (string).`);
                } else if (propDef.enum && !propDef.enum.includes(val)) {
                    errors.push(`El valor "${val}" no es válido para "${propName}". Permitidos: [${propDef.enum.join(', ')}].`);
                }
            }

            // Objeto
            if (propDef.type === 'object') {
                if (typeof val !== 'object' || Array.isArray(val)) {
                    errors.push(`El campo "${propName}" debe ser un objeto.`);
                }
            }

            // Array
            if (propDef.type === 'array') {
                if (!Array.isArray(val)) {
                    errors.push(`El campo "${propName}" debe ser un array.`);
                } else if (propDef.items) {
                    for (let i = 0; i < val.length; i++) {
                        const item = val[i];
                        if (propDef.items.type === 'string' && typeof item !== 'string') {
                            errors.push(`Elemento ${i} de "${propName}" debe ser texto.`);
                        } else if (propDef.items.type === 'object') {
                            if (typeof item !== 'object' || item === null) {
                                errors.push(`Elemento ${i} de "${propName}" debe ser un objeto.`);
                            } else if (propDef.items.required) {
                                for (const subReq of propDef.items.required) {
                                    if (item[subReq] === undefined || item[subReq] === null) {
                                        errors.push(`Elemento ${i} de "${propName}" no incluye el campo requerido "${subReq}".`);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. Normalizar confidence si está presente
        if (data.confidence !== undefined) {
            let conf = Number(data.confidence);
            if (Number.isNaN(conf)) conf = 0.5;
            data.confidence = Math.min(1.0, Math.max(0.0, Math.round(conf * 100) / 100));
        }

        const isOk = errors.length === 0;
        if (isOk) {
            this.metrics.successful_validations++;
        } else {
            this.metrics.schema_validation_failure++;
        }

        return {
            ok: isOk,
            errors,
            sanitized: isOk ? data : null
        };
    }

    /**
     * Parsea una cadena de texto (JSON) y la valida contra el esquema.
     */
    parseAndValidate(rawText, schemaName) {
        if (!rawText || typeof rawText !== 'string') {
            this.metrics.total_validations++;
            this.metrics.schema_validation_failure++;
            return { ok: false, errors: ['Entrada vacía o inválida.'] };
        }

        let parsed = null;
        try {
            parsed = JSON.parse(rawText.trim());
        } catch (_) {
            const match = rawText.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    parsed = JSON.parse(match[0]);
                } catch (e) {
                    this.metrics.total_validations++;
                    this.metrics.schema_validation_failure++;
                    return { ok: false, errors: [`Error de sintaxis JSON: ${e.message}`] };
                }
            } else {
                this.metrics.total_validations++;
                this.metrics.schema_validation_failure++;
                return { ok: false, errors: ['No se encontró un bloque JSON válido en la respuesta.'] };
            }
        }

        return this.validate(parsed, schemaName);
    }

    /**
     * Bucle de autoreparación controlado (Sección 3):
     * Si la salida no cumple el esquema, realiza exactamente 1 intento de reparación llamando a `repairFn`.
     */
    async repairAndValidate(rawText, schemaName, repairFn = null, fallbackObj = null) {
        const initial = this.parseAndValidate(rawText, schemaName);
        if (initial.ok) {
            return {
                ok: true,
                data: initial.sanitized,
                repairs: 0
            };
        }

        // Si falló pero se proporcionó función de reparación: 1 intento controlado
        if (typeof repairFn === 'function') {
            this.metrics.schema_repair_count++;
            try {
                const repairedText = await repairFn(rawText, initial.errors);
                const second = this.parseAndValidate(repairedText, schemaName);
                if (second.ok) {
                    this.metrics.repaired_success_count++;
                    return {
                        ok: true,
                        data: second.sanitized,
                        repairs: 1,
                        repaired: true
                    };
                }
            } catch (err) {
                console.warn('[StructuredOutputService] Error en función de reparación:', err.message);
            }
        }

        // Si falló definitivamente, devolver fallback si fue especificado
        if (fallbackObj) {
            const fallbackVal = this.validate(fallbackObj, schemaName);
            if (fallbackVal.ok) {
                return {
                    ok: true,
                    data: fallbackVal.sanitized,
                    repairs: 1,
                    usedFallback: true
                };
            }
        }

        return {
            ok: false,
            errors: initial.errors,
            rawText
        };
    }

    /**
     * Obtiene métricas de observabilidad en tiempo real.
     */
    getMetrics() {
        const total = this.metrics.total_validations;
        const success = this.metrics.successful_validations;
        const rate = total > 0 ? Math.round((success / total) * 100) / 100 : 1.0;

        return {
            ...this.metrics,
            structured_output_success_rate: rate
        };
    }

    resetMetrics() {
        this.metrics = {
            total_validations: 0,
            successful_validations: 0,
            schema_validation_failure: 0,
            schema_repair_count: 0,
            repaired_success_count: 0
        };
    }

    getSystemPromptInstruction(schemaName) {
        const schema = this.getSchema(schemaName);
        return `\n[INSTRUCCIÓN ESTRICTA DE SALIDA ESTRUCTURADA]
Debes responder ÚNICAMENTE con un objeto JSON válido y nada más (sin introducciones, markdown innecesario ni explicaciones).
El JSON debe cumplir estrictamente con el siguiente esquema:
${JSON.stringify(schema, null, 2)}\n`;
    }
}

const structuredOutputService = new StructuredOutputService();
structuredOutputService.StructuredOutputService = StructuredOutputService;
structuredOutputService.structuredOutputService = structuredOutputService;

module.exports = structuredOutputService;
