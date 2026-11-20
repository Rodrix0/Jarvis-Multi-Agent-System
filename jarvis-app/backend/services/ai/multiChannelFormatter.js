/**
 * Multi-Channel Response Formatter for JARVIS 3.0 (Sección 35, 99)
 * Adapta de forma determinista la salida generada para cada canal:
 *   - Voice (TTS): Alocución concisa, sin markdown, sin tablas, amigable (< 25 palabras).
 *   - Screen / UI: Respuesta enriquecida con Markdown, badges, listas y visualizaciones.
 *   - Log / Audit: Registro estructurado con metadatos técnicos y traceId.
 */

class MultiChannelFormatter {
    /**
     * Limpia y optimiza texto para sintetizador de voz (TTS).
     */
    formatForVoice(text) {
        if (!text) return '';
        let clean = String(text).trim();

        // 1. Remover bloques de código markdown
        clean = clean.replace(/```[\s\S]*?```/g, 'Código generado en pantalla.');

        // 2. Remover formato markdown en línea
        clean = clean.replace(/`([^`]+)`/g, '$1');
        clean = clean.replace(/\*\*([^*]+)\*\*/g, '$1');
        clean = clean.replace(/\*([^*]+)\*/g, '$1');
        clean = clean.replace(/__([^_]+)__/g, '$1');

        // 3. Remover enlaces markdown [texto](url)
        clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

        // 4. Remover viñetas y encabezados markdown
        clean = clean.replace(/^\s*#+\s+/gm, '');
        clean = clean.replace(/^\s*[-*•]\s+/gm, '');

        // 5. Remover URLs directas
        clean = clean.replace(/https?:\/\/\S+/gi, 'en el enlace correspondiente');

        // 6. Normalizar espacios repetidos
        clean = clean.replace(/\s+/g, ' ').trim();

        // 7. Si es excesivamente largo, sintetizar de manera concisa
        if (clean.length > 220) {
            const firstSentence = clean.split(/[.!?]\s+/)[0];
            if (firstSentence && firstSentence.length > 20) {
                return `${firstSentence}. Los detalles adicionales están en pantalla, señor.`;
            }
            return `${clean.slice(0, 180)}... Listo en pantalla, señor.`;
        }

        return clean;
    }

    /**
     * Formatea respuesta para interfaz de usuario / HUD.
     */
    formatForScreen(text, metadata = {}) {
        return {
            content: text,
            metadata,
            renderMode: metadata.renderMode || 'markdown',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Formatea respuesta para registro de auditoría o log.
     */
    formatForAudit(text, metadata = {}) {
        return {
            traceId: metadata.traceId || `trace-${Date.now()}`,
            correlationId: metadata.correlationId || null,
            text,
            characterCount: text ? text.length : 0,
            channel: metadata.channel || 'voice_v2',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Entrega el paquete multicanal unificado.
     */
    formatAll(rawText, metadata = {}) {
        return {
            voice: this.formatForVoice(rawText),
            screen: this.formatForScreen(rawText, metadata),
            audit: this.formatForAudit(rawText, metadata)
        };
    }
}

const multiChannelFormatter = new MultiChannelFormatter();
module.exports = multiChannelFormatter;
