const actionRouterService = require('../core/actionRouterService');
const notificationService = require('../core/notificationService');

class RoutineService {
    constructor() {
        this.routines = new Map();
        this.initDefaultRoutines();
    }

    initDefaultRoutines() {
        this.routines.set('modo estudio', [
            { action: 'audio.set-volume', params: { percent: 30 } },
            { action: 'display.set-brightness', params: { percent: 50 } }
        ]);
        this.routines.set('modo juego', [
            { action: 'audio.set-volume', params: { percent: 70 } }
        ]);
    }

    async executeRoutine(routineName) {
        const clean = String(routineName || '').toLowerCase().trim();
        const steps = this.routines.get(clean);
        if (!steps) {
            return { ok: false, message: `No se encontró la rutina "${routineName}".` };
        }

        notificationService.notify({ title: 'Rutina Jarvis', message: `Activando ${routineName}...` });

        const results = [];
        for (const step of steps) {
            const res = await actionRouterService.dispatch({ action: step.action, params: step.params });
            results.push(res);
        }

        return { ok: true, routine: routineName, stepsExecuted: results.length, message: `Rutina "${routineName}" completada.` };
    }
}

const routineService = new RoutineService();
module.exports = routineService;
