/**
 * Project Memory Service for Jarvis (Ítem 16)
 * Proporciona memoria multidimensional aislada por proyectos (projects/).
 * Cada proyecto contiene:
 *   - summary (visión general y objetivos)
 *   - decisions (registro inmutable de decisiones técnicas y arquitectura)
 *   - files (catálogo de archivos, escenas y rutas clave)
 *   - important_facts (reglas, versiones de motor, restricciones)
 *   - tasks (gestor de tareas activas, en progreso y completadas)
 *   - recent_context (últimos intercambios de diálogo específicos del proyecto)
 *
 * Incluye un motor de detección y conmutación contextual ("Seguimos con Unity")
 * y ensamblado de contexto compuesto (User Core + Project Dossier + Recent Context).
 */

const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

class ProjectMemoryService {
    constructor() {
        this._ensureSchema();
    }

    _ensureSchema() {
        try {
            databaseService.db.exec(`
                CREATE TABLE IF NOT EXISTS projects_manifest (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    aliases_json TEXT,
                    summary TEXT,
                    decisions_json TEXT,
                    files_json TEXT,
                    facts_json TEXT,
                    tasks_json TEXT,
                    recent_context_json TEXT,
                    created_at TEXT NOT NULL,
                    last_active_at TEXT NOT NULL,
                    is_active INTEGER DEFAULT 0
                );
            `);
        } catch (err) {
            console.error('[ProjectMemory] Error asegurando esquema SQLite:', err.message);
        }
    }

