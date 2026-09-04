const activityDetectionService = require('./activityDetectionService');
const notificationService = require('../core/notificationService');

class AttentionManager {
    shouldInterruptUser(priority = 'NORMAL') {
        if (priority === 'EMERGENCY') return true;

        const current = activityDetectionService.detectCurrentActivity();
        if (current.activity === 'Gaming' && current.confidence > 0.80) {
            // Durante Gaming solo interrumpir emergencias
            return priority === 'HIGH' || priority === 'EMERGENCY';
        }

        return true;
    }
}

const attentionManager = new AttentionManager();
module.exports = attentionManager;
