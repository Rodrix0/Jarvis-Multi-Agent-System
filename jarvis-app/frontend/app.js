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
        inpaintingMask: currentInpaintingMaskBase64
    });

    document.getElementById('context-url').value = "";
    document.getElementById('context-file-path').value = "";
    document.getElementById('dropzone-text').textContent = "Arrastra múltiples archivos aquí (.pdf) o haz clic";
    currentInpaintingMaskBase64 = null; // Clear mask after sending
}

function normalizeActivationText(text) {
    return normalizeText(text)
        .replace(/\b(?:yarvis|jarbis|charvis|harvis)\b/g, 'jarvis')
        .replace(/\bprende\s+(?:te|de)\b/g, 'prendete')
        .replace(/\bapaga\s+(?:te|de)\b/g, 'apagate')
        .replace(/\s+/g, ' ')
        .trim();
}

function isWakeCommand(text) {
    const normalized = normalizeActivationText(text);
    if (/\b(tele|television|tv|netflix)\b/.test(normalized)) return false;
    return /\b(prendete|prenderte|despertate|despierta|reactivate)\b/.test(normalized)
        || (/\bjarvis\b/.test(normalized) && /\b(prende|encende|activa|desperta)\w*\b/.test(normalized));
}

function isSleepCommand(text) {
    const normalized = normalizeActivationText(text);
    if (/\b(tele|television|tv|netflix)\b/.test(normalized)) return false;
    return /\b(apagate|apagarte|dormite|descansa)\b/.test(normalized)
        || (/\bjarvis\b/.test(normalized) && /\b(apaga|dormi|descansa)\w*\b/.test(normalized));
}

function restartRecognition(delay = 300) {
    clearTimeout(recognitionRestartTimer);
    recognitionRestartTimer = setTimeout(() => {
        if (!recognition || !isSystemActive || isJarvisSpeaking) return;
        try { recognition.start(); } catch(error) {}
    }, delay);
}

