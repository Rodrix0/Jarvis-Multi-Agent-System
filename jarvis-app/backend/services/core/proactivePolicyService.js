/**
 * Proactive Policy Service for Jarvis (Ítem 26)
 * Motor de políticas que reacciona inteligentemente a los eventos del Event Bus (PC -> JARVIS).
 * Determina cuándo y cómo actuar proactivamente:
 *  - Enviar notificación visual al HUD
 *  - Emitir aviso por voz neuronal (TTS) respetando el modo activo y reposo
 *  - Ofrecer acciones de seguimiento contextuales
 */

const eventBus = require('./eventBusService');
const { SYSTEM_EVENTS } = require('./eventBusService');
const notificationService = require('./notificationService');

class ProactivePolicyService {
    constructor() {
        this.ttsService = null;
        this.io = null;
        this.modeService = null;
        this.voiceEnabled = true;
        this.unsubscribers = [];
    }

    /**
     * Inicializa dependencias y suscribe a eventos del sistema.
     */
    init({ ttsService = null, io = null, modeService = null } = {}) {
        if (ttsService) this.ttsService = ttsService;
        if (io) this.io = io;
        if (modeService) this.modeService = modeService;

        this.detach();

        // Suscribirse a eventos canónicos
        this.unsubscribers.push(
            eventBus.subscribe(SYSTEM_EVENTS.DOWNLOAD_COMPLETED, ev => this.onDownloadCompleted(ev)),
            eventBus.subscribe(SYSTEM_EVENTS.BATTERY_LOW, ev => this.onBatteryLow(ev)),
            eventBus.subscribe(SYSTEM_EVENTS.CPU_HIGH, ev => this.onCpuHigh(ev)),
            eventBus.subscribe(SYSTEM_EVENTS.APP_CRASH, ev => this.onAppCrash(ev)),
            eventBus.subscribe(SYSTEM_EVENTS.REMINDER_DUE, ev => this.onReminderDue(ev)),
            eventBus.subscribe(SYSTEM_EVENTS.TASK_FINISHED, ev => this.onTaskFinished(ev))
        );

        console.log('[ProactivePolicy] 🧠 Motor de políticas proactivas inicializado.');
    }

    detach() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
    }

    /**
     * Evalúa si está permitido emitir un aviso por voz en el contexto actual.
     * @param {string} priority 'NORMAL' | 'WARNING' | 'EMERGENCY'
     * @returns {boolean}
     */
    shouldSpeak(priority = 'NORMAL') {
        if (!this.voiceEnabled) return false;
        if (!this.ttsService) return false;

        // Si es emergencia siempre habla
        if (priority === 'EMERGENCY') return true;

        // Verificar modo actual
        if (this.modeService && typeof this.modeService.getActiveMode === 'function') {
            const activeMode = this.modeService.getActiveMode() || {};
            const modeName = String(activeMode.name || '').toLowerCase();
            // Silenciar voz automática en modo descanso o modo juego para no interrumpir
            if (modeName.includes('descanso') || modeName.includes('juego') || modeName.includes('silencio')) {
                return false;
            }
        }

        return true;
    }

    /**
     * Reacción ante descarga completada.
     */
    onDownloadCompleted(event) {
        const title = 'Descarga Completada';
        const message = event.message || `Se completó la descarga de ${event.filename || 'tu archivo'}.`;
        const speakText = `Se completó la descarga de ${event.filename || 'tu archivo'}. Te lo dejé en tu carpeta de descargas.`;

        this.notifyHud({ title, message, priority: 'NORMAL', data: event });

        if (this.shouldSpeak('NORMAL')) {
            try { this.ttsService.speak(speakText); } catch (e) {}
        }
    }

    /**
     * Reacción ante batería baja.
     */
    onBatteryLow(event) {
        const isCritical = event.critical === true;
        const priority = isCritical ? 'EMERGENCY' : 'WARNING';
        const title = isCritical ? '⚠️ BATERÍA CRÍTICA' : 'Batería Baja';
        const message = event.message || `Batería al ${event.percent}%.`;
        const speakText = `Atención señor: la batería está al ${event.percent} por ciento. Te recomiendo conectar el cargador.`;

        this.notifyHud({ title, message, priority, data: event });

        if (this.shouldSpeak(priority)) {
            try { this.ttsService.speak(speakText); } catch (e) {}
        }
    }

    /**
     * Reacción ante consumo alto de CPU.
     */
    onCpuHigh(event) {
        const title = 'Consumo Alto de CPU';
        const message = event.message || `Consumo de CPU al ${event.cpuUsage}%.`;
        this.notifyHud({ title, message, priority: 'WARNING', data: event });
    }

    /**
     * Reacción ante fallo de aplicación.
     */
    onAppCrash(event) {
        const title = 'Fallo de Aplicación';
        const message = `La aplicación ${event.appName || 'del sistema'} se cerró inesperadamente.`;
        this.notifyHud({ title, message, priority: 'WARNING', data: event });
    }

    /**
     * Reacción ante vencimiento de recordatorio.
     */
    onReminderDue(event) {
        const title = 'Recordatorio Pendiente';
        const message = event.text || event.message || 'Tenés un recordatorio programado.';
        const speakText = `Señor, tenés un recordatorio: ${message}`;

        this.notifyHud({ title, message, priority: 'NORMAL', data: event });

        if (this.shouldSpeak('NORMAL')) {
            try { this.ttsService.speak(speakText); } catch (e) {}
        }
    }

    /**
     * Reacción ante tarea finalizada del TaskManager.
     */
    onTaskFinished(event) {
        const title = 'Tarea Finalizada';
        const message = `La tarea "${event.description || 'de fondo'}" se completó con éxito.`;
        this.notifyHud({ title, message, priority: 'NORMAL', data: event });
    }

    /**
     * Emite notificación hacia los clientes del HUD y el escritorio de Windows.
     */
    notifyHud({ title, message, priority = 'NORMAL', data = {} }) {
        try {
            notificationService.notify({
                title,
                message,
                priority,
                channels: ['HUD', 'TOAST'],
                data
            });
        } catch (err) {
            console.warn('[ProactivePolicy] Error despachando notificación:', err.message);
        }
    }
}

const proactivePolicyService = new ProactivePolicyService();
module.exports = proactivePolicyService;
module.exports.ProactivePolicyService = ProactivePolicyService;
