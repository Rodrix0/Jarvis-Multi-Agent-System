const { execFile } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'sendWhatsAppByName.ps1');

class WhatsAppService {
    async sendMessage(contactName, messageText) {
        const contact = String(contactName || '').trim();
        const message = String(messageText || '').trim();

        if (!contact || !message) {
            return {
                ok: false,
                error: 'Faltan parámetros: se requiere nombre de contacto y texto del mensaje.',
                message: 'No pude enviar el mensaje porque falta el contacto o el texto.'
            };
        }

        return new Promise((resolve) => {
            const args = [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-File', SCRIPT_PATH,
                '-ContactName', contact,
                '-MessageText', message
            ];

            execFile('powershell.exe', args, { timeout: 25000 }, (error, stdout, stderr) => {
                const output = (stdout || '') + (stderr || '');
                console.log(`[WhatsAppService] Contacto: "${contact}" | Mensaje: "${message}" | Output:`, output.trim());

                if (error || output.includes('ERROR:')) {
                    console.error('[WhatsAppService Error]:', error ? error.message : output);
                    resolve({
                        ok: false,
                        error: error ? error.message : output,
                        contact,
                        messageText: message,
                        message: `No pude enviar el mensaje a ${contact}. Verificá que WhatsApp esté abierto o disponible.`
                    });
                } else {
                    resolve({
                        ok: true,
                        contact,
                        messageText: message,
                        message: `Listo, envié el mensaje a ${contact}: "${message}".`,
                        raw: output.trim()
                    });
                }
            });
        });
    }
}

const whatsappService = new WhatsAppService();
module.exports = whatsappService;
