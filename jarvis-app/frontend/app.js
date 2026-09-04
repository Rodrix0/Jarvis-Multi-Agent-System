// --- DOM Elements ---
const userBox = document.getElementById('user-transcript');
const jarvisBox = document.getElementById('jarvis-response');
const btnToggleMic = document.getElementById('btn-toggle-mic');
const modesList = document.getElementById('modes-list');
const capabilitiesList = document.getElementById('capabilities-list');
const capabilitySearch = document.getElementById('capability-search');
let capabilities = [];
const tvModal = document.getElementById('tv-modal');
const tvStatus = document.getElementById('tv-status');
const tvOperationMessage = document.getElementById('tv-operation-message');

// Modal Elements
const modeModal = document.getElementById('mode-modal');
const btnOpenModeModal = document.getElementById('btn-open-mode-modal');
const btnCloseModal = document.getElementById('close-modal');
const modeForm = document.getElementById('mode-form');

// Inpainting Global State
let currentInpaintingMaskBase64 = null;

// --- Socket.io Setup ---
const socket = io(); 

// =================================================================
// SISTEMA DE VOZ MANOS LIBRES (Web Speech API - Chrome)
// =================================================================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
let isSystemActive = false;  // true = motor de reconocimiento encendido
let isDormant = true;        // true = mic abierto pero solo escucha la frase de activación
let isJarvisSpeaking = false;
let isAwaitingFollowUp = false;
let followUpTimer = null;
let lastSpokenWords = [];  // Palabras que Jarvis dijo recientemente (anti-eco inteligente)
let lastSpokenTimestamp = 0;
let speechRunId = 0;
let recognitionRestartTimer = null;
let voiceSettings = null;
let voiceMonitorStream = null;
let voiceAudioContext = null;
let voiceAnalyser = null;
let voiceMeterTimer = null;
let currentAudioLevel = 0;
let pendingVoiceTranscript = null;
let localVoiceOnline = false;
let actionToastTimer = null;

function stopAllSpeech({ restartBrowserRecognition = false } = {}) {
    speechRunId++;
    fetch('/api/tts/stop', { method: 'POST' }).catch(() => {});
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.resume();
    isJarvisSpeaking = false;
    document.getElementById('btn-stop-audio')?.style.setProperty('display', 'none');
    if (isSystemActive) setRingState('idle');
    if (restartBrowserRecognition && recognition && isSystemActive && !localVoiceOnline) {
        setTimeout(() => { try { recognition.start(); } catch(error) {} }, 200);
    }
}

// --- PARADA DE EMERGENCIA MULTI-ACCESO (Ctrl+Alt+J y HUD) ---
function triggerEmergencyStop(source = 'KEYBOARD_SHORTCUT') {
    stopAllSpeech();
    showActionToast('🚨 PARADA DE EMERGENCIA EJECUTADA (Deteniendo todo)', 'failed', 4000);
    fetch('/api/emergency-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source })
    })
    .then(r => r.json())
    .then(data => {
        console.log('[Emergency] Señal confirmada con latencia:', data.cancelSignalLatencyMs, 'ms');
    })
    .catch(err => console.error('[Emergency] Error enviando señal:', err));
}

document.addEventListener('DOMContentLoaded', () => {
    const btnEmerg = document.getElementById('btn-emergency-stop');
    if (btnEmerg) {
        btnEmerg.addEventListener('click', () => triggerEmergencyStop('HUD_BUTTON'));
    }
});

window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey && e.altKey && (e.key === 'j' || e.key === 'J')) || (e.ctrlKey && (e.key === 'j' || e.key === 'J'))) {
        e.preventDefault();
        triggerEmergencyStop('HOTKEY_CTRL_ALT_J');
    }
});

socket.on('jarvis_event', (ev) => {
    console.log('[Jarvis Event]:', ev.eventName, ev);
});

socket.on('notification', (data) => {
    showActionToast(`[${data.title}] ${data.message}`, data.priority === 'EMERGENCY' ? 'failed' : 'success', 5000);
});

function showActionToast(message, phase = 'working', duration = 4500) {
    let toast = document.getElementById('jarvis-action-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'jarvis-action-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }
    clearTimeout(actionToastTimer);
    toast.className = `jarvis-action-toast ${phase} visible`;
    toast.textContent = message;
    if (duration > 0) {
        actionToastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
    }
}

// Activa el modo "esperando respuesta" por N segundos
function setAwaitingFollowUp(seconds = 30) {
    isAwaitingFollowUp = true;
    console.log(`[Jarvis] 🟡 Modo espera de respuesta activo por ${seconds}s`);
    clearTimeout(followUpTimer);
    followUpTimer = setTimeout(() => {
        isAwaitingFollowUp = false;
        console.log("[Jarvis] 🟢 Tiempo de espera agotado, volviendo a filtro normal");
    }, seconds * 1000);
}

function clearAwaitingFollowUp() {
    isAwaitingFollowUp = false;
    clearTimeout(followUpTimer);
}


// Frases que Jarvis mismo dice y que el micrófono puede captar por error (anti-eco)
const ECHO_FILTER_PHRASES = [
    "iniciando", "procesando", "analizando",
    "abriendo", "ejecutando", "buscando en",
    "entendido", "de acuerdo", "por supuesto",
    "a sus órdenes", "jarvis responde"
];

// Normalizar texto: quitar acentos y pasar a minúsculas para comparaciones robustas
function normalizeText(text) {
    return text.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Elimina diacríticos (á→a, é→e, etc.)
        .replace(/[.,!?;:¡¿]/g, '');     // Elimina puntuación
}

function isEcho(text) {
    const lower = text.toLowerCase();
    
    // 1. Filtro clásico: frases que Jarvis suele decir
    if (ECHO_FILTER_PHRASES.some(phrase => lower.startsWith(phrase))) return true;
    
    // 2. Filtro inteligente: comparar con lo que Jarvis acaba de decir
    //    Si hace menos de 4 segundos que habló, cualquier fragmento reconocido
    //    que se parezca a lo que dijo es eco.
    if (lastSpokenWords.length > 0 && (Date.now() - lastSpokenTimestamp) < 4000) {
        const inputWords = normalizeText(text).split(/\s+/).filter(w => w.length > 2);
        if (inputWords.length === 0) return true;
        
        const spokenNorm = lastSpokenWords.map(w => normalizeText(w));
        const matchCount = inputWords.filter(w => spokenNorm.some(sw => sw.includes(w) || w.includes(sw))).length;
        const matchRatio = matchCount / inputWords.length;
        
        // Si más del 50% de las palabras reconocidas coinciden con lo que Jarvis dijo, es eco
        if (matchRatio >= 0.5) return true;
    }
    
    return false;
}

