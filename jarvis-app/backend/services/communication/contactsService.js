const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

class ContactsService {
    constructor() {
        this.initDefaultContacts();
    }

    initDefaultContacts() {
        const count = databaseService.db.prepare('SELECT COUNT(*) AS count FROM contacts').get();
        if (count && count.count === 0) {
            this.addContact({ name: 'Mamá', aliases: ['mama', 'mami', 'madre'], phoneIntl: '+5491112345678', email: 'mama@gmail.com' });
            this.addContact({ name: 'Juan Pérez', aliases: ['juan', 'juancito'], phoneIntl: '+5491187654321', email: 'juan.perez@gmail.com' });
        }
    }

    addContact({ name, aliases = [], phoneIntl = null, email = null, notes = null }) {
        const id = `cnt-${crypto.randomUUID().slice(0, 8)}`;
        databaseService.db.prepare(`
            INSERT INTO contacts (id, name, aliases_json, phone_intl, email, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, name, JSON.stringify(aliases), phoneIntl, email, notes);
        return { ok: true, id, name };
    }

    resolveContact(query) {
        const clean = String(query || '').toLowerCase().trim();
        const rows = databaseService.db.prepare('SELECT * FROM contacts').all();

        const matches = [];
        for (const r of rows) {
            const aliases = JSON.parse(r.aliases_json || '[]').map(a => a.toLowerCase());
            if (r.name.toLowerCase().includes(clean) || aliases.some(a => a.includes(clean))) {
                matches.push(r);
            }
        }

        if (matches.length === 0) {
            return { status: 'NOT_FOUND', matches: [] };
        }
        if (matches.length === 1) {
            return { status: 'RESOLVED', contact: matches[0] };
        }

        // Conflicto de múltiples coincidencias (Desambiguación obligatoria)
        return {
            status: 'AMBIGUOUS',
            matches,
            message: `Encontré varios contactos: ${matches.map(m => m.name).join(' y ')}. ¿A cuál te referís?`
        };
    }
}

const contactsService = new ContactsService();
module.exports = contactsService;
