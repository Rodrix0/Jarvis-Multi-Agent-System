/**
 * Memory Importance Service for Jarvis (Ítem 18)
 * Evalúa la importancia intrínseca (0.0 a 1.0) de cualquier dato o declaración
 * del usuario en forma 100% universal y agnóstica al dominio (Finanzas, Hardware,
 * Salud, Estudio, Programación, Trabajo, Vida Diaria y Creatividad).
 *
 * Triaje en 3 Vías:
 *   [0.00 - 0.25] ──▶ DESCARTAR (No almacenar, evita basura en memoria)
 *   [0.26 - 0.70] ──▶ EPISÓDICA (Almacenar con fecha de expiración / TTL)
 *   [0.71 - 1.00] ──▶ PERMANENTE (Almacenar de forma inmutable / Core Memory)
 */

class MemoryImportanceService {
    constructor() {
        // Patrones de Ruido y Estados Transitorios (Importancia: 0.00 - 0.20 -> DESCARTAR)
        this.transientNoisePatterns = [
            /\b(?:tengo\s+(?:sueno|hambre|frio|calor|sed|fiaca|pereza))\b/i,
            /\b(?:estoy\s+(?:cansado|aburrido|comiendo|almorzando|cenando|durmiendo|yendo))\b/i,
            /\b(?:que\s+(?:calor|frio|lindo\s+dia|tiempo\s+loco))\b/i,
            /\b(?:jaja|jeje|jajaja|lol|xd|gracias|muchas\s+gracias|de\s+nada|ok|dale|bueno|listo)\b/i,
            /\b(?:hola|chau|adios|buenas|hasta\s+luego|nos\s+vemos)\b/i
        ];

        // Patrones Permanentes / Identidad / Hardware / Inmutables (Importancia: 0.75 - 1.00 -> PERMANENTE)
        this.permanentPatterns = [
            // Dispositivos, Marcas y Hardware (TV, Monitor, PC, Placa, Router)
            { pattern: /\b(?:mi\s+(?:tv|tele|television|monitor|celular|pc|notebook|router|auto|consola)\s+(?:es|marca|modelo))\b/i, score: 0.95 },
            { pattern: /\b(?:aiwa|samsung|lg|sony|philips|tcl|apple|xiaomi|nvidia|intel|amd|ryzen|rtx|geforce)\b/i, score: 0.90 },
            
            // Salud, Alergias y Datos Médicos Críticos
            { pattern: /\b(?:alergico|alergia|medicamento|presion|sangre|enfermedad|tratamiento|diabetes|asma)\b/i, score: 1.00 },
            
            // Identidad Personal, Documentos y Vínculos
            { pattern: /\b(?:mi\s+(?:dni|cuil|cuit|pasaporte|direccion|cumpleanos|nacimiento|madre|padre|hermano|pareja|esposa|novia))\b/i, score: 0.95 },
            
            // Arquitectura Técnica, Sistemas, Tecnologías de Proyectos
            { pattern: /\b(?:usa|desarrolla(?:do)?|corre\s+en|backend\s+en|base\s+de\s+datos)\s+(?:unity|urp|postgresql|postgres|node(?:\.js)?|python|docker|kubernetes|sqlite|react|vue|c\+\+|c#|linux|windows)\b/i, score: 0.85 },
            { pattern: /\b(?:puerto\s+\d+|ip\s+\d+\.\d+|dns|servidor\s+dedicado|credenciales\s+de|api\s+key)\b/i, score: 0.90 },
            
            // Finanzas Críticas, Cuentas y Bancos
            { pattern: /\b(?:cuenta\s+(?:bancaria|corriente)|cbu|alias\s+bancario|banco\s+(?:galicia|santander|bbva|nacion|macro))\b/i, score: 0.90 },

            // Mandato Explícito del Usuario ("recordá siempre esto", "nunca te olvides")
            { pattern: /\b(?:recorda\s+siempre|nunca\s+(?:te\s+)?olvides|anota(?:te)?\s+esto|dato\s+clave|muy\s+importante)\b/i, score: 0.95 }
        ];

        // Patrones Episódicos (Importancia: 0.30 - 0.70 -> EPISÓDICA)
        this.episodicPatterns = [
            // Tareas, Turnos, Fechas Relativas y Exámenes
            { pattern: /\b(?:el\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|manana|pasado\s+manana)\s+(?:tengo|debo|hay|rindo|examen|final|parcial|turno|medico|taller)\b/i, score: 0.65 },
            { pattern: /\b(?:comprar|pedir|pagar|llamar|enviar|revisar|arreglar)\b/i, score: 0.50 },
            { pattern: /\b(?:error|bug|excepcion|falla|404|500|crash)\b/i, score: 0.55 },
            { pattern: /\b(?:capitulo|temporada|episodio|pelicula|libro|serie)\b/i, score: 0.40 }
        ];
    }

    /**
     * Evalúa la importancia numérica (0.0 a 1.0) de un texto de manera universal.
     */
    evaluateImportance(text, context = {}) {
        if (!text || typeof text !== 'string' || !text.trim()) return 0.0;
        const clean = text.trim();
        const norm = clean.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // 1. Detección de Ruido / Charlas Triviales
        for (const pattern of this.transientNoisePatterns) {
            if (pattern.test(clean) || pattern.test(norm)) {
                // Si contiene algo trivial pero además menciona una marca/dispositivo o un mandato explícito, no descartar ciegamente
                const hasExplicitOverride = /\b(?:recorda|anota|importante)\b/i.test(norm);
                if (!hasExplicitOverride) {
                    return 0.05;
                }
            }
        }

        // Si es una frase extremadamente corta sin contenido sustantivo (ej. "ok", "si", "no sé")
        if (clean.split(/\s+/).length <= 2 && !/\b\d+\b/.test(clean)) {
            return 0.10;
        }

        // 2. Comprobación de Patrones Permanentes / Core
        let maxPermanentScore = 0.0;
        for (const item of this.permanentPatterns) {
            if (item.pattern.test(clean) || item.pattern.test(norm)) {
                if (item.score > maxPermanentScore) {
                    maxPermanentScore = item.score;
                }
            }
        }
        if (maxPermanentScore > 0) {
            return maxPermanentScore;
        }

        // 3. Comprobación de Patrones Episódicos
        let maxEpisodicScore = 0.0;
        for (const item of this.episodicPatterns) {
            if (item.pattern.test(clean) || item.pattern.test(norm)) {
                if (item.score > maxEpisodicScore) {
                    maxEpisodicScore = item.score;
                }
            }
        }
        if (maxEpisodicScore > 0) {
            return maxEpisodicScore;
        }

        // 4. Heurística General: Datos numéricos, medidas o identificadores
        if (/\b\d+(?:[\.,]\d+)?\b/.test(clean)) {
            return 0.60; // Números o cantidades suelen tener relevancia media-alta
        }

        // 5. Default moderado para frases informativas neutras
        return 0.45;
    }

    /**
     * Realiza el triaje automático: PERMANENT, EPISODIC o DISCARD.
     */
    triageMemory(text, context = {}) {
        const importance = this.evaluateImportance(text, context);

        if (importance <= 0.25) {
            return {
                action: 'DISCARD',
                importance,
                ttlDays: 0,
                tier: 'DO_NOT_PERSIST',
                reason: 'Dato trivial, estado pasajero o charla de bajo valor informacional.'
            };
        }

        if (importance <= 0.70) {
            // Episódica: expira por defecto en 14 días (o 30 si supera 0.50)
            const ttlDays = importance > 0.50 ? 30 : 14;
            const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

            return {
                action: 'EPISODIC',
                importance,
                ttlDays,
                expiresAt,
                tier: 'NORMAL',
                reason: 'Dato de relevancia contextual de corto a mediano plazo.'
            };
        }

        // Permanente (Core Memory)
        return {
            action: 'PERMANENT',
            importance,
            ttlDays: null,
            expiresAt: null,
            tier: 'CORE',
            reason: 'Hecho crítico, regla técnica, identidad o configuración fija del usuario.'
        };
    }
}

const memoryImportanceService = new MemoryImportanceService();
module.exports = memoryImportanceService;