function sendCommandToJarvis(transcript, voiceMeta = {}) {
    console.log("[Jarvis] → Enviando:", transcript);
    userBox.textContent = `"${transcript}"`;
    jarvisBox.textContent = "Analizando...";
    showActionToast(`Entendí: “${transcript}”. Lo estoy haciendo…`, 'working', 0);
    hideUXButtons();
    setRingState('idle');

    const urlContext = document.getElementById('context-url').value.trim();
    const fileContext = document.getElementById('context-file-path').value.trim();
    let queryToSend = transcript;
    if (urlContext) queryToSend += " " + urlContext;
    if (fileContext) queryToSend += " " + fileContext;
    const contextSuffix = `${urlContext ? ` ${urlContext}` : ''}${fileContext ? ` ${fileContext}` : ''}`;
    const alternativesWithContext = Array.isArray(voiceMeta.alternatives)
        ? voiceMeta.alternatives.map(item => ({ ...item, transcript: `${item.transcript}${contextSuffix}` }))
        : undefined;

    socket.emit('process_speech', {
        text: queryToSend,
        source: 'voice',
        alternatives: alternativesWithContext,
        confidence: voiceMeta.confidence,
        audioLevel: currentAudioLevel,
        inpaintingMask: currentInpaintingMaskBase64
    });

    document.getElementById('context-url').value = "";
    document.getElementById('context-file-path').value = "";
    document.getElementById('dropzone-text').textContent = "Arrastra múltiples archivos aquí (.pdf) o haz clic";
    currentInpaintingMaskBase64 = null; // Clear mask after sending
}

function normalizeActivationText(text) {
    return normalizeText(text)
        .replace(/\b(?:yarvis|jarbis|charvis|harvis|yervis|edrey|edrei)\b/g, 'jarvis')
        .replace(/\bprende\s+(?:te|de)\b/g, 'prendete')
        .replace(/\bapaga\s+(?:te|de)\b/g, 'apagate')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractWakeWordCommand(text) {
    const raw = String(text || '').trim();
    const wakeRegex = /(?:hola|hey|oye|che|ok|bueno)?\s*\b(?:jarvis|yarvis|jarbis|charvis|harvis|yervis|edrey|edrei)\b[\s,.:;!?-]*(.*)$/i;
    const match = raw.match(wakeRegex);
    if (match) {
        return { hasWakeWord: true, command: match[1].trim() };
    }
    return { hasWakeWord: false, command: raw };
}

function isDirectImperativeCommand(text) {
    const norm = normalizeActivationText(text);
    const tokens = norm.split(/\s+/).filter(Boolean);
    if (tokens.length > 12) return false; // Frases largas de charla no son comandos directos

    const directPrefixes = [
        'abri ', 'abrir ', 'abre ', 'abrime ', 'cerra ', 'cerrar ', 'cierra ',
        'pone ', 'poner ', 'pon ', 'poneme ', 'reproduce ', 'reproduci ', 'reproducime ',
        'busca ', 'buscar ', 'buscame ', 'descarga ', 'descargar ', 'descargame ',
        'baja ', 'bajar ', 'bajame ', 'guarda ', 'guardar ',
        'prende ', 'prender ', 'encende ', 'encender ', 'apaga ', 'apagar ',
        'sube', 'subi', 'baja', 'derecha', 'izquierda', 'arriba', 'abajo',
        'silencio', 'pausa', 'play', 'para', 'continua', 'atras', 'volve',
        'dolar', 'cuanto esta el dolar', 'cotizacion', 'que hora es', 'hora',
        'modo estudio', 'modo juego', 'modo productividad', 'activar modo',
        'activa observador', 'desactiva observador'
    ];

    return directPrefixes.some(prefix => norm.startsWith(prefix) || norm.startsWith(`el ${prefix}`));
}

function isWakeCommand(text) {
    const normalized = normalizeActivationText(text);
    if (/\b(tele|television|tv|netflix)\b/.test(normalized)) return false;
    return /^(?:hola\s+)?jarvis\s+(?:prendete|prenderte|despertate|despierta|reactivate)$/.test(normalized) || /^jarvis\s+activa(?:te)?$/.test(normalized);
}

function isSleepCommand(text) {
    const normalized = normalizeActivationText(text);
    if (/\b(tele|television|tv|netflix)\b/.test(normalized)) return false;
    return /^(?:hola\s+)?jarvis\s+(?:apagate|apagarte|dormite|modo descanso|entra en modo descanso)$/.test(normalized);
}

function restartRecognition(delay = 300) {
    clearTimeout(recognitionRestartTimer);
    recognitionRestartTimer = setTimeout(() => {
        if (!recognition || !isSystemActive || isJarvisSpeaking || localVoiceOnline) return;
        try { recognition.start(); } catch(error) {}
    }, delay);
}

function handleRecognizedTranscript(transcript, alternatives = []) {
    if (!transcript || transcript.length < 2 || isJarvisSpeaking) return;
    const normalized = normalizeActivationText(transcript);

    // 1. Manejo de apagar/dormir
    if (isSleepCommand(normalized)) {
        stopAllSpeech();
        isDormant = true;
        setRingState('idle');
        updateMicButtonUI();
        jarvisBox.textContent = "Sistema en pausa. Decí 'Jarvis, prendete' para reactivar.";
        console.log('[Jarvis] 🔴 Modo dormido activado');
        speak('Entrando en modo descanso.');
        return;
    }

    // 2. Manejo de despertar
    if (isWakeCommand(normalized)) {
        isDormant = false;
        setRingState('listening');
        updateMicButtonUI();
        jarvisBox.textContent = 'Sistema activo. Esperando tus órdenes.';
        console.log('[Jarvis] 🟢 Modo dormido desactivado');
        speak('Estoy en línea. ¿Qué necesitás?');
        setAwaitingFollowUp(30);
        return;
    }

    if (isDormant) {
        console.log('[Jarvis] 💤 Dormido, ignorando:', transcript);
        return;
    }
    if (isEcho(transcript)) {
        console.log('[Jarvis] Eco detectado, ignorado:', transcript);
        return;
    }

    // 3. Extracción de Wake-Word y filtrado de conversaciones de fondo
    const wakeResult = extractWakeWordCommand(transcript);
    let finalQuery = transcript;

    if (wakeResult.hasWakeWord) {
        if (!wakeResult.command || wakeResult.command.length < 2) {
            // El usuario solo dijo "Jarvis" o "Hola Jarvis"
            console.log('[Jarvis] 🙋 Wake-word detectado solo, solicitando orden');
            jarvisBox.textContent = "Te escucho. ¿Qué necesitás?";
            speak('Te escucho. ¿Qué necesitás?');
            setAwaitingFollowUp(30);
            return;
        }
        // Dijo "Jarvis [orden]" -> extraemos únicamente la orden limpia
        finalQuery = wakeResult.command;
        console.log(`[Jarvis] ⚡ Wake-word detectado. Orden limpia: "${finalQuery}" (Original: "${transcript}")`);
        setAwaitingFollowUp(30);
    } else if (isAwaitingFollowUp) {
        // El usuario está en medio de una conversación activa con Jarvis
        console.log(`[Jarvis] 💬 Modo seguimiento activo. Procesando: "${transcript}"`);
        setAwaitingFollowUp(30);
    } else if (isDirectImperativeCommand(transcript)) {
        // Orden directa inequívoca ("abrí spotify", "poné youtube", etc.)
        console.log(`[Jarvis] 🎯 Comando imperativo directo detectado: "${transcript}"`);
        setAwaitingFollowUp(30);
    } else {
        // Es una conversación casual con otra persona o ruido en la habitación
        console.log(`[Jarvis] 🔇 Conversación de fondo ignorada (no dirigida a Jarvis): "${transcript}"`);
        return;
    }

    const selected = alternatives.find(item => item.transcript === transcript) || alternatives[0] || {};
    sendCommandToJarvis(finalQuery, { confidence: selected.confidence, alternatives });
}

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'es-AR';
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
        if (isJarvisSpeaking) return;

        const resultGroups = [];
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (!result.isFinal) continue;
            const alternatives = Array.from(result)
                .slice(0, 3)
                .map(item => ({ transcript: item.transcript.trim(), confidence: item.confidence }));
            if (alternatives[0]?.transcript) resultGroups.push(alternatives);
        }
        if (!resultGroups.length) return;
        const alternativeCount = Math.min(3, Math.max(...resultGroups.map(group => group.length)));
        const alternatives = Array.from({ length: alternativeCount }, (_, rank) => {
            const parts = resultGroups.map(group => group[rank] || group[0]);
            return {
                transcript: parts.map(part => part.transcript).join(' ').replace(/\s+/g, ' ').trim(),
                confidence: parts.reduce((sum, part) => sum + (Number(part.confidence) || 0), 0) / parts.length
            };
        });
        const activationAlternative = isDormant
            ? alternatives.find(item => isWakeCommand(item.transcript))
            : alternatives.find(item => isSleepCommand(item.transcript));
        handleRecognizedTranscript((activationAlternative || alternatives[0]).transcript, alternatives);
    };

    recognition.onend = () => {
        // Chrome corta el reconocimiento después de un silencio. Lo reiniciamos automáticamente.
        restartRecognition(300);
    };

    recognition.onerror = (event) => {
        if (event.error === 'no-speech') {
            restartRecognition(350);
            return;
        }
        if (event.error === 'not-allowed') {
            jarvisBox.textContent = '⚠️ Error: Permisos de micrófono denegados. Permite el micrófono en Chrome.';
            isSystemActive = false;
            updateMicButtonUI();
            return;
        }
        // Para otros errores, reintentar si el sistema sigue activo
        if (isSystemActive) {
            restartRecognition(1000);
        }
    };

} else {
    jarvisBox.textContent = "Error: Tu navegador no soporta reconocimiento de voz. Usa Google Chrome.";
}

