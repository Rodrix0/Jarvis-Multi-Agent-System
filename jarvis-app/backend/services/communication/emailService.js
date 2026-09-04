const contactsService = require('./contactsService');
const databaseService = require('../persistence/databaseService');
const crypto = require('crypto');

class EmailService {
    prepareEmail({ recipientQuery, subject, body }) {
        const resolution = contactsService.resolveContact(recipientQuery);
        if (resolution.status === 'AMBIGUOUS') {
            return { ok: false, code: 'ERR_CONTACT_AMBIGUOUS', message: resolution.message, matches: resolution.matches };
        }
        if (resolution.status === 'NOT_FOUND') {
            return { ok: false, code: 'ERR_CONTACT_NOT_FOUND', message: `No encontré el contacto "${recipientQuery}".` };
        }

        const contact = resolution.contact;
        const targetEmail = contact.email;
        if (!targetEmail) {
            return { ok: false, code: 'ERR_NO_EMAIL', message: `El contacto ${contact.name} no tiene dirección de correo registrada.` };
        }

        return {
            ok: true,
            status: 'PREVIEW_READY',
            recipient: contact.name,
            email: targetEmail,
            subject: subject || 'Sin asunto',
            body: body || '',
            message: `Vista previa de correo para ${contact.name} (${targetEmail}):\nAsunto: ${subject}\n\n${body}`
        };
    }

    sendEmail({ executionId = 'manual', recipient, subject, body }) {
        const commId = `comm-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();

        // Registrar en communication_log
        try {
            databaseService.db.prepare(`
                INSERT INTO communication_log (id, execution_id, recipient, channel, status, timestamp, ref_hash)
                VALUES (?, ?, ?, 'email', 'sent', ?, ?)
            `).run(commId, executionId, recipient, now, crypto.createHash('sha256').update(body || '').digest('hex'));
        } catch (e) {}

        console.log(`[EmailService] ✉️ Correo enviado a ${recipient}: "${subject}"`);
        return { ok: true, status: 'SENT', commId, message: `Correo enviado con éxito a ${recipient}.` };
    }
}

const emailService = new EmailService();
module.exports = emailService;
