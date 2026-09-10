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
        if (/^aprende\b/.test(clean) || /https?:\/\//i.test(text) || /^(?:descarga|descargar|descargame)\b/.test(clean)) return { match: false };

        // 0. Parada de Emergencia Inmediata
        if (/\b(?:deten(?:er)?\s+todo|par(?:ar)?\s+todo|abortar|emergencia|cancel(?:ar)?\s+todo|detente|parate|cancela|detene)\b/i.test(clean)) {
            return { match: true, action: 'emergency.stop', params: {} };
        }

        // Only explicit audio/display commands may change these devices.
        // Preserve TV calibration, but never infer a TV from 'hasta' or 'subile'.
        const isTv = /\b(?:tele|television|tv)\b/.test(clean);
        const isBrightness = /\b(?:brillo|iluminacion)\b/.test(clean);
        const isAudio = /\b(?:volumen|sonido|audio)\b/.test(clean) || (isTv && /\b(?:subile|bajale)\b/.test(clean));
        const up = /\b(?:subi(?:r|me|le)?|sube(?:me|le)?|aumenta(?:r|me|le)?)\b/.test(clean);
        const down = /\b(?:baja(?:r|me|le)?|disminui(?:r|me|le)?|reduce)\b/.test(clean);
        const number = clean.match(/\b(\d{1,3})(?:\s*%|\b)/);
        if (isTv && isAudio && number && /\b(?:calibra(?:r)?|sincroniza(?:r)?|actual|actualmente|esta en|quedo en|es)\b/.test(clean)) {
            return { match: true, action: 'tv.calibrate-volume', params: { level: Number(number[1]) } };
        }
        if (isAudio || isBrightness) {
            const prefix = isBrightness ? 'display' : isTv ? 'tv' : 'audio';
            const noun = isBrightness ? 'brightness' : 'volume';
            const absolute = /\b(?:a|al|en|hasta)\s+(?:el\s+)?\d/.test(clean) && !/\ben\s+\d/.test(clean);
            if ((up || down) && !absolute) {
                return { match: true, action: prefix + '.adjust-' + noun, params: { delta: (up ? 1 : -1) * (number ? Number(number[1]) : 10) } };
            }
            if (number) return { match: true, action: prefix + '.set-' + noun, params: { percent: Number(number[1]) } };
            if (/\b(?:cuanto|que|cual|nivel|estado)\b/.test(clean) || /^(?:volumen|brillo)(?: de la tele)?$/.test(clean)) {
                return { match: true, action: prefix + '.get-' + noun, params: {} };
            }
        }
        if (/^(?:(?:jarvis|por favor)\s+)?(?:mute|silencia(?:r|me)?|mutear|desmutear|pone en silencio|saca el silencio)(?:\s+(?:la tele|el audio|la pc|la computadora))?$/.test(clean)) {
            return { match: true, action: isTv ? 'tv.toggle-mute' : 'audio.toggle-mute', params: {} };
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

        // 8. Control de Ventanas y Pestañas
        // 8.1 Minimizar
        if (/\b(?:minimiza\s+todo|minimizar\s+todo|minimisa\s+todo|minimisar\s+todo|mini\s+misa\s+todo|achica\s+todo|achicar\s+todo|mostrar\s+escritorio|mostra\s+el\s+escritorio|ir\s+al\s+escritorio)\b/i.test(clean)) {
            return { match: true, action: 'window.minimize-all', params: {} };
        }
        if (/\b(?:minimiza(?:r|me|la|te)?|minimisa(?:r|me|la|te)?|mini\s+misa(?:r)?|achica(?:r|me|la|te)?|oculta(?:r|me|la)?)\b/i.test(clean)) {
            return { match: true, action: 'window.minimize', params: {} };
        }

        // 8.2 Maximizar
        if (/\b(?:maximiza(?:r|me|la|te)?|maximisa(?:r|me|la|te)?|maxi\s+misa(?:r)?|agranda(?:r|me|la|te)?|pantalla\s+completa|toda\s+la\s+pantalla)\b/i.test(clean)) {
            return { match: true, action: 'window.maximize', params: {} };
        }

        // 8.3 Pestañas (Navegador, VS Code, etc.)
        const WORD_TO_TAB = {
            '1': 1, 'uno': 1, 'una': 1, 'primer': 1, 'primero': 1, 'primera': 1,
            '2': 2, 'dos': 2, 'segundo': 2, 'segunda': 2,
            '3': 3, 'tres': 3, 'tercer': 3, 'tercero': 3, 'tercera': 3,
            '4': 4, 'cuatro': 4, 'cuarto': 4, 'cuarta': 4,
            '5': 5, 'cinco': 5, 'quinto': 5, 'quinta': 5,
            '6': 6, 'seis': 6, 'sexto': 6, 'sexta': 6,
            '7': 7, 'siete': 7, 'septimo': 7, 'septima': 7,
            '8': 8, 'ocho': 8, 'octavo': 8, 'octava': 8,
            '9': 9, 'nueve': 9, 'noveno': 9, 'novena': 9, 'ultimo': 9, 'ultima': 9
        };

        const tabNumMatch = clean.match(/(?:(?:and[aá]|ir|pas[aá]|cambi[aá]|pon[eé]|andate|movete|salt[aá]|abr[eé])\s+)?(?:a\s+)?(?:la\s+)?pesta[nñ]a\s*(?:n[uú]mero\s*)?(\d{1,2}|uno|una|primer[oa]?|dos|segund[oa]|tres|tercer[oa]?|cuatro|cuart[oa]|cinco|quint[oa]|seis|sext[oa]|siete|septim[oa]|ocho|octav[oa]|nueve|noven[oa]|ultim[oa])\b/i)
            || clean.match(/\b(?:a\s+la\s+)?pesta[nñ]a\s*(\d{1,2}|uno|una|primer[oa]?|dos|segund[oa]|tres|tercer[oa]?|cuatro|cuart[oa]|cinco|quint[oa]|seis|sext[oa]|siete|septim[oa]|ocho|octav[oa]|nueve|noven[oa]|ultim[oa])\b/i)
            || clean.match(/\b(primer[oa]|segund[oa]|tercer[oa]|cuart[oa]|quint[oa]|sext[oa]|septim[oa]|octav[oa]|noven[oa]|ultim[oa])\s+pesta[nñ]a\b/i);

        if (tabNumMatch && !/\b(?:siguiente|anterior|nueva|cerrar|cerra)\b/i.test(tabNumMatch[0])) {
            const rawVal = (tabNumMatch[1] || '').toLowerCase();
            const num = WORD_TO_TAB[rawVal] || parseInt(rawVal, 10);
            if (num >= 1 && num <= 9) {
                return { match: true, action: 'tab.go-to', params: { index: num } };
            }
        }

        if (/\b(?:siguiente\s+pesta[nñ]a|pesta[nñ]a\s+siguiente|cambia(?:r)?\s+de\s+pesta[nñ]a|otra\s+pesta[nñ]a|pasa\s+de\s+pesta[nñ]a|pr[oó]xima\s+pesta[nñ]a|siguiente\s+pagina|cambia(?:r)?\s+de\s+pagina)\b/i.test(clean)) {
            return { match: true, action: 'tab.next', params: {} };
        }
        if (/\b(?:pesta[nñ]a\s+anterior|anterior\s+pesta[nñ]a|volver\s+de\s+pesta[nñ]a|pagina\s+anterior)\b/i.test(clean)) {
            return { match: true, action: 'tab.prev', params: {} };
        }
        if (/\b(?:nueva\s+pesta[nñ]a|abrir\s+(?:una\s+)?nueva\s+pesta[nñ]a|abrir\s+pesta[nñ]a)\b/i.test(clean)) {
            return { match: true, action: 'tab.new', params: {} };
        }

        // 8.4 Cerrar Pestaña o Ventana
        if (/\b(?:cerrar\s+la\s+ventana|cerra\s+la\s+ventana|cerrar\s+ventana|cerra\s+ventana|cerrar\s+(?:el\s+)?programa|cerra\s+(?:el\s+)?programa|cerrar\s+(?:la\s+)?app|cerra\s+(?:la\s+)?app|cerrar\s+(?:la\s+)?aplicacion|cerra\s+(?:la\s+)?aplicacion)\b/i.test(clean)) {
            return { match: true, action: 'window.close', params: {} };
        }
        if (/\b(?:cerrar\s+(?:la\s+|esta\s+)?pesta[nñ]a|cerra\s+(?:la\s+|esta\s+)?pesta[nñ]a|cerra\s+pesta[nñ]a|cerrar\s+pagina|cerra\s+pagina|cerrar\s+esto|cerra\s+esto|cerra|cerralo|cerrala)\b/i.test(clean)) {
            return { match: true, action: 'tab.close', params: {} };
        }

        // 8.5 Cambiar de Ventana
        if (/\b(?:cambia(?:r)?\s+de\s+ventana|siguiente\s+ventana|otra\s+ventana|pasa\s+de\s+ventana)\b/i.test(clean)) {
            return { match: true, action: 'window.next', params: {} };
        }

        // 8.6 Envío Directo de Mensajes por WhatsApp
        const waDelimiterRegex = /\s+(?:que\s+(?:le\s+)?diga|que\s+digas|que\s+dice|diciendo(?:le)?|con\s+el\s+(?:texto|mensaje)|con\s+texto)\s+/i;
        const delimMatch = text.match(waDelimiterRegex);

        if (delimMatch) {
            const delimIndex = delimMatch.index;
            const beforeText = text.substring(0, delimIndex).trim();
            let messageText = text.substring(delimIndex + delimMatch[0].length).trim();
            messageText = messageText.replace(/^['"“]+|['"”]+$/g, '').trim();

            // Descartar repeticiones si el usuario se corrigió a mitad de frase
            const repeatMatch = messageText.match(/^(?:(?:un\s+)?mensaj[ea]\s+(?:a\s+|al\s+)?.+?\s+(?:que\s+diga|que\s+digas)\s+)([\s\S]+)$/i);
            if (repeatMatch) {
                messageText = repeatMatch[1].trim().replace(/^['"“]+|['"”]+$/g, '').trim();
            }

            // Extraer el contacto justo antes del delimitador
            const contactMatch = beforeText.match(/(?:^|\s)(?:a|al|para)\s+(?:el\s+contacto\s+|al\s+contacto\s+|contacto\s+|chat\s+de\s+|al\s+chat\s+de\s+|la\s+persona\s+)?['"“]?([a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s._-]+?)['"”]?$/i);
            if (contactMatch) {
                let contact = contactMatch[1].trim().replace(/^(?:el\s+contacto|contacto|chat\s+de|chat|al\s+contacto)\s+/i, '').trim();
                if (contact && messageText) {
                    return {
                        match: true,
                        action: 'whatsapp.send',
                        params: { contact, message: messageText }
                    };
                }
            }
        }

        // Fallback por patrones de regex directa
        const waMatch = clean.match(/^(?:.*?\b)?(?:mandale|mandame|mand[aá]|enviar(?:le)?|envi[aá](?:me|le)?|escribi(?:le)?|escr[ií]b[eé](?:le)?|un)\s+(?:un\s+)?mensaje\s+(?:por\s+whatsapp\s+)?(?:a|al|para)\s+(?:el\s+contacto\s+|contacto\s+)?([a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s._-]+?)\s+(?:que\s+diga|diciendo|con\s+el\s+texto|:|que\s+le\s+diga)\s+([\s\S]+)$/i)
            || clean.match(/^(?:.*?\b)?(?:mandale|mand[aá]|envi[aá](?:le)?|enviar(?:le)?|escribi(?:le)?|escr[ií]b[eé](?:le)?)\s+(?:un\s+)?(?:whatsapp|watsap|wasap)\s+(?:a|al|para)\s+(?:el\s+contacto\s+|contacto\s+)?([a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s._-]+?)\s+(?:que\s+diga|diciendo|con\s+el\s+texto|:|que\s+le\s+diga)\s+([\s\S]+)$/i)
            || clean.match(/^(?:.*?\b)?(?:mandale|mand[aá]|envi[aá](?:le)?|escribi(?:le)?|decile)\s+(?:a|al|para)\s+(?:el\s+contacto\s+|contacto\s+)?([a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s._-]+?)\s+(?:por\s+whatsapp\s+)?(?:un\s+mensaje\s+)?(?:que\s+diga|diciendo)\s+([\s\S]+)$/i)
            || clean.match(/^(?:.*?\b)?(?:un\s+)?mensaje\s+(?:a|al|para)\s+(?:el\s+contacto\s+|contacto\s+)?([a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s._-]+?)\s+(?:que\s+diga|diciendo)\s+([\s\S]+)$/i);

        if (waMatch) {
            let contact = waMatch[1].trim().replace(/^(?:el\s+contacto|contacto|chat\s+de|chat|al\s+contacto)\s+/i, '').trim();
            let message = waMatch[2].trim();
            if (contact && message) {
                return {
                    match: true,
                    action: 'whatsapp.send',
                    params: { contact, message }
                };
            }
        }

        // 9. Visión de Pantalla y Diagnóstico de Errores
        if (/\b(?:fijate\s+(?:qu[eé]\s+)?error\s+sali[oó]|qu[eé]\s+error\s+sali[oó]|qu[eé]\s+error\s+hay|qu[eé]\s+error\s+aparece|revisa\s+el\s+error|analiza\s+el\s+error|mir[aá]\s+(?:la\s+)?pantalla|qu[eé]\s+dice\s+(?:la\s+)?(?:pantalla|captura|screenshot|foto|imagen)|le[eé](?:me)?\s+(?:la\s+)?(?:pantalla|captura|screenshot|foto|imagen)|analiza\s+(?:la\s+)?(?:pantalla|captura|screenshot|foto|imagen)|qu[eé]\s+hay\s+en\s+(?:la\s+)?(?:pantalla|captura|screenshot|foto|imagen)|revisa\s+(?:la\s+)?(?:pantalla|captura|screenshot|foto|imagen)|qu[eé]\s+captura\s+(?:sacaste|tomaste)|qu[eé]\s+(?:se\s+)?ve\s+(?:en\s+la\s+|en\s+el\s+)?(?:pantalla|captura|screenshot)|fijate\s+qu[eé]\s+dice)\b/i.test(clean)) {
            return { match: true, action: 'vision.analyze-screen', params: { query: text } };
        }

        // 10. Modo descanso / Despertar (ignorar si el destino es un dispositivo externo como tele o luces)
        const isDevicePowerTarget = /\b(?:tele|television|tv|pantalla|monitor|pc|computadora|luz|luces|aire|ventilador|enchufe|switch|lampara)\b/i.test(clean);
        if (!isDevicePowerTarget) {
            // 10.1 Poner a Jarvis en descanso / Apagar escucha
            // Debe ser una orden concisa y no contener acciones operativas (abrir, carpeta, buscar, etc.)
            const words = clean.split(/\s+/).filter(Boolean);
            const hasActionIntent = /\b(?:abre|abra|abri|abrir|carpeta|busca|buscar|pone|pon|reproduce|reproducir|crea|crear|borra|borrar|escribe|escribir|jugar|juego|descarga|descargas|watsap|wasap|whatsapp)\b/i.test(clean);
            const isSleepCmd = /\b(?:apaga(?:te)?|dormite|duermete|a\s+dormir|a\s+descansar|modo\s+descanso|modo\s+reposo|entra\s+en\s+(?:modo\s+)?descanso|entra\s+en\s+(?:modo\s+)?reposo|ponete\s+en\s+(?:modo\s+)?descanso|ponete\s+en\s+(?:modo\s+)?reposo|silencia(?:te)?|desactiva(?:te)?)\b/i.test(clean);
            const isNegatedSleep = /\bno\s+(?:te\s+)?apagu/i.test(clean);
            if (!hasActionIntent && words.length <= 5 && ((isSleepCmd && !isNegatedSleep)
                || /^(?:buenas\s+noches(?:\s+jarvis)?|hasta\s+luego(?:\s+jarvis)?|chau\s+jarvis|adios\s+jarvis)$/i.test(clean))) {
                return { match: true, action: 'voice.sleep', params: {} };
            }

            // 10.2 Despertar a Jarvis / Prender escucha
            if (/\b(?:prende(?:te)?|encende(?:te)?|desperta(?:te)?|despierta|despiertate|reactiva(?:te)?|activa(?:te)?|arriba|levantate)\b/i.test(clean)
                || /^(?:hola\s+jarvis|buen\s+dia\s+jarvis|buenas\s+jarvis|hey\s+jarvis|che\s+jarvis|ok\s+jarvis|jarvis)$/i.test(clean)) {
                return { match: true, action: 'voice.wake', params: {} };
            }
        }

        // 11. Automatizaciones reactivas y por condiciones (Ítem 27)
        // 11.1 Listar reglas
        if (/\b(?:listar|ver|cuales\s+son|mostra(?:r)?)\s+(?:las\s+)?(?:automatizaciones|reglas\s+de\s+automatizacion|reglas\s+activas)\b/i.test(clean)
            || clean === 'automatizaciones' || clean === 'reglas activas') {
            return { match: true, action: 'automation.list-rules', params: {} };
        }

        // 11.2 "cuando termine la descarga avisame / avisa"
        const downloadAlertMatch = clean.match(/\bcuando\s+termine\s+(?:la|una)\s+descarga\s*(?:de\s+([^,]+?))?\s*(?:,|->)?\s*(?:avisame|notificame|decime|avisa)\b/i);
        if (downloadAlertMatch) {
            const targetFile = downloadAlertMatch[1]?.trim();
            const filters = targetFile ? { filename: { contains: targetFile } } : {};
            return {
                match: true,
                action: 'automation.create-rule',
                params: {
                    rule: {
                        name: targetFile ? `Aviso descarga: ${targetFile}` : 'Aviso descarga completada',
                        trigger: { event: 'DOWNLOAD_COMPLETED', once: true, filters },
                        actions: [
                            { type: 'tts', message: 'Se completó la descarga de {{filename}}.' },
                            { type: 'notification', title: 'Descarga Lista', message: '{{filename}} está listo en tu carpeta.' }
                        ]
                    }
                }
            };
        }

        // 11.3 "cuando termine la descarga apagar pc"
        if (/\bcuando\s+termine\s+(?:la|una)\s+descarga\s*(?:,|->)?\s*(?:apaga(?:r)?\s+(?:la\s+pc|la\s+computadora|el\s+equipo))\b/i.test(clean)) {
            return {
                match: true,
                action: 'automation.create-rule',
                params: {
                    rule: {
                        name: 'Apagar PC tras descarga',
                        trigger: { event: 'DOWNLOAD_COMPLETED', once: true },
                        actions: [
                            { type: 'tts', message: 'Descarga terminada. Procediendo a apagar el equipo.' },
                            { type: 'action', action: 'power.shutdown', params: {} }
                        ]
                    }
                }
            };
        }

        // 11.4 "cuando cierre <app> apagar pc / cambiar de modo"
        const closeProcMatch = clean.match(/\bcuando\s+cierre\s+([a-zA-Z0-9\s._-]+?)\s*(?:,|->)?\s*(?:apaga(?:r)?\s+(?:la\s+pc|la\s+computadora)|cambia(?:r)?\s+(?:a\s+|de\s+)?modo\s+([a-zA-Z0-9\s]+))\b/i);
        if (closeProcMatch) {
            const procName = closeProcMatch[1].trim();
            const targetMode = closeProcMatch[2]?.trim();
            const actions = targetMode
                ? [{ type: 'routine', name: targetMode }]
                : [
                    { type: 'tts', message: `Se cerró ${procName}. Apagando la computadora.` },
                    { type: 'action', action: 'power.shutdown', params: {} }
                ];

            return {
                match: true,
                action: 'automation.create-rule',
                params: {
                    rule: {
                        name: `Al cerrar ${procName}: ${targetMode ? `Cambiar a ${targetMode}` : 'Apagar PC'}`,
                        trigger: {
                            event: 'PROCESS_TERMINATED',
                            filters: { processName: { contains: procName } },
                            once: true
                        },
                        actions
                    }
                }
            };
        }

        // 12. Tareas persistentes y recuperación (Ítem 28)
        if (/\b(?:recupera(?:r)?|continuar|reanudar)\s+(?:las\s+)?(?:tareas\s+pendientes|tareas\s+interrumpidas|tareas\s+anteriores|la\s+sesion)\b/i.test(clean)
            || clean === 'recuperar tareas' || clean === 'recuperar tareas pendientes') {
            return { match: true, action: 'task.recover', params: {} };
        }
        if (/\b(?:historial|registro)\s+de\s+tareas\b/i.test(clean)) {
            return { match: true, action: 'task.history', params: {} };
        }
        if (/\b(?:reintentar|repetir)\s+(?:la\s+)?(?:tarea|descarga)\b/i.test(clean)) {
            return { match: true, action: 'task.retry', params: {} };
        }

        // 13. Domótica y Home Assistant (Ítem 29)
        // 13.1 Consulta de temperatura
        if (/\b(?:cuanta|que|cual\s+es\s+la|como\s+esta\s+la)\s+temperatura\b/i.test(clean) || clean === 'temperatura' || clean === 'temperatura living') {
            return { match: true, action: 'ha.command', params: { text: clean } };
        }

        // 13.2 Control de Aire Acondicionado
        if (/\b(?:el\s+)?aire\b/i.test(clean) && !/\b(?:tele|pantalla|audio)\b/i.test(clean)) {
            if (/\b(?:pon|pone|coloca|cambia|sete(?:a|ar)|ajusta|prende|apaga|encende|desactiva|temperatura)\b/i.test(clean)) {
                return { match: true, action: 'ha.command', params: { text: clean } };
            }
        }

        // 13.3 Luces y Lámparas
        if (/\b(?:luz|luces|lampara|lamparas)\b/i.test(clean)) {
            if (/\b(?:prende|encende|apaga|apagar|apagarme|activa|desactiva|alterna|toggle)\b/i.test(clean)) {
                return { match: true, action: 'ha.command', params: { text: clean } };
            }
        }

        // 13.4 Enchufes y Ventiladores
        if (/\b(?:enchufe|ventilador)\b/i.test(clean)) {
            if (/\b(?:prende|encende|apaga|apagar|activa|desactiva)\b/i.test(clean)) {
                return { match: true, action: 'ha.command', params: { text: clean } };
            }
        }

        // 13.5 Listar dispositivos domóticos
        if (/\b(?:dispositivos\s+(?:inteligentes|domoticos)|listar\s+luces|dispositivos\s+de\s+casa)\b/i.test(clean)) {
            return { match: true, action: 'ha.list-devices', params: {} };
        }

        return { match: false };
    }
}

const fastCommandParser = new FastCommandParser();
module.exports = fastCommandParser;
