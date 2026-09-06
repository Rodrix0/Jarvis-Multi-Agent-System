/**
 * behaviorProfileService.js
 * 
 * Sistema Integral de Perfiles de Comportamiento para JARVIS.
 * 
 * Perfiles Soportados:
 * 1. NORMAL  - Equilibrio general, herramientas estándar, modelo balanceado.
 * 2. CODING  - Herramientas dev, modelo técnico, baja temperatura, contexto profundo.
 * 3. GAMING  - Cero distracciones, respuestas telegráficas (< 6 palabras), DND proactivo.
 * 4. STUDY   - Modo académico, didáctico, herramientas documentales y síntesis.
 * 5. HOME    - Domótica, Spotify, TV, tono cálido y proactividad doméstica.
 */

const fs = require('fs');
const path = require('path');
const eventBus = require('../core/eventBusService');
const modeService = require('../modeService');

const PROFILES_FILE = path.join(__dirname, '..', '..', 'data', 'profiles', 'saved_profiles.json');

const BUILTIN_PROFILES = {
    NORMAL: {
        id: 'NORMAL',
        name: 'Normal / Asistente General',
        description: 'Equilibrio operativo entre rapidez, asistencia cotidiana y respuesta conversacional.',
        model: 'qwen2.5:3b',
        temperature: 0.5,
        maxTokens: 512,
        verbosity: 'BALANCED',
        proactiveAggressiveness: 'MEDIUM',
        allowedCategories: ['*'],
        blockedCategories: [],
        blockedActions: [],
        allowProactiveSuggestions: true,
        promptDirective: 'Eres Jarvis, un asistente personal inteligente y eficiente. Responde con claridad, cortesía y precisión equilibrada.'
    },
    CODING: {
        id: 'CODING',
        name: 'Coding / Ingeniería de Software',
        description: 'Optimizado para programación intensiva, Git, terminal y reparación autónoma de proyectos.',
        model: 'qwen2.5-coder:7b',
        temperature: 0.15,
        maxTokens: 1024,
        verbosity: 'DETAILED',
        proactiveAggressiveness: 'HIGH',
        allowedCategories: ['code', 'git', 'snapshot', 'terminal', 'file', 'system', 'diagnostics'],
        blockedCategories: ['gaming', 'social'],
        blockedActions: [],
        allowProactiveSuggestions: true,
        promptDirective: 'Modo CODING activado: Actúas como un ingeniero de software senior y coding agent autónomo. Responde con rigor técnico, diffs unificados, análisis de sintaxis y arquitectura limpia.'
    },
    GAMING: {
        id: 'GAMING',
        name: 'Gaming / Rendimiento en Juegos',
        description: 'Cero interrupciones, latencia mínima, respuestas telegráficas y DND absoluto.',
        model: 'qwen2.5:1.5b',
        temperature: 0.2,
        maxTokens: 64,
        verbosity: 'TELEGRAPHIC',
        proactiveAggressiveness: 'OFF',
        allowedCategories: ['audio', 'system.stats', 'window', 'media'],
        blockedCategories: ['code', 'git', 'snapshot', 'document'],
        blockedActions: ['code.*', 'git.*', 'snapshot.*', 'document.*'],
        allowProactiveSuggestions: false,
        promptDirective: 'Modo GAMING activado: El usuario está jugando. Responde de forma ultra-corta (máximo 6 palabras), directa y telegráfica. Cero explicaciones largas ni sugerencias.'
    },
    STUDY: {
        id: 'STUDY',
        name: 'Estudio y Concentración Académica',
        description: 'Enfocado en lectura, generación de documentos, síntesis teórica y foco.',
        model: 'qwen2.5:7b',
        temperature: 0.35,
        maxTokens: 768,
        verbosity: 'DIDACTIC',
        proactiveAggressiveness: 'MEDIUM',
        allowedCategories: ['document', 'search', 'summary', 'agenda', 'audio.ambient', 'file'],
        blockedCategories: ['gaming'],
        blockedActions: ['gaming.*'],
        allowProactiveSuggestions: true,
        promptDirective: 'Modo STUDY activado: Eres un tutor académico de alto nivel. Estructura tus explicaciones didácticamente, con puntos clave y resúmenes concisos.'
    },
    HOME: {
        id: 'HOME',
        name: 'Hogar y Confort Doméstico',
        description: 'Domótica, entretenimiento, TV, Spotify y tono familiar cálido.',
        model: 'qwen2.5:3b',
        temperature: 0.7,
        maxTokens: 512,
        verbosity: 'FRIENDLY',
        proactiveAggressiveness: 'HIGH',
        allowedCategories: ['homeassistant', 'tv', 'spotify', 'weather', 'reminders', 'voice', 'media'],
        blockedCategories: ['code', 'git'],
        blockedActions: ['code.*', 'git.*', 'snapshot.*'],
        allowProactiveSuggestions: true,
        promptDirective: 'Modo HOME activado: Asistente hogareño cálido, amigable y proactivo para la automatización de la casa, música y entretenimiento.'
    }
};

class BehaviorProfileService {
    constructor() {
        this.profilesFile = PROFILES_FILE;
        this.activeProfileId = 'NORMAL';
        this._ensureDirectories();
    }

    _ensureDirectories() {
        try {
            fs.mkdirSync(path.dirname(this.profilesFile), { recursive: true });
            if (!fs.existsSync(this.profilesFile)) {
                fs.writeFileSync(this.profilesFile, JSON.stringify({}, null, 2), 'utf8');
            }
        } catch (e) {
            console.error('[BehaviorProfileService] Error inicializando directorios:', e.message);
        }
    }

