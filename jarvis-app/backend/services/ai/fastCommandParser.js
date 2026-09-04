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

        // 0. Parada de Emergencia Inmediata
        if (/\b(?:deten(?:er)?\s+todo|par(?:ar)?\s+todo|abortar|emergencia|cancel(?:ar)?\s+todo|detente|parate|cancela|detene)\b/i.test(clean)) {
            return { match: true, action: 'emergency.stop', params: {} };
        }

        // 1. Volumen de TV (Smart TV Wi-Fi)
        const isTvAudio = /\b(?:tele|television|tv)\b/i.test(clean);
        if (isTvAudio) {
            const tvVolMatch = clean.match(/(?:volumen|sonido|audio)\s*(?:a|al|en)?\s*(\d{1,3})\s*(?:%|por ciento)?/i)
                || clean.match(/(?:volumen|sonido|audio).*?\b(\d{1,3})\s*(?:%|por ciento)?\b/i)
                || clean.match(/(?:pon|pone|subi|subir|baja|bajar|ajusta|cambia|coloca|sete(?:a|ar)).*?\b(\d{1,3})\s*(?:%|por ciento)?\b/i);
            if (tvVolMatch) {
                return { match: true, action: 'tv.set-volume', params: { percent: parseInt(tvVolMatch[1], 10) } };
            }
            if (/\b(?:mute|silenci(?:a|ar|ate)|mutear|desmutear|pon(?:e)? en silencio|sac(?:a)? el silencio)\b/i.test(clean)) {
                return { match: true, action: 'tv.toggle-mute', params: {} };
            }
            if (/\b(?:que|cuanto|cuanta|a que|nivel de|estado del?)\s+(?:volumen|sonido|audio)\b/i.test(clean) || clean === 'volumen de la tele' || clean === 'volumen tele') {
                return { match: true, action: 'tv.get-volume', params: {} };
            }
        }

        // 1.1 Volumen de Windows (Notebook / PC)
        const volMatch = clean.match(/(?:volumen|sonido|audio)\s*(?:a|al|en)?\s*(\d{1,3})\s*(?:%|por ciento)?/i)
            || clean.match(/(?:volumen|sonido|audio).*?\b(\d{1,3})\s*(?:%|por ciento)?\b/i)
            || clean.match(/(?:pon|pone|subi|subir|baja|bajar|ajusta|cambia|coloca|sete(?:a|ar)).*?\b(\d{1,3})\s*(?:%|por ciento)?\b/i);
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

        // 3. Captura de pantalla (Solo para creación, nunca para borrado o eliminación)
        if (!/\b(?:borr|elimin|sacar\s+(?:la\s+|esta\s+|las\s+)?(?:ultima\s+|última\s+)?(?:captura|foto|imagen)|sacame\s+(?:la\s+|esta\s+)?(?:captura|foto)|quit|mand.*papelera|recuper|restaur)/i.test(clean)) {
            if (/\b(?:captura\s+de\s+pantalla|hac(?:e|er|eme)?\s+(?:una\s+)?captura|tom(?:a|ar|ame)?\s+(?:una\s+)?captura|sac(?:a|ar|ame)\s+una\s+captura|screenshot|pantallazo|foto\s+(?:a|de)\s+la\s+pantalla)\b/i.test(clean)
                || clean === 'captura' || clean === 'screenshot' || clean === 'pantallazo') {
                return { match: true, action: 'display.screenshot', params: {} };
            }
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
