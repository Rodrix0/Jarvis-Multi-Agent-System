function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[¿?¡!.,;:]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

class FastCommandParser {
    parse(text) {
        const clean = normalize(text);

        // 1. Volumen (con porcentaje o número explícito)
        const volMatch = clean.match(/(?:volumen|sonido|audio)\s+(?:a|al)?\s*(\d{1,3})(?:%| por ciento)?/i)
            || clean.match(/(?:pon|pone|subi|subir|baja|bajar|ajusta|cambia|coloca|sete(?:a|ar)).*(?:volumen|sonido|audio).*(?:a|al)?\s*(\d{1,3})/i);
        if (volMatch) {
            return { match: true, action: 'audio.set-volume', params: { percent: parseInt(volMatch[1], 10) } };
        }
        if (/\b(?:mute|silenci(?:a|ar|ate)|mutear|desmutear|pon(?:e)? en silencio|sac(?:a)? el silencio)\b/i.test(clean)) {
            return { match: true, action: 'audio.toggle-mute', params: {} };
        }

        // 2. Brillo
        const brightMatch = clean.match(/(?:brillo|iluminacion)\s+(?:a|al)?\s*(\d{1,3})(?:%| por ciento)?/i)
            || clean.match(/(?:pon|pone|subi|subir|baja|bajar|ajusta|cambia).*(?:brillo|iluminacion).*(?:a|al)?\s*(\d{1,3})/i);
        if (brightMatch) {
            return { match: true, action: 'display.set-brightness', params: { percent: parseInt(brightMatch[1], 10) } };
        }

        // 3. Captura de pantalla
        if (/\b(?:captura|screenshot|sacar captura|saca captura|pantallazo|foto a la pantalla)\b/i.test(clean)) {
            return { match: true, action: 'display.screenshot', params: {} };
        }

        // 4. Batería (Evaluamos antes de recursos generales)
        if (/\b(?:bateria|carga|cuanta bateria|estado de la bateria|pila|nivel de bateria)\b/i.test(clean)) {
            return { match: true, action: 'system.get-battery', params: {} };
        }

        // 5. Apps consumidoras de recursos y memoria RAM
        if (/\b(?:recursos|consumiendo|consumo|consume|gastando|usando).*(?:ram|memoria|procesador|cpu)\b/i.test(clean)
            || /\b(?:que|quien|cuales).*(?:consume|gasta|usa).*(?:ram|memoria|procesos)\b/i.test(clean)
            || /\b(?:top procesos|administrador de tareas|estado de ram)\b/i.test(clean)) {
            return { match: true, action: 'system.get-top-consumers', params: {} };
        }

        // 6. Portapapeles
        if (/\b(?:portapapeles|clipboard|que copie|que tengo copiado|leer portapapeles)\b/i.test(clean)) {
            return { match: true, action: 'clipboard.read', params: {} };
        }

        // 7. Espacio en disco / Almacenamiento
        if (/\b(?:espacio en disco|cuanto espacio tengo|disco libre|almacenamiento|espacio libre|gigas libres)\b/i.test(clean)) {
            return { match: true, action: 'system.get-disk-space', params: {} };
        }

        // 8. Modo descanso / Despertar
        if (/^(?:apagate|dormite|modo descanso|entra en modo descanso)$/i.test(clean)) {
            return { match: true, action: 'voice.sleep', params: {} };
        }
        if (/^(?:prendete|despertate|reactivate|hola jarvis)$/i.test(clean)) {
            return { match: true, action: 'voice.wake', params: {} };
        }

        return { match: false };
    }
}

const fastCommandParser = new FastCommandParser();
module.exports = fastCommandParser;