function handleRecognizedTranscript(transcript, alternatives = []) {
    if (!transcript || transcript.length < 2 || isJarvisSpeaking) return;
    const normalized = normalizeActivationText(transcript);

    if (isSleepCommand(normalized)) {
        isDormant = true;
        setRingState('idle');
        updateMicButtonUI();
        jarvisBox.textContent = "Sistema en pausa. Decí 'Préndete' para reactivar.";
        console.log('[Jarvis] 🔴 Modo dormido activado');
        speak('Entendido, entrando en modo espera.');
        return;
    }

    if (isWakeCommand(normalized)) {
        if (isDormant) {
            isDormant = false;
            setRingState('listening');
            updateMicButtonUI();
            jarvisBox.textContent = 'Sistema activo. Esperando tus órdenes.';
            console.log('[Jarvis] 🟢 Modo dormido desactivado');
            speak('Estoy en línea. ¿Qué necesitás?');
        }
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

    const selected = alternatives.find(item => item.transcript === transcript) || alternatives[0] || {};
    sendCommandToJarvis(transcript, { confidence: selected.confidence, alternatives });
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
        `${item.category} ${item.name} ${item.description} ${item.command}`
    ).includes(normalizedQuery));

    if (visible.length === 0) {
        capabilitiesList.innerHTML = '<p class="capabilities-empty">No encontré una función con ese nombre.</p>';
        return;
    }

    capabilitiesList.innerHTML = '';
    let currentCategory = '';
    visible.forEach(item => {
        if (item.category !== currentCategory) {
            currentCategory = item.category;
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
            <code>${item.command}</code>
        `;
        card.addEventListener('click', () => {
            const textInput = document.getElementById('manual-text-input');
            textInput.value = item.command;
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
    document.querySelectorAll('[data-tv-learn]').forEach(button => {
        button.classList.toggle('learned', learned.has(button.dataset.tvLearn));
        const cleanLabel = button.textContent.replace(/^✓\s*/, '');
        button.textContent = learned.has(button.dataset.tvLearn) ? `✓ ${cleanLabel}` : cleanLabel;
    });

    const blocked = status.device?.authenticated === false;
    tvStatus.className = `tv-status ${blocked ? 'error' : (status.configured ? 'ready' : '')}`;
    tvStatus.textContent = blocked
        ? `BroadLink detectado en ${status.device.host}, pero el control local está bloqueado desde la app.`
        : (status.configured
            ? `BroadLink conectado en ${status.device.host}. ${learned.size} tecla(s) aprendida(s).`
            : 'BroadLink todavía no configurado.');

    const settings = status.netflix || {};
    document.getElementById('tv-boot-wait').value = Math.round((settings.bootWaitMs || 45000) / 1000);
    document.getElementById('tv-profile-wait').value = Math.round((settings.profileLoadMs || 8000) / 1000);
    document.getElementById('tv-profile-index').value = settings.profileDownPresses || 0;
    document.getElementById('tv-continue-down').value = settings.continueWatchingDownPresses ?? 1;
    document.getElementById('tv-continue-right').value = settings.continueWatchingRightPresses || 0;
    document.getElementById('tv-key-delay').value = settings.keyDelayMs || 350;
    document.getElementById('tv-keyboard-delay').value = settings.keyboardKeyDelayMs || 700;
    document.getElementById('tv-use-netflix-key').checked = settings.pressNetflixAfterBoot === true;
    document.getElementById('tv-confirm-play').checked = settings.pressPlayAfterResult !== false;
    document.getElementById('tv-device-ip').value = status.device?.host || '';
}

async function loadTvStatus() {
    try {
        renderTvStatus(await tvApi('/api/tv/status'));
    } catch (error) {
        tvStatus.className = 'tv-status error';
        tvStatus.textContent = error.message;
    }
}

function openTvModal() {
    tvModal.classList.remove('hidden');
    loadTvStatus();
}

document.getElementById('btn-open-tv-modal').addEventListener('click', openTvModal);
document.getElementById('close-tv-modal').addEventListener('click', () => tvModal.classList.add('hidden'));

document.getElementById('btn-tv-discover').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    tvStatus.className = 'tv-status';
    tvStatus.textContent = 'Buscando BroadLink en la red local…';
    try {
        renderTvStatus(await tvApi('/api/tv/discover', { method: 'POST' }));
    } catch (error) {
        tvStatus.className = 'tv-status error';
        tvStatus.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

document.querySelectorAll('[data-tv-learn]').forEach(button => {
    button.addEventListener('click', async () => {
        const key = button.dataset.tvLearn;
        document.querySelectorAll('[data-tv-learn]').forEach(item => { item.disabled = true; });
        tvOperationMessage.textContent = `Ahora apuntá el control físico al BroadLink y presioná ${key.toUpperCase()}. Tenés 20 segundos.`;
        try {
            const status = await tvApi('/api/tv/learn', {
                method: 'POST',
                body: JSON.stringify({ button: key })
            });
            renderTvStatus(status);
            tvOperationMessage.textContent = `Tecla ${key.toUpperCase()} aprendida correctamente.`;
        } catch (error) {
            tvOperationMessage.textContent = error.message;
        } finally {
            document.querySelectorAll('[data-tv-learn]').forEach(item => { item.disabled = false; });
        }
    });
});

document.getElementById('btn-tv-test').addEventListener('click', async () => {
    const button = document.getElementById('tv-test-button').value;
    tvOperationMessage.textContent = `Enviando ${button.toUpperCase()}…`;
    try {
        await tvApi('/api/tv/test', { method: 'POST', body: JSON.stringify({ button }) });
        tvOperationMessage.textContent = `Tecla ${button.toUpperCase()} enviada.`;
    } catch (error) {
        tvOperationMessage.textContent = error.message;
    }
});

document.getElementById('btn-tv-save').addEventListener('click', async () => {
    const settings = {
        deviceHost: document.getElementById('tv-device-ip').value,
        bootWaitMs: Number(document.getElementById('tv-boot-wait').value) * 1000,
        profileLoadMs: Number(document.getElementById('tv-profile-wait').value) * 1000,
        profileDownPresses: Number(document.getElementById('tv-profile-index').value),
        continueWatchingDownPresses: Number(document.getElementById('tv-continue-down').value),
        continueWatchingRightPresses: Number(document.getElementById('tv-continue-right').value),
        keyDelayMs: Number(document.getElementById('tv-key-delay').value),
        keyboardKeyDelayMs: Number(document.getElementById('tv-keyboard-delay').value),
        pressNetflixAfterBoot: document.getElementById('tv-use-netflix-key').checked,
        pressPlayAfterResult: document.getElementById('tv-confirm-play').checked
    };
    try {
        renderTvStatus(await tvApi('/api/tv/settings', { method: 'POST', body: JSON.stringify(settings) }));
        tvOperationMessage.textContent = 'Calibración guardada.';
    } catch (error) {
        tvOperationMessage.textContent = error.message;
    }
});

document.getElementById('btn-tv-run').addEventListener('click', async () => {
    const runButton = document.getElementById('btn-tv-run');
    runButton.disabled = true;
    tvOperationMessage.textContent = 'Iniciando secuencia Netflix…';
    try {
        const result = await tvApi('/api/tv/netflix', {
            method: 'POST',
            body: JSON.stringify({
                title: document.getElementById('tv-netflix-title').value,
                powerOn: document.getElementById('tv-power-on-test').checked
            })
        });
        tvOperationMessage.textContent = result.message;
    } catch (error) {
        tvOperationMessage.textContent = error.message;
    } finally {
        runButton.disabled = false;
    }
});

document.getElementById('btn-tv-cancel').addEventListener('click', async () => {
    await tvApi('/api/tv/cancel', { method: 'POST' });
    tvOperationMessage.textContent = 'Automatización cancelada.';
});

socket.on('tv_progress', progress => {
    tvOperationMessage.textContent = progress.message;
    jarvisBox.textContent = progress.message;
});

socket.on('response', (data) => {
    speak(data.text, () => {
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
    });
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
window.addEventListener('load', startDormantMode);

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
        speechRunId++;
        fetch('/api/tts/stop', { method: 'POST' }).catch(() => {});
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
        isJarvisSpeaking = false;
        if(isSystemActive) { setRingState('idle'); }
        if (recognition && isSystemActive) {
            setTimeout(() => { try { recognition.start(); } catch(error) {} }, 200);
        }
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
