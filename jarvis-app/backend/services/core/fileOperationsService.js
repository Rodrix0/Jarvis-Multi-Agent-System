const fs = require('fs');
const path = require('path');
const os = require('os');
const docx = require('docx');
const trashService = require('./trashService');

class FileOperationsService {
    getDesktopPath() {
        return process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
    }

    createFolder({ folderName, parentDir = null }) {
        const base = parentDir || this.getDesktopPath();
        const cleanName = String(folderName || 'Nueva_Carpeta').trim().replace(/[/\\?%*:|"<>]/g, '_');
        const targetPath = path.join(base, cleanName);

        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }

        console.log(`[FileOperations] 📁 Carpeta creada: ${targetPath}`);
        return {
            ok: true,
            folderPath: targetPath,
            folderName: cleanName,
            message: `Carpeta "${cleanName}" creada exitosamente en tu Escritorio.`
        };
    }

    async createWordDocument(filePath, title, content) {
        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;

        const paragraphs = [
            new Paragraph({
                text: title,
                heading: HeadingLevel.HEADING_1,
                spacing: { after: 300 }
            })
        ];

        const lines = String(content || '').split('\n').filter(Boolean);
        if (lines.length > 0) {
            lines.forEach(line => {
                paragraphs.push(new Paragraph({
                    children: [new TextRun({ text: line, size: 24 })],
                    spacing: { after: 150 }
                }));
            });
        } else {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: `Documento generado por Jarvis OS sobre: ${title}`, size: 24, italics: true })]
            }));
        }

        const doc = new Document({
            sections: [{ properties: {}, children: paragraphs }]
        });

        const buffer = await Packer.toBuffer(doc);
        fs.writeFileSync(filePath, buffer);
    }

    async createFile({ fileName, content = '', format = 'txt', folderName = null, topic = null, template = null, style = null, templateData = {} }) {
        let targetDir = this.getDesktopPath();

        // Si se pide crear dentro de una carpeta específica
        if (folderName) {
            const folderRes = this.createFolder({ folderName });
            targetDir = folderRes.folderPath;
        }

        let baseName = String(fileName || '').trim();
        const isWord = format.toLowerCase().includes('doc') || format.toLowerCase().includes('word');

        if (!baseName) {
            if (topic) {
                baseName = `${topic.replace(/[/\\?%*:|"<>]/g, '_')}`;
            } else {
                baseName = isWord ? `Documento_${Date.now()}` : `Nota_${Date.now()}`;
            }
        }

        // Extensión adecuada
        const ext = isWord ? '.docx' : (format.startsWith('.') ? format : `.${format}`);
        if (!baseName.toLowerCase().endsWith(ext)) {
            baseName += ext;
        }

        const targetFilePath = path.join(targetDir, baseName);

        // Si es Word (.docx)
        if (isWord) {
            const title = topic || path.basename(baseName, ext);
            if (template) {
                const { documentTemplateService } = require('../developer/documentTemplateService');
                await documentTemplateService.renderDocument({
                    template,
                    style: style || 'CLASSIC_ACADEMIC',
                    data: { title, content, ...templateData },
                    title,
                    outputPath: targetFilePath
                });
            } else {
                await this.createWordDocument(targetFilePath, title, content);
            }
        } else {
            // Archivo de texto plano (.txt, .md, etc.)
            let fileContent = String(content || '');
            if (!fileContent && topic) {
                fileContent = `Notas sobre ${topic}\n\nDocumento generado por Jarvis OS.\nFecha: ${new Date().toLocaleString('es-AR')}\n`;
            }
            fs.writeFileSync(targetFilePath, fileContent, 'utf8');
        }

        const locationLabel = folderName ? `dentro de la carpeta "${folderName}"` : 'en tu Escritorio';
        console.log(`[FileOperations] 📄 Archivo creado: ${targetFilePath}`);

        return {
            ok: true,
            filePath: targetFilePath,
            fileName: baseName,
            folderName: folderName || null,
            message: `Archivo "${baseName}" creado exitosamente ${locationLabel}.`
        };
    }

    deleteFolder(folderName) {
        const desktop = this.getDesktopPath();
        const cleanName = String(folderName || '').trim();
        const targetPath = path.isAbsolute(cleanName) ? cleanName : path.join(desktop, cleanName);

        if (!fs.existsSync(targetPath)) {
            // Buscar coincidencia en Escritorio
            try {
                const entries = fs.readdirSync(desktop);
                const found = entries.find(e => e.toLowerCase() === cleanName.toLowerCase() && fs.statSync(path.join(desktop, e)).isDirectory());
                if (found) {
                    return trashService.moveToTrash(path.join(desktop, found));
                }
            } catch (e) {}
            return { ok: false, code: 'ERR_FOLDER_NOT_FOUND', message: `No se encontró la carpeta "${folderName}" en tu Escritorio.` };
        }

        return trashService.moveToTrash(targetPath);
    }
}

const fileOperationsService = new FileOperationsService();
module.exports = fileOperationsService;