// --- Text to Speech Setup ---
// --- Menu de Voces ---
function populateVoices() {
    const select = document.getElementById('voice-select');
    if (!select) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;
    const currentVal = select.value || localStorage.getItem('jarvisVoiceName') || '';
    select.innerHTML = '';
    let foundDefault = false;
    voices.forEach((voice, index) => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        option.value = voice.name;
        if (voice.name === currentVal) {
            option.selected = true;
            foundDefault = true;
        } else if (!currentVal && (voice.name.includes("Google español") || voice.name.includes("Microsoft Helena"))) {
            if(!currentVal) { option.selected = true; foundDefault = true; }
        }
        select.appendChild(option);
    });
    if (currentVal && voices.some(voice => voice.name === currentVal)) select.value = currentVal;
}

window.speechSynthesis.onvoiceschanged = () => {
    populateVoices();
};
window.addEventListener('load', () => populateVoices());
document.getElementById('voice-select')?.addEventListener('change', event => {
    localStorage.setItem('jarvisVoiceName', event.target.value);
});
document.getElementById('btn-test-voice')?.addEventListener('click', () => {
    speak('Prueba de voz completada. El sistema de audio de Jarvis está funcionando.');
});

function speechChunks(text, maxLength = 180) {
    const spoken = String(text || '')
        .replace(/```[\s\S]*?```/g, ' código omitido ')
        .replace(/[*_#>`~\[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const sentences = spoken.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [spoken];
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        if (current && `${current} ${sentence}`.length > maxLength) {
            chunks.push(current.trim());
            current = '';
        }
        current += ` ${sentence}`;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

function speak(text, callback) {
    const runId = ++speechRunId;
    window.speechSynthesis?.cancel();
    isJarvisSpeaking = true;
    setRingState('speaking');

    if (typeof marked !== 'undefined') {
        jarvisBox.innerHTML = marked.parse(text);
        if (window.MathJax) MathJax.typesetPromise([jarvisBox]);
    } else {
        jarvisBox.textContent = text;
    }
    userBox.textContent = '...';
    document.getElementById('btn-stop-audio').style.display = 'block';
    if (recognition && isSystemActive) {
        try { recognition.abort(); } catch(error) {}
    }

    lastSpokenWords = String(text || '').split(/\s+/).filter(word => word.length > 2);
    const voice = document.getElementById('voice-select')?.value || '';
    const spokenText = speechChunks(text).join(' ');
    fetch('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spokenText, voice })
    }).then(response => {
        if (!response.ok) throw new Error('Falló la voz nativa');
        if (runId !== speechRunId) return;
        lastSpokenTimestamp = Date.now();
        setTimeout(() => {
            if (runId !== speechRunId) return;
            isJarvisSpeaking = false;
            setRingState('idle');
            if (callback) callback();
            if (recognition && isSystemActive) {
                try { recognition.start(); } catch(error) {}
            }
        }, 700);
    }).catch(error => {
        if (runId !== speechRunId) return;
        console.warn('[TTS] Voz nativa no disponible, usando navegador:', error.message);
        speakInBrowser(text, callback);
    });
}

function speakInBrowser(text, callback) {
    if (!window.speechSynthesis) {
        console.warn("SpeechSynthesis no soportado");
        if (callback) callback();
        return;
    }

    const runId = ++speechRunId;
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();

    isJarvisSpeaking = true;
    setRingState('speaking');
    
    // Mejorar representación visual y accesibilidad
    if (typeof marked !== 'undefined') {
        jarvisBox.innerHTML = marked.parse(text);
        if (window.MathJax) MathJax.typesetPromise([jarvisBox]);
    } else {
        jarvisBox.textContent = text;
    }
    
    userBox.textContent = "..."; 
    
    // Muestra los botones de UX
    
    document.getElementById('btn-stop-audio').style.display = 'block';

    if (recognition && isSystemActive) {
        try { recognition.abort(); } catch(e){}
    }

    const voices = window.speechSynthesis.getVoices();
    const select = document.getElementById('voice-select');
    let selectedVoice = null;
    
    if (select && select.value !== "" && voices.length > 0) {
        selectedVoice = voices.find(voice => voice.name === select.value);
    } else {
        selectedVoice = voices.find(v => v.localService && /^es[-_]/i.test(v.lang))
            || voices.find(v => /^es[-_]/i.test(v.lang));
    }

    const chunks = speechChunks(text);
    let finished = false;
    const finish = () => {
        if (finished || runId !== speechRunId) return;
        finished = true;
        lastSpokenTimestamp = Date.now();
        setTimeout(() => {
            if (runId !== speechRunId) return;
            isJarvisSpeaking = false;
            setRingState('idle');
            if (callback) callback();
            if (recognition && isSystemActive) {
                try { recognition.start(); } catch(e) {}
            }
        }, 900);
    };

    const playChunk = (index, useDefaultVoice = false) => {
        if (runId !== speechRunId) return;
        if (index >= chunks.length) return finish();

        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = 'es-AR';
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        if (selectedVoice && !useDefaultVoice) utterance.voice = selectedVoice;

        let started = false;
        const watchdog = setTimeout(() => {
            if (started || runId !== speechRunId) return;
            window.speechSynthesis.cancel();
            window.speechSynthesis.resume();
            if (!useDefaultVoice) playChunk(index, true);
            else finish();
        }, 1800);

        utterance.onstart = () => {
            started = true;
            clearTimeout(watchdog);
        };
        utterance.onend = () => {
            clearTimeout(watchdog);
            playChunk(index + 1, useDefaultVoice);
        };
        utterance.onerror = event => {
            clearTimeout(watchdog);
            if (runId !== speechRunId || event.error === 'interrupted' || event.error === 'canceled') return;
            console.error('TTS Error:', event.error);
            if (!useDefaultVoice) {
                window.speechSynthesis.cancel();
                window.speechSynthesis.resume();
                playChunk(index, true);
            } else {
                finish();
            }
        };
        setTimeout(() => {
            if (runId === speechRunId) window.speechSynthesis.speak(utterance);
        }, 80);
    };

    lastSpokenWords = text.split(/\s+/).filter(w => w.length > 2);
    setTimeout(() => playChunk(0), 120);
}

// Ensure voices are loaded (Chrome things)



// --- Socket Events Logic ---
socket.on('init_data', (data) => {
    renderModes(data.modes, data.activeModeId);
});

socket.on('modes_updated', (modes) => {
    // Para simplificar, refrescamos la UI consultando la API local, 
    // pero acá nos envian la lista, así que verificamos el activo leyendo clase CSS actual:
    const activeItem = document.querySelector('.mode-list li.active');
    const activeId = activeItem ? activeItem.dataset.id : null;
    renderModes(modes, activeId);
});

function renderCapabilities(query = '') {
    const normalizedQuery = normalizeText(query);
    const visible = capabilities.filter(item => normalizeText(
        `${item.category || item.permission} ${item.name} ${item.description} ${(item.examples || []).join(' ')}`
    ).includes(normalizedQuery));

    if (visible.length === 0) {
        capabilitiesList.innerHTML = '<p class="capabilities-empty">No encontré una función con ese nombre.</p>';
        return;
    }

    capabilitiesList.innerHTML = '';
    let currentCategory = '';
    visible.forEach(item => {
        const categoryLabels = {
            standard: 'Asistente', 'memory-write': 'Memoria', destructive: 'Acciones delicadas',
            'physical-device': 'Dispositivos físicos', 'desktop-control': 'Notebook', 'screen-observation': 'Privacidad'
        };
        const itemCategory = categoryLabels[item.permission] || item.permission || 'Asistente';
        if (itemCategory !== currentCategory) {
            currentCategory = itemCategory;
            const category = document.createElement('h4');
            category.textContent = currentCategory;
            capabilitiesList.appendChild(category);
        }

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'capability-card';
        card.innerHTML = `
            <span class="capability-name">${item.name}</span>
            <span class="capability-description">${item.description}</span>
            <code>${item.examples?.[0] || item.id}</code>
            <span class="capability-status ${item.available ? '' : 'offline'}">${item.available ? 'Disponible' : 'No disponible'} · ${item.confirmation ? 'requiere confirmación' : 'sin confirmación extra'}</span>
        `;
        card.addEventListener('click', () => {
            const textInput = document.getElementById('manual-text-input');
            textInput.value = item.examples?.[0] || '';
            textInput.focus();
            textInput.setSelectionRange(0, textInput.value.length);
            jarvisBox.textContent = 'Comando preparado. Reemplazá los datos entre corchetes y presioná Enter.';
        });
        capabilitiesList.appendChild(card);
    });
}

fetch('/api/capabilities')
    .then(response => response.ok ? response.json() : Promise.reject(new Error('Catálogo no disponible')))
    .then(data => {
        capabilities = data;
        renderCapabilities();
    })
    .catch(error => {
        console.error(error);
        capabilitiesList.innerHTML = '<p class="capabilities-empty">No se pudo cargar el catálogo.</p>';
    });

capabilitySearch.addEventListener('input', event => renderCapabilities(event.target.value));

// --- Panel central de voz y memoria ---
const brainModal = document.getElementById('brain-modal');
const microphoneSelect = document.getElementById('voice-microphone');

async function voiceApi(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'La operación no se pudo completar.');
    return payload;
}

async function loadVoiceSettings() {
    const [settings, localStatus] = await Promise.all([
        voiceApi('/api/voice/settings'),
        voiceApi('/api/voice/local/status').catch(() => ({ online: false }))
    ]);
    voiceSettings = settings;
    document.getElementById('voice-whisper-model').value = voiceSettings.whisperModel || 'turbo';
    document.getElementById('voice-whisper-device').value = voiceSettings.whisperDevice || 'cuda';
    document.getElementById('voice-confidence').value = voiceSettings.confidenceThreshold;
    document.getElementById('voice-agreement').value = voiceSettings.agreementThreshold;
    document.getElementById('voice-echo').checked = voiceSettings.echoCancellation;
    document.getElementById('voice-noise').checked = voiceSettings.noiseSuppression;
    document.getElementById('voice-gain').checked = voiceSettings.autoGainControl;
    document.getElementById('voice-confirm').checked = voiceSettings.confirmUncertain;
    document.getElementById('voice-local-context').checked = voiceSettings.localContextEnabled !== false;
    renderLocalVoiceStatus(localStatus);
}

function renderLocalVoiceStatus(status = {}) {
    localVoiceOnline = status.online === true && (!status.lastSeenAt || Date.now() - Date.parse(status.lastSeenAt) < 15000);
    const box = document.getElementById('voice-engine-status');
    box.textContent = localVoiceOnline
        ? `Motor local activo · ${status.engine} · ${status.stage || status.state || 'listening'}${status.model ? ` · ${status.model}` : ''}`
        : 'Motor local detenido · se usará el reconocimiento del navegador como respaldo';
    box.classList.toggle('ready', localVoiceOnline);
    box.classList.toggle('error', !localVoiceOnline);
    if (Array.isArray(status.devices) && status.devices.length) {
        microphoneSelect.innerHTML = '';
        status.devices.forEach(device => {
            const option = document.createElement('option');
            option.value = String(device.index);
            option.dataset.local = 'true';
            option.textContent = device.name;
            option.selected = Number(voiceSettings?.localDeviceIndex) === device.index;
            microphoneSelect.appendChild(option);
        });
    }
    if (localVoiceOnline) {
        isSystemActive = true;
        isDormant = status.state !== 'awake';
        try { recognition?.abort(); } catch (_) {}
        updateMicButtonUI();
    }
}

function stopVoiceMonitor() {
    clearInterval(voiceMeterTimer);
    voiceMonitorStream?.getTracks().forEach(track => track.stop());
    voiceAudioContext?.close().catch(() => {});
    voiceMonitorStream = voiceAudioContext = voiceAnalyser = null;
    currentAudioLevel = 0;
}

async function listMicrophones(requestPermission = false, startMonitor = false) {
    if (!navigator.mediaDevices?.getUserMedia) {
        microphoneSelect.innerHTML = '<option value="">Predeterminado de Windows</option>';
        return;
    }
    if (requestPermission) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        permissionStream.getTracks().forEach(track => track.stop());
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');
    microphoneSelect.innerHTML = '';
    devices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Micrófono ${index + 1}`;
        option.selected = voiceSettings?.microphoneId === device.deviceId;
        microphoneSelect.appendChild(option);
    });
    if (!devices.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Predeterminado de Windows (habilitá permiso para ver nombres)';
        microphoneSelect.appendChild(option);
    }
    if (startMonitor) await startVoiceMonitor();
}

async function startVoiceMonitor() {
    stopVoiceMonitor();
    const deviceId = microphoneSelect.value || voiceSettings?.microphoneId;
    voiceMonitorStream = await navigator.mediaDevices.getUserMedia({ audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: voiceSettings?.echoCancellation !== false,
        noiseSuppression: voiceSettings?.noiseSuppression !== false,
        autoGainControl: voiceSettings?.autoGainControl !== false
    } });
    voiceAudioContext = new AudioContext();
    voiceAnalyser = voiceAudioContext.createAnalyser();
    voiceAnalyser.fftSize = 512;
    voiceAudioContext.createMediaStreamSource(voiceMonitorStream).connect(voiceAnalyser);
    const samples = new Uint8Array(voiceAnalyser.fftSize);
    // 4 muestras por segundo: suficiente para cercanía/ruido sin animar a 60 FPS.
    voiceMeterTimer = setInterval(() => {
        voiceAnalyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += ((value - 128) / 128) ** 2;
        currentAudioLevel = Math.sqrt(sum / samples.length);
        document.getElementById('voice-meter-bar').style.width = `${Math.min(100, currentAudioLevel * 600)}%`;
    }, 250);
}

async function loadMemory() {
    const [memory, learning] = await Promise.all([
        voiceApi('/api/memory'),
        voiceApi('/api/voice/learning')
    ]);
    document.getElementById('voice-learning-status').textContent =
        `${learning.phrases.length} órdenes verificadas · ${learning.vocabulary.length} términos aprendidos · ${learning.lexicon.length} palabras activas`;
    renderMemoryList('memory-preferences', memory.preferences, item => `<strong>${escapeHtml(item.key)}</strong>: ${escapeHtml(item.value)}`, 'preferences', true);
    renderMemoryList('memory-corrections', memory.corrections, item => `<strong>${escapeHtml(item.from)}</strong> → ${escapeHtml(item.to)}`, 'corrections', true);
    renderMemoryList('memory-conversations', [...memory.conversations].reverse().slice(0, 30), item => `<strong>${escapeHtml(item.role)}</strong> · ${escapeHtml(item.topic)}<br>${escapeHtml(item.text)}`, 'conversations');
    renderMemoryList('memory-summaries', [...memory.summaries].reverse(), item => `<strong>${escapeHtml(item.topic)}</strong><br>${escapeHtml(item.text)}`, 'summaries');
}

function escapeHtml(value) {
    const span = document.createElement('span');
    span.textContent = String(value ?? '');
    return span.innerHTML;
}

function renderMemoryList(id, items, formatter, collection, editable = false) {
    const container = document.getElementById(id);
    container.innerHTML = items.length ? '' : '<div class="memory-item">Sin datos.</div>';
    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'memory-item';
        row.innerHTML = `<span class="memory-item-actions">${editable ? '<button data-edit title="Corregir">✎</button>' : ''}<button data-delete title="Borrar">×</button></span>${formatter(item)}`;
        row.querySelector('[data-delete]').addEventListener('click', async () => {
            if (!confirm('¿Borrar este recuerdo?')) return;
            await voiceApi(`/api/memory/${collection}/${item.id}`, { method: 'DELETE' });
            await loadMemory();
        });
        row.querySelector('[data-edit]')?.addEventListener('click', async () => {
            let patch;
            if (collection === 'preferences') {
                const key = prompt('Tema de la preferencia:', item.key);
                if (key === null) return;
                const value = prompt('Preferencia correcta:', item.value);
                if (value === null) return;
                patch = { key, value };
            } else {
                const from = prompt('Texto que Jarvis suele entender:', item.from);
                if (from === null) return;
                const to = prompt('Texto correcto:', item.to);
                if (to === null) return;
                patch = { from, to };
            }
            await voiceApi(`/api/memory/${collection}/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
            await loadMemory();
        });
        container.appendChild(row);
    });
}

