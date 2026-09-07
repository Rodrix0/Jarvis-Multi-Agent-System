const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'jarvis.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const CURRENT_SCHEMA_VERSION = 12;

// Serialización canónica de JSON (claves ordenadas determinísticamente)
function canonicalStringify(obj) {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalStringify).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}';
}

// Data scrubbing: limpia contraseñas, tokens y contenido privado antes de auditar
function scrubData(data) {
    if (!data || typeof data !== 'object') return data;
    const scrubbed = Array.isArray(data) ? [] : {};
    for (const [key, val] of Object.entries(data)) {
        if (/password|token|secret|pin|authorization|cookie|privateKey/i.test(key)) {
            scrubbed[key] = '[SCRUBBED_SECRET]';
        } else if (typeof val === 'object' && val !== null) {
            scrubbed[key] = scrubData(val);
        } else {
            scrubbed[key] = val;
        }
    }
    return scrubbed;
}

class DatabaseService {
    constructor() {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        
        this.db = new DatabaseSync(DB_PATH);
        this.initPragmas();
        this.runMigrations();
        this.verifyAuditChainIntegrity();
    }

    initPragmas() {
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');
        this.db.exec('PRAGMA foreign_keys = ON;');
    }

    runMigrations() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_info (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
        `);

        const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_info').get();
        const currentVer = row && row.version ? Number(row.version) : 0;

        if (currentVer < 6) {
            this.db.exec('BEGIN TRANSACTION;');
            try {
                // Tablas Core
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS executions (
                        id TEXT PRIMARY KEY,
                        action_id TEXT NOT NULL,
                        parent_execution_id TEXT,
                        level TEXT NOT NULL,
                        status TEXT NOT NULL,
                        started_at TEXT NOT NULL,
                        finished_at TEXT,
                        progress REAL DEFAULT 0,
                        error TEXT,
                        cancelable INTEGER DEFAULT 1,
                        rollback_available INTEGER DEFAULT 0,
                        metadata_json TEXT
                    );

                    CREATE TABLE IF NOT EXISTS communication_log (
                        id TEXT PRIMARY KEY,
                        execution_id TEXT NOT NULL,
                        recipient TEXT NOT NULL,
                        channel TEXT NOT NULL,
                        status TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        ref_hash TEXT
                    );

                    CREATE TABLE IF NOT EXISTS agenda (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        target_date TEXT,
                        target_time TEXT NOT NULL,
                        recurrence TEXT DEFAULT 'none',
                        status TEXT NOT NULL DEFAULT 'pending',
                        last_triggered TEXT,
                        created_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS contacts (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        aliases_json TEXT,
                        phone_intl TEXT,
                        email TEXT,
                        notes TEXT
                    );

                    CREATE TABLE IF NOT EXISTS trash_manifest (
                        id TEXT PRIMARY KEY,
                        original_path TEXT NOT NULL,
                        trash_path TEXT NOT NULL,
                        deleted_at TEXT NOT NULL,
                        file_size INTEGER,
                        file_hash TEXT,
                        status TEXT NOT NULL DEFAULT 'in_trash'
                    );

                    CREATE TABLE IF NOT EXISTS memory (
                        id TEXT PRIMARY KEY,
                        type TEXT NOT NULL,
                        tier TEXT NOT NULL DEFAULT 'NORMAL',
                        key TEXT,
                        value TEXT NOT NULL,
                        source TEXT NOT NULL,
                        confidence REAL DEFAULT 1.0,
                        created_at TEXT NOT NULL,
                        last_used TEXT,
                        expires_at TEXT,
                        status TEXT NOT NULL DEFAULT 'ACTIVE'
                    );

                    CREATE TABLE IF NOT EXISTS skills_manifest (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        version TEXT NOT NULL,
                        permissions_json TEXT,
                        network_access INTEGER DEFAULT 0,
                        fs_access TEXT DEFAULT 'none',
                        required_level TEXT NOT NULL DEFAULT 'L4',
                        entrypoint TEXT NOT NULL,
                        hash TEXT NOT NULL,
                        trust_level TEXT NOT NULL DEFAULT 'untrusted',
                        status TEXT NOT NULL DEFAULT 'enabled'
                    );

                    CREATE TABLE IF NOT EXISTS goals (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        status TEXT NOT NULL,
                        priority TEXT DEFAULT 'MEDIUM',
                        deadline TEXT,
                        created_by TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        completed_at TEXT,
                        subgoals_json TEXT
                    );

                    CREATE TABLE IF NOT EXISTS plans (
                        id TEXT PRIMARY KEY,
                        goal_id TEXT,
                        plan_version INTEGER DEFAULT 1,
                        last_completed_step_id TEXT,
                        status TEXT NOT NULL,
                        steps_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS audit_chain (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp TEXT NOT NULL,
                        execution_id TEXT NOT NULL,
                        action TEXT NOT NULL,
                        level TEXT NOT NULL,
                        status TEXT NOT NULL,
                        prev_hash TEXT NOT NULL,
                        record_hash TEXT NOT NULL,
                        data_json TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS critical_events (
                        id TEXT PRIMARY KEY,
                        event_name TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        payload_json TEXT NOT NULL
                    );
                `);

