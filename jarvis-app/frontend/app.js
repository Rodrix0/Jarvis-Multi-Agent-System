// --- DOM Elements ---
const userBox = document.getElementById('user-transcript');
const jarvisBox = document.getElementById('jarvis-response');
const btnToggleMic = document.getElementById('btn-toggle-mic');
const modesList = document.getElementById('modes-list');

// Modal Elements
const modeModal = document.getElementById('mode-modal');
const btnOpenModeModal = document.getElementById('btn-open-mode-modal');
const btnCloseModal = document.getElementById('close-modal');
const modeForm = document.getElementById('mode-form');

// --- Socket.io Setup ---
const socket = io(); 

// =================================================================
// SISTEMA DE VOZ MANOS LIBRES (Web Speech API - Chrome)
// =================================================================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
let isSystemActive = false;  // true = motor de reconocimiento encendido
let isDormant = false;       // true = mic abierto pero solo escucha "activate"
let isJarvisSpeaking = false;
let isAwaitingFollowUp = false;
let followUpTimer = null;
let lastSpokenWords = [];  // Palabras que Jarvis dijo recientemente (anti-eco inteligente)
let lastSpokenTimestamp = 0;

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
        .replace(/[\u0300-\u036f]/g, ''); // Elimina diacríticos (á→a, é→e, etc.)
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

function sendCommandToJarvis(transcript) {
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

    socket.emit('process_speech', { text: queryToSend });

    document.getElementById('context-url').value = "";
    document.getElementById('context-file-path').value = "";
    document.getElementById('dropzone-text').textContent = "Arrastra múltiples archivos aquí (.pdf) o haz clic";
}

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'es-AR';

    recognition.onresult = (event) => {
        if (isJarvisSpeaking) return;

        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (!event.results[i].isFinal) continue;

            const transcript = event.results[i][0].transcript.trim();
            if (!transcript || transcript.length < 2) continue;

            const lower = transcript.toLowerCase();
            const normalized = normalizeText(transcript); // sin acentos, todo minúscula

            // --- APAGADO: interceptar ANTES de cualquier otra cosa ---
            if (normalized.includes('apagate') || normalized.includes('apagarte')) {
                isDormant = true;
                setRingState('idle');
                updateMicButtonUI();
                jarvisBox.textContent = "Sistema en pausa. Decí 'Préndete' para reactivar.";
                console.log('[Jarvis] 🔴 Modo dormido activado');
                speak('Entendido, entrando en modo espera.');
                continue;
            }

            // --- ENCENDIDO ---
            if (normalized.includes('prendete') || normalized.includes('prenderte')) {
                if (isDormant) {
                    isDormant = false;
                    setRingState('listening');
                    updateMicButtonUI();
                    jarvisBox.textContent = "Sistema activo. Esperando tus órdenes.";
                    console.log('[Jarvis] 🟢 Modo dormido desactivado');
                    speak('Estoy en línea. ¿Qué necesitás?');
                }
                continue;
            }

            // --- Si está dormido, bloquear TODO lo demás ---
            if (isDormant) {
                console.log('[Jarvis] 💤 Dormido, ignorando:', transcript);
                continue;
            }

            // Único filtro: anti-eco
            if (isEcho(transcript)) {
                console.log("[Jarvis] Eco detectado, ignorado:", transcript);
                continue;
            }

            // Todo lo demás va directo a Jarvis
            sendCommandToJarvis(transcript);
        }
    };

    recognition.onend = () => {
        // Chrome corta el reconocimiento después de un silencio. Lo reiniciamos automáticamente.
        if (isSystemActive && !isJarvisSpeaking) {
            setTimeout(() => {
                try { recognition.start(); } catch(e) {}
            }, 300);
        }
    };

    recognition.onerror = (event) => {
        if (event.error === 'no-speech') return; // Normal, ignorar
        if (event.error === 'not-allowed') {
            jarvisBox.textContent = '⚠️ Error: Permisos de micrófono denegados. Permite el micrófono en Chrome.';
            isSystemActive = false;
            updateMicButtonUI();
            return;
        }
        // Para otros errores, reintentar si el sistema sigue activo
        if (isSystemActive) {
            setTimeout(() => {
                try { recognition.start(); } catch(e) {}
            }, 1000);
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
    const currentVal = select.value;
    select.innerHTML = '';
    let foundDefault = false;
    voices.forEach((voice, index) => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        option.value = index;
        if (voice.name.includes("Google español") || voice.name.includes("Microsoft Helena")) {
            if(!currentVal) { option.selected = true; foundDefault = true; }
        }
        select.appendChild(option);
    });
    if(currentVal) select.value = currentVal;
}

