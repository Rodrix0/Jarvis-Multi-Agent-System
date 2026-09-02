class ContextManager {
    constructor() {
        this.contexts = new Map(); // sessionId -> ContextState
    }

    getContext(sessionId = 'default-session') {
        if (!this.contexts.has(sessionId)) {
            this.contexts.set(sessionId, {
                currentFile: null,
                currentTask: null,
                currentContactCandidate: null,
                conversationActionId: null,
                lastTopic: null,
                lastMentionedEntities: [],
                updatedAt: Date.now()
            });
        }
        return this.contexts.get(sessionId);
    }

    updateContext(sessionId = 'default-session', updates = {}) {
        const ctx = this.getContext(sessionId);
        Object.assign(ctx, updates, { updatedAt: Date.now() });
        return ctx;
    }

    resolvePronounReference(text, sessionId = 'default-session') {
        const ctx = this.getContext(sessionId);
        const lower = String(text || '').toLowerCase().trim();

        // Si dice "abrilo", "mandáselo", "borralo"
        if (/\b(abrilo|abrilas|abrilos|borralo|borrala|mandaselo|enviaselo|copialo)\b/i.test(lower)) {
            return {
                hasPronoun: true,
                targetFile: ctx.currentFile,
                targetContact: ctx.currentContactCandidate
            };
        }

        return { hasPronoun: false };
    }
}

const contextManager = new ContextManager();
module.exports = contextManager;