                this.db.prepare('INSERT INTO schema_info (version, applied_at) VALUES (?, ?)')
                    .run(6, new Date().toISOString());
                this.db.exec('COMMIT;');
                console.log(`[Database] Migraciones aplicadas a versión v6 con éxito.`);
            } catch (err) {
                this.db.exec('ROLLBACK;');
                throw err;
            }
        }

        if (currentVer < 7) {
            this.db.exec('BEGIN TRANSACTION;');
            try {
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS memory_vectors (
                        id TEXT PRIMARY KEY,
                        text TEXT NOT NULL,
                        vector BLOB NOT NULL,
                        category TEXT DEFAULT 'general',
                        metadata_json TEXT,
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_memory_vectors_category ON memory_vectors (category);
                    CREATE INDEX IF NOT EXISTS idx_memory_vectors_created ON memory_vectors (created_at);
                `);

                this.db.prepare('INSERT INTO schema_info (version, applied_at) VALUES (?, ?)')
                    .run(7, new Date().toISOString());
                this.db.exec('COMMIT;');
                console.log('[Database] Migración v7 (memory_vectors) aplicada con éxito.');
            } catch (err) {
                this.db.exec('ROLLBACK;');
                throw err;
            }
        }

        if (currentVer < 8) {
            this.db.exec('BEGIN TRANSACTION;');
            try {
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS conditional_automations (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        rule_json TEXT NOT NULL,
                        enabled INTEGER DEFAULT 1,
                        trigger_count INTEGER DEFAULT 0,
                        consecutive_failures INTEGER DEFAULT 0,
                        created_at TEXT NOT NULL,
                        last_triggered TEXT,
                        status TEXT DEFAULT 'active'
                    );

                    CREATE TABLE IF NOT EXISTS automation_execution_log (
                        id TEXT PRIMARY KEY,
                        rule_id TEXT NOT NULL,
                        event_name TEXT NOT NULL,
                        status TEXT NOT NULL,
                        payload_json TEXT,
                        result_json TEXT,
                        error TEXT,
                        duration_ms INTEGER DEFAULT 0,
                        timestamp TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_cond_auto_enabled ON conditional_automations (enabled);
                    CREATE INDEX IF NOT EXISTS idx_auto_log_rule ON automation_execution_log (rule_id);
                    CREATE INDEX IF NOT EXISTS idx_auto_log_timestamp ON automation_execution_log (timestamp);
                `);

                this.db.prepare('INSERT INTO schema_info (version, applied_at) VALUES (?, ?)')
                    .run(8, new Date().toISOString());
                this.db.exec('COMMIT;');
                console.log('[Database] Migración v8 (conditional_automations) aplicada con éxito.');
            } catch (err) {
                this.db.exec('ROLLBACK;');
                throw err;
            }
        }

        if (currentVer < 9) {
            this.db.exec('BEGIN TRANSACTION;');
            try {
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS persistent_tasks (
                        id TEXT PRIMARY KEY,
                        type TEXT NOT NULL,
                        description TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'PENDING',
                        priority TEXT DEFAULT 'NORMAL',
                        progress REAL DEFAULT 0,
                        payload_json TEXT,
                        checkpoint_json TEXT,
                        recovery_policy TEXT DEFAULT 'RESUME',
                        retry_count INTEGER DEFAULT 0,
                        max_retries INTEGER DEFAULT 3,
                        created_at TEXT NOT NULL,
                        started_at TEXT,
                        updated_at TEXT,
                        finished_at TEXT,
                        error TEXT,
                        metadata_json TEXT
                    );

                    CREATE TABLE IF NOT EXISTS task_checkpoints (
                        id TEXT PRIMARY KEY,
                        task_id TEXT NOT NULL,
                        step_index INTEGER,
                        step_name TEXT,
                        data_json TEXT,
                        created_at TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_tasks_status ON persistent_tasks (status);
                    CREATE INDEX IF NOT EXISTS idx_tasks_type ON persistent_tasks (type);
                    CREATE INDEX IF NOT EXISTS idx_tasks_created ON persistent_tasks (created_at);
                    CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON task_checkpoints (task_id);
                `);

                this.db.prepare('INSERT INTO schema_info (version, applied_at) VALUES (?, ?)')
                    .run(9, new Date().toISOString());
                this.db.exec('COMMIT;');
                console.log('[Database] Migración v9 (persistent_tasks & task_checkpoints) aplicada con éxito.');
            } catch (err) {
                this.db.exec('ROLLBACK;');
                throw err;
            }
        }

        if (currentVer < 10) {
            this.db.exec('BEGIN TRANSACTION;');
            try {
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS operation_metrics (
                        id TEXT PRIMARY KEY,
                        trace_id TEXT,
                        operation_type TEXT NOT NULL DEFAULT 'turn',
                        status TEXT NOT NULL DEFAULT 'SUCCESS',
                        intent_detection_ms REAL DEFAULT 0,
                        memory_search_ms REAL DEFAULT 0,
                        llm_ttft_ms REAL DEFAULT 0,
                        llm_generation_ms REAL DEFAULT 0,
                        tool_execution_ms REAL DEFAULT 0,
                        total_duration_ms REAL DEFAULT 0,
                        tokens_prompt INTEGER DEFAULT 0,
                        tokens_completion INTEGER DEFAULT 0,
                        tokens_total INTEGER DEFAULT 0,
                        vram_used_mb REAL DEFAULT 0,
                        retries INTEGER DEFAULT 0,
                        tool_errors INTEGER DEFAULT 0,
                        error_message TEXT,
                        model_name TEXT,
                        metadata_json TEXT,
                        created_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS metrics_aggregated_hourly (
                        hour TEXT PRIMARY KEY,
                        total_operations INTEGER DEFAULT 0,
                        successful_operations INTEGER DEFAULT 0,
                        failed_operations INTEGER DEFAULT 0,
                        total_retries INTEGER DEFAULT 0,
                        total_tool_errors INTEGER DEFAULT 0,
                        avg_intent_ms REAL DEFAULT 0,
                        avg_memory_ms REAL DEFAULT 0,
                        avg_ttft_ms REAL DEFAULT 0,
                        avg_generation_ms REAL DEFAULT 0,
                        avg_tool_ms REAL DEFAULT 0,
                        avg_total_ms REAL DEFAULT 0,
                        total_tokens INTEGER DEFAULT 0
                    );

                    CREATE INDEX IF NOT EXISTS idx_op_metrics_created ON operation_metrics (created_at);
                    CREATE INDEX IF NOT EXISTS idx_op_metrics_type ON operation_metrics (operation_type);
                    CREATE INDEX IF NOT EXISTS idx_op_metrics_status ON operation_metrics (status);
                    CREATE INDEX IF NOT EXISTS idx_op_metrics_trace ON operation_metrics (trace_id);
                `);

                this.db.prepare('INSERT INTO schema_info (version, applied_at) VALUES (?, ?)')
                    .run(10, new Date().toISOString());
                this.db.exec('COMMIT;');
                console.log('[Database] Migración v10 (operation_metrics) aplicada con éxito.');
            } catch (err) {
                this.db.exec('ROLLBACK;');
                throw err;
            }
        }

        if (currentVer < 11) {
            this.db.exec('BEGIN TRANSACTION;');
            try {
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS structured_logs (
                        id TEXT PRIMARY KEY,
                        timestamp TEXT NOT NULL,
                        level TEXT NOT NULL DEFAULT 'INFO',
                        module TEXT NOT NULL,
                        action TEXT NOT NULL,
                        result TEXT NOT NULL DEFAULT 'success',
                        duration INTEGER DEFAULT 0,
                        error_code TEXT,
                        error_message TEXT,
                        error_stack TEXT,
                        metadata_json TEXT,
                        created_at TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_struct_logs_mod_act ON structured_logs (module, action);
                    CREATE INDEX IF NOT EXISTS idx_struct_logs_result ON structured_logs (result);
                    CREATE INDEX IF NOT EXISTS idx_struct_logs_level ON structured_logs (level);
                    CREATE INDEX IF NOT EXISTS idx_struct_logs_created ON structured_logs (created_at);
                `);

                this.db.prepare('INSERT INTO schema_info (version, applied_at) VALUES (?, ?)')
                    .run(11, new Date().toISOString());
                this.db.exec('COMMIT;');
                console.log('[Database] Migración v11 (structured_logs) aplicada con éxito.');
            } catch (err) {
                this.db.exec('ROLLBACK;');
                throw err;
            }
        }

        if (currentVer < 12) {
            this.db.exec('BEGIN TRANSACTION;');
            try {
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS raw_archive_fts USING fts5(
                        id UNINDEXED,
                        tier UNINDEXED,
                        content,
                        source UNINDEXED,
                        timestamp UNINDEXED
                    );

                    CREATE TABLE IF NOT EXISTS memory_conflict_history (
                        id TEXT PRIMARY KEY,
                        memory_key TEXT NOT NULL,
                        previous_value TEXT NOT NULL,
                        new_value TEXT NOT NULL,
                        valid_from TEXT NOT NULL,
                        valid_until TEXT NOT NULL,
                        superseded_by TEXT,
                        source TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_conflict_key ON memory_conflict_history (memory_key);
                    CREATE INDEX IF NOT EXISTS idx_conflict_valid_from ON memory_conflict_history (valid_from);
                `);

                this.db.prepare('INSERT INTO schema_info (version, applied_at) VALUES (?, ?)')
                    .run(12, new Date().toISOString());
                this.db.exec('COMMIT;');
                console.log('[Database] Migración v12 (raw_archive_fts & memory_conflict_history) aplicada con éxito.');
            } catch (err) {
                this.db.exec('ROLLBACK;');
                throw err;
            }
        }

    }

    // Auditoría Canónica con Hash-Chaining
    appendAudit(entry) {
        const timestamp = new Date().toISOString();
        const scrubbed = scrubData(entry.data || {});
        const canonicalData = canonicalStringify(scrubbed);

        // Obtener último hash
        const lastRow = this.db.prepare('SELECT record_hash FROM audit_chain ORDER BY id DESC LIMIT 1').get();
        const prevHash = lastRow ? lastRow.record_hash : 'GENESIS_HASH_JARVIS_V6';

        // Calcular hash SHA-256 de este bloque
        const recordContent = `${timestamp}|${entry.executionId}|${entry.action}|${entry.level}|${entry.status}|${prevHash}|${canonicalData}`;
        const recordHash = crypto.createHash('sha256').update(recordContent, 'utf8').digest('hex');

        const stmt = this.db.prepare(`
            INSERT INTO audit_chain (timestamp, execution_id, action, level, status, prev_hash, record_hash, data_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(timestamp, entry.executionId, entry.action, entry.level, entry.status, prevHash, recordHash, canonicalData);

        return { recordHash, prevHash, timestamp };
    }

    verifyAuditChainIntegrity() {
        const rows = this.db.prepare('SELECT * FROM audit_chain ORDER BY id ASC').all();
        if (!rows.length) return true;

        let expectedPrev = 'GENESIS_HASH_JARVIS_V6';
        for (const row of rows) {
            if (row.prev_hash !== expectedPrev) {
                console.error(`[Audit Security Alert] 🚨 Alteración detectada en registro audit_chain ID ${row.id}: prev_hash inconsistente.`);
                return false;
            }
            const recordContent = `${row.timestamp}|${row.execution_id}|${row.action}|${row.level}|${row.status}|${row.prev_hash}|${row.data_json}`;
            const computedHash = crypto.createHash('sha256').update(recordContent, 'utf8').digest('hex');
            if (computedHash !== row.record_hash) {
                console.error(`[Audit Security Alert] 🚨 Alteración detectada en registro audit_chain ID ${row.id}: hash no coincide.`);
                return false;
            }
            expectedPrev = row.record_hash;
        }
        return true;
    }

    recordCriticalEvent(eventName, payload) {
        const id = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const stmt = this.db.prepare('INSERT INTO critical_events (id, event_name, timestamp, payload_json) VALUES (?, ?, ?, ?)');
        stmt.run(id, eventName, timestamp, JSON.stringify(payload));
    }

    // Backup consistente online con rotación a 7 copias
    createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(BACKUP_DIR, `jarvis_backup_${timestamp}.db`);
        
        try {
            this.db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}';`);
            console.log(`[Database] ✅ Backup consistente creado: ${backupFile}`);

            // Rotar backups antiguos manteniendo últimos 7
            const files = fs.readdirSync(BACKUP_DIR)
                .filter(f => f.startsWith('jarvis_backup_') && f.endsWith('.db'))
                .sort()
                .reverse();
            
            if (files.length > 7) {
                for (const oldFile of files.slice(7)) {
                    fs.unlinkSync(path.join(BACKUP_DIR, oldFile));
                }
            }
            return backupFile;
        } catch (err) {
            console.error('[Database] Error creando backup online:', err.message);
            return null;
        }
    }

    // --- AUTOMATIZACIONES CONDICIONALES (Ítem 27) ---
    saveAutomationRule(rule) {
        const stmt = this.db.prepare(`
            INSERT INTO conditional_automations (id, name, rule_json, enabled, trigger_count, consecutive_failures, created_at, last_triggered, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                rule_json = excluded.rule_json,
                enabled = excluded.enabled,
                trigger_count = excluded.trigger_count,
                consecutive_failures = excluded.consecutive_failures,
                last_triggered = excluded.last_triggered,
                status = excluded.status
        `);
        stmt.run(
            rule.id,
            rule.name || 'Regla sin nombre',
            JSON.stringify(rule),
            rule.enabled !== false ? 1 : 0,
            Number(rule.trigger_count || 0),
            Number(rule.consecutive_failures || 0),
            rule.created_at || new Date().toISOString(),
            rule.last_triggered || null,
            rule.status || 'active'
        );
        return rule;
    }

    getAutomationRule(id) {
        const row = this.db.prepare('SELECT * FROM conditional_automations WHERE id = ?').get(id);
        if (!row) return null;
        try {
            const rule = JSON.parse(row.rule_json);
            rule.enabled = row.enabled === 1;
            rule.trigger_count = row.trigger_count;
            rule.consecutive_failures = row.consecutive_failures;
            rule.last_triggered = row.last_triggered;
            rule.status = row.status;
            return rule;
        } catch {
            return null;
        }
    }

    getAllAutomationRules() {
        const rows = this.db.prepare('SELECT * FROM conditional_automations ORDER BY created_at ASC').all();
        return rows.map(row => {
            try {
                const rule = JSON.parse(row.rule_json);
                rule.enabled = row.enabled === 1;
                rule.trigger_count = row.trigger_count;
                rule.consecutive_failures = row.consecutive_failures;
                rule.last_triggered = row.last_triggered;
                rule.status = row.status;
                return rule;
            } catch {
                return null;
            }
        }).filter(Boolean);
    }

    updateAutomationRuleStatus(id, updates = {}) {
        const current = this.getAutomationRule(id);
        if (!current) return null;

        const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : (current.enabled ? 1 : 0);
        const triggerCount = updates.trigger_count !== undefined ? Number(updates.trigger_count) : Number(current.trigger_count || 0);
        const consecutiveFailures = updates.consecutive_failures !== undefined ? Number(updates.consecutive_failures) : Number(current.consecutive_failures || 0);
        const lastTriggered = updates.last_triggered !== undefined ? updates.last_triggered : current.last_triggered;
        const status = updates.status !== undefined ? updates.status : (current.status || 'active');

        // Actualizar también en el objeto rule_json interno
        current.enabled = enabled === 1;
        current.trigger_count = triggerCount;
        current.consecutive_failures = consecutiveFailures;
        current.last_triggered = lastTriggered;
        current.status = status;

        const stmt = this.db.prepare(`
            UPDATE conditional_automations
            SET enabled = ?, trigger_count = ?, consecutive_failures = ?, last_triggered = ?, status = ?, rule_json = ?
            WHERE id = ?
        `);
        stmt.run(enabled, triggerCount, consecutiveFailures, lastTriggered, status, JSON.stringify(current), id);
        return current;
    }

    deleteAutomationRule(id) {
        const info = this.db.prepare('DELETE FROM conditional_automations WHERE id = ?').run(id);
        return info.changes > 0;
    }

    logAutomationExecution(entry) {
        const id = entry.id || crypto.randomUUID();
        const timestamp = entry.timestamp || new Date().toISOString();
        const stmt = this.db.prepare(`
            INSERT INTO automation_execution_log (id, rule_id, event_name, status, payload_json, result_json, error, duration_ms, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            id,
            entry.ruleId,
            entry.eventName,
            entry.status,
            JSON.stringify(entry.payload || {}),
            JSON.stringify(entry.result || {}),
            entry.error ? String(entry.error) : null,
            Number(entry.durationMs || 0),
            timestamp
        );
        return { id, timestamp };
    }

    getAutomationLogs(ruleId = null, limit = 50) {
        let stmt;
        if (ruleId) {
            stmt = this.db.prepare('SELECT * FROM automation_execution_log WHERE rule_id = ? ORDER BY timestamp DESC LIMIT ?');
            return stmt.all(ruleId, limit);
        } else {
            stmt = this.db.prepare('SELECT * FROM automation_execution_log ORDER BY timestamp DESC LIMIT ?');
            return stmt.all(limit);
        }
    }

    // --- TAREAS PERSISTENTES Y PUNTOS DE CONTROL (Ítem 28) ---
    savePersistentTask(task) {
        const stmt = this.db.prepare(`
            INSERT INTO persistent_tasks (
                id, type, description, status, priority, progress,
                payload_json, checkpoint_json, recovery_policy,
                retry_count, max_retries, created_at, started_at,
                updated_at, finished_at, error, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                type = excluded.type,
                description = excluded.description,
                status = excluded.status,
                priority = excluded.priority,
                progress = excluded.progress,
                payload_json = excluded.payload_json,
                checkpoint_json = excluded.checkpoint_json,
                recovery_policy = excluded.recovery_policy,
                retry_count = excluded.retry_count,
                max_retries = excluded.max_retries,
                started_at = excluded.started_at,
                updated_at = excluded.updated_at,
                finished_at = excluded.finished_at,
                error = excluded.error,
                metadata_json = excluded.metadata_json
        `);

        stmt.run(
            task.id,
            task.type || 'generic',
            task.description || 'Tarea persistente',
            task.status || 'PENDING',
            task.priority || 'NORMAL',
            Number(task.progress || 0),
            task.payload ? JSON.stringify(task.payload) : (task.payload_json || null),
            task.checkpoint ? JSON.stringify(task.checkpoint) : (task.checkpoint_json || null),
            task.recovery_policy || 'RESUME',
            Number(task.retry_count || 0),
            Number(task.max_retries !== undefined ? task.max_retries : 3),
            task.created_at || task.createdAt || new Date().toISOString(),
            task.started_at || task.startedAt || null,
            new Date().toISOString(),
            task.finished_at || task.finishedAt || null,
            task.error || null,
            task.metadata ? JSON.stringify(task.metadata) : (task.metadata_json || null)
        );
        return task;
    }

    getPersistentTask(id) {
        const row = this.db.prepare('SELECT * FROM persistent_tasks WHERE id = ?').get(id);
        if (!row) return null;
        return this._deserializeTask(row);
    }

    getAllPersistentTasks({ status = null, type = null, limit = 100 } = {}) {
        let query = 'SELECT * FROM persistent_tasks WHERE 1=1';
        const params = [];
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const rows = this.db.prepare(query).all(...params);
        return rows.map(r => this._deserializeTask(r));
    }

    getOrphanTasksOnCrash() {
        const rows = this.db.prepare(`
            SELECT * FROM persistent_tasks
            WHERE status IN ('RUNNING', 'PENDING', 'PAUSED')
            ORDER BY created_at ASC
        `).all();
        return rows.map(r => this._deserializeTask(r));
    }

    updatePersistentTask(id, updates = {}) {
        const current = this.getPersistentTask(id);
        if (!current) return null;

        const updated = {
            ...current,
            ...updates,
            updated_at: new Date().toISOString()
        };
        this.savePersistentTask(updated);
        return updated;
    }

    deletePersistentTask(id) {
        this.db.prepare('DELETE FROM task_checkpoints WHERE task_id = ?').run(id);
        const info = this.db.prepare('DELETE FROM persistent_tasks WHERE id = ?').run(id);
        return info.changes > 0;
    }

    saveTaskCheckpoint(taskId, stepIndex, stepName, data = {}) {
        const checkpointId = crypto.randomUUID();
        const now = new Date().toISOString();
        const dataJson = JSON.stringify(data);

        this.db.prepare(`
            INSERT INTO task_checkpoints (id, task_id, step_index, step_name, data_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(checkpointId, taskId, stepIndex, stepName, dataJson, now);

        // Actualizar último checkpoint en la tarea
        this.db.prepare(`
            UPDATE persistent_tasks
            SET checkpoint_json = ?, updated_at = ?
            WHERE id = ?
        `).run(dataJson, now, taskId);

        return { id: checkpointId, taskId, stepIndex, stepName, data, created_at: now };
    }

    getTaskCheckpoints(taskId) {
        const rows = this.db.prepare('SELECT * FROM task_checkpoints WHERE task_id = ? ORDER BY step_index ASC, created_at ASC').all(taskId);
        return rows.map(r => ({
            id: r.id,
            taskId: r.task_id,
            stepIndex: r.step_index,
            stepName: r.step_name,
            data: r.data_json ? JSON.parse(r.data_json) : null,
            created_at: r.created_at
        }));
    }

    _deserializeTask(row) {
        if (!row) return null;
        let payload = null, checkpoint = null, metadata = {};
        try { if (row.payload_json) payload = JSON.parse(row.payload_json); } catch (e) {}
        try { if (row.checkpoint_json) checkpoint = JSON.parse(row.checkpoint_json); } catch (e) {}
        try { if (row.metadata_json) metadata = JSON.parse(row.metadata_json); } catch (e) {}

        return {
            id: row.id,
            type: row.type,
            description: row.description,
            status: row.status,
            priority: row.priority,
            progress: row.progress,
            payload,
            checkpoint,
            recovery_policy: row.recovery_policy,
            retry_count: row.retry_count,
            max_retries: row.max_retries,
            created_at: row.created_at,
            started_at: row.started_at,
            updated_at: row.updated_at,
            finished_at: row.finished_at,
            error: row.error,
            metadata
        };
    }

    // ==========================================
    // MÉTRICAS POR OPERACIÓN (Ítem 32)
    // ==========================================
    saveOperationMetric(metric) {
        const stmt = this.db.prepare(`
            INSERT INTO operation_metrics (
                id, trace_id, operation_type, status,
                intent_detection_ms, memory_search_ms, llm_ttft_ms,
                llm_generation_ms, tool_execution_ms, total_duration_ms,
                tokens_prompt, tokens_completion, tokens_total,
                vram_used_mb, retries, tool_errors, error_message,
                model_name, metadata_json, created_at
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?
            )
        `);

        stmt.run(
            metric.id,
            metric.trace_id || metric.id,
            metric.operation_type || 'turn',
            metric.status || 'SUCCESS',
            metric.intent_detection_ms || 0,
            metric.memory_search_ms || 0,
            metric.llm_ttft_ms || 0,
            metric.llm_generation_ms || 0,
            metric.tool_execution_ms || 0,
            metric.total_duration_ms || 0,
            metric.tokens_prompt || 0,
            metric.tokens_completion || 0,
            metric.tokens_total || 0,
            metric.vram_used_mb || 0,
            metric.retries || 0,
            metric.tool_errors || 0,
            metric.error_message || null,
            metric.model_name || null,
            metric.metadata ? JSON.stringify(metric.metadata) : null,
            metric.created_at || new Date().toISOString()
        );

        return metric;
    }

    getOperationMetrics({ limit = 50, offset = 0, status, operationType } = {}) {
        let sql = 'SELECT * FROM operation_metrics';
        const params = [];
        const conditions = [];

        if (status) {
            conditions.push('status = ?');
            params.push(status);
        }
        if (operationType) {
            conditions.push('operation_type = ?');
            params.push(operationType);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(Number(limit) || 50, Number(offset) || 0);

        const rows = this.db.prepare(sql).all(...params);
        return rows.map(r => ({
            ...r,
            metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {}
        }));
    }

    getMetricsSummary(timeframeHours = 24) {
        const sinceTime = new Date(Date.now() - (Number(timeframeHours) || 24) * 3600 * 1000).toISOString();
        const row = this.db.prepare(`
            SELECT
                COUNT(*) as total_operations,
                SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successful_operations,
                SUM(CASE WHEN status != 'SUCCESS' THEN 1 ELSE 0 END) as failed_operations,
                SUM(retries) as total_retries,
                SUM(tool_errors) as total_tool_errors,
                AVG(intent_detection_ms) as avg_intent_ms,
                AVG(memory_search_ms) as avg_memory_ms,
                AVG(llm_ttft_ms) as avg_ttft_ms,
                AVG(llm_generation_ms) as avg_generation_ms,
                AVG(tool_execution_ms) as avg_tool_ms,
                AVG(total_duration_ms) as avg_total_ms,
                SUM(tokens_total) as total_tokens,
                AVG(vram_used_mb) as avg_vram_mb
            FROM operation_metrics
            WHERE created_at >= ?
        `).get(sinceTime);

        const total = row?.total_operations || 0;
        const success = row?.successful_operations || 0;
        const successRate = total > 0 ? parseFloat(((success / total) * 100).toFixed(1)) : 100;
        const failureRate = total > 0 ? parseFloat((((total - success) / total) * 100).toFixed(1)) : 0;

        return {
            timeframeHours: Number(timeframeHours) || 24,
            totalOperations: total,
            successfulOperations: success,
            failedOperations: row?.failed_operations || 0,
            successRate,
            failureRate,
            totalRetries: row?.total_retries || 0,
            totalToolErrors: row?.total_tool_errors || 0,
            stagesAvgMs: {
                intent_detection: Math.round(row?.avg_intent_ms || 0),
                memory_search: Math.round(row?.avg_memory_ms || 0),
                llm_ttft: Math.round(row?.avg_ttft_ms || 0),
                llm_generation: Math.round(row?.avg_generation_ms || 0),
                tool_execution: Math.round(row?.avg_tool_ms || 0),
                total: Math.round(row?.avg_total_ms || 0)
            },
            totalTokens: row?.total_tokens || 0,
            avgVramMb: Math.round(row?.avg_vram_mb || 0)
        };
    }

    // --- Ítem 33: Métodos de Persistencia para Logs Estructurados ---
    saveStructuredLog(entry) {
        if (!this.db || !entry) return false;
        try {
            const stmt = this.db.prepare(`
                INSERT INTO structured_logs (
                    id, timestamp, level, module, action, result, duration,
                    error_code, error_message, error_stack, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const id = entry.id || `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const timestamp = entry.timestamp || new Date().toISOString();
            const level = entry.level || (entry.result === 'error' ? 'ERROR' : 'INFO');
            const module = entry.module || 'core';
            const action = entry.action || 'unknown';
            const result = entry.result || 'success';
            const duration = Number(entry.duration) || 0;
            const errorCode = entry.error?.code || entry.error_code || null;
            const errorMessage = entry.error?.message || entry.error_message || (typeof entry.error === 'string' ? entry.error : null);
            const errorStack = entry.error?.stack || entry.error_stack || null;
            const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : null;
            const createdAt = timestamp;

            stmt.run(
                id, timestamp, level, module, action, result, duration,
                errorCode, errorMessage, errorStack, metadataJson, createdAt
            );
            return true;
        } catch (err) {
            console.error('[DatabaseService] Error al guardar structured_log:', err.message);
            return false;
        }
    }

    queryStructuredLogs(filter = {}) {
        if (!this.db) return [];
        try {
            const conditions = [];
            const params = [];

            if (filter.module) {
                conditions.push('module = ?');
                params.push(filter.module);
            }
            if (filter.action) {
                conditions.push('action = ?');
                params.push(filter.action);
            }
            if (filter.result) {
                conditions.push('result = ?');
                params.push(filter.result);
            }
            if (filter.level) {
                conditions.push('level = ?');
                params.push(filter.level);
            }
            if (filter.since) {
                conditions.push('created_at >= ?');
                params.push(filter.since);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const limit = Number(filter.limit) || 50;

            const stmt = this.db.prepare(`
                SELECT * FROM structured_logs
                ${whereClause}
                ORDER BY created_at DESC
                LIMIT ?
            `);

            params.push(limit);
            const rows = stmt.all(...params);
            return rows.map(r => ({
                id: r.id,
                timestamp: r.timestamp,
                level: r.level,
                module: r.module,
                action: r.action,
                result: r.result,
                duration: r.duration,
                error: (r.error_code || r.error_message) ? {
                    code: r.error_code,
                    message: r.error_message,
                    stack: r.error_stack
                } : null,
                metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
                createdAt: r.created_at
            }));
        } catch (err) {
            console.error('[DatabaseService] Error al consultar structured_logs:', err.message);
            return [];
        }
    }

    getStructuredErrorsSummary(timeframeHours = 24) {
        if (!this.db) return [];
        try {
            const sinceTime = new Date(Date.now() - (Number(timeframeHours) || 24) * 3600 * 1000).toISOString();
            const stmt = this.db.prepare(`
                SELECT
                    module,
                    action,
                    COALESCE(error_code, 'unspecified_error') as error_code,
                    COUNT(*) as count,
                    AVG(duration) as avg_duration,
                    MAX(created_at) as last_seen
                FROM structured_logs
                WHERE result != 'success' AND created_at >= ?
                GROUP BY module, action, error_code
                ORDER BY count DESC
                LIMIT 20
            `);
            return stmt.all(sinceTime);
        } catch (err) {
            console.error('[DatabaseService] Error en getStructuredErrorsSummary:', err.message);
            return [];
        }
    }
}

const databaseService = new DatabaseService();
module.exports = databaseService;

