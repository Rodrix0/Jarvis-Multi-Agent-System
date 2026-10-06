const fs = require('fs');
const path = require('path');
const os = require('os');
const research = require('./ai/researchService');
const cachePath = process.env.JARVIS_RESEARCH_CACHE_PATH || path.join(__dirname,'../data/last_research.json');
const OLLAMA_URL = 'http://127.0.0.1:11434';
function format(result) {
    return `Información encontrada sobre ${result.topic}\nConsulta: ${new Date().toLocaleString('es-AR')}\n\nExtractos de fuentes web:\n\n` + result.sources.slice(0,6).map((s,i)=>`[${i+1}] ${s.title}\n${s.pageText || s.content}\nFuente: ${s.url}${s.pageText?'':' (extracto del buscador)'}`).join('\n\n');
}

function fallbackReport(result) {
    const sources = result.sources.slice(0, 6);
    return `## Resumen\n\nSe consultaron ${result.uniqueSources || sources.length} fuentes sobre ${result.topic}. El informe conserva únicamente información recuperada de esas fuentes y muestra la referencia de cada hallazgo.\n\n## Hallazgos documentados\n\n${sources.map((source, index) => {
        const raw = String(source.pageText || source.content || '').replace(/\s+/g, ' ').trim();
        const sentences = raw
            .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ0-9¿¡])/)
            .map(sentence => sentence.trim())
            .filter(sentence => sentence.length >= 45 && sentence.length <= 520)
            .filter(sentence => !/cookies?|suscr[ií]bete|newsletter|publicidad/i.test(sentence));
        const selected = [];
        let used = 0;
        for (const sentence of sentences) {
            if (used + sentence.length > 950 && selected.length >= 2) break;
            selected.push(sentence);
            used += sentence.length;
            if (selected.length >= 4) break;
        }
        const evidence = selected.join(' ') || raw.slice(0, 950);
        return `### ${index + 1}. ${source.title}\n\n${evidence || 'La fuente no proporcionó un extracto descriptivo.'} [${index + 1}]`;
    }).join('\n\n')}\n\n## Fuentes consultadas\n\n${sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.url}`).join('\n\n')}`;
}

