const notifier = require('node-notifier');
const { WindowsToaster } = require('node-notifier');
const eventBus = require('./eventBusService');
const configService = require('./configService');

class NotificationService {
    constructor() {
        this.isQuietMode = false;
        this.ttsQueue = []; // Array<{ message, priority: 0..4, abortController }>
        this.currentTts = null;
        this.io = null;
        this.ttsService = null;
        this.windowsToaster = new WindowsToaster();
    }

    setSocketIO(io) {
        this.io = io;
    }

    setTtsService(tts) {
        this.ttsService = tts;
    }

    setQuietMode(enabled) {
        this.isQuietMode = Boolean(enabled);
        console.log(`[Notifications] Modo No Molestar (Quiet Mode): ${this.isQuietMode ? 'ACTIVADO' : 'DESACTIVADO'}`);
    }

    notify({
        title = 'Jarvis OS',
        message = '',
        priority = 'NORMAL', // 'EMERGENCY', 'HIGH', 'NORMAL', 'LOW'
        channels = ['HUD', 'TOAST', 'TTS'],
        sound = true,
        data = null
    }) {
        const isEmergency = priority === 'EMERGENCY' || priority === 'HIGH';

        // 1. Canal HUD (Socket.io)
        if (channels.includes('HUD') && this.io) {
            try {
                this.io.emit('notification', {
                    id: Date.now(),
                    title,
                    message,
                    priority,
                    data,
                    timestamp: new Date().toISOString()
                });
            } catch (err) {
                console.warn('[Notifications] Error emitiendo a HUD:', err.message);
            }
        }

        // Si está en Quiet Mode y no es emergencia, no emitir sonido ni Toast ni TTS
        if (this.isQuietMode && !isEmergency) {
            return;
        }

        // 2. Canal Windows Toast Nativo
        if (channels.includes('TOAST')) {
            this._sendWindowsToast(title, message, sound && !this.isQuietMode);
        }

        // 3. Canal TTS con Prioridades
        if (channels.includes('TTS') && message) {
            this.enqueueTTS(message, isEmergency ? 0 : 2);
        }
    }

    _sendWindowsToast(title, message, playSound = true) {
        // Intentar primero con WindowsToaster nativo de Windows 10/11
        try {
            this.windowsToaster.notify({
                title: String(title),
                message: String(message),
                sound: playSound,
                appId: 'Jarvis OS',
                wait: false
            }, (err) => {
                if (err) {
                    // Fallback a notifu estándar
                    try {
                        notifier.notify({
                            title: String(title),
                            message: String(message),
                            sound: playSound,
                            wait: false
                        });
                    } catch (fallbackErr) {
                        console.warn('[Notifications] Fallback de notificación falló:', fallbackErr.message);
                    }
                }
            });
        } catch (e) {
            try {
                notifier.notify({
                    title: String(title),
                    message: String(message),
                    sound: playSound,
                    wait: false
                });
            } catch (err) {
                console.warn('[Notifications] Error en notificación de Windows:', err.message);
            }
        }
    }

    enqueueTTS(text, priority = 2) {
        // Si entra una emergencia (prioridad 0), interrumpir audio actual si existe
        if (priority === 0 && this.currentTts) {
            this.currentTts.abortController?.abort();
            this.currentTts = null;
        }

        const ttsItem = {
            text,
            priority,
            abortController: new AbortController()
        };

        if (priority === 0) {
            this.ttsQueue.unshift(ttsItem); // Al frente de la cola
        } else {
            this.ttsQueue.push(ttsItem);
        }

        this.processTtsQueue();
    }

    async processTtsQueue() {
        if (this.currentTts || this.ttsQueue.length === 0) return;

        this.currentTts = this.ttsQueue.shift();
        const textToSpeak = this.currentTts.text;

        // 1. Sintetizar y reproducir voz en la PC si ttsService está disponible
        if (this.ttsService && typeof this.ttsService.speak === 'function') {
            this.ttsService.speak(textToSpeak).catch(err => {
                console.warn('[Notifications] Error reproduciendo TTS:', err.message);
            });
        }

        // 2. Emitir al socket para clientes frontend
        if (this.io) {
            this.io.emit('speak_phrase', { phrase: textToSpeak });
        }

        // Esperar duración estimada de habla (~60ms por carácter)
        const durationMs = Math.min(10000, Math.max(1200, textToSpeak.length * 60));
        setTimeout(() => {
            this.currentTts = null;
            this.processTtsQueue();
        }, durationMs);
    }
}

const notificationService = new NotificationService();
module.exports = notificationService;
