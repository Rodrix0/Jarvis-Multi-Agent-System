const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

const ENCRYPTION_KEY = process.env.JARVIS_MEMORY_SECRET || crypto.createHash('sha256').update('JARVIS_OS_LOCAL_KEY_V6').digest();

function encryptAtRest(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(String(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptOnDemand(ciphertext) {
    try {
        const parts = ciphertext.split(':');
        if (parts.length !== 3) return ciphertext;
        const [ivHex, tagHex, encrypted] = parts;
        const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return '[DECRYPTION_ERROR]';
    }
}

const memoryImportanceService = require('./memoryImportanceService');

class MemoryService {
    constructor() {
        this.workingMemory = new Map();
    }

    addMemory({
        type = 'PREFERENCE', // 'EPISODIC', 'SEMANTIC', 'PREFERENCE', 'CORRECTION'
        tier = 'NORMAL',      // 'NORMAL', 'PERSONAL', 'SENSITIVE', 'DO_NOT_PERSIST', 'CORE'
        key = null,
        value,
        source = 'explicit_user_statement', // 'explicit_user_statement', 'inferred_pattern', 'system_observed'
        confidence = null,
        expiresAt = null,
        bypassTriage = false
    }) {
        if (tier === 'DO_NOT_PERSIST') {
            this.workingMemory.set(key || `temp-${Date.now()}`, { type, value, source });
            return { ok: true, tier: 'DO_NOT_PERSIST' };
        }

        // Triaje Automático de Importancia (Ítem 18)
        let effectiveTier = tier;
        let effectiveExpiresAt = expiresAt;
        let effectiveConfidence = typeof confidence === 'number' ? confidence : 1.0;

        if (!bypassTriage) {
            const triage = memoryImportanceService.triageMemory(value, { type, tier, key });
            if (triage.action === 'DISCARD') {
                return {
                    ok: true,
                    discarded: true,
                    action: 'DISCARD',
                    importance: triage.importance,
                    reason: triage.reason
                };
            }

            if (tier === 'NORMAL' && triage.action === 'PERMANENT') {
                effectiveTier = 'CORE';
            }
            if (!effectiveExpiresAt && triage.action === 'EPISODIC') {
                effectiveExpiresAt = triage.expiresAt;
            }
            if (confidence === null || confidence === undefined) {
                effectiveConfidence = triage.importance;
            }
        }

        const id = `mem-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        const storedValue = effectiveTier === 'SENSITIVE' ? encryptAtRest(value) : value;

        try {
            databaseService.db.prepare(`
                INSERT INTO memory (id, type, tier, key, value, source, confidence, created_at, expires_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
            `).run(id, type, effectiveTier, key, storedValue, source, effectiveConfidence, now, effectiveExpiresAt);
            return { ok: true, id, tier: effectiveTier, importance: effectiveConfidence, message: 'Recuerdo guardado con éxito.' };
        } catch (err) {
            return { ok: false, message: err.message };
        }
    }

    queryMemory(topic, authorized = false) {
        const rows = databaseService.db.prepare(`
            SELECT * FROM memory 
            WHERE status = 'ACTIVE' AND (key LIKE ? OR value LIKE ?)
            ORDER BY confidence DESC, created_at DESC
        `).all(`%${topic}%`, `%${topic}%`);

        return rows.map(r => ({
            ...r,
            value: (r.tier === 'SENSITIVE' && authorized) ? decryptOnDemand(r.value) : (r.tier === 'SENSITIVE' ? '[ENCRYPTED_SENSITIVE_DATA]' : r.value)
        }));
    }

    forgetMemory(keyOrTopic) {
        const res = databaseService.db.prepare(`
            UPDATE memory SET status = 'SUPERSEDED' 
            WHERE key LIKE ? OR value LIKE ?
        `).run(`%${keyOrTopic}%`, `%${keyOrTopic}%`);

        return { ok: true, count: res.changes, message: `Se marcaron ${res.changes} recuerdo(s) como olvidados.` };
    }
}

const memoryService = new MemoryService();
module.exports = memoryService;