document.getElementById('btn-open-brain-modal').addEventListener('click', async () => {
    brainModal.classList.remove('hidden');
    try { await loadVoiceSettings(); if (!localVoiceOnline) await listMicrophones(false, false); await loadMemory(); }
    catch (error) { document.getElementById('voice-engine-status').textContent = error.message; }
});
document.getElementById('close-brain-modal').addEventListener('click', () => brainModal.classList.add('hidden'));
document.getElementById('btn-refresh-mics').addEventListener('click', () => listMicrophones(true, true).catch(error => alert(error.message)));
microphoneSelect.addEventListener('change', () => startVoiceMonitor().catch(error => alert(error.message)));
document.getElementById('btn-refresh-memory').addEventListener('click', () => loadMemory().catch(error => alert(error.message)));

document.getElementById('btn-calibrate-voice').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Guardá silencio…';
    try {
        if (!voiceAnalyser) await startVoiceMonitor();
        const readings = [];
        const sampler = setInterval(() => readings.push(currentAudioLevel), 100);
        await new Promise(resolve => setTimeout(resolve, 3000));
        clearInterval(sampler);
        const floor = readings.reduce((sum, value) => sum + value, 0) / Math.max(1, readings.length);
        voiceSettings = await voiceApi('/api/voice/settings', { method: 'POST', body: JSON.stringify({ noiseFloor: Math.max(.003, floor) }) });
        document.getElementById('voice-engine-status').textContent = `Calibrado. Piso de ruido: ${voiceSettings.noiseFloor.toFixed(4)}`;
    } finally { button.disabled = false; button.textContent = 'Calibrar ruido (3 s)'; }
});

