const crypto = require('crypto');

const TOKEN_EXPIRY_MS = 30 * 1000; // 30 segundos
const SECRET_KEY = process.env.JARVIS_AUTH_SECRET || crypto.randomBytes(32).toString('hex');

function canonicalParams(params = {}) {
    const keys = Object.keys(params).sort();
    return JSON.stringify(keys.reduce((acc, k) => {
        acc[k] = params[k];
        return acc;
    }, {}));
}

function computeParamsHash(params = {}) {
    return crypto.createHash('sha256').update(canonicalParams(params), 'utf8').digest('hex');
}

class AuthorizationManager {
    constructor() {
        this.activeTokens = new Map(); // token -> TokenData
        this.conversationalContexts = new Map(); // sessionId -> ContextData
    }

    createToken({ action, params = {}, sessionId = 'default-session' }) {
        const tokenId = crypto.randomUUID();
        const nonce = crypto.randomBytes(16).toString('hex');
        const createdAt = Date.now();
        const expiresAt = createdAt + TOKEN_EXPIRY_MS;
        const paramsHash = computeParamsHash(params);

        const payload = `${tokenId}|${action}|${paramsHash}|${sessionId}|${createdAt}|${expiresAt}|${nonce}`;
        const signature = crypto.createHmac('sha256', SECRET_KEY).update(payload, 'utf8').digest('hex');

        const tokenData = {
            tokenId,
            action,
            paramsHash,
            sessionId,
            createdAt,
            expiresAt,
            nonce,
            signature,
            used: false
        };

        this.activeTokens.set(tokenId, tokenData);
        setTimeout(() => this.activeTokens.delete(tokenId), TOKEN_EXPIRY_MS + 5000).unref?.();

        return {
            token: tokenId,
            expiresAt,
            expiresInSeconds: 30,
            action,
            nonce
        };
    }

    validateAndConsumeToken(tokenId, action, params = {}) {
        const tokenData = this.activeTokens.get(tokenId);
        if (!tokenData) {
            return { valid: false, code: 'ERR_AUTH_NOT_FOUND', reason: 'Token de autorización no encontrado o expirado.' };
        }

        if (tokenData.used) {
            return { valid: false, code: 'ERR_AUTH_REUSED', reason: 'El token de autorización ya fue consumido.' };
        }

        if (Date.now() > tokenData.expiresAt) {
            this.activeTokens.delete(tokenId);
            return { valid: false, code: 'ERR_AUTH_EXPIRED', reason: 'El token de autorización ha expirado (límite de 30s excedido).' };
        }

        if (tokenData.action !== action) {
            return { valid: false, code: 'ERR_AUTH_ACTION_MISMATCH', reason: `El token no corresponde a la acción solicitada (${action}).` };
        }

        const incomingParamsHash = computeParamsHash(params);
        if (tokenData.paramsHash !== incomingParamsHash) {
            return { valid: false, code: 'ERR_AUTH_PARAMS_MISMATCH', reason: 'Los parámetros de la acción no coinciden con los autorizados.' };
        }

        const payload = `${tokenData.tokenId}|${tokenData.action}|${tokenData.paramsHash}|${tokenData.sessionId}|${tokenData.createdAt}|${tokenData.expiresAt}|${tokenData.nonce}`;
        const expectedSignature = crypto.createHmac('sha256', SECRET_KEY).update(payload, 'utf8').digest('hex');
        if (expectedSignature !== tokenData.signature) {
            return { valid: false, code: 'ERR_AUTH_SIGNATURE_INVALID', reason: 'Firma de seguridad de autorización inválida.' };
        }

        // Consumir token (de un solo uso)
        tokenData.used = true;
        this.activeTokens.delete(tokenId);

        return { valid: true };
    }

    setConversationalContext(sessionId, context) {
        this.conversationalContexts.set(sessionId, {
            ...context,
            updatedAt: Date.now(),
            expiresAt: Date.now() + TOKEN_EXPIRY_MS
        });
    }

    getConversationalContext(sessionId) {
        const ctx = this.conversationalContexts.get(sessionId);
        if (!ctx) return null;
        if (Date.now() > ctx.expiresAt) {
            this.conversationalContexts.delete(sessionId);
            return null;
        }
        return ctx;
    }

    clearConversationalContext(sessionId) {
        this.conversationalContexts.delete(sessionId);
    }
}

const authorizationManager = new AuthorizationManager();
module.exports = authorizationManager;
