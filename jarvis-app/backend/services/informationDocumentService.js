const fs = require('fs');
const os = require('os');
const path = require('path');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const aiService = require('./aiService');

const MODEL = process.env.OLLAMA_FAST_MODEL || 'qwen2.5:3b';

function safeName(topic) {
    const clean = String(topic || 'informacion')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        .slice(0, 40);
    return clean || 'informacion';
}

async function generateInformation(topic) {
    const response = await require('./aiService').executeLlamaChat([{ role: 'user', content: 'Escribí un informe en español sobre: ' + topic + '. Incluí explicación, puntos principales y conclusión. No inventes fuentes ni afirmes haber consultado internet.' }]);
    if (!response?.content || response.content.trim().length < 50) throw new Error('El motor de IA no pudo generar el contenido del informe.');
    return response.content.trim();
}

async function createOnDesktop(topic) {
    console.log(`[Doc Generator] 📄 Generando informe para tema: "${topic}"...`);
    const content = await generateInformation(topic);
    const desktop = process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
    fs.mkdirSync(desktop, { recursive: true });
    const filename = `Informe_${safeName(topic)}.docx`;
    const filePath = path.join(desktop, filename);
    
    const paragraphs = [
        new Paragraph({ text: String(topic).toUpperCase(), heading: HeadingLevel.TITLE }),
        new Paragraph({ text: `Fecha: ${new Date().toLocaleDateString('es-AR')} | Generado por Jarvis OS`, style: 'Subtitle' }),
        new Paragraph({ text: '' }),
        ...content.split(/\r?\n/).filter(line => line.trim()).map(line => {
            const clean = line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '• ');
            if (line.startsWith('# ') || line.startsWith('## ')) {
                return new Paragraph({ text: clean, heading: HeadingLevel.HEADING_2 });
            }
            return new Paragraph({ children: [new TextRun(clean)] });
        })
    ];
    
    const document = new Document({ sections: [{ properties: {}, children: paragraphs }] });
    fs.writeFileSync(filePath, await Packer.toBuffer(document), { flag: 'wx' });
    console.log(`[Doc Generator] ✅ Archivo guardado con éxito en: ${filePath}`);
    
    try {
        require('child_process').exec(`explorer.exe /select,"${filePath}"`);
    } catch (e) {}

    return { filePath, content, filename };
}

module.exports = { createOnDesktop, generateInformation };