document.getElementById('btn-save-voice').addEventListener('click', async () => {
    const selected = microphoneSelect.selectedOptions[0];
    voiceSettings = await voiceApi('/api/voice/settings', { method: 'POST', body: JSON.stringify({
        microphoneId: selected?.dataset.local ? voiceSettings.microphoneId : microphoneSelect.value,
        microphoneLabel: selected?.textContent || '',
        localDeviceIndex: selected?.dataset.local ? Number(microphoneSelect.value) : voiceSettings.localDeviceIndex,
        whisperModel: document.getElementById('voice-whisper-model').value,
        whisperDevice: document.getElementById('voice-whisper-device').value,
        confidenceThreshold: document.getElementById('voice-confidence').value,
        agreementThreshold: document.getElementById('voice-agreement').value,
        echoCancellation: document.getElementById('voice-echo').checked,
        noiseSuppression: document.getElementById('voice-noise').checked,
        autoGainControl: document.getElementById('voice-gain').checked,
        confirmUncertain: document.getElementById('voice-confirm').checked,
        localContextEnabled: document.getElementById('voice-local-context').checked
    }) });
    await startVoiceMonitor();
    document.getElementById('voice-engine-status').textContent = 'Configuración de voz guardada.';
});

document.getElementById('btn-add-correction').addEventListener('click', async () => {
    const from = document.getElementById('memory-correction-from').value.trim();
    const to = document.getElementById('memory-correction-to').value.trim();
    await voiceApi('/api/memory/corrections', { method: 'POST', body: JSON.stringify({ from, to }) });
    document.getElementById('memory-correction-from').value = '';
    document.getElementById('memory-correction-to').value = '';
    await loadMemory();
});

socket.on('voice_status', status => {
    const confidence = status.confidence ? `${Math.round(status.confidence * 100)}%` : 'sin dato';
    document.getElementById('voice-engine-status').textContent = `${status.engine} · confianza ${confidence} · acuerdo ${Math.round((status.agreement || 0) * 100)}%`;
});

socket.on('local_voice_status', renderLocalVoiceStatus);

