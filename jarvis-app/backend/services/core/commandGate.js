class CommandGate {
    static isRepeatableControl(text) {
        const clean = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^jarvis[,\s]+/, '').trim();
        return /^(?:baja(?:me)?|subi(?:me)?|segui|siguiente|anterior|anda|desplaza(?:me)?|volumen|brillo|mas|menos|arriba|abajo)\b/.test(clean);
    }
    constructor({ now = Date.now, cooldownMs = 6000 } = {}) {
        this.entries = new Map(); this.now = now; this.cooldownMs = cooldownMs;
    }
    claim(key) {
        const now = this.now();
        for (const [k, entry] of this.entries) {
            if (entry.finishedAt !== null && now - entry.finishedAt >= this.cooldownMs) this.entries.delete(k);
        }
        if (this.entries.has(key)) return null;
        const entry = { finishedAt: null };
        this.entries.set(key, entry);
        return { finish: () => { entry.finishedAt = this.now(); }, release: () => this.entries.delete(key) };
    }
}
module.exports = CommandGate;
