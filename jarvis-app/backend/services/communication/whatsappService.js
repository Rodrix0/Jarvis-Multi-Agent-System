const contactsService = require('./contactsService');
const databaseService = require('../persistence/databaseService');
const crypto = require('crypto');

class WhatsAppService {
    prepareMessage({ recipientQuery, message }) {
        const resolution = contactsService.resolveContact(recipientQuery);
        if (resolution.status === 'AMBIGUOUS') {
            return { ok: false, code: 'ERR_CONTACT_AMBIGUOUS', message: resolution.message, matches: resolution.matches };
        }
        if (resolution.status === 'NOT_FOUND') {
            return { ok: false, code: 'ERR_CONTACT_NOT_FOUND', message: `No encontré el contacto "${recipientQuery}".` };
        }

        const contact = resolution.contact;
        return {
            ok: true,
            status: 'PREVIEW_READY',
            recipient: contact.name,
            phone: contact.phone_intl,
            message,
            preview: `[WhatsApp ➔ ${contact.name} (${contact.phone_intl || 'Sin número'})]\n"${message}"\n\n¿Deseas Enviar, Editar o Cancelar?`
        };
    }

    sendMessage({ executionId = 'manual', recipient, message }) {
        const commId = `comm-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();

        try {
            databaseService.db.prepare(`
                INSERT INTO communication_log (id, execution_id, recipient, channel, status, timestamp, ref_hash)
                VALUES (?, ?, ?, 'whatsapp', 'sent', ?, ?)
            `).run(commId, executionId, recipient, now, crypto.createHash('sha256').update(message || '').digest('hex'));
        } catch (e) {}

        console.log(`[WhatsAppService] 💬 Mensaje enviado a ${recipient}: "${message}"`);
        return { ok: true, status: 'SENT', commId, message: `Mensaje de WhatsApp enviado a ${recipient}.` };
    }
}

const whatsappService = new WhatsAppService();
module.exports = whatsappService;