socket.on('voice_confirmation_required', payload => {
    pendingVoiceTranscript = payload;
    brainModal.classList.remove('hidden');
    document.getElementById('voice-confirmation-box').classList.remove('hidden');
    document.getElementById('voice-confirmation-reason').textContent = `La transcripción es insegura: ${payload.reason}. Revisala antes de ejecutar.`;
    document.getElementById('voice-confirmation-text').value = payload.text;
});

function executeConfirmedTranscript(teachCorrection) {
    const corrected = document.getElementById('voice-confirmation-text').value.trim();
    if (!corrected) return;
    if (teachCorrection && pendingVoiceTranscript?.text !== corrected) {
        voiceApi('/api/memory/corrections', { method: 'POST', body: JSON.stringify({ from: pendingVoiceTranscript.text, to: corrected }) }).catch(console.error);
    }
    document.getElementById('voice-confirmation-box').classList.add('hidden');
    socket.emit('process_speech', { text: corrected, source: 'voice', confirmed: true, confidence: 1, audioLevel: currentAudioLevel });
    pendingVoiceTranscript = null;
}
document.getElementById('btn-confirm-transcript').addEventListener('click', () => executeConfirmedTranscript(false));
document.getElementById('btn-correct-transcript').addEventListener('click', () => executeConfirmedTranscript(true));

async function tvApi(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Falló la operación de TV.');
    return payload;
}

function renderTvStatus(status) {
    const learned = new Set(status.learnedButtons || []);
    document.querySelectorAll('.btn-learn').forEach(button => {
        const key = button.dataset.btn;
        const normalized = key ? key.replace('_', '').toLowerCase() : '';
        const isLearned = learned.has(key) || learned.has(normalized);
        button.classList.toggle('learned', isLearned);
        if (isLearned) {
            button.style.borderColor = '#00f2fe';
            button.style.boxShadow = '0 0 10px rgba(0, 242, 254, 0.4)';
        } else {
            button.style.borderColor = '';
            button.style.boxShadow = '';
        }
    });

    const statusBadge = document.querySelector('#tv-status .tv-status-badge');
    const statusDetails = document.querySelector('#tv-status .tv-status-details');
    const blocked = status.device?.authenticated === false;

    if (statusBadge) {
        statusBadge.textContent = blocked
            ? 'Estado: Bloqueado (Desactivar Lock Device en app)'
            : (status.configured ? `Estado: Conectado (${status.device.host})` : 'Estado: No configurado');
        statusBadge.style.color = blocked ? '#ff4d4d' : (status.configured ? '#00f2fe' : '#ffaa00');
    }
    if (statusDetails) {
        statusDetails.textContent = `${learned.size} tecla(s) aprendida(s) en BroadLink.`;
    }

    if (status.device?.host) {
        const hostEl = document.getElementById('tv-host');
        if (hostEl) hostEl.value = status.device.host;
    }
    if (status.device?.mac) {
        const macEl = document.getElementById('tv-mac');
        if (macEl) macEl.value = status.device.mac;
    }
}

async function loadTvStatus() {
    try {
        const status = await tvApi('/api/tv/status');
        renderTvStatus(status);
    } catch (error) {
        const statusDetails = document.querySelector('#tv-status .tv-status-details');
        if (statusDetails) statusDetails.textContent = error.message;
    }
}

function openTvModal() {
    const modal = document.getElementById('tv-modal');
    if (modal) {
        modal.classList.remove('hidden');
        loadTvStatus();
    }
}
window.openTvModal = openTvModal;

function closeTvModal() {
    const modal = document.getElementById('tv-modal');
    if (modal) modal.classList.add('hidden');
}
window.closeTvModal = closeTvModal;

const openTvBtn = document.getElementById('btn-open-tv-modal');
if (openTvBtn) openTvBtn.addEventListener('click', openTvModal);

const closeTvBtn = document.getElementById('close-tv-modal');
if (closeTvBtn) closeTvBtn.addEventListener('click', closeTvModal);

function switchTvTab(tabName, el) {
    document.querySelectorAll('.tv-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tv-tab-content').forEach(c => { c.style.display = 'none'; });
    if (el) {
        el.classList.add('active');
    } else {
        const btn = document.querySelector(`.tv-tab-btn[data-tab="${tabName}"]`);
        if (btn) btn.classList.add('active');
    }
    const target = document.getElementById(`tab-${tabName}`);
    if (target) {
        target.style.display = 'block';
    }
}
window.switchTvTab = switchTvTab;

// Pestañas de TV Modal (Event Listeners)
document.querySelectorAll('.tv-tab-btn').forEach(tabBtn => {
    tabBtn.addEventListener('click', (e) => {
        switchTvTab(tabBtn.dataset.tab, tabBtn);
    });
});

async function discoverTvBroadlink() {
    const discoverBtn = document.getElementById('btn-discover-tv');
    if (discoverBtn) discoverBtn.disabled = true;
    const msg = document.getElementById('tv-operation-message');
    if (msg) {
        msg.style.display = 'block';
        msg.textContent = 'Buscando BroadLink en la red local Wi-Fi…';
    }
    try {
        const status = await tvApi('/api/tv/discover', { method: 'POST' });
        renderTvStatus(status);
        if (msg) msg.textContent = '¡BroadLink detectado y guardado con éxito!';
    } catch (error) {
        if (msg) msg.textContent = `Error: ${error.message}`;
    } finally {
        if (discoverBtn) discoverBtn.disabled = false;
    }
}
window.discoverTvBroadlink = discoverTvBroadlink;

const discoverBtn = document.getElementById('btn-discover-tv');
if (discoverBtn) discoverBtn.addEventListener('click', discoverTvBroadlink);

// Guardar configuración manual
const settingsForm = document.getElementById('tv-settings-form');
if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const host = document.getElementById('tv-host')?.value?.trim();
        const msg = document.getElementById('tv-operation-message');
        if (msg) {
            msg.style.display = 'block';
            msg.textContent = 'Guardando configuración…';
        }
        try {
            const status = await tvApi('/api/tv/settings', {
                method: 'POST',
                body: JSON.stringify({ deviceHost: host })
            });
            renderTvStatus(status);
            if (msg) msg.textContent = 'Configuración guardada correctamente.';
        } catch (error) {
            if (msg) msg.textContent = error.message;
        }
    });
}

// Aprender Botones
async function learnTvButton(key) {
    const msg = document.getElementById('tv-operation-message');
    document.querySelectorAll('.btn-learn').forEach(b => { b.disabled = true; });
    if (msg) {
        msg.style.display = 'block';
        msg.textContent = `🔴 Apuntá el control remoto al BroadLink y presioná ${key.toUpperCase()} (tenés 20 segundos)...`;
    }
    try {
        const status = await tvApi('/api/tv/learn', {
            method: 'POST',
            body: JSON.stringify({ button: key })
        });
        renderTvStatus(status);
        if (msg) msg.textContent = `✅ ¡Tecla ${key.toUpperCase()} aprendida correctamente!`;
    } catch (error) {
        if (msg) msg.textContent = `❌ ${error.message}`;
    } finally {
        document.querySelectorAll('.btn-learn').forEach(b => { b.disabled = false; });
    }
}
window.learnTvButton = learnTvButton;

document.querySelectorAll('.btn-learn').forEach(button => {
    button.addEventListener('click', () => {
        learnTvButton(button.dataset.btn);
    });
});

