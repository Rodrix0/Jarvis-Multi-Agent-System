const fs = require('fs');
const path = require('path');

const PROFILE_PATH = process.env.JARVIS_USER_PROFILE_PATH || path.join(__dirname, '..', '..', 'data', 'user_profile.json');

const DEFAULT_PROFILE = {
    version: 1,
    identity: {
        name: "Rodrigo",
        nickname: "Rodri",
        role: "Creador y Usuario Principal",
        language: "es-AR",
        honorific: "señor"
    },
    communication_style: {
        tone: "conciso, directo, respetuoso y resolutivo",
        rule: "Llamarlo 'señor', no dar rodeos ni explicaciones redundantes a menos que lo pida expresamente."
    },
    preferences: {
        entertainment: {
            streaming_platform: "Netflix",
            netflix_profile: "Rodri (icono de Luffy)",
            favorite_genres: ["Anime", "Ciencia Ficción", "Acción", "Drama"],
            favorite_shows: ["One Piece", "Haikyu", "Demon Slayer", "Breaking Bad"]
        },
        hardware: {
            tv: "AIWA con control remoto IR vía BroadLink RM4 mini",
            os: "Windows 11 PC",
            default_volume: 20
        }
    },
    routines_and_projects: {
        active_projects: [
            "Jarvis Multi-Agent System (asistente local para automatización de PC y hogar)"
        ],
        routines: [
            "Control de TV nocturno y reproducción en Netflix / Stremio",
            "Desarrollo de software y automatizaciones en PC"
        ]
    },
    last_updated: new Date().toISOString()
};

class ProfileService {
    constructor() {
        this.cache = null;
        this.lastRead = 0;
    }

    getProfile() {
        const now = Date.now();
        if (this.cache && (now - this.lastRead < 5000)) {
            return this.cache;
        }

        try {
            if (!fs.existsSync(PROFILE_PATH)) {
                this.saveProfile(DEFAULT_PROFILE);
                this.cache = structuredClone(DEFAULT_PROFILE);
                this.lastRead = now;
                return this.cache;
            }

            const content = fs.readFileSync(PROFILE_PATH, 'utf8');
            this.cache = JSON.parse(content);
            this.lastRead = now;
            return this.cache;
        } catch (err) {
            console.error('[ProfileService] Error leyendo perfil, usando default:', err.message);
            return this.cache || structuredClone(DEFAULT_PROFILE);
        }
    }

    saveProfile(profile) {
        fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
        profile.last_updated = new Date().toISOString();
        const tmpPath = `${PROFILE_PATH}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(profile, null, 2), 'utf8');
        fs.renameSync(tmpPath, PROFILE_PATH);
        this.cache = profile;
        this.lastRead = Date.now();
    }

    /**
     * Actualización con filtro estricto anti-alucinación.
     * Solo permite mutaciones si:
     * 1. `options.explicit === true` (el usuario dijo explícitamente "guardá en mi perfil...")
     * 2. O `options.source === 'admin'`
     * Impide que charlas casuales borren o alteren el perfil nuclear.
     */
    updateProfile(section, data, options = { explicit: false, source: 'user' }) {
        if (!options.explicit && options.source !== 'admin') {
            console.warn(`[ProfileService] Intento de actualización bloqueado por filtro estricto: no fue explícito.`);
            return {
                ok: false,
                rejected: true,
                reason: 'El perfil permanente solo se actualiza con una orden explícita (ej. "guardá en mi perfil que...").'
            };
        }

        const profile = structuredClone(this.getProfile());

        if (section === 'identity') {
            if (typeof data === 'object') {
                Object.assign(profile.identity, data);
            }
        } else if (section === 'entertainment') {
            if (!profile.preferences) profile.preferences = {};
            if (!profile.preferences.entertainment) profile.preferences.entertainment = {};
            
            if (Array.isArray(data.favorite_shows)) {
                // Añadir sin duplicar
                const current = new Set(profile.preferences.entertainment.favorite_shows || []);
                data.favorite_shows.forEach(s => current.add(s));
                profile.preferences.entertainment.favorite_shows = Array.from(current);
            }
            if (data.netflix_profile) profile.preferences.entertainment.netflix_profile = data.netflix_profile;
            if (data.streaming_platform) profile.preferences.entertainment.streaming_platform = data.streaming_platform;
        } else if (section === 'projects') {
            if (!profile.routines_and_projects) profile.routines_and_projects = {};
            if (!Array.isArray(profile.routines_and_projects.active_projects)) {
                profile.routines_and_projects.active_projects = [];
            }
            if (typeof data === 'string') {
                if (!profile.routines_and_projects.active_projects.includes(data)) {
                    profile.routines_and_projects.active_projects.push(data);
                }
            } else if (Array.isArray(data)) {
                data.forEach(p => {
                    if (!profile.routines_and_projects.active_projects.includes(p)) {
                        profile.routines_and_projects.active_projects.push(p);
                    }
                });
            }
        } else if (section === 'hardware') {
            if (!profile.preferences) profile.preferences = {};
            profile.preferences.hardware = { ...profile.preferences.hardware, ...data };
        } else {
            return { ok: false, reason: `Sección no reconocida o no permitida: ${section}` };
        }

        this.saveProfile(profile);
        return { ok: true, profile };
    }

    /**
     * Genera un bloque conciso y de alto impacto para inyectar en el system prompt de Ollama.
     */
    getSystemPromptBlock() {
        const p = this.getProfile();
        const id = p.identity || {};
        const style = p.communication_style || {};
        const ent = (p.preferences && p.preferences.entertainment) || {};
        const hw = (p.preferences && p.preferences.hardware) || {};
        const proj = (p.routines_and_projects && p.routines_and_projects.active_projects) || [];

        const shows = Array.isArray(ent.favorite_shows) ? ent.favorite_shows.join(', ') : 'One Piece';
        const projectsStr = proj.length > 0 ? proj.join('; ') : 'Jarvis Multi-Agent System';

        return [
            `\n[BLOQUE PERFIL HUMANO - IDENTIDAD Y PREFERENCIAS NUCLEARES]`,
            `- Usuario: ${id.name || 'Rodrigo'} (${id.nickname || 'Rodri'}). Trátalo siempre con respeto de "${id.honorific || 'señor'}".`,
            `- Estilo de respuesta: ${style.tone || 'conciso, directo y resolutivo'}. ${style.rule || 'Sin rodeos ni explicaciones redundantes.'}`,
            `- Preferencias de entretenimiento: Su plataforma principal es ${ent.streaming_platform || 'Netflix'} (perfil: ${ent.netflix_profile || 'Rodri'}). Series y animes favoritos: ${shows}.`,
            `- Entorno y hardware: TV ${hw.tv || 'AIWA con BroadLink RM4 mini'}, ${hw.os || 'Windows 11 PC'}.`,
            `- Proyectos activos: ${projectsStr}.`,
            `------------------------------------------------------------\n`
        ].join('\n');
    }
}

const profileService = new ProfileService();
module.exports = profileService;
