const securityPolicyService = require('./securityPolicyService');
const authorizationManager = require('./authorizationManager');
const executionManager = require('./executionManager');
const eventBus = require('./eventBusService');

class ActionRouterService {
    constructor() {
        this.actionHandlers = new Map(); // actionId -> handlerFunction
    }

    registerAction(actionId, handler) {
        this.actionHandlers.set(actionId, handler);
    }

    async dispatch({
        action,
        params = {},
        actionId = null,
        authToken = null,
        sessionId = 'default-session',
        dryRun = false
    }) {
        const level = securityPolicyService.getActionLevel(action);

        // Modo Simulación (Dry Run)
        if (dryRun) {
            return {
                ok: true,
                dryRun: true,
                action,
                level,
                params,
                description: `Simulación de ejecución para ${action}. Nivel de riesgo requerido: ${level}.`
            };
        }

        // 1. Validaciones de Seguridad
        if (action === 'process.kill') {
            const procValidation = securityPolicyService.validateProcessKill(params.processName || params.appName);
            if (!procValidation.allowed) return { ok: false, ...procValidation };
        }
        if (['file.delete', 'file.move', 'file.rename'].includes(action)) {
            const pathValidation = securityPolicyService.validatePathAccess(params.targetPath || params.filePath, true);
            if (!pathValidation.allowed) return { ok: false, ...pathValidation };
        }

        // 2. Control de Autorización para Acciones Críticas (L3)
        if (level === 'L3') {
            if (!authToken) {
                // Generar token de 30s y solicitar confirmación al usuario
                const tokenObj = authorizationManager.createToken({ action, params, sessionId });
                return {
                    ok: false,
                    status: 'AWAITING_AUTHORIZATION',
                    code: 'AUTH_REQUIRED_L3',
                    level: 'L3',
                    action,
                    params,
                    token: tokenObj.token,
                    expiresInSeconds: 30,
                    message: `La acción ${action} es crítica (L3). Se requiere confirmación del usuario antes de 30 segundos.`
                };
            }

            // Validar token suministrado
            const authValidation = authorizationManager.validateAndConsumeToken(authToken, action, params);
            if (!authValidation.valid) {
                return { ok: false, code: authValidation.code, message: authValidation.reason };
            }
        }

        // 3. Obtener handler registrado
        const handler = this.actionHandlers.get(action);
        if (!handler) {
            return { ok: false, code: 'ERR_ACTION_NOT_REGISTERED', message: `No hay un ejecutor registrado para la acción ${action}.` };
        }

        // 4. Enviar a ExecutionManager
        return await executionManager.runTask({
            action,
            actionId: actionId || `act-${Date.now()}`,
            level,
            params,
            reversible: ['file.move', 'file.rename', 'file.delete', 'audio.volume'].includes(action),
            executeFn: async (abortSignal) => {
                return await handler(params, { abortSignal, sessionId });
            }
        });
    }
}

const actionRouterService = new ActionRouterService();
module.exports = actionRouterService;