// Probar Botones
async function testTvButton(key) {
    const msg = document.getElementById('tv-operation-message');
    if (msg) {
        msg.style.display = 'block';
        msg.textContent = `Enviando señal ${key.toUpperCase()}…`;
    }
    try {
        await tvApi('/api/tv/test', {
            method: 'POST',
            body: JSON.stringify({ button: key })
        });
        if (msg) msg.textContent = `Señal ${key.toUpperCase()} enviada a la TV.`;
    } catch (error) {
        if (msg) msg.textContent = error.message;
    }
}
window.testTvButton = testTvButton;

document.querySelectorAll('.btn-test-cmd').forEach(button => {
    button.addEventListener('click', () => {
        testTvButton(button.dataset.btn);
    });
});

socket.on('tv_progress', progress => {
    const msg = document.getElementById('tv-operation-message');
    if (msg && progress) {
        msg.style.display = 'block';
        msg.textContent = progress.message || '';
    }
    jarvisBox.textContent = progress.message;
});

socket.on('action_status', status => {
    const phase = status.phase === 'failed' ? 'failed' : status.phase === 'completed' ? 'completed' : 'working';
    showActionToast(status.message || 'Procesando…', phase, phase === 'working' ? 0 : 5000);
    if (status.message) {
        jarvisBox.textContent = status.message;
        if (status.speakAck) {
            speak(status.message);
        }
    }
});

socket.on('response', (data) => {
    const enteringSleep = data.action === 'voice.sleep' || data.actionPayload?.voiceState === 'dormant';
    const succeeded = data.status !== 'failed' && data.status !== 'unavailable';
    showActionToast(
        succeeded ? `Listo: ${data.text || 'acción completada.'}` : `No pude completarlo: ${data.text || 'error desconocido.'}`,
        succeeded ? 'completed' : 'failed',
        5500
    );
    if (data.action === 'voice.wake' || data.actionPayload?.voiceState === 'awake') {
        isSystemActive = true;
        isDormant = false;
        updateMicButtonUI();
    } else if (data.action === 'voice.sleep' || data.actionPayload?.voiceState === 'dormant') {
        isSystemActive = true;
        isDormant = true;
        updateMicButtonUI();
    }
    const afterResponse = () => {
        // Ejecutar acciones visuales una vez termine de hablar
        if (data.action === "OPEN_MODE_MENU") {
            modeModal.classList.remove('hidden');
        } else if (data.action === "OPEN_TV_SETUP") {
            openTvModal();
        } else if (data.action === "MODE_CHANGED") {
            document.querySelectorAll('.mode-list li').forEach(li => li.classList.remove('active'));
            const targetLi = document.querySelector(`.mode-list li[data-id="${data.actionPayload}"]`);
            if (targetLi) targetLi.classList.add('active');
        }
        
        // Detectar si Jarvis hizo una pregunta de seguimiento
        // Esto permite capturar la respuesta libre del usuario sin filtro de palabras clave
        const responseText = (data.text || "").toLowerCase();
        const isAskingFollowUp = (
            responseText.includes("qué querés") ||
            responseText.includes("que queres") ||
            responseText.includes("qué quieres") ||
            responseText.includes("que quieres") ||
            responseText.includes("qué mensaje") ||
            responseText.includes("que mensaje") ||
            responseText.includes("qué le digo") ||
            responseText.includes("que le digo") ||
            responseText.includes("cuál es el mensaje") ||
            responseText.includes("cual es el mensaje") ||
            responseText.includes("qué le decimos") ||
            responseText.includes("dime el mensaje") ||
            responseText.includes("decime el mensaje") ||
            responseText.includes("qué contenido") ||
            responseText.includes("que contenido") ||
            responseText.includes("cuéntame más") ||
            responseText.includes("¿qué") ||
            responseText.includes("¿cómo") ||
            responseText.includes("¿cuál") ||
            responseText.endsWith("?") ||
            responseText.includes("esperando tu respuesta") ||
            responseText.includes("dime cuál") ||
            responseText.includes("decime cual")
        );
        
        if (isAskingFollowUp) {
            setAwaitingFollowUp(30); // 30 segundos para responder
        }
    };
    if (enteringSleep) {
        stopAllSpeech();
        jarvisBox.textContent = data.text || 'Sistema en pausa.';
        afterResponse();
        return;
    }
    if (data.suppressTts) {
        jarvisBox.textContent = data.text;
        afterResponse();
    } else {
        speak(data.text, afterResponse);
    }
});

// Hotkey global ya no se usa (sistema manos libres activo)

// --- UI Logic ---
function renderModes(modes, activeId) {
    modesList.innerHTML = '';
    modes.forEach(mode => {
        const li = document.createElement('li');
        li.dataset.id = mode.id;

        // Validar si es el activo
        if (mode.id === activeId) {
            li.classList.add('active');
        }

        li.innerHTML = `
            <strong>${mode.name}</strong>
            <p>${mode.description}</p>
        `;
        
        li.addEventListener('click', () => {
            document.querySelectorAll('.mode-list li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            socket.emit('set_mode', mode.id);
            speak(`Modo manual cambiado a ${mode.name}`);
        });

        modesList.appendChild(li);
    });
}

function setRingState(state) {
    if (typeof neuralVisualizer !== 'undefined') {
        neuralVisualizer.setState(state);
    }
}

function updateMicButtonUI() {
    if (isSystemActive && !isDormant) {
        btnToggleMic.innerHTML = '<i class="fa-solid fa-microphone"></i> ESCUCHA ACTIVA — Di tu orden directamente';
        btnToggleMic.classList.add('active');
        setRingState('listening');
    } else if (isSystemActive && isDormant) {
        btnToggleMic.innerHTML = '<i class="fa-solid fa-moon"></i> EN PAUSA — Decí "Préndete" para despertar';
        btnToggleMic.classList.remove('active');
        setRingState('idle');
    } else {
        btnToggleMic.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> MICRÓFONO APAGADO — Click para activar';
        btnToggleMic.classList.remove('active');
        setRingState('idle');
    }
}

function startHandsFreeMode() {
    if (!recognition) return;
    isSystemActive = true;
    isDormant = false;
    updateMicButtonUI();
    jarvisBox.textContent = "Sistema activo. Di 'Jarvis' o un comando directo (abre, busca, crea...).";
    try { recognition.start(); } catch(e) {}
}

function startDormantMode() {
    if (!recognition) return;
    isSystemActive = true;
    isDormant = true;
    updateMicButtonUI();
    jarvisBox.textContent = 'Jarvis está en descanso. Decí "Jarvis, prendete" para activarlo.';
    try { recognition.start(); } catch(e) {}
}

// Click en el botón: toggle encender/apagar
btnToggleMic.addEventListener('click', (e) => {
    e.preventDefault();
    if (localVoiceOnline) {
        const state = isDormant ? 'awake' : 'dormant';
        if (state === 'dormant') stopAllSpeech();
        voiceApi('/api/voice/local/state', { method: 'POST', body: JSON.stringify({ state }) })
            .then(() => voiceApi('/api/voice/local/status'))
            .then(renderLocalVoiceStatus)
            .catch(error => { jarvisBox.textContent = error.message; });
        return;
    }
    if (isSystemActive && !isDormant) {
        isDormant = true;
        updateMicButtonUI();
        jarvisBox.textContent = 'Jarvis está en descanso. Decí "Jarvis, prendete" para activarlo.';
    } else if (isSystemActive && isDormant) {
        startHandsFreeMode();
    } else {
        startDormantMode();
    }
});

// Arranca en descanso: mantiene únicamente el reconocimiento de la frase de
// activación y bloquea todas las demás órdenes hasta oír "Jarvis, prendete".
window.addEventListener('load', async () => {
    try {
        const status = await voiceApi('/api/voice/local/status');
        renderLocalVoiceStatus(status);
        if (!localVoiceOnline) startDormantMode();
    } catch (_) {
        startDormantMode();
    }
});

// Modal UI Handlers
btnOpenModeModal.addEventListener('click', () => {
    modeModal.classList.remove('hidden');
});

btnCloseModal.addEventListener('click', () => {
    modeModal.classList.add('hidden');
});

// Form Submission for New Mode
modeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('mode-name').value;
    const description = document.getElementById('mode-desc').value;

    try {
        const response = await fetch('/api/modes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description })
        });
        if (response.ok) {
            modeModal.classList.add('hidden');
            modeForm.reset();
            speak(`He registrado el nuevo estrato cerebral bajo el nombre: ${name}.`);
        }
    } catch (err) {
        console.error("Error creating mode:", err);
        jarvisBox.textContent = "Error al conectar con la base de datos de modos.";
    }
});

