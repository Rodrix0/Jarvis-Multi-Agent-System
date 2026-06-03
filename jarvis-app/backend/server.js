const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
require('dotenv').config();

const modeService = require('./services/modeService');
const systemService = require('./services/systemService');
const aiService = require('./services/aiService');
const backgroundTuner = require('./services/backgroundTuner');
const observerService = require('./services/observerService');
const appDiscoveryService = require('./services/appDiscoveryService');
const hotkeyService = require('./services/hotkeyService');
const reminderService = require('./services/reminderService');
const powerService = require('./services/powerService');
const shopRoutes = require('./routes/shopRoutes');

const app = express();

// Optimizaciones de Seguridad y Rendimiento
app.use(helmet({ contentSecurityPolicy: false })); // Protege cabeceras HTTP sin romper la carga local de scripts
app.use(compression()); // Comprime las respuestas HTTP enviadas al cliente para mayor eficiencia

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    perMessageDeflate: true, // Habilitar compresión en Socket.io
});

app.use(cors());
app.use(express.json());
app.use('/api/shop', shopRoutes);

// Servir frontend si se corre el server directo (opcional para facilidad)
app.use(express.static(path.join(__dirname, '../frontend')));

// --- NUEVO: RUTA PARA SUBIR ARCHIVOS (RAG) ---
const multer = require('multer');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'data', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, ''));
    }
});
const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No se subió ningún archivo." });
    }
    // Return absolute path
    const absolutePath = req.file.path;
    console.log(`[Servidor] 💾 Archivo recibido y guardado en: ${absolutePath}`);
    res.json({ filepath: absolutePath });
});
// ----------------------------------------------

// API Rest para Modos (usado por el cliente cuando quiere crear nuevos modos usando la interfaz)
app.get('/api/modes', (req, res) => {
    res.json(modeService.getAllModes());
});

app.post('/api/modes', (req, res) => {
    const { name, description } = req.body;
    if (!name || !description) {
        return res.status(400).json({ error: "El nombre y descripción son requeridos." });
    }
    const newMode = modeService.addMode({ name, description });
    // Al notificar a todos los clientes actualizamos su lista
    io.emit('modes_updated', modeService.getAllModes());
    res.json(newMode);
});

// Endpoint para que servicios externos (Ej: Python Background Tasks) activen la voz nativa
app.post('/api/speak', (req, res) => {
    const { text } = req.body;
    if (text && io) {
        io.emit('response', { text: text, action: "REMOTE_SPEAK", actionPayload: null });
        console.log(`[Jarvis Comunicación Externa]: ${text}`);
        res.json({ status: "success" });
    } else {
        res.status(400).json({ error: "Text missing" });
    }
});

// Endpoint principal para el cliente de Audio Python (Fondo)
app.post('/api/process_speech_local', async (req, res) => {
    const text = req.body.text;
    if (!text) return res.status(400).json({ error: "Text missing" });
    
    const lowerText = text.toLowerCase();
    console.log(`[Jarvis Audio Python]: ${text}`);

    let responseText = "";
    try {
        const sysCommand = systemService.handleSystemCommand(text);
        
        if (sysCommand.isSystemCommand) {
            responseText = sysCommand.isLearned
                ? `Comando aprendido detectado. Ejecutando ${sysCommand.appName}, señor.`
                : `Abriendo ${sysCommand.appName}.`;
            const activeMode = modeService.getActiveMode();
            await systemService.openApp(sysCommand.appName, activeMode.id);
        } else {
            const activeMode = modeService.getActiveMode();
            const screenContext = observerService.getScreenContext();
            responseText = await aiService.getAIResponse(text, activeMode, screenContext);
        }
    } catch (error) {
        console.error(error);
        responseText = "Lo siento, mi núcleo central interceptó una excepción no controlada.";
    }
    
    // Sincronizar la respuesta con cualquier UI web abierta
    io.emit('response', { text: responseText, action: null, actionPayload: null });
    
    // Responder a Python para que lo hable por TTS
    res.json({ response: responseText });
});