async function synthesizeReport(result) {
    const aiSynthesisEnabled = /^(?:1|true|yes|si|sí)$/i.test(String(process.env.JARVIS_DOCUMENT_AI_SYNTHESIS || ''));
    if (!aiSynthesisEnabled) {
        console.log('[ResearchDocument] Informe verificable generado directamente desde las fuentes; no se cargó un modelo de redacción.');
        return fallbackReport(result);
    }
    const sources = result.sources.slice(0, 5);
    const evidence = sources.map((source, index) => {
        const body = String(source.pageText || source.content || '').replace(/\s+/g, ' ').trim().slice(0, 1400);
        return `[${index + 1}] ${source.title}\nURL: ${source.url}\nEvidencia: ${body}`;
    }).join('\n\n');
    const startedAt = Date.now();
    try {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(30000),
            body: JSON.stringify({
                model: process.env.JARVIS_DOCUMENT_MODEL || 'qwen2.5:3b',
                stream: false,
                keep_alive: '2m',
                options: { temperature: 0.12, num_predict: 850, num_ctx: 8192 },
                prompt: `Redactá un informe útil, preciso y bien organizado en español sobre "${result.topic}" usando únicamente la evidencia incluida abajo. No inventes nombres, fechas ni datos. Si las fuentes discrepan o un dato no está confirmado, indicalo. Usá solamente encabezados Markdown de nivel 2 (##) y 3 (###), una introducción breve, desarrollo por temas, una conclusión y citas [1], [2], etc. Sintetizá; no copies párrafos completos. No escribas una portada ni una lista de fuentes porque se adjuntará automáticamente. Extensión máxima: 700 palabras.\n\nEVIDENCIA:\n${evidence}`
            })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const generated = String((await response.json()).response || '').trim();
        if (generated.length < 300) throw new Error('La síntesis fue demasiado breve.');
        console.log(`[ResearchDocument] Informe redactado localmente en ${Date.now() - startedAt}ms.`);
        return `${generated}\n\n## Fuentes consultadas\n\n${sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.url}`).join('\n\n')}`;
    } catch (error) {
        console.warn(`[ResearchDocument] Síntesis local no disponible tras ${Date.now() - startedAt}ms; uso informe extractivo:`, error.message);
        return fallbackReport(result);
    }
}
async function search(question, options={}) {
    const result=await research.research(question,{quick:true,...options});
    if(result.ok && options.readPages !== false) {
        await Promise.allSettled(result.sources.slice(0,3).map(async source=>{
            const response=await fetch(source.url,{headers:research.headersBing,signal:AbortSignal.timeout(4000)});
            if(!response.ok || !/text\/html/i.test(response.headers.get('content-type') || ''))return;
            const html=await response.text();
            const $=require('cheerio').load(html);
            $('script,style,nav,footer,header,aside,noscript').remove();
            const main=$('main,article,[role="main"]').first();
            const text=(main.length?main:$('body')).find('p').map((_,p)=>$(p).text().trim()).get().filter(t=>t.length>65).join('\n\n').slice(0,4500);
            if(text.length>180 && !/verify you are human|just a moment|access denied/i.test(text.slice(0,300)))source.pageText=text;
        }));
    }
    fs.mkdirSync(path.dirname(cachePath),{recursive:true});
    fs.writeFileSync(cachePath,JSON.stringify({at:Date.now(),result:result.ok && result.sources?.length ? result : null}));
    return result;
}
async function create({topic,useLast=false,directory,format:ext='docx',fileName,open=false}) {
    let result;
    if(useLast) {
        try {const saved=JSON.parse(fs.readFileSync(cachePath,'utf8'));if(Date.now()-saved.at<86400000)result=saved.result;}catch(_){}
        if(!result) return {ok:false,message:'Primero pedime una búsqueda de información; no tengo resultados recientes para guardar.'};
    } else result=await search(topic);
    if(!result.ok || !result.sources?.length) return {ok:false,message:`No pude obtener fuentes para ${topic}. No creé un documento vacío. Probá con un tema más preciso o un enlace.`};
    const desktop=process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(),'Desktop');
    const aliases={escritorio:desktop,documentos:path.join(os.homedir(),'Documents'),descargas:path.join(os.homedir(),'Downloads')};
    const parentDir=directory ? aliases[directory.toLowerCase()] || (path.isAbsolute(directory)?directory:path.join(desktop,directory)) : desktop;
    const safe=result.topic.replace(/[<>:"/\\|?*]/g,'_').slice(0,70).replace(/[. ]+$/,'');
    const content = await synthesizeReport(result);
    let outputName = fileName;
    if (!outputName) {
        const normalizedExt = /^(?:docx|word)$/i.test(ext) ? 'docx' : String(ext || 'docx').replace(/^\./, '').toLowerCase();
        const stem = `Informe_${safe}`;
        outputName = stem;
        for (let copy = 2; fs.existsSync(path.join(parentDir, `${outputName}.${normalizedExt}`)); copy += 1) {
            outputName = `${stem} (${copy})`;
        }
    }
    const created=await require('./core/fileOperationsService').createFile({fileName:outputName,parentDir,format:ext,content,topic:result.topic});
    if(!created.ok)return created;
    if(!fs.statSync(created.filePath).size)throw new Error('El archivo generado está vacío.');
    const opened = open ? await require('./systemService').openApp(created.filePath) : false;
    const message = opened
        ? `Terminé el trabajo. El documento se encuentra abierto en la pantalla y quedó guardado en ${created.filePath}.`
        : `Terminé el trabajo. El documento quedó guardado en ${created.filePath}.`;
    return {...created, data:{filePath:created.filePath,sources:result.sources,opened}, evidence:{filePath:created.filePath,fileCreated:true,opened},message};
}
module.exports={search,create,format,fallbackReport,synthesizeReport};