window.speechSynthesis.onvoiceschanged = () => {
    populateVoices();
};
window.addEventListener('load', () => populateVoices());

function speak(text, callback) {
    if (!window.speechSynthesis) {
        console.warn("SpeechSynthesis no soportado");
        return;
    }

    window.speechSynthesis.cancel();

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

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.rate = 1.15;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const select = document.getElementById('voice-select');
    let selectedVoice = null;
    
    if (select && select.value !== "" && voices.length > 0) {
        selectedVoice = voices[select.value];
    } else {
        selectedVoice = voices.find(v => v.name.includes("Google español") || v.lang.includes('es-'));
    }

    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }

    utterance.onend = () => {
        // Retraso generoso para que el eco de la sala se disipe por completo
        setTimeout(() => {
            isJarvisSpeaking = false;
            setRingState('idle');
            if (callback) callback();
        }, 1500); // 1.5 segundos de silencio post-habla
    };

    utterance.onerror = (e) => {
        console.error("TTS Error:", e);
        setTimeout(() => {
            isJarvisSpeaking = false;
            if(isSystemActive) setRingState('idle');
        }, 800);
    };

    // Guardar las palabras que Jarvis va a decir para el filtro anti-eco
    lastSpokenWords = text.split(/\s+/).filter(w => w.length > 2);
    lastSpokenTimestamp = Date.now();

    window.speechSynthesis.speak(utterance);
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

socket.on('response', (data) => {
    speak(data.text, () => {
        // Ejecutar acciones visuales una vez termine de hablar
        if (data.action === "OPEN_MODE_MENU") {
            modeModal.classList.remove('hidden');
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
    updateMicButtonUI();
    jarvisBox.textContent = "Sistema activo. Di 'Jarvis' o un comando directo (abre, busca, crea...).";
    try { recognition.start(); } catch(e) {}
}

function stopHandsFreeMode() {
    if (!recognition) return;
    isSystemActive = false;
    updateMicButtonUI();
    jarvisBox.textContent = "Sistema dormido. Haz click en el micrófono para activar.";
    try { recognition.stop(); } catch(e) {}
}

// Click en el botón: toggle encender/apagar
btnToggleMic.addEventListener('click', (e) => {
    e.preventDefault();
    if (isSystemActive) {
        stopHandsFreeMode();
    } else {
        startHandsFreeMode();
    }
});

// AUTO-ARRANQUE: Iniciar el sistema automáticamente al cargar la página
window.addEventListener('load', () => {
    setTimeout(() => {
        startHandsFreeMode();
    }, 1500); // Pequeño delay para que el navegador termine de inicializar
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
    setRingState('idle');
    
    if (urlContext) queryToSend += " " + urlContext;
    if (fileContext) queryToSend += " " + fileContext;
    
    socket.emit('process_speech', { text: queryToSend });
    
    textInput.value = "";
    document.getElementById('context-url').value = "";
    document.getElementById('context-file-path').value = "";
    document.getElementById('dropzone-text').textContent = "Arrastra múltiples archivos aquí (.pdf) o haz clic";
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
        window.speechSynthesis.cancel();
        isJarvisSpeaking = false;
        if(isSystemActive) { setRingState('idle'); }
        btnStop.innerHTML = '<i class="fa-solid fa-check"></i> Silenciado';
        setTimeout(() => btnStop.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> Detener Audio', 2500);
    });
}

function hideUXButtons() { const b2 = document.getElementById('btn-stop-audio'); if(b2) b2.style.display = 'none'; }