// Real-time voice processing y Eventos del Socket
io.on('connection', (socket) => {
    console.log('[+] Interfaz conectada a Jarvis (Socket ID: ' + socket.id + ')');

    // Inicializar data en frontend
    socket.emit('init_data', {
        modes: modeService.getAllModes(),
        activeModeId: modeService.getActiveMode().id
    });

    // Evento de procesamiento de voz (cuando Jarvis escucha al usuario)
    socket.on('process_speech', async (data) => {
        const text = data.text;
        const lowerText = text.toLowerCase();
        console.log(`[Usuario dice]: ${text}`);

        let responseText = "";
        let action = null;
        let actionPayload = null;

        try {
            // 0. Toggle de Observador/Estudio Activo
            const turnOnWords = ['activar observador', 'activa observador', 'activa el observador', 'modo observador', 'modo observación', 'modo observacion', 'estudio activo', 'inicia observador', 'enciende el observador'];
            const turnOffWords = ['desactivar observador', 'desactiva observador', 'apaga observador', 'apaga el observador', 'apaga observacion', 'apaga observación', 'desactiva estudio activo'];

            if (turnOnWords.some(w => lowerText.includes(w))) {
                observerService.toggleObserver(true);
                responseText = "Modo Estudio Activo habilitado. He activado mi red de escaneo neuromotriz; a partir de ahora analizaré tus ventanas para brindarte ayuda contextual.";
                action = "OBSERVER_ON";
            } 
            else if (turnOffWords.some(w => lowerText.includes(w))) {
                observerService.toggleObserver(false);
                responseText = "Modo Estudio Activo deshabilitado. Mis ojos locales sobre el sistema operativo han sido apagados.";
                action = "OBSERVER_OFF";
            }
            // 1. Detección de comandos específicos
            else if (lowerText.includes('abrir menú de carga de modos') || lowerText.includes('crear modo') || lowerText.includes('nuevo modo')) {
                responseText = "Abriendo el panel de creación de modalidades.";
                action = "OPEN_MODE_MENU";
            } 
            else if (lowerText.includes('mostrar modos')) {
                responseText = "Mostrando los modos disponibles de mi sistema.";
                action = "SHOW_MODES";
            }
            else if (lowerText.includes('entrenar seguridad') || lowerText.includes('configurar seguridad') || lowerText.includes('entrenar biometría')) {
                const { spawn } = require('child_process');
                // Buscamos un PIN dictado, o usamos 0000 por defecto
                let pinMatches = lowerText.match(/\d{4}/);
                let selectedPin = pinMatches ? pinMatches[0] : "0000";
                
                const pythonExe = require('path').join(__dirname, '..', 'python_engine', 'venv', 'Scripts', 'python.exe');
                const lockScript = require('path').join(__dirname, '..', 'python_engine', 'register_face.py');
                spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', pythonExe, lockScript, selectedPin], { detached: true });
                
                // Forzamos la activacion en el JSON
                const fs = require('fs');
                const secPath = require('path').join(__dirname, 'data', 'security.json');
                let sec = {"pin": selectedPin, "enabled": true};
                fs.writeFileSync(secPath, JSON.stringify(sec, null, 4));

                responseText = `Iniciando proceso de entrenamiento biométrico en una ventana externa. Tu PIN temporal de respaldo es ${selectedPin}. Por favor, sigue las instrucciones en pantalla. El escudo quedará activado al finalizar.`;
            }
            else if (/(apagar|desactivar|quitar|remover|apaga|desactiva|quita)( el| la)? (seguridad|escudo|biometría|bloqueo)/.test(lowerText)) {
                const fs = require('fs');
                const secPath = require('path').join(__dirname, 'data', 'security.json');
                if (fs.existsSync(secPath)) {
                    let sec = JSON.parse(fs.readFileSync(secPath));
                    sec.enabled = false;
                    fs.writeFileSync(secPath, JSON.stringify(sec, null, 4));
                }
                responseText = "Escudo biométrico de Windows desactivado. Tu computadora no será bloqueada al entrar en suspensión.";
                action = "SECURITY_DISABLED";
            }
            else if (/(encender|activar|poner|habilitar|prender|enciende|activa|pon|prende)( el| la)? (seguridad|escudo|biometría|bloqueo)/.test(lowerText)) {
                const fs = require('fs');
                const secPath = require('path').join(__dirname, 'data', 'security.json');
                let sec = {"pin": "0000", "enabled": true};
                if (fs.existsSync(secPath)) {
                    sec = JSON.parse(fs.readFileSync(secPath));
                    sec.enabled = true;
                }
                fs.writeFileSync(secPath, JSON.stringify(sec, null, 4));
                responseText = "Escudo Biométrico encendido y armado. Defenderé tu sistema en cuanto lo ordenes.";
                action = "SECURITY_ENABLED";
            }
            else if (lowerText.includes('activar modo')) {
                const modeNameMatch = lowerText.replace('activar modo', '').replace('el', '').trim();
                const modes = modeService.getAllModes();
                
                // Encontrar el modo que coincida
                const targetMode = modes.find(m => m.name.toLowerCase() === modeNameMatch || m.id === modeNameMatch);
                
                if (targetMode) {
                    modeService.setActiveMode(targetMode.id);
                    responseText = `He cambiado mi configuración cerebral al modo ${targetMode.name}.`;
                    action = "MODE_CHANGED";
                    actionPayload = targetMode.id;
                    io.emit('modes_updated', modeService.getAllModes());
                } else {
                    responseText = `No pude encontrar en mi base de datos un modo llamado ${modeNameMatch}.`;
                }
            }
            else {
                const lowerText = text.toLowerCase();
                const activeMode = modeService.getActiveMode();

                // === MODO FUTBOL (toggle, igual que Programador) ===
                if (activeMode && activeMode.id === 'futbol') {
                    console.log(`[Jarvis Server] ⚽ MODO FUTBOL activo: buscando con Puppeteer.`);
                    try {
                        const { searchSports } = require('./services/aiService');
                        const respuesta = await searchSports(text);
                        responseText = respuesta || "No reconoci el equipo. Escribi el nombre completo (ej: 'Boca Juniors', 'Real Madrid').";
                    } catch (e) {
                        console.error("[Futbol] Error:", e.message);
                        responseText = "Hubo un problema buscando el partido. Intenta de nuevo.";
                    }
                }

                // === MODO PROGRAMADOR AHORA MANEJADO POR AI SERVICE ===
                // El chequeo y ruteo a Python fue desactivado ya que la herramienta nativa build_software en aiService maneja el código.

                // 2. Comandos de sistema (Abrir apps y Entrenamientos)
                const sysCommand = systemService.handleSystemCommand(text);
                
                if (sysCommand.isTraining) {
                    systemService.saveCustomCommand(sysCommand.trigger, sysCommand.appName);
                    responseText = `Entendido. A partir de ahora, cuando me digas "${sysCommand.trigger}", abriré ${sysCommand.appName}.`;
                    action = "TRAINING_SAVED";
                }
                else if (sysCommand.isSystemCommand) {
                    responseText = sysCommand.isLearned
                        ? `Comando aprendido detectado. Ejecutando ${sysCommand.appName}, señor.`
                        : `Abriendo ${sysCommand.appName}.`;

                    const activeMode = modeService.getActiveMode();
                    const success = await systemService.openApp(sysCommand.appName, activeMode.id);
                    if (!success) {
                        responseText = `Hubo un inconveniente al intentar abrir la aplicación ${sysCommand.appName}.`;
                    }
                }
                // 3. Respuesta de IA (Cerebro Híbrido) - Delega todo lo demás a Ollama
                else {
                    const activeMode = modeService.getActiveMode();
                    const screenContext = observerService.getScreenContext();
                    responseText = await aiService.getAIResponse(text, activeMode, screenContext);
                }
            }

        } catch (error) {
            console.error(error);
            responseText = "Lo siento, mi sistema interceptó una excepción no controlada.";
        }

        console.log(`[Jarvis Responde]: ${responseText}`);
        socket.emit('response', { text: responseText, action, actionPayload });
    });

    // Evento manual para cambiar de modo desde la UI
    socket.on('set_mode', (modeId) => {
        if(modeService.setActiveMode(modeId)) {
            io.emit('modes_updated', modeService.getAllModes());
        }
    });

    socket.on('disconnect', () => {
        console.log('[-] Interfaz desconectada (' + socket.id + ')');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n===========================================`);
    console.log(`  JARVIS VIRTUAL ASSISTANT - BACKEND ACTIVE`);
    console.log(`  => Server running on http://localhost:${PORT}`);
    console.log(`===========================================\n`);
    
    // Iniciar el estudio automático en segundo plano
    backgroundTuner.startBackgroundStudying();
    // Iniciar el indexador de accesos directos
    appDiscoveryService.triggerBackgroundScan();
    // Iniciar modulo Cronos para tareas y recordatorios
    reminderService.startScheduler(io);
    // Iniciar escucha de eventos de energia OS (Para Lockscreen)
    powerService.initPowerListener();
});
