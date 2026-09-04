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
    // 1. Intentar con Ollama local
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);
        const response = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                stream: false,
                keep_alive: '5m',
                prompt: [
                    'Redacta en español un informe completo, claro y profesional.',
                    `Tema: ${topic}`,
                    'Incluye: Título, Resumen Introductorio, Puntos Clave, Análisis Detallado y Conclusión.',
                    'Devuelve directamente el contenido estructurado del informe.'
                ].join('\n'),
                options: { temperature: 0.3, num_predict: 850 }
            }),
            signal: controller.signal
        });
        clearTimeout(timer);
        if (response.ok) {
            const data = await response.json();
            const content = String(data.response || '').trim();
            if (content.length > 50) return content;
        }
    } catch (e) {
        console.warn('[Doc Generator] Ollama no disponible, usando motor de respaldo IA...');
    }

    // 2. Fallback con motor de IA principal
    try {
        const fallbackPrompt = `Escribe un informe completo, profesional y estructurado sobre: "${topic}". Incluye introducción, desarrollo en puntos clave y conclusión.`;
        const content = await aiService.getAIResponse(fallbackPrompt, { id: 'estudio', name: 'Estudio' });
        if (content && content.length > 50) return content;
    } catch (e) {
        console.error('[Doc Generator] Falló fallback IA:', e);
    }

    return `Informe sobre ${topic}\n\nDocumento generado automáticamente por Jarvis OS.\nFecha: ${new Date().toLocaleDateString('es-AR')}`;
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
    fs.writeFileSync(filePath, await Packer.toBuffer(document));
    console.log(`[Doc Generator] ✅ Archivo guardado con éxito en: ${filePath}`);
    
    try {
        require('child_process').exec(`explorer.exe /select,"${filePath}"`);
    } catch (e) {}

    return { filePath, content, filename };
}

module.exports = { createOnDesktop };