    _loadCustomProfiles() {
        try {
            if (!fs.existsSync(this.profilesFile)) return {};
            return JSON.parse(fs.readFileSync(this.profilesFile, 'utf8'));
        } catch {
            return {};
        }
    }

    /**
     * Obtiene el perfil actualmente activo con todos sus atributos.
     */
    getActiveProfile() {
        return this.getProfile(this.activeProfileId);
    }

    /**
     * Obtiene la definición de un perfil por su ID.
     */
    getProfile(profileId) {
        const id = String(profileId || 'NORMAL').trim().toUpperCase();
        if (BUILTIN_PROFILES[id]) return BUILTIN_PROFILES[id];
        const customs = this._loadCustomProfiles();
        if (customs[id]) return customs[id];
        return BUILTIN_PROFILES.NORMAL;
    }

    /**
     * Conmuta el perfil de comportamiento activo en tiempo real.
     */
    switchProfile(profileId, reason = 'user_command') {
        const targetId = String(profileId || '').trim().toUpperCase();
        const profile = this.getProfile(targetId);

        const previousId = this.activeProfileId;
        this.activeProfileId = profile.id;

        // Sincronizar con modeService tradicional
        try {
            modeService.setActiveMode(profile.id.toLowerCase());
        } catch {}

        // Emitir evento por el bus de eventos
        try {
            eventBus.publish('profile.switched', {
                previousProfile: previousId,
                activeProfile: profile.id,
                reason,
                timestamp: new Date().toISOString()
            });
        } catch {}

        // Auditoría estructurada
        try {
            const structuredLogger = require('../diagnostics/structuredLoggerService');
            structuredLogger.log({
                level: 'INFO',
                module: 'behaviorProfile',
                action: 'profile_switched',
                result: 'success',
                metadata: {
                    from: previousId,
                    to: profile.id,
                    reason,
                    model: profile.model,
                    verbosity: profile.verbosity
                }
            });
        } catch {}

        return {
            ok: true,
            previousProfile: previousId,
            activeProfile: profile.id,
            profile,
            message: `Perfil conmutado a '${profile.name}'. Modelo: ${profile.model}, Verbosidad: ${profile.verbosity}.`
        };
    }

    /**
     * Verifica si una herramienta o acción está permitida en el perfil activo.
     */
    isActionAllowed(actionId) {
        const profile = this.getActiveProfile();
        const actId = String(actionId || '').toLowerCase();

        // Verificar acciones bloqueadas explícitas (e.g. 'code.*' o coincidencia exacta)
        for (const pattern of profile.blockedActions || []) {
            if (pattern.endsWith('.*')) {
                const prefix = pattern.slice(0, -2).toLowerCase();
                if (actId.startsWith(prefix)) {
                    return {
                        allowed: false,
                        reason: `La acción '${actionId}' está restringida en el perfil ${profile.id}.`
                    };
                }
            } else if (pattern.toLowerCase() === actId) {
                return {
                    allowed: false,
                    reason: `La acción '${actionId}' está bloqueada en el perfil ${profile.id}.`
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Adapta la respuesta generada a la verbosidad configurada en el perfil.
     */
    formatResponseForProfile(text) {
        const profile = this.getActiveProfile();
        const raw = String(text || '').trim();

        if (profile.verbosity === 'TELEGRAPHIC') {
            // Modo gaming: máximo 6 a 8 palabras, telegráfico
            const words = raw.split(/\s+/).slice(0, 8);
            let short = words.join(' ');
            if (short.length < raw.length && !short.endsWith('.')) short += '.';
            return short;
        }

        if (profile.verbosity === 'DIDACTIC') {
            // Si no tiene viñetas y es largo, asegura estructura limpia
            return raw;
        }

        return raw;
    }

    /**
     * Guarda un perfil personalizado.
     */
    saveCustomProfile(id, config) {
        const cleanId = String(id || '').trim().toUpperCase();
        if (!cleanId) throw new Error('Se requiere un identificador de perfil válido.');

        const customs = this._loadCustomProfiles();
        const fullProfile = {
            id: cleanId,
            name: config.name || cleanId,
            description: config.description || 'Perfil personalizado de usuario',
            model: config.model || 'qwen2.5:3b',
            temperature: typeof config.temperature === 'number' ? config.temperature : 0.5,
            maxTokens: config.maxTokens || 512,
            verbosity: config.verbosity || 'BALANCED',
            proactiveAggressiveness: config.proactiveAggressiveness || 'MEDIUM',
            allowedCategories: config.allowedCategories || ['*'],
            blockedCategories: config.blockedCategories || [],
            blockedActions: config.blockedActions || [],
            allowProactiveSuggestions: config.allowProactiveSuggestions !== false,
            promptDirective: config.promptDirective || `Perfil ${cleanId} activo.`
        };

        customs[cleanId] = fullProfile;
        fs.writeFileSync(this.profilesFile, JSON.stringify(customs, null, 2), 'utf8');
        return fullProfile;
    }

    /**
     * Lista todos los perfiles disponibles (incorporados y personalizados).
     */
    listProfiles() {
        const customs = this._loadCustomProfiles();
        const builtins = Object.values(BUILTIN_PROFILES).map(p => ({
            ...p,
            type: 'builtin',
            isActive: p.id === this.activeProfileId
        }));
        const userCustoms = Object.values(customs).map(p => ({
            ...p,
            type: 'custom',
            isActive: p.id === this.activeProfileId
        }));
        return [...builtins, ...userCustoms];
    }
}

const behaviorProfileService = new BehaviorProfileService();

module.exports = {
    BehaviorProfileService,
    behaviorProfileService,
    BUILTIN_PROFILES
};
