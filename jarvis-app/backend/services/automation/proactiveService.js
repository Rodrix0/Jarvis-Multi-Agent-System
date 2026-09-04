const notificationService = require('../core/notificationService');

class ProactiveService {
    constructor() {
        this.cooldowns = new Map(); // triggerName -> lastFiredTimestamp
        this.defaultCooldowns = {
            'battery_low': 30 * 60 * 1000,        // 30 minutos
            'routine_suggestion': 24 * 60 * 60 * 1000 // 24 horas
        };
    }

    canTrigger(triggerName) {
        const last = this.cooldowns.get(triggerName);
        if (!last) return true;
        const cooldown = this.defaultCooldowns[triggerName] || 15 * 60 * 1000;
        return Date.now() - last >= cooldown;
    }

    recordTrigger(triggerName) {
        this.cooldowns.set(triggerName, Date.now());
    }

    suggestAction(triggerName, suggestionText, level = 'L2') {
        if (!this.canTrigger(triggerName)) return false;

        // Gobernanza L0-L4: L3 y L4 NUNCA autónomas
        if (level === 'L3' || level === 'L4') return false;

        this.recordTrigger(triggerName);
        notificationService.notify({
            title: 'Sugerencia de Jarvis',
            message: suggestionText,
            priority: 'NORMAL',
            channels: ['HUD', 'TOAST']
        });
        return true;
    }
}

const proactiveService = new ProactiveService();
module.exports = proactiveService;
