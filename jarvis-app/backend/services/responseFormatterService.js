/**
 * Response Formatter Service for Jarvis (Ítem 24)
 * Separa y desdobla las respuestas en dos canales especializados:
 *  1. Canal Pantalla (Screen): Formato enriquecido completo con Markdown, código, tablas, listas y enlaces.
 *  2. Canal Voz (Voice): Síntesis hablada ultra-concisa, fluida, natural, libre de Markdown/código/URLs,
 *     señalizando visualmente el detalle cuando corresponde.
 */

// Límite de palabras para considerar una respuesta "extensa" para voz
const VOICE_MAX_WORDS = 40;

// Patrones de interrogaciones para preservar preguntas en el canal de voz
const QUESTION_REGEX = /(?:¿[^?]+?\?|\b(?:qu[eé]\s+(?:quer[eé]s|hacemos|decid[ií]s|prefer[ií]s)|confirm[aá]s|dese[aá]s)\b[^.!?]*\??)/i;

/**
 * Convierte números cardinales simples a texto en español para una pronunciación natural en TTS.
 */
function numberToSpanishWord(numStr) {
    const map = {
        '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro',
        '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve',
        '10': 'diez', '11': 'once', '12': 'doce', '13': 'trece', '14': 'catorce',
        '15': 'quince', '16': 'dieciséis', '17': 'diecisiete', '18': 'dieciocho',
        '19': 'diecinueve', '20': 'veinte'
    };
    return map[numStr] || numStr;
}

class ResponseFormatterService {
    constructor(options = {}) {
        this.maxVoiceWords = options.maxVoiceWords || VOICE_MAX_WORDS;
    }

