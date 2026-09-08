const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIT_PATH = process.env.JARVIS_ACTION_AUDIT_PATH || path.join(__dirname, '..', 'data', 'action_audit.jsonl');
const actions = new Map();
const pendingConfirmations = new Map();

function register(definition) {
    if (!definition?.id || typeof definition.execute !== 'function') {
        throw new Error('Una acción requiere id y execute().');
    }
    actions.set(definition.id, {
        name: definition.id,
        description: '',
        parameters: {},
        permission: 'standard',
        confirmation: false,
        dependencies: [],
        examples: [],
        ...definition
    });
}

function audit(entry) {
    try {
        fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
        fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(entry)}\n`);
    } catch (error) {
        console.error('[Acciones] No pude escribir auditoría:', error.message);
    }
}

async function dependencyStatus(action, context = {}) {
    const details = [];
    for (const dependency of action.dependencies || []) {
        try {
            const result = typeof dependency.check === 'function'
                ? await dependency.check(context)
                : true;
            const available = typeof result === 'object' ? result.available !== false : result !== false;
            details.push({ id: dependency.id, label: dependency.label || dependency.id, available, detail: result?.detail || '' });
        } catch (error) {
            details.push({ id: dependency.id, label: dependency.label || dependency.id, available: false, detail: error.message });
        }
    }
    return { available: details.every(item => item.available), details };
}

async function describe(context = {}) {
    return Promise.all([...actions.values()].map(async action => {
        const status = await dependencyStatus(action, context);
        return {
            id: action.id,
            name: action.name,
            description: action.description,
            parameters: action.parameters,
            permission: action.permission,
            confirmation: action.confirmation,
            dependencies: status.details,
            available: status.available,
            examples: action.examples
        };
    }));
}

async function execute(id, params = {}, context = {}, options = {}) {
    const action = actions.get(id);
    const startMs = Date.now();
    const startedAt = new Date().toISOString();
    if (!action) return { ok: false, status: 'failed', actionId: id, verified: true, message: `Acción desconocida: ${id}.` };

    const deps = await dependencyStatus(action, context);
    if (!deps.available) {
        const result = {
            ok: false,
            status: 'unavailable',
            actionId: id,
            verified: true,
            message: `No puedo ejecutar ${action.name}: falta ${deps.details.filter(item => !item.available).map(item => item.label).join(', ')}.`,
            dependencies: deps.details,
            startedAt,
            finishedAt: new Date().toISOString()
        };
        audit(result);
        return result;
    }

    // --- Restricción según Perfil de Comportamiento (Ítem 45) ---
    try {
        const { behaviorProfileService } = require('./intelligence/behaviorProfileService');
        const allowedCheck = behaviorProfileService.isActionAllowed(id);
        if (!allowedCheck.allowed && !options.overrideProfile) {
            const result = {
                ok: false,
                status: 'profile_restricted',
                actionId: id,
                verified: true,
                message: allowedCheck.reason,
                startedAt,
                finishedAt: new Date().toISOString()
            };
            audit(result);
            return result;
        }
    } catch (e) {}

    // --- Gobernanza de Confirmaciones según Riesgo (Ítem 38) ---
    const { riskAssessmentService } = require('./security/riskAssessmentService');
    const riskLevel = action.riskLevel || riskAssessmentService.classify(id, params);
    const riskReqs = riskAssessmentService.getRequirements(riskLevel);

    // 1. Nivel CRITICAL: Doble confirmación obligatoria + Validación de PIN
    if (riskLevel === 'CRITICAL') {
        if (!options.confirmed) {
            const token = crypto.randomUUID();
            pendingConfirmations.set(token, { id, params, riskLevel: 'CRITICAL', createdAt: Date.now() });
            setTimeout(() => pendingConfirmations.delete(token), 60000).unref?.();
            return {
                ok: false,
                status: 'awaiting_pin_confirmation',
                riskLevel: 'CRITICAL',
                actionId: id,
                confirmationToken: token,
                permission: action.permission,
                verified: true,
                message: `Esta acción es CRÍTICA (${action.name}). Requiere confirmación doble y PIN de seguridad.`
            };
        } else {
            // Validar PIN de seguridad
            const pinValidation = riskAssessmentService.verifyPin(options.pin);
            if (!pinValidation.ok) {
                return {
                    ok: false,
                    status: 'pin_verification_failed',
                    riskLevel: 'CRITICAL',
                    actionId: id,
                    verified: false,
                    message: pinValidation.error || 'PIN de seguridad inválido para ejecutar acción crítica.',
                    locked: pinValidation.locked
                };
            }
        }
    }
    // 2. Nivel HIGH: Confirmación explícita con token
    else if (riskLevel === 'HIGH') {
        if (!options.confirmed) {
            const token = crypto.randomUUID();
            pendingConfirmations.set(token, { id, params, riskLevel: 'HIGH', createdAt: Date.now() });
            setTimeout(() => pendingConfirmations.delete(token), 60000).unref?.();
            return {
                ok: false,
                status: 'awaiting_confirmation',
                riskLevel: 'HIGH',
                actionId: id,
                confirmationToken: token,
                permission: action.permission,
                verified: true,
                message: action.confirmationMessage?.(params) || `Esta acción es de ALTO RIESGO. Confirmá que querés ejecutar: ${action.name}.`
            };
        }
    }
    // 3. Fallback a confirmación tradicional de la acción (si estuviese explícitamente declarada)
    else {
        const needsConfirmation = typeof action.confirmation === 'function'
            ? action.confirmation(params, context)
            : action.confirmation === true;
        if (needsConfirmation && !options.confirmed) {
            const token = crypto.randomUUID();
            pendingConfirmations.set(token, { id, params, riskLevel, createdAt: Date.now() });
            setTimeout(() => pendingConfirmations.delete(token), 60000).unref?.();
            return {
                ok: false,
                status: 'awaiting_confirmation',
                riskLevel,
                actionId: id,
                confirmationToken: token,
                permission: action.permission,
                verified: true,
                message: action.confirmationMessage?.(params) || `Confirmá que querés ejecutar: ${action.name}.`
            };
        }
    }


    // --- Verificación de Circuit Breaker (Ítem 35) ---
    let breaker = null;
    try {
        const { circuitBreakerManager } = require('./resilience/circuitBreakerService');
        const resourceId = action.circuitBreakerResource || circuitBreakerManager.mapActionToResource(id);
        breaker = circuitBreakerManager.getBreaker(resourceId);

        if (breaker && breaker.isOpen()) {
            const remainingSec = breaker.getRemainingCooldownSeconds();
            const msg = `El servicio '${breaker.name}' se encuentra temporalmente suspendido por fallas consecutivas. Reintentando en ${remainingSec} segundos.`;
            return {
                ok: false,
                status: 'circuit_breaker_open',
                actionId: id,
                permission: action.permission,
                verified: true,
                message: msg,
                cooldownRemainingSeconds: remainingSec,
                startedAt,
                finishedAt: new Date().toISOString()
            };
        }
    } catch (cbErr) {}

    try {
        let output = await action.execute(params, context);
        let verified = output?.verified !== false;
        let verificationResult = null;

        // Post-Execution Verification (verificationService hook)
        if (typeof action.verifier === 'function' && output?.ok !== false) {
            try {
                verificationResult = await action.verifier(output, params, context);
                if (verificationResult && verificationResult.verified === false) {
                    // Reintento automático si está configurado en la acción
                    if (action.retry && !options._retried) {
                        options._retried = true;
                        output = await action.execute(params, context);
                        verificationResult = await action.verifier(output, params, context);
                    }
                }
                if (verificationResult) {
                    verified = verificationResult.verified !== false;
                }
            } catch (verErr) {
                verified = false;
                verificationResult = { verified: false, error: verErr.message };
            }
        }

        const hasExplicitError = output?.ok === false || (typeof action.verifier === 'function' && verificationResult?.error);
        const isOk = !hasExplicitError;

        // Retroalimentar al Circuit Breaker (solo por fallas técnicas reales o rechazos)
        if (breaker) {
            if (isOk) breaker.recordSuccess();
            else breaker.recordFailure();
        }

        const result = {

            ok: isOk,
            status: !isOk ? (verified === false ? 'verification_failed' : 'failed') : 'completed',
            actionId: id,
            permission: action.permission,
            verified,
            message: !verified && verificationResult?.error
                ? `${output?.message || action.name}. (Verificación: ${verificationResult.error})`
                : (output?.message || `${action.name} completada.`),
            data: output?.data,
            evidence: {
                ...(output?.evidence || {}),
                ...(verificationResult ? { verification: verificationResult } : {})
            },
            startedAt,
            finishedAt: new Date().toISOString()
        };
        audit(result);
        try {
            const dashboardService = require('./diagnostics/dashboardService');
            dashboardService.recordActionExecution(id, Date.now() - startMs, isOk ? 'success' : 'failed');
        } catch (e) {}

        // Registrar en Action Timeline (Ítem 48)
        try {
            const { actionTimelineService } = require('./core/actionTimelineService');
            actionTimelineService.recordAction({
                actionId: id,
                params,
                result,
                status: isOk ? 'SUCCESS' : 'FAILED',
                reversible: Boolean(action.reversible || output?.reversible),
                undoData: output?.undoData
            });
        } catch (tlErr) {}

        // Registrar en Trazabilidad de Decisiones y Explicación (Ítem 49)
        try {
            const explanationService = require('./core/explanationService');
            explanationService.recordDecision({
                actionId: id,
                params,
                result,
                status: isOk ? 'SUCCESS' : 'FAILED',
                context: typeof context === 'object' ? context : {}
            });
        } catch (expErr) {}
        try {
            const structuredLogger = require('./diagnostics/structuredLoggerService');
            structuredLogger.log({
                level: isOk ? 'INFO' : 'ERROR',
                module: 'actionKernel',
                action: id,
                result: isOk ? 'success' : 'error',
                duration: Date.now() - startMs,
                error: isOk ? null : { code: result.status, message: result.message },
                metadata: { permission: action.permission, verified }
            });
        } catch (e) {}
        return result;
    } catch (error) {
        if (breaker) {
            try { breaker.recordFailure(error); } catch (e) {}
        }
        const result = {

            ok: false,
            status: 'failed',
            actionId: id,
            verified: true,
            message: error.message,
            startedAt,
            finishedAt: new Date().toISOString()
        };
        audit(result);
        try {
            const dashboardService = require('./diagnostics/dashboardService');
            dashboardService.recordActionExecution(id, Date.now() - startMs, 'error');
        } catch (e) {}
        try {
            const structuredLogger = require('./diagnostics/structuredLoggerService');
            structuredLogger.log({
                level: 'ERROR',
                module: 'actionKernel',
                action: id,
                result: 'error',
                duration: Date.now() - startMs,
                error: { code: 'kernel_exception', message: error.message, stack: error.stack },
                metadata: { actionId: id }
            });
        } catch (e) {}
        return result;
    }

}

async function confirm(token, context = {}, options = {}) {
    const pending = pendingConfirmations.get(token);
    if (!pending) return { ok: false, status: 'failed', verified: true, message: 'La confirmación expiró o no existe.' };
    pendingConfirmations.delete(token);
    const pin = options.pin || context.pin;
    return execute(pending.id, pending.params, context, { confirmed: true, pin });
}


function cancelConfirmation(token) {
    return pendingConfirmations.delete(token);
}

module.exports = { register, describe, execute, confirm, cancelConfirmation };
