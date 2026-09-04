const fs = require('fs');
const path = require('path');
const os = require('os');

class FileCreationService {
    createFile({ fileName, content = '', format = 'txt', destinationDir = null }) {
        const desktop = destinationDir || process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
        if (!fs.existsSync(desktop)) {
            fs.mkdirSync(desktop, { recursive: true });
        }

        let baseName = String(fileName || '').trim();
        if (!baseName) {
            baseName = `Nota_${Date.now()}`;
        }

        // Si no tiene extensión, agregarla según formato
        if (!path.extname(baseName)) {
            baseName += `.${format.replace(/^\./, '')}`;
        }

        const filePath = path.join(desktop, baseName);
        fs.writeFileSync(filePath, String(content || ''), 'utf8');

        console.log(`[FileCreation] 📄 Archivo creado en: ${filePath}`);
        return {
            ok: true,
            filePath,
            fileName: baseName,
            size: Buffer.byteLength(content, 'utf8'),
            message: `Archivo "${baseName}" creado exitosamente en tu Escritorio.`
        };
    }
}

const fileCreationService = new FileCreationService();
module.exports = fileCreationService;
