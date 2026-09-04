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

    const needsConfirmation = typeof action.confirmation === 'function'
        ? action.confirmation(params, context)
        : action.confirmation === true;
    if (needsConfirmation && !options.confirmed) {
        const token = crypto.randomUUID();
        pendingConfirmations.set(token, { id, params, createdAt: Date.now() });
        setTimeout(() => pendingConfirmations.delete(token), 60000).unref?.();
        return {
            ok: false,
            status: 'awaiting_confirmation',
            actionId: id,
            confirmationToken: token,
            permission: action.permission,
            verified: true,
            message: action.confirmationMessage?.(params) || `Confirmá que querés ejecutar: ${action.name}.`
        };
    }

    try {
        const output = await action.execute(params, context);
        const result = {
            ok: output?.ok !== false,
            status: output?.ok === false ? 'failed' : 'completed',
            actionId: id,
            permission: action.permission,
            verified: output?.verified !== false,
            message: output?.message || `${action.name} completada.`,
            data: output?.data,
            evidence: output?.evidence,
            startedAt,
            finishedAt: new Date().toISOString()
        };
        audit(result);
        return result;
    } catch (error) {
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
        return result;
    }
}

async function confirm(token, context = {}) {
    const pending = pendingConfirmations.get(token);
    if (!pending) return { ok: false, status: 'failed', verified: true, message: 'La confirmación expiró o no existe.' };
    pendingConfirmations.delete(token);
    return execute(pending.id, pending.params, context, { confirmed: true });
}

function cancelConfirmation(token) {
    return pendingConfirmations.delete(token);
}

module.exports = { register, describe, execute, confirm, cancelConfirmation };
