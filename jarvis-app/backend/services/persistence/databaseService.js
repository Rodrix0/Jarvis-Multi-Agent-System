const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'jarvis.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const CURRENT_SCHEMA_VERSION = 6;

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

        if (currentVer < CURRENT_SCHEMA_VERSION) {
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
                    .run(CURRENT_SCHEMA_VERSION, new Date().toISOString());
                this.db.exec('COMMIT;');
                console.log(`[Database] Migraciones aplicadas a versión v${CURRENT_SCHEMA_VERSION} con éxito.`);
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
}

const databaseService = new DatabaseService();
module.exports = databaseService;