    /**
     * Crea o actualiza un proyecto en el catálogo.
     */
    createOrUpdateProject({
        id,
        name,
        aliases = [],
        summary = '',
        decisions = [],
        files = [],
        facts = [],
        tasks = [],
        recentContext = [],
        isActive = false
    }) {
        if (!id || !name) {
            return { ok: false, message: 'ID y Nombre de proyecto son obligatorios.' };
        }

        const cleanId = String(id).toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_');
        const now = new Date().toISOString();
        const existing = this.getProject(cleanId);

        try {
            if (existing) {
                databaseService.db.prepare(`
                    UPDATE projects_manifest SET
                        name = ?,
                        aliases_json = ?,
                        summary = ?,
                        decisions_json = ?,
                        files_json = ?,
                        facts_json = ?,
                        tasks_json = ?,
                        recent_context_json = ?,
                        last_active_at = ?,
                        is_active = ?
                    WHERE id = ?
                `).run(
                    name,
                    JSON.stringify(aliases),
                    summary,
                    JSON.stringify(decisions),
                    JSON.stringify(files),
                    JSON.stringify(facts),
                    JSON.stringify(tasks),
                    JSON.stringify(recentContext),
                    now,
                    isActive ? 1 : (existing.is_active ? 1 : 0),
                    cleanId
                );
            } else {
                databaseService.db.prepare(`
                    INSERT INTO projects_manifest (
                        id, name, aliases_json, summary, decisions_json, files_json,
                        facts_json, tasks_json, recent_context_json, created_at,
                        last_active_at, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    cleanId,
                    name,
                    JSON.stringify(aliases),
                    summary,
                    JSON.stringify(decisions),
                    JSON.stringify(files),
                    JSON.stringify(facts),
                    JSON.stringify(tasks),
                    JSON.stringify(recentContext),
                    now,
                    now,
                    isActive ? 1 : 0
                );
            }

            return { ok: true, id: cleanId, name, updated: Boolean(existing) };
        } catch (err) {
            return { ok: false, message: err.message };
        }
    }

    /**
     * Obtiene un proyecto por su ID.
     */
    getProject(id) {
        const row = databaseService.db.prepare("SELECT * FROM projects_manifest WHERE id = ?").get(String(id).toLowerCase().trim());
        if (!row) return null;
        return this._parseProjectRow(row);
    }

    /**
     * Obtiene el proyecto actualmente activo en el sistema.
     */
    getActiveProject() {
        const row = databaseService.db.prepare("SELECT * FROM projects_manifest WHERE is_active = 1 ORDER BY last_active_at DESC LIMIT 1").get();
        if (!row) return null;
        return this._parseProjectRow(row);
    }

    /**
     * Lista todos los proyectos registrados.
     */
    listProjects() {
        const rows = databaseService.db.prepare("SELECT * FROM projects_manifest ORDER BY last_active_at DESC").all();
        return rows.map(r => this._parseProjectRow(r));
    }

    /**
     * Registra una decisión técnica o de arquitectura en un proyecto.
     */
    addDecision(projectId, decision, rationale = '') {
        const project = this.getProject(projectId);
        if (!project) return { ok: false, message: `Proyecto '${projectId}' no encontrado.` };

        const newDecision = {
            id: `dec-${crypto.randomUUID().slice(0, 6)}`,
            decision: String(decision).trim(),
            rationale: String(rationale).trim(),
            timestamp: new Date().toISOString()
        };

        const updatedDecisions = [newDecision, ...(project.decisions || [])];

        databaseService.db.prepare("UPDATE projects_manifest SET decisions_json = ?, last_active_at = ? WHERE id = ?")
            .run(JSON.stringify(updatedDecisions), new Date().toISOString(), project.id);

        return { ok: true, decision: newDecision };
    }

    /**
     * Añade un hecho o restricción importante al proyecto.
     */
    addFact(projectId, fact) {
        const project = this.getProject(projectId);
        if (!project) return { ok: false, message: `Proyecto '${projectId}' no encontrado.` };

        const cleanFact = String(fact).trim();
        const facts = project.important_facts || [];
        if (!facts.includes(cleanFact)) {
            facts.push(cleanFact);
            databaseService.db.prepare("UPDATE projects_manifest SET facts_json = ?, last_active_at = ? WHERE id = ?")
                .run(JSON.stringify(facts), new Date().toISOString(), project.id);
        }

        return { ok: true, facts };
    }

    /**
     * Añade una referencia a un archivo o escena clave.
     */
    addFileRef(projectId, filePath, role = 'code', description = '') {
        const project = this.getProject(projectId);
        if (!project) return { ok: false, message: `Proyecto '${projectId}' no encontrado.` };

        const fileEntry = {
            path: filePath,
            role,
            description,
            added_at: new Date().toISOString()
        };

        const files = project.files || [];
        const existingIdx = files.findIndex(f => f.path === filePath);
        if (existingIdx >= 0) {
            files[existingIdx] = fileEntry;
        } else {
            files.push(fileEntry);
        }

        databaseService.db.prepare("UPDATE projects_manifest SET files_json = ?, last_active_at = ? WHERE id = ?")
            .run(JSON.stringify(files), new Date().toISOString(), project.id);

        return { ok: true, file: fileEntry };
    }

    /**
     * Añade una tarea al backlog del proyecto.
     */
    addTask(projectId, title, priority = 'medium') {
        const project = this.getProject(projectId);
        if (!project) return { ok: false, message: `Proyecto '${projectId}' no encontrado.` };

        const task = {
            id: `tsk-${crypto.randomUUID().slice(0, 6)}`,
            title: String(title).trim(),
            status: 'pending', // 'pending', 'in_progress', 'completed'
            priority: priority.toLowerCase(),
            created_at: new Date().toISOString()
        };

        const tasks = [...(project.tasks || []), task];

        databaseService.db.prepare("UPDATE projects_manifest SET tasks_json = ?, last_active_at = ? WHERE id = ?")
            .run(JSON.stringify(tasks), new Date().toISOString(), project.id);

        return { ok: true, task };
    }

    /**
     * Actualiza el estado de una tarea.
     */
    updateTaskStatus(projectId, taskId, newStatus = 'completed') {
        const project = this.getProject(projectId);
        if (!project) return { ok: false, message: `Proyecto '${projectId}' no encontrado.` };

        const tasks = project.tasks || [];
        const task = tasks.find(t => t.id === taskId);
        if (!task) return { ok: false, message: `Tarea '${taskId}' no encontrada en '${projectId}'.` };

        task.status = newStatus;
        task.updated_at = new Date().toISOString();

        databaseService.db.prepare("UPDATE projects_manifest SET tasks_json = ?, last_active_at = ? WHERE id = ?")
            .run(JSON.stringify(tasks), new Date().toISOString(), project.id);

        return { ok: true, task };
    }

    /**
     * Registra un intercambio de diálogo reciente en el proyecto.
     */
    recordInteraction(projectId, userText, assistantText) {
        const project = this.getProject(projectId);
        if (!project) return { ok: false };

        const now = new Date().toISOString();
        const history = project.recent_context || [];
        
        history.push({ role: 'user', text: userText, timestamp: now });
        if (assistantText) {
            history.push({ role: 'assistant', text: assistantText, timestamp: now });
        }

        // Mantener ventana deslizante de los últimos 10 intercambios
        const trimmed = history.slice(-10);

        databaseService.db.prepare("UPDATE projects_manifest SET recent_context_json = ?, last_active_at = ? WHERE id = ?")
            .run(JSON.stringify(trimmed), now, project.id);

        return { ok: true };
    }

    /**
     * Detecta si la instrucción del usuario indica cambio o activación de proyecto ("Seguimos con Unity").
     */
    detectProjectIntent(text) {
        if (!text) return { detected: false };
        const raw = String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

        const allProjects = this.listProjects();

        // 1. Patrones de cambio explícito
        const intentRegex = /(?:seguimos\s+con|pasemos\s+a(?:l)?|vamos\s+a(?:l)?(?:\s+proyecto)?|enfocate\s+en|abri(?:r)?\s+(?:el\s+)?proyecto|trabajemos\s+en)\s+([a-z0-9_\-\s]+)/i;
        const match = raw.match(intentRegex);

        if (match) {
            const candidate = match[1].trim();
            for (const proj of allProjects) {
                if (candidate.includes(proj.id) || candidate.includes(proj.name.toLowerCase())) {
                    return { detected: true, projectId: proj.id, project: proj, matchedPhrase: match[0] };
                }
                for (const alias of proj.aliases) {
                    if (candidate.includes(alias.toLowerCase())) {
                        return { detected: true, projectId: proj.id, project: proj, matchedPhrase: match[0] };
                    }
                }
            }
        }

        // 2. Emparejamiento directo por alias o palabras clave
        for (const proj of allProjects) {
            for (const alias of proj.aliases) {
                const aliasRegex = new RegExp(`\\b${alias.toLowerCase()}\\b`, 'i');
                if (aliasRegex.test(raw)) {
                    return { detected: true, projectId: proj.id, project: proj, matchedPhrase: alias };
                }
            }
        }

        return { detected: false };
    }

    /**
     * Conmuta el proyecto activo en el sistema.
     */
    switchProject(projectIdOrQuery) {
        let targetId = projectIdOrQuery;
        const detected = this.detectProjectIntent(projectIdOrQuery);
        if (detected.detected) {
            targetId = detected.projectId;
        }

        const project = this.getProject(targetId);
        if (!project) {
            return { ok: false, message: `Proyecto '${targetId}' no encontrado.` };
        }

        // Desactivar todos los demás y activar este
        const now = new Date().toISOString();
        databaseService.db.prepare("UPDATE projects_manifest SET is_active = 0").run();
        databaseService.db.prepare("UPDATE projects_manifest SET is_active = 1, last_active_at = ? WHERE id = ?").run(now, project.id);

        return {
            ok: true,
            activeProjectId: project.id,
            activeProjectName: project.name,
            message: `Contexto cambiado al proyecto '${project.name}'.`
        };
    }

    /**
     * MONTAJE DE CONTEXTO INTEGRADO (Ítem 16):
     * Genera el payload contextual con:
     *   1. User Core Memory (Perfil inmutable del usuario)
     *   2. Project Dossier (Summary, Decisiones, Facts, Files, Tasks)
     *   3. Últimos recuerdos e intercambios del proyecto
     */
    mountProjectContext(projectIdOrQuery = null) {
        let project = null;
        if (projectIdOrQuery) {
            const switchRes = this.switchProject(projectIdOrQuery);
            if (switchRes.ok) {
                project = this.getProject(switchRes.activeProjectId);
            }
        }

        if (!project) {
            project = this.getActiveProject();
        }

        if (!project) {
            return {
                mounted: false,
                contextText: '',
                message: 'No hay ningún proyecto activo montado.'
            };
        }

        // 1. User Core Profile (simulado o leído de base de datos)
        const userCore = [
            "- Usuario: Rodrigo",
            "- Preferencias: Respuestas concisas, código probado al 100%, seguridad y cero regresiones."
        ].join('\n');

        // 2. Dossier del Proyecto
        const factsText = (project.important_facts && project.important_facts.length > 0)
            ? project.important_facts.map(f => `  * ${f}`).join('\n')
            : '  (Sin restricciones registradas)';

        const decisionsText = (project.decisions && project.decisions.length > 0)
            ? project.decisions.slice(0, 5).map(d => `  * [${d.timestamp ? d.timestamp.split('T')[0] : 'HIST'}] ${d.decision}: ${d.rationale}`).join('\n')
            : '  (Sin decisiones técnicas registradas)';

        const filesText = (project.files && project.files.length > 0)
            ? project.files.map(f => `  * ${f.path} (${f.role}) - ${f.description || ''}`).join('\n')
            : '  (Sin archivos registrados)';

        const tasksText = (project.tasks && project.tasks.length > 0)
            ? project.tasks.map(t => `  * [${t.priority.toUpperCase()}] [${t.status.toUpperCase()}] ${t.title}`).join('\n')
            : '  (Sin tareas activas)';

        // 3. Recuerdos Recientes del Proyecto
        const recentInteractions = (project.recent_context && project.recent_context.length > 0)
            ? project.recent_context.map(c => `  - [${c.role === 'user' ? 'Usuario' : 'Jarvis'}]: ${c.text}`).join('\n')
            : '  (Sin historial reciente en este proyecto)';

        const mountedText = [
            `=== CONTEXTO DE PROYECTO ACTIVO: ${project.name.toUpperCase()} [${project.id}] ===`,
            `## 1. NUCLEO DE USUARIO (User Core)`,
            userCore,
            ``,
            `## 2. DOSSIER TECNICO DEL PROYECTO`,
            `- Resumen: ${project.summary || 'Sin resumen'}`,
            `- Hechos Clave (Important Facts):`,
            factsText,
            `- Decisiones de Arquitectura (Ultimas 5):`,
            decisionsText,
            `- Archivos y Rutas Clave:`,
            filesText,
            `- Tareas Activas y Backlog:`,
            tasksText,
            ``,
            `## 3. HISTORIAL Y MEMORIA RECIENTE DEL PROYECTO`,
            recentInteractions,
            `==============================================================`
        ].join('\n');

        return {
            mounted: true,
            projectId: project.id,
            projectName: project.name,
            contextText: mountedText,
            project
        };
    }

    _parseProjectRow(row) {
        return {
            id: row.id,
            name: row.name,
            aliases: JSON.parse(row.aliases_json || '[]'),
            summary: row.summary || '',
            decisions: JSON.parse(row.decisions_json || '[]'),
            files: JSON.parse(row.files_json || '[]'),
            important_facts: JSON.parse(row.facts_json || '[]'),
            tasks: JSON.parse(row.tasks_json || '[]'),
            recent_context: JSON.parse(row.recent_context_json || '[]'),
            created_at: row.created_at,
            last_active_at: row.last_active_at,
            is_active: Boolean(row.is_active)
        };
    }
}

const projectMemoryService = new ProjectMemoryService();
module.exports = projectMemoryService;
