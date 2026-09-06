/**
 * Entity Graph Service for Jarvis (Ítem 20)
 * Proporciona un Grafo de Conocimiento (Knowledge Graph) universal persistente en SQLite:
 *   - Nodos (Entidades): Personas, Dispositivos, Proyectos, Sistemas, Servicios, Hardware, etc.
 *   - Aristas (Relaciones / Tripletas): Sujeto -> Predicado -> Objeto (owns, develops, uses, controls, etc.)
 *   - Motor de Resolución Anafórica y Pronombres Clíticos ("prendela", "apagala", "la tele", "el juego")
 *   - Desambiguación Contextual Semántica ("el proyecto" -> JARVIS vs Horror Game según contexto)
 *   - Navegación en Grafo y Búsqueda de Rutas Multi-Salto (findPath, getNeighbors)
 *   - Extracción Automática de Tripletas desde Lenguaje Natural
 */

const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

function normalizeStr(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

class EntityGraphService {
    constructor() {
        this._ensureSchema();
        this._seedDefaultGraph();
    }

    _ensureSchema() {
        try {
            databaseService.db.exec(`
                CREATE TABLE IF NOT EXISTS graph_entities (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    aliases_json TEXT NOT NULL DEFAULT '[]',
                    attributes_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS graph_relations (
                    id TEXT PRIMARY KEY,
                    subject_id TEXT NOT NULL,
                    predicate TEXT NOT NULL,
                    object_id TEXT NOT NULL,
                    confidence REAL DEFAULT 1.0,
                    metadata_json TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (subject_id) REFERENCES graph_entities(id) ON DELETE CASCADE,
                    FOREIGN KEY (object_id) REFERENCES graph_entities(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_graph_entities_type ON graph_entities(type);
                CREATE INDEX IF NOT EXISTS idx_graph_relations_sub ON graph_relations(subject_id);
                CREATE INDEX IF NOT EXISTS idx_graph_relations_obj ON graph_relations(object_id);
                CREATE INDEX IF NOT EXISTS idx_graph_relations_pred ON graph_relations(predicate);
            `);
        } catch (err) {
            console.error('[EntityGraph] Error asegurando tablas en SQLite:', err.message);
        }
    }

    _seedDefaultGraph() {
        try {
            const now = new Date().toISOString();

            // 1. Entidades Semilla (Ecosistema Real del Usuario)
            const seedEntities = [
                {
                    id: 'person:rodri',
                    name: 'Rodrigo',
                    type: 'person',
                    aliases: ['rodri', 'rodrigo', 'yo', 'el usuario', 'el creador', 'el programador'],
                    attributes: { role: 'creator', honorific: 'señor', pronouns: ['él'] }
                },
                {
                    id: 'device:tv_aiwa',
                    name: 'TV AIWA',
                    type: 'device',
                    aliases: ['la tele', 'la tv', 'el televisor', 'la pantalla', 'television', 'aiwa', 'smart tv'],
                    attributes: {
                        brand: 'AIWA',
                        controllable: true,
                        power_action: 'tv.power',
                        volume_controllable: true,
                        gender: 'feminine',
                        device_category: 'entertainment'
                    }
                },
                {
                    id: 'project:jarvis',
                    name: 'JARVIS',
                    type: 'project',
                    aliases: ['el proyecto', 'jarvis', 'el asistente', 'el bot', 'asistente virtual', 'sistema multi agente', 'backend'],
                    attributes: {
                        tech_stack: ['Node.js', 'JavaScript', 'SQLite', 'Ollama'],
                        domain: 'ai_assistant',
                        active: true,
                        keywords: ['node', 'backend', 'asistente', 'agente', 'api', 'ia', 'ollama', 'sqlite', 'servidor', 'javascript']
                    }
                },
                {
                    id: 'project:horror_game',
                    name: 'Horror Game',
                    type: 'project',
                    aliases: ['el proyecto', 'el juego', 'el videojuego', 'el proyecto de terror', 'juego de terror', 'videojuego de terror', 'game'],
                    attributes: {
                        tech_stack: ['Unity', 'C#', 'URP'],
                        domain: 'game_development',
                        genre: 'horror',
                        active: true,
                        keywords: ['unity', 'juego', 'videojuego', 'terror', 'c#', 'shader', 'escena', 'horror', 'luces', 'bosque']
                    }
                },
                {
                    id: 'system:windows_pc',
                    name: 'Windows PC',
                    type: 'system',
                    aliases: ['windows', 'la pc', 'la compu', 'la computadora', 'el escritorio', 'el sistema'],
                    attributes: { os: 'Windows 11', device_type: 'desktop_pc' }
                },
                {
                    id: 'service:ollama',
                    name: 'Ollama',
                    type: 'service',
                    aliases: ['ollama', 'el modelo local', 'el llm local', 'servidor ollama'],
                    attributes: { role: 'local_llm_inference', default_port: 11434 }
                },
                {
                    id: 'hardware:broadlink_rm4',
                    name: 'BroadLink RM4',
                    type: 'hardware',
                    aliases: ['broadlink', 'el emisor ir', 'rm4', 'control remoto broadlink'],
                    attributes: { role: 'ir_rf_controller', protocol: 'infrared' }
                },
                {
                    id: 'database:sqlite',
                    name: 'SQLite',
                    type: 'database',
                    aliases: ['sqlite', 'la base de datos', 'jarvis db', 'el db'],
                    attributes: { role: 'relational_persistence', mode: 'WAL' }
                }
            ];

            const insertEntity = databaseService.db.prepare(`
                INSERT INTO graph_entities (id, name, type, aliases_json, attributes_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    aliases_json = excluded.aliases_json,
                    attributes_json = excluded.attributes_json,
                    updated_at = excluded.updated_at
            `);

            for (const ent of seedEntities) {
                insertEntity.run(
                    ent.id,
                    ent.name,
                    ent.type,
                    JSON.stringify(ent.aliases),
                    JSON.stringify(ent.attributes),
                    now,
                    now
                );
            }

            // 2. Relaciones Semilla (Grafo Inicial)
            const seedRelations = [
                { id: 'rel:rodri_owns_tv', subject_id: 'person:rodri', predicate: 'owns', object_id: 'device:tv_aiwa' },
                { id: 'rel:rodri_develops_jarvis', subject_id: 'person:rodri', predicate: 'develops', object_id: 'project:jarvis' },
                { id: 'rel:rodri_develops_horror_game', subject_id: 'person:rodri', predicate: 'develops', object_id: 'project:horror_game' },
                { id: 'rel:rodri_uses_windows', subject_id: 'person:rodri', predicate: 'uses', object_id: 'system:windows_pc' },
                { id: 'rel:jarvis_uses_ollama', subject_id: 'project:jarvis', predicate: 'uses', object_id: 'service:ollama' },
                { id: 'rel:jarvis_uses_broadlink', subject_id: 'project:jarvis', predicate: 'uses', object_id: 'hardware:broadlink_rm4' },
                { id: 'rel:jarvis_uses_sqlite', subject_id: 'project:jarvis', predicate: 'uses', object_id: 'database:sqlite' },
                { id: 'rel:broadlink_controls_tv', subject_id: 'hardware:broadlink_rm4', predicate: 'controls', object_id: 'device:tv_aiwa' }
            ];

            const insertRelation = databaseService.db.prepare(`
                INSERT OR IGNORE INTO graph_relations (id, subject_id, predicate, object_id, confidence, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            for (const rel of seedRelations) {
                insertRelation.run(
                    rel.id,
                    rel.subject_id,
                    rel.predicate,
                    rel.object_id,
                    1.0,
                    JSON.stringify({ seed: true }),
                    now
                );
            }

            console.log('[EntityGraph] Grafo de entidades semilla inicializado con éxito.');
        } catch (err) {
            console.error('[EntityGraph] Error sembrando grafo por defecto:', err.message);
        }
    }

    // ==========================================
    // CRUD DE ENTIDADES (NODOS)
    // ==========================================

    createEntity({ id, name, type, aliases = [], attributes = {} }) {
        if (!id || !name || !type) {
            throw new Error('createEntity requiere id, name y type');
        }
        const now = new Date().toISOString();
        const aliasesJson = JSON.stringify(aliases.map(a => normalizeStr(a)));
        const attrsJson = JSON.stringify(attributes);

        const stmt = databaseService.db.prepare(`
            INSERT INTO graph_entities (id, name, type, aliases_json, attributes_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                type = excluded.type,
                aliases_json = excluded.aliases_json,
                attributes_json = excluded.attributes_json,
                updated_at = excluded.updated_at
        `);
        stmt.run(id, name, type, aliasesJson, attrsJson, now, now);

        return this.getEntity(id);
    }

    getEntity(id) {
        if (!id) return null;
        const row = databaseService.db.prepare('SELECT * FROM graph_entities WHERE id = ?').get(id);
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            type: row.type,
            aliases: JSON.parse(row.aliases_json || '[]'),
            attributes: JSON.parse(row.attributes_json || '{}'),
            created_at: row.created_at,
            updated_at: row.updated_at
        };
    }

    updateEntity(id, updates = {}) {
        const existing = this.getEntity(id);
        if (!existing) throw new Error(`Entidad ${id} no encontrada`);

        const name = updates.name || existing.name;
        const type = updates.type || existing.type;
        const aliases = updates.aliases ? updates.aliases.map(a => normalizeStr(a)) : existing.aliases;
        const attributes = updates.attributes ? { ...existing.attributes, ...updates.attributes } : existing.attributes;
        const now = new Date().toISOString();

        databaseService.db.prepare(`
            UPDATE graph_entities
            SET name = ?, type = ?, aliases_json = ?, attributes_json = ?, updated_at = ?
            WHERE id = ?
        `).run(name, type, JSON.stringify(aliases), JSON.stringify(attributes), now, id);

        return this.getEntity(id);
    }

    deleteEntity(id) {
        if (!id) return false;
        databaseService.db.prepare('DELETE FROM graph_relations WHERE subject_id = ? OR object_id = ?').run(id, id);
        const res = databaseService.db.prepare('DELETE FROM graph_entities WHERE id = ?').run(id);
        return res.changes > 0;
    }

    findEntities({ type = null, query = null, limit = 50 } = {}) {
        let sql = 'SELECT * FROM graph_entities WHERE 1=1';
        const params = [];

        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }

        const rows = databaseService.db.prepare(sql).all(...params);
        let results = rows.map(r => ({
            id: r.id,
            name: r.name,
            type: r.type,
            aliases: JSON.parse(r.aliases_json || '[]'),
            attributes: JSON.parse(r.attributes_json || '{}'),
            created_at: r.created_at,
            updated_at: r.updated_at
        }));

        if (query) {
            const qNorm = normalizeStr(query);
            results = results.filter(e => {
                if (normalizeStr(e.name).includes(qNorm)) return true;
                if (e.aliases.some(a => a.includes(qNorm))) return true;
                if (normalizeStr(e.type).includes(qNorm)) return true;
                return false;
            });
        }

        return results.slice(0, limit);
    }

    // ==========================================
    // CRUD DE RELACIONES (ARISTAS / TRIPLETAS)
    // ==========================================

    createRelation({ id, subject_id, predicate, object_id, confidence = 1.0, metadata = {} }) {
        if (!subject_id || !predicate || !object_id) {
            throw new Error('createRelation requiere subject_id, predicate y object_id');
        }
        const relId = id || `rel:${crypto.randomBytes(6).toString('hex')}`;
        const now = new Date().toISOString();

        // Validar que ambos nodos existan
        const sub = this.getEntity(subject_id);
        const obj = this.getEntity(object_id);
        if (!sub) throw new Error(`Entidad sujeto no encontrada: ${subject_id}`);
        if (!obj) throw new Error(`Entidad objeto no encontrada: ${object_id}`);

        const stmt = databaseService.db.prepare(`
            INSERT INTO graph_relations (id, subject_id, predicate, object_id, confidence, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                predicate = excluded.predicate,
                confidence = excluded.confidence,
                metadata_json = excluded.metadata_json
        `);
        stmt.run(relId, subject_id, predicate.toLowerCase().trim(), object_id, confidence, JSON.stringify(metadata), now);

        return {
            id: relId,
            subject_id,
            predicate: predicate.toLowerCase().trim(),
            object_id,
            confidence,
            metadata,
            created_at: now
        };
    }

    deleteRelation(id) {
        if (!id) return false;
        const res = databaseService.db.prepare('DELETE FROM graph_relations WHERE id = ?').run(id);
        return res.changes > 0;
    }

    getRelations({ subject_id = null, predicate = null, object_id = null } = {}) {
        let sql = 'SELECT * FROM graph_relations WHERE 1=1';
        const params = [];

        if (subject_id) {
            sql += ' AND subject_id = ?';
            params.push(subject_id);
        }
        if (predicate) {
            sql += ' AND predicate = ?';
            params.push(predicate.toLowerCase().trim());
        }
        if (object_id) {
            sql += ' AND object_id = ?';
            params.push(object_id);
        }

        const rows = databaseService.db.prepare(sql).all(...params);
        return rows.map(r => ({
            id: r.id,
            subject_id: r.subject_id,
            predicate: r.predicate,
            object_id: r.object_id,
            confidence: Number(r.confidence),
            metadata: JSON.parse(r.metadata_json || '{}'),
            created_at: r.created_at
        }));
    }

    // ==========================================
    // NAVEGACIÓN EN GRAFO Y SUBGRAFOS
    // ==========================================

    /**
     * Obtiene nodos vecinos directos de una entidad.
     */
    getNeighbors(entityId, { direction = 'both', predicate = null, targetType = null } = {}) {
        const entity = this.getEntity(entityId);
        if (!entity) return [];

        const neighbors = [];

        if (direction === 'outgoing' || direction === 'both') {
            const outgoing = this.getRelations({ subject_id: entityId, predicate });
            for (const rel of outgoing) {
                const target = this.getEntity(rel.object_id);
                if (target && (!targetType || target.type === targetType)) {
                    neighbors.push({
                        relation: rel.predicate,
                        direction: 'outgoing',
                        entity: target,
                        relation_id: rel.id
                    });
                }
            }
        }

        if (direction === 'incoming' || direction === 'both') {
            const incoming = this.getRelations({ object_id: entityId, predicate });
            for (const rel of incoming) {
                const source = this.getEntity(rel.subject_id);
                if (source && (!targetType || source.type === targetType)) {
                    neighbors.push({
                        relation: rel.predicate,
                        direction: 'incoming',
                        entity: source,
                        relation_id: rel.id
                    });
                }
            }
        }

        return neighbors;
    }

    /**
     * Encuentra la ruta más corta entre dos entidades mediante BFS (Breadth-First Search).
     * Ej: JARVIS -> uses BroadLink -> controls TV AIWA
     */
    findPath(startEntityId, endEntityId, maxDepth = 4) {
        if (!startEntityId || !endEntityId) return null;
        if (startEntityId === endEntityId) {
            const ent = this.getEntity(startEntityId);
            return { found: true, depth: 0, path: [ent], hops: [] };
        }

        const queue = [{ currentId: startEntityId, path: [startEntityId], hops: [] }];
        const visited = new Set([startEntityId]);

        while (queue.length > 0) {
            const { currentId, path, hops } = queue.shift();

            if (path.length - 1 >= maxDepth) continue;

            const neighbors = this.getNeighbors(currentId, { direction: 'outgoing' });
            for (const neighbor of neighbors) {
                const nextId = neighbor.entity.id;
                const newPath = [...path, nextId];
                const newHops = [...hops, { from: currentId, predicate: neighbor.relation, to: nextId }];

                if (nextId === endEntityId) {
                    const resolvedNodes = newPath.map(id => this.getEntity(id));
                    return {
                        found: true,
                        depth: newHops.length,
                        path: resolvedNodes,
                        hops: newHops,
                        summary: newHops.map(h => `${this.getEntity(h.from)?.name} --(${h.predicate})--> ${this.getEntity(h.to)?.name}`).join(' -> ')
                    };
                }

                if (!visited.has(nextId)) {
                    visited.add(nextId);
                    queue.push({ currentId: nextId, path: newPath, hops: newHops });
                }
            }
        }

        return { found: false, depth: -1, path: [], hops: [] };
    }

    // ==========================================
    // MOTOR DE RESOLUCIÓN DE ENTIDADES Y PRONOMBRES
    // ==========================================

    /**
     * Resuelve referencias en lenguaje natural tales como:
     *   - "prendela", "apagala", "subila" (pronombres clíticos y verbos de control)
     *   - "la tele", "el televisor" (alias exactos)
     *   - "el juego" (alias exacto a project:horror_game)
     *   - "el proyecto" (desambiguación contextual entre JARVIS y Horror Game)
     *
     * @param {string} query Frase o término del usuario
     * @param {object} context Contexto de conversación activo (activeProjectId, text, tags, etc.)
     * @returns {object} { entity, confidence, matchType, disambiguatedFrom, suggestedAction }
     */
    resolveReference(query, context = {}) {
        if (!query) return null;
        const normQuery = normalizeStr(query);

        // 1. Detección de Verbos Clíticos y Acciones sobre Dispositivos / Objetos ("prendela", "apagala", "subila", etc.)
        const cliticMatch = this._resolveCliticVerb(normQuery, context);
        if (cliticMatch) {
            return cliticMatch;
        }

        // 2. Coincidencia por Categoría Genérica ("el proyecto", "los proyectos", "proyecto")
        const allEntities = this.findEntities();
        if (normQuery === 'el proyecto' || normQuery === 'proyecto' || normQuery === 'los proyectos') {
            const projectEntities = allEntities.filter(e => e.type === 'project');
            if (projectEntities.length > 1) {
                const projectCandidates = projectEntities.map(p => ({
                    entity: p,
                    confidence: 0.90,
                    matchType: 'project_category'
                }));
                return this._disambiguateCandidates(projectCandidates, normQuery, context);
            }
        }

        // 3. Coincidencia por Alias o Nombre Exacto
        const candidates = [];
        for (const ent of allEntities) {
            const nameNorm = normalizeStr(ent.name);
            if (nameNorm === normQuery) {
                candidates.push({ entity: ent, confidence: 1.0, matchType: 'exact_name' });
                continue;
            }

            for (const alias of ent.aliases) {
                const aliasNorm = normalizeStr(alias);
                if (aliasNorm === normQuery) {
                    candidates.push({ entity: ent, confidence: 0.98, matchType: 'exact_alias' });
                    break;
                }
                // Si la consulta contiene el alias completo como token (ej. "por favor prendé la tele")
                if (normQuery.split(' ').includes(aliasNorm) || normQuery.includes(aliasNorm)) {
                    candidates.push({ entity: ent, confidence: 0.85, matchType: 'contained_alias' });
                    break;
                }
            }
        }

        if (candidates.length === 1) {
            return {
                entity: candidates[0].entity,
                confidence: candidates[0].confidence,
                matchType: candidates[0].matchType,
                alternatives: []
            };
        }

        // 3. Desambiguación Contextual si hay múltiples candidatos (ej. "el proyecto")
        if (candidates.length > 1) {
            return this._disambiguateCandidates(candidates, normQuery, context);
        }

        return null;
    }

    /**
     * Resuelve verbos con pronombres enclíticos:
     *   "prendela" / "encendela" -> device:tv_aiwa (femenino, controllable)
     *   "apagala" -> device:tv_aiwa
     *   "subila" / "bajala" -> device:tv_aiwa o system:windows_pc
     */
    _resolveCliticVerb(normQuery, context = {}) {
        // Expresiones regulares para verbos clíticos en español rioplatense y estándar
        const powerCliticRegex = /\b(prende|encende|apaga|activa|desactiva)(la|lo|las|los)\b/;
        const audioCliticRegex = /\b(subi|baja|mutea|desmutea)(la|lo|le)\b/;
        const appCliticRegex = /\b(abri|cerra|minimiz|maximiz)(la|lo)\b/;

        const powerMatch = normQuery.match(powerCliticRegex);
        if (powerMatch) {
            const verb = powerMatch[1];
            const pronoun = powerMatch[2]; // 'la' o 'lo'
            const isFeminine = pronoun === 'la' || pronoun === 'las';

            // Buscar dispositivos controlables con género coincidente
            const devices = this.findEntities({ type: 'device' });
            for (const dev of devices) {
                const attrs = dev.attributes || {};
                const gender = attrs.gender || 'feminine'; // la TV / la tele es femenino

                if (isFeminine && gender === 'feminine' && attrs.controllable) {
                    return {
                        entity: dev,
                        confidence: 0.95,
                        matchType: 'clitic_pronoun_action',
                        detectedAction: verb.startsWith('apag') ? 'power_off' : 'power_on',
                        suggestedAction: attrs.power_action || 'device.power',
                        verb: `${verb}${pronoun}`
                    };
                }
            }
        }

        const audioMatch = normQuery.match(audioCliticRegex);
        if (audioMatch) {
            const verb = audioMatch[1];
            const pronoun = audioMatch[2];
            // Dispositivos con control de audio
            const devices = this.findEntities({ type: 'device' });
            for (const dev of devices) {
                if (dev.attributes?.volume_controllable) {
                    return {
                        entity: dev,
                        confidence: 0.90,
                        matchType: 'clitic_pronoun_audio',
                        detectedAction: verb.startsWith('sub') ? 'volume_up' : (verb.startsWith('baj') ? 'volume_down' : 'mute'),
                        verb: `${verb}${pronoun}`
                    };
                }
            }
        }

        return null;
    }

    /**
     * Desambigua cuando un término como "el proyecto" coincide con varios nodos.
     */
    _disambiguateCandidates(candidates, normQuery, context = {}) {
        const contextText = normalizeStr(
            (context.text || '') + ' ' +
            (context.recentDialogue || '') + ' ' +
            (context.activeProject || '')
        );

        let bestCandidate = null;
        let highestScore = -1;

        for (const cand of candidates) {
            let score = cand.confidence;
            const attrs = cand.entity.attributes || {};
            const keywords = attrs.keywords || [];

            // Puntuación por palabras clave en contexto
            for (const kw of keywords) {
                if (contextText.includes(normalizeStr(kw))) {
                    score += 0.35;
                }
            }

            // Si el proyecto activo coincide con el ID de la entidad
            if (context.activeProjectId && cand.entity.id.includes(context.activeProjectId)) {
                score += 0.50;
            }

            if (score > highestScore) {
                highestScore = score;
                bestCandidate = cand;
            }
        }

        const alternatives = candidates
            .filter(c => c.entity.id !== bestCandidate.entity.id)
            .map(c => c.entity.name);

        return {
            entity: bestCandidate.entity,
            confidence: Math.min(1.0, highestScore),
            matchType: 'contextual_disambiguation',
            disambiguatedFrom: alternatives
        };
    }

    // ==========================================
    // EXTRACCIÓN AUTOMÁTICA DE TRIPLETAS
    // ==========================================

    /**
     * Extrae tripletas sujeto-predicado-objeto desde expresiones en lenguaje natural.
     * Ej: "tengo una tele AIWA", "desarrollo un juego de terror", "estoy programando una app de finanzas"
     */
    extractTriplesFromText(text, defaultSubjectId = 'person:rodri') {
        if (!text) return [];
        const norm = normalizeStr(text);
        const triples = [];

        // 1. Patrones de Posesión ("tengo un/una [X]", "compre [X]", "mi [X] es [Y]")
        const ownsRegex = /\b(?:tengo|compre|adquiri)\s+(?:un|una|el|la)?\s*([a-z0-9\s]{3,30})/g;
        let match;
        while ((match = ownsRegex.exec(norm)) !== null) {
            const objectName = match[1].trim();
            if (objectName.length > 2 && !['que', 'para', 'como'].includes(objectName)) {
                triples.push({
                    subject_id: defaultSubjectId,
                    predicate: 'owns',
                    object_name: objectName,
                    object_type: 'device_or_asset'
                });
            }
        }

        // 2. Patrones de Desarrollo ("desarrollo [X]", "estoy programando [X]", "creando [X]")
        const devRegex = /\b(?:desarrollo|programando|creando|diseñando|cree|haciendo)\s+(?:un|una|el|la)?\s*([a-z0-9\s]{3,30})/g;
        while ((match = devRegex.exec(norm)) !== null) {
            const objectName = match[1].trim();
            if (objectName.length > 2 && !['en', 'con', 'para'].includes(objectName)) {
                triples.push({
                    subject_id: defaultSubjectId,
                    predicate: 'develops',
                    object_name: objectName,
                    object_type: 'project'
                });
            }
        }

        // 3. Patrones de Uso ("uso [X] para [Y]", "utilizo [X]")
        const useRegex = /\b(?:uso|utilizo|trabajo con)\s+([a-z0-9\s]{3,25})/g;
        while ((match = useRegex.exec(norm)) !== null) {
            const objectName = match[1].trim();
            if (objectName.length > 2) {
                triples.push({
                    subject_id: defaultSubjectId,
                    predicate: 'uses',
                    object_name: objectName,
                    object_type: 'software_or_system'
                });
            }
        }

        return triples;
    }

    // ==========================================
    // GENERACIÓN DE CONTEXTO PARA LLM
    // ==========================================

    /**
     * Genera un resumen conciso del grafo de relaciones para inyectar en el contexto del LLM.
     */
    getGraphContextSummary(focusEntityId = 'person:rodri') {
        const entity = this.getEntity(focusEntityId);
        if (!entity) return '';

        const outgoing = this.getNeighbors(focusEntityId, { direction: 'outgoing' });
        const summaryLines = [`[KNOWLEDGE GRAPH: ${entity.name}]`];

        const groupedByPredicate = {};
        for (const n of outgoing) {
            if (!groupedByPredicate[n.relation]) {
                groupedByPredicate[n.relation] = [];
            }
            groupedByPredicate[n.relation].push(n.entity.name);
        }

        for (const [predicate, objects] of Object.entries(groupedByPredicate)) {
            summaryLines.push(`  - ${predicate}: ${objects.join(', ')}`);
        }

        // Incluir relaciones de Jarvis
        const jarvisOutgoing = this.getNeighbors('project:jarvis', { direction: 'outgoing' });
        if (jarvisOutgoing.length > 0) {
            const jarvisObjects = jarvisOutgoing.map(n => `${n.relation} ${n.entity.name}`).join(', ');
            summaryLines.push(`[JARVIS Ecosystem]: ${jarvisObjects}`);
        }

        return summaryLines.join('\n');
    }
}

module.exports = new EntityGraphService();
