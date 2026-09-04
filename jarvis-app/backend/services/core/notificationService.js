const notifier = require('node-notifier');
const eventBus = require('./eventBusService');
const configService = require('./configService');

class NotificationService {
    constructor() {
        this.isQuietMode = false;
        this.ttsQueue = []; // Array<{ message, priority: 0..4, abortController }>
        this.currentTts = null;
        this.io = null;
    }

    setSocketIO(io) {
        this.io = io;
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
        sound = true
    }) {
        const isEmergency = priority === 'EMERGENCY' || priority === 'HIGH';

        // 1. Canal HUD (Socket.io)
        if (channels.includes('HUD') && this.io) {
            this.io.emit('notification', {
                id: Date.now(),
                title,
                message,
                priority,
                timestamp: new Date().toISOString()
            });
        }

        // Si está en Quiet Mode y no es emergencia, no emitir sonido ni Toast ni TTS
        if (this.isQuietMode && !isEmergency) {
            return;
        }

        // 2. Canal Windows Toast
        if (channels.includes('TOAST')) {
            try {
                notifier.notify({
                    title,
                    message,
                    sound: sound && !this.isQuietMode,
                    wait: false
                });
            } catch (e) {}
        }

        // 3. Canal TTS con Prioridades
        if (channels.includes('TTS') && message) {
            this.enqueueTTS(message, isEmergency ? 0 : 2);
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
        if (this.io) {
            this.io.emit('speak_phrase', { phrase: this.currentTts.text });
        }

        // Esperar duración estimada de habla (~60ms por carácter)
        const durationMs = Math.min(10000, Math.max(1200, this.currentTts.text.length * 60));
        setTimeout(() => {
            this.currentTts = null;
            this.processTtsQueue();
        }, durationMs);
    }
}

const notificationService = new NotificationService();
module.exports = notificationService;
