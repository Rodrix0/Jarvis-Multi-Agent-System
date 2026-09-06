/**
 * Structured Output Service for Jarvis (Ítem 8)
 * Obliga al LLM a generar respuestas estrictamente estructuradas según esquemas
 * formales JSON Schema, eliminando respuestas ambiguas y alucinaciones de argumentos.
 *
 * Ejemplo canónico:
 * {
 *   "action": "open_app",
 *   "target": "spotify",
 *   "confidence": 0.98
 * }
 */

class StructuredOutputService {
    constructor() {
        this.schemas = this._initSchemas();
    }

    /**
     * Inicializa los esquemas canónicos por dominio operativo.
     */
    _initSchemas() {
        return {
            // 1. AppAction: Control de aplicaciones y ventanas
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

            // 2. TVAction: Control de Smart TV / BroadLink IR
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

            // 3. FileAction: Manejo de archivos y carpetas
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

            // 4. BrowserAction: Navegación web autónoma (Playwright)
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

            // 5. MemoryAction: Memoria y preferencias de usuario
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

            // 6. ResearchAction: Búsqueda e investigación profunda
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

            // 7. UnifiedAction: Meta-esquema para decisiones abiertas
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

    /**
     * Obtiene la definición formal de un esquema por su nombre.
     */
    getSchema(schemaName) {
        const schema = this.schemas[schemaName];
        if (!schema) {
            throw new Error(`Esquema estructurado desconocido: "${schemaName}". Disponibles: ${Object.keys(this.schemas).join(', ')}`);
        }
        return schema;
    }

    /**
     * Valida un objeto contra un esquema estructurado.
     */
    validate(data, schemaName) {
        if (!data || typeof data !== 'object') {
            return {
                ok: false,
                errors: ['Los datos deben ser un objeto JSON válido.']
            };
        }

        const schema = this.getSchema(schemaName);
        const errors = [];

        // 1. Validar campos requeridos
        for (const req of (schema.required || [])) {
            if (data[req] === undefined || data[req] === null || data[req] === '') {
                errors.push(`Campo requerido ausente o vacío: "${req}".`);
            }
        }

        // 2. Validar tipos y enums
        for (const [propName, propDef] of Object.entries(schema.properties || {})) {
            const val = data[propName];
            if (val === undefined || val === null) continue;

            // Tipo numérico
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

            // Tipo string y enums
            if (propDef.type === 'string') {
                if (typeof val !== 'string') {
                    errors.push(`El campo "${propName}" debe ser texto (string).`);
                } else if (propDef.enum && !propDef.enum.includes(val)) {
                    errors.push(`El valor "${val}" no es válido para "${propName}". Permitidos: [${propDef.enum.join(', ')}].`);
                }
            }

            // Tipo objeto
            if (propDef.type === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
                errors.push(`El campo "${propName}" debe ser un objeto.`);
            }
        }

        // 3. Normalizar y verificar confidence obligatorio
        if (data.confidence !== undefined) {
            let conf = Number(data.confidence);
            if (Number.isNaN(conf)) conf = 0.5;
            data.confidence = Math.min(1.0, Math.max(0.0, Math.round(conf * 100) / 100));
        }

        return {
            ok: errors.length === 0,
            errors,
            sanitized: errors.length === 0 ? data : null
        };
    }

    /**
     * Parsea una cadena de texto (JSON) y la valida contra el esquema correspondiente.
     */
    parseAndValidate(rawText, schemaName) {
        if (!rawText || typeof rawText !== 'string') {
            return { ok: false, errors: ['Entrada vacía o inválida.'] };
        }

        let parsed = null;
        try {
            parsed = JSON.parse(rawText.trim());
        } catch (_) {
            // Intentar extraer el bloque JSON si vino rodeado de texto o markdown
            const match = rawText.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    parsed = JSON.parse(match[0]);
                } catch (e) {
                    return { ok: false, errors: [`Error de sintaxis JSON: ${e.message}`] };
                }
            } else {
                return { ok: false, errors: ['No se encontró un bloque JSON válido en la respuesta.'] };
            }
        }

        return this.validate(parsed, schemaName);
    }

    /**
     * Construye un prompt enriquecido con la instrucción formal del esquema para el LLM.
     */
    getSystemPromptInstruction(schemaName) {
        const schema = this.getSchema(schemaName);
        return `\n[INSTRUCCIÓN ESTRICTA DE SALIDA ESTRUCTURADA]
Debes responder ÚNICAMENTE con un objeto JSON válido y nada más (sin introducciones ni explicaciones).
El JSON debe cumplir con el siguiente esquema:
${JSON.stringify(schema, null, 2)}
Asegúrate de incluir obligatoriamente el campo "confidence" (número entre 0.0 y 1.0) indicando tu nivel de certeza.\n`;
    }
}

const structuredOutputService = new StructuredOutputService();
module.exports = structuredOutputService;