    /**
     * Limpia texto eliminando Markdown y caracteres técnicos para que el TTS suene natural.
     * @param {string} text
     * @returns {string}
     */
    sanitizeForTts(text) {
        if (!text) return '';
        let clean = String(text)
            // Remover bloques de código
            .replace(/```[\s\S]*?```/g, ' ')
            // Remover código inline
            .replace(/`([^`]+)`/g, '$1')
            // Remover tablas Markdown completas
            .replace(/\|[^\n\r]+\|/g, ' ')
            .replace(/[-:]{2,}\|[-:]{2,}/g, ' ')
            // Remover encabezados Markdown (# Titulo)
            .replace(/^#{1,6}\s+/gm, '')
            // Remover viñetas (*, -, +) al inicio de línea
            .replace(/^[\s]*[-*+]\s+/gm, '')
            // Remover numeración de listas al inicio de línea (1. Item)
            .replace(/^[\s]*\d+\.\s+/gm, '')
            // Remover negrita y cursiva
            .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
            // Remover enlaces Markdown [texto](url) -> texto
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            // Remover URLs directas https://... -> "el enlace"
            .replace(/https?:\/\/\S+/gi, 'el enlace')
            // Remover rutas de archivo largas de Windows (ej: C:\Users\...)
            .replace(/[a-zA-Z]:\\[^ \n\r\t]+(?:\\[^ \n\r\t]+)*/g, 'tu archivo')
            // Expandir porcentajes (50% -> 50 por ciento)
            .replace(/(\d+)\s*%/g, '$1 por ciento')
            // Expandir signos monetarios comunes ($100 -> 100 pesos)
            .replace(/\$\s*(\d+(?:[.,]\d+)?)/g, '$1 pesos')
            // Remover caracteres especiales o emojis técnicos
            .replace(/[•●■◆▶►✓✔❌🚨🛡️🎙️⭐]/g, ' ')
            // Limpiar espacios múltiples y saltos de línea excesivos
            .replace(/\s+/g, ' ')
            .trim();

        return clean;
    }

    /**
     * Formatea el contenido para el Canal Pantalla (HUD / UI).
     * Preserva la riqueza de Markdown, tablas, enlaces y código.
     * @param {string|object} rawContent
     * @param {object} context
     * @returns {string}
     */
    formatForScreen(rawContent, context = {}) {
        if (!rawContent) return '';
        if (typeof rawContent === 'object') {
            if (rawContent.screen) return String(rawContent.screen);
            if (rawContent.message) return String(rawContent.message);
            if (rawContent.text) return String(rawContent.text);
            return JSON.stringify(rawContent, null, 2);
        }
        return String(rawContent).trim();
    }

    /**
     * Formatea el contenido para el Canal Voz (TTS).
     * Produce un resumen conciso, sin código ni tablas, conservando preguntas.
     * @param {string|object} rawContent
     * @param {object} context
     * @returns {string}
     */
    formatForVoice(rawContent, context = {}) {
        if (!rawContent) return '';

        // Si ya viene predefinido un texto específico de voz en el objeto
        if (typeof rawContent === 'object' && rawContent.voice) {
            return this.sanitizeForTts(rawContent.voice);
        }

        const rawText = typeof rawContent === 'object'
            ? (rawContent.message || rawContent.text || '')
            : String(rawContent);

        const trimmed = rawText.trim();
        if (!trimmed) return '';

        // Extraer si hay alguna pregunta de seguimiento formulada al usuario
        let extractedQuestion = '';
        const questionMatch = trimmed.match(QUESTION_REGEX);
        if (questionMatch) {
            extractedQuestion = this.sanitizeForTts(questionMatch[0]);
        }

        // 1. Caso: Contiene bloques de código grandes (```)
        const hasCodeBlock = /```[\s\S]*?```/.test(trimmed);
        if (hasCodeBlock) {
            const beforeCode = trimmed.split('```')[0].trim();
            const cleanIntro = this.sanitizeForTts(beforeCode);
            let voiceMsg = cleanIntro && cleanIntro.length < 80
                ? `${cleanIntro}. Generé el código y te lo dejé en pantalla.`
                : 'Generé el código correspondiente y te lo dejé en pantalla.';
            if (extractedQuestion && !voiceMsg.includes(extractedQuestion)) {
                voiceMsg += ` ${extractedQuestion}`;
            }
            return voiceMsg.trim();
        }

        // 2. Caso: Contiene tablas Markdown (| col1 | col2 |)
        const hasTable = /\|[^\n\r]+\|[\r\n]+\|[-: ]+\|/.test(trimmed);
        if (hasTable) {
            const beforeTable = trimmed.split(/\|/)[0].trim();
            const cleanIntro = this.sanitizeForTts(beforeTable);
            let voiceMsg = cleanIntro && cleanIntro.length < 80
                ? `${cleanIntro}. Organicé los datos en una tabla que podés ver en pantalla.`
                : 'Organicé los datos en una tabla comparativa en tu pantalla.';
            if (extractedQuestion && !voiceMsg.includes(extractedQuestion)) {
                voiceMsg += ` ${extractedQuestion}`;
            }
            return voiceMsg.trim();
        }

        // 3. Caso: Búsqueda o lista con múltiples resultados numerados o con viñetas
        // Ej: "Encontré 8 resultados:\n1. ... \n2. ..."
        const listMatch = trimmed.match(/(?:encontr[eé]|hall[eé]|hay|veo)\s+(\d+)\s+(?:resultados?|opciones?|archivos?|elementos?)/i);
        const countMatch = listMatch ? listMatch[1] : null;
        const lineCount = trimmed.split(/\r?\n/).filter(l => /^\s*(?:\d+\.|[-*+])\s+/.test(l)).length;

        if (countMatch || lineCount >= 3) {
            const countWord = countMatch ? numberToSpanishWord(countMatch) : (lineCount > 0 ? numberToSpanishWord(String(lineCount)) : '');
            let voiceMsg = countWord
                ? `Encontré ${countWord} resultados. Los principales coinciden con tu búsqueda. Te los dejé en pantalla.`
                : 'Encontré varios resultados y te los dejé listados en pantalla.';
            if (extractedQuestion && !voiceMsg.includes(extractedQuestion)) {
                voiceMsg += ` ${extractedQuestion}`;
            }
            return voiceMsg.trim();
        }

        // 4. Caso: Respuesta corta y directa (< VOICE_MAX_WORDS)
        const words = trimmed.split(/\s+/).filter(Boolean);
        if (words.length <= this.maxVoiceWords) {
            return this.sanitizeForTts(trimmed);
        }

        // 5. Caso: Texto extenso (> VOICE_MAX_WORDS palabras)
        // Extraer las dos primeras oraciones clave y resumir el resto
        const sentences = trimmed
            .replace(/```[\s\S]*?```/g, '')
            .split(/(?<=[.!?])\s+/)
            .map(s => this.sanitizeForTts(s))
            .filter(s => s.length > 5);

        let conciseVoice = '';
        if (sentences.length > 0) {
            const firstWords = sentences[0].split(/\s+/).filter(Boolean);
            if (firstWords.length > (this.maxVoiceWords - 8)) {
                conciseVoice = firstWords.slice(0, this.maxVoiceWords - 8).join(' ');
            } else {
                conciseVoice = sentences[0];
                if (sentences.length > 1 && (conciseVoice.split(/\s+/).length + sentences[1].split(/\s+/).length) <= (this.maxVoiceWords - 8)) {
                    conciseVoice += ` ${sentences[1]}`;
                }
            }
        } else {
            conciseVoice = this.sanitizeForTts(trimmed.substring(0, 180));
        }

        // Asegurar que termine en punto y añadir aviso de pantalla si es relevante
        conciseVoice = conciseVoice.trim();
        if (!conciseVoice.endsWith('.')) conciseVoice += '.';
        conciseVoice += ' Te dejé el detalle completo en pantalla.';

        if (extractedQuestion && !conciseVoice.includes(extractedQuestion)) {
            conciseVoice += ` ${extractedQuestion}`;
        }

        return conciseVoice.trim();
    }

    /**
     * Método principal que produce el payload desdoblado para Pantalla y Voz.
     * @param {string|object} rawResponse
     * @param {object} context
     * @returns {object} { screen, voice, isTruncatedForVoice, stats }
     */
    format(rawResponse, context = {}) {
        const screen = this.formatForScreen(rawResponse, context);
        const voice = this.formatForVoice(rawResponse, context);

        const screenWords = screen.split(/\s+/).filter(Boolean).length;
        const voiceWords = voice.split(/\s+/).filter(Boolean).length;
        const isTruncatedForVoice = voiceWords < screenWords && screenWords > this.maxVoiceWords;

        return {
            screen,
            voice,
            isTruncatedForVoice,
            stats: {
                screenWords,
                voiceWords,
                wordSavings: Math.max(0, screenWords - voiceWords)
            }
        };
    }
}

const responseFormatterService = new ResponseFormatterService();
module.exports = responseFormatterService;
module.exports.ResponseFormatterService = ResponseFormatterService;
