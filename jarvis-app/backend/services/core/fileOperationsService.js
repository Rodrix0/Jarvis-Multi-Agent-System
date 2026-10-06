const fs = require('fs');
const path = require('path');
const os = require('os');
const docx = require('docx');
const trashService = require('./trashService');

class FileOperationsService {
    validateName(name) {
        if (!name || /[\\/<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
            throw new Error('El nombre no es válido en Windows. Indicá el nombre y la carpeta de destino por separado.');
        }
        return name;
    }
    getDesktopPath() {
        return process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
    }

    createFolder({ folderName, parentDir = null }) {
        const base = parentDir || this.getDesktopPath();
        const cleanName = this.validateName(String(folderName || 'Nueva_Carpeta').trim());
        const targetPath = path.join(base, cleanName);

        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }

        console.log(`[FileOperations] 📁 Carpeta creada: ${targetPath}`);
        return {
            ok: true,
            folderPath: targetPath,
            folderName: cleanName,
            message: `Carpeta disponible en ${targetPath}.`
        };
    }

    async createWordDocument(filePath, title, content) {
        const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } = docx;

        const paragraphs = [
            new Paragraph({
                text: title,
                heading: HeadingLevel.HEADING_1,
                spacing: { after: 300 }
            })
        ];

        const lines = String(content || '').split('\n').filter(line => line.trim());
        if (lines.length > 0) {
            lines.forEach(line => {
                const heading = line.match(/^(#{1,6})\s+(.+)/);
                if (heading) {
                    const levels = [
                        HeadingLevel.HEADING_1,
                        HeadingLevel.HEADING_2,
                        HeadingLevel.HEADING_3,
                        HeadingLevel.HEADING_4,
                        HeadingLevel.HEADING_5,
                        HeadingLevel.HEADING_6
                    ];
                    paragraphs.push(new Paragraph({
                        text: heading[2].trim(),
                        heading: levels[heading[1].length - 1],
                        spacing: { before: 220, after: 120 }
                    }));
                    return;
                }
                const bullet = line.match(/^[-*•]\s+(.+)/);
                const url = line.trim().match(/^https?:\/\/\S+$/i);
                paragraphs.push(new Paragraph({
                    children: url
                        ? [new ExternalHyperlink({
                            link: url[0],
                            children: [new TextRun({ text: url[0], style: 'Hyperlink', size: 20 })]
                        })]
                        : [new TextRun({ text: bullet ? bullet[1] : line, size: 22 })],
                    ...(bullet ? { bullet: { level: 0 } } : {}),
                    spacing: { after: url ? 180 : 130 },
                    alignment: url ? undefined : 'both'
                }));
            });
        } else {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: `Documento generado por Jarvis OS sobre: ${title}`, size: 24, italics: true })]
            }));
        }

        const doc = new Document({
            styles: {
                default: {
                    document: { run: { font: 'Aptos', size: 22, color: '222222' } },
                    heading1: { run: { font: 'Aptos Display', size: 34, bold: true, color: '17365D' } },
                    heading2: { run: { font: 'Aptos Display', size: 28, bold: true, color: '1F4E79' } },
                    heading3: { run: { font: 'Aptos Display', size: 24, bold: true, color: '2F5597' } }
                }
            },
            sections: [{ properties: {}, children: paragraphs }]
        });

        const buffer = await Packer.toBuffer(doc);
        fs.writeFileSync(filePath, buffer, { flag: 'wx' });
    }

    async createFile({ fileName, content = '', format = 'txt', folderName = null, parentDir = null, topic = null, template = null, style = null, templateData = {} }) {
        let targetDir = parentDir || this.getDesktopPath();
        format = String(format).toLowerCase().replace(/^\./, '');
        if (!['txt','md','json','csv','html','css','js','ts','py','xml','yaml','yml','sql','log','docx','word','pdf','xlsx','pptx'].includes(format)) throw new Error(`No tengo un generador para el formato ${format}.`);

        // Si se pide crear dentro de una carpeta específica
        if (folderName) {
            const folderRes = this.createFolder({ folderName, parentDir: targetDir });
            targetDir = folderRes.folderPath;
        }

        let baseName = String(fileName || '').trim();
        if (path.isAbsolute(baseName)) { targetDir = path.dirname(baseName); baseName = path.basename(baseName); }
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
        this.validateName(baseName);
        fs.mkdirSync(targetDir, { recursive: true });

        const targetFilePath = path.join(targetDir, baseName);
        if (fs.existsSync(targetFilePath)) return { ok: false, filePath: targetFilePath, message: `Ya existe ${targetFilePath}. Indicá otro nombre para conservar el archivo existente.` };
        if (!content && topic) content = await require('../informationDocumentService').generateInformation(topic);

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
        } else if (format === 'pdf') {
            const PDFDocument = require('pdfkit');
            await new Promise((resolve, reject) => {
                const stream = fs.createWriteStream(targetFilePath, { flags: 'wx' });
                const pdf = new PDFDocument();
                stream.on('finish', resolve); stream.on('error', reject); pdf.on('error', reject);
                pdf.pipe(stream); pdf.text(String(content || '')); pdf.end();
            });
        } else if (format === 'xlsx') {
            const xlsx = require('xlsx'); const book = xlsx.utils.book_new();
            const rows = String(content || '').split('\n').map(line => line.split('\t'));
            xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows), 'Hoja 1');
            fs.writeFileSync(targetFilePath, xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }), { flag: 'wx' });
        } else if (format === 'pptx') {
            const Presentation = require('pptxgenjs'); const deck = new Presentation();
            const slide = deck.addSlide(); slide.addText(String(content || ''), { x: 0.5, y: 0.5, w: 9, h: 6, fontSize: 20, breakLine: false });
            fs.writeFileSync(targetFilePath, await deck.write({ outputType: 'nodebuffer' }), { flag: 'wx' });
        } else {
            // Archivo de texto plano (.txt, .md, etc.)
            let fileContent = String(content || '');
            if (!fileContent && topic) {
                fileContent = `Notas sobre ${topic}\n\nDocumento generado por Jarvis OS.\nFecha: ${new Date().toLocaleString('es-AR')}\n`;
            }
            fs.writeFileSync(targetFilePath, fileContent, { encoding: 'utf8', flag: 'wx' });
        }

        const locationLabel = `en "${targetDir}"`;
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