// LOGICA OBTENCIÓN Y ENVIO POR TEXTO (Para no usar voz siempre)
document.getElementById('btn-send-text').addEventListener('click', () => {
    const textInput = document.getElementById('manual-text-input');
    const urlContext = document.getElementById('context-url').value.trim();
    const fileContext = document.getElementById('context-file-path').value.trim();
    
    let queryToSend = textInput.value.trim();
    if (!queryToSend) return; // no enviar vacios

    userBox.textContent = `"${queryToSend}"`;
    jarvisBox.textContent = "Analizando memoria y directivas...";
    showActionToast(`Entendí: “${queryToSend}”. Lo estoy haciendo…`, 'working', 0);
    setRingState('idle');
    
    if (urlContext) queryToSend += " " + urlContext;
    if (fileContext) queryToSend += " " + fileContext;
    
    socket.emit('process_speech', { text: queryToSend, inpaintingMask: currentInpaintingMaskBase64 });
    
    textInput.value = "";
    document.getElementById('context-url').value = "";
    document.getElementById('context-file-path').value = "";
    document.getElementById('dropzone-text').textContent = "Arrastra múltiples archivos aquí (.pdf) o haz clic";
    currentInpaintingMaskBase64 = null; // Clear mask after sending
});

document.getElementById('manual-text-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('btn-send-text').click();
    }
});

// LOGICA DRAG AND DROP FILE UPLOAD
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('context-file');
const filePathInput = document.getElementById('context-file-path');
const dropzoneText = document.getElementById('dropzone-text');

dropzone.addEventListener('click', () => fileInput.click());

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, preventDefaults, false);
});
function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
});

dropzone.addEventListener('drop', handleDrop, false);
fileInput.addEventListener('change', function(e) { handleFiles(this.files); });

function handleDrop(e) {
    let dt = e.dataTransfer;
    let files = dt.files;
    handleFiles(files);
}

function handleFiles(files) {
    if (files.length === 0) return;
    Array.from(files).forEach(file => uploadFile(file));
}

function uploadFile(file) {
    dropzoneText.textContent = "Subiendo archivo...";
    let url = '/api/upload';
    let formData = new FormData();
    formData.append('file', file);

    fetch(url, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.filepath) {
            let currentStr = filePathInput.value;
            filePathInput.value = currentStr ? currentStr + " | " + data.filepath : data.filepath;
            
            let parts = filePathInput.value.split(" | ").filter(i => i.trim());
            dropzoneText.textContent = `✅ ${parts.length} archivo(s) subido(s) listos`;
            console.log("Archivo guardado en:", data.filepath);

            // Si es imagen, abrimos el canvas modal de Inpainting
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const inpaintingBg = document.getElementById('inpainting-bg');
                    inpaintingBg.src = e.target.result;
                    document.getElementById('inpainting-modal').classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            }
        } else {
            dropzoneText.textContent = "❌ Error subiendo archivo";
        }
    })
    .catch(() => {
        dropzoneText.textContent = "❌ Fallo en la red al subir";
    });
}





const btnStop = document.getElementById('btn-stop-audio');

if (btnStop) {
    btnStop.addEventListener('click', () => {
        stopAllSpeech({ restartBrowserRecognition: true });
        btnStop.innerHTML = '<i class="fa-solid fa-check"></i> Silenciado';
        setTimeout(() => btnStop.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> Detener Audio', 2500);
    });
}

function hideUXButtons() { const b2 = document.getElementById('btn-stop-audio'); if(b2) b2.style.display = 'none'; }

// INPAINTING LOGIC
const inpaintingModal = document.getElementById('inpainting-modal');
const btnCloseInpainting = document.getElementById('close-inpainting-modal');
const btnClearMask = document.getElementById('btn-clear-mask');
const btnSaveMask = document.getElementById('btn-save-mask');
const inpaintingBg = document.getElementById('inpainting-bg');
const inpaintingCanvas = document.getElementById('inpainting-canvas');
const brushSizeInput = document.getElementById('brush-size');

let isPainting = false;
let maskCtx = null;

btnCloseInpainting.addEventListener('click', () => {
    inpaintingModal.classList.add('hidden');
});

// Inicializar el canvas de mismo tamaño que la imagen al cargar
inpaintingBg.addEventListener('load', () => {
    inpaintingCanvas.width = inpaintingBg.width;
    inpaintingCanvas.height = inpaintingBg.height;
    maskCtx = inpaintingCanvas.getContext('2d');
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    
    // Fondo negro puro (área que no se modificará)
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, inpaintingCanvas.width, inpaintingCanvas.height);
});

function drawMask(e) {
    if (!isPainting || !maskCtx) return;
    const rect = inpaintingCanvas.getBoundingClientRect();
    // Calcular escala correcta si CSS deforma
    const scaleX = inpaintingCanvas.width / rect.width;
    const scaleY = inpaintingCanvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    maskCtx.lineWidth = brushSizeInput.value;
    maskCtx.strokeStyle = "white"; // Blanco para el área que SÍ se modifica
    
    maskCtx.lineTo(x, y);
    maskCtx.stroke();
    maskCtx.beginPath();
    maskCtx.moveTo(x, y);
}

inpaintingCanvas.addEventListener('mousedown', (e) => {
    isPainting = true;
    maskCtx.beginPath();
    drawMask(e);
});
inpaintingCanvas.addEventListener('mousemove', drawMask);
inpaintingCanvas.addEventListener('mouseup', () => { isPainting = false; maskCtx.beginPath(); });
inpaintingCanvas.addEventListener('mouseleave', () => { isPainting = false; maskCtx.beginPath(); });

btnClearMask.addEventListener('click', () => {
    if (maskCtx) {
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, inpaintingCanvas.width, inpaintingCanvas.height);
    }
});

btnSaveMask.addEventListener('click', () => {
    if (maskCtx) {
        // Enviar al servidor como JPEG para asegurar que no hay canal alpha
        currentInpaintingMaskBase64 = inpaintingCanvas.toDataURL('image/jpeg', 1.0);
        inpaintingModal.classList.add('hidden');
        document.getElementById('dropzone-text').textContent = "✅ Máscara lista. Escribe la edición y envía.";
    }
});
