const fs = require('fs');
const path = require('path');
const os = require('os');
const research = require('./ai/researchService');
const cachePath = path.join(__dirname,'../data/last_research.json');
function format(result) {
    return `Información encontrada sobre ${result.topic}\nConsulta: ${new Date().toLocaleString('es-AR')}\n\nExtractos de fuentes web:\n\n` + result.sources.slice(0,6).map((s,i)=>`[${i+1}] ${s.title}\n${s.pageText || s.content}\nFuente: ${s.url}${s.pageText?'':' (extracto del buscador)'}`).join('\n\n');
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
async function create({topic,useLast=false,directory,format:ext='docx',fileName}) {
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
    const created=await require('./core/fileOperationsService').createFile({fileName:fileName || `Informe_${safe}_${Date.now()}`,parentDir,format:ext,content:format(result)});
    if(!created.ok)return created;
    if(!fs.statSync(created.filePath).size)throw new Error('El archivo generado está vacío.');
    return {...created, data:{filePath:created.filePath,sources:result.sources}, evidence:{filePath:created.filePath,fileCreated:true},message:`Guardé la información y sus fuentes en ${created.filePath}.`};
}
module.exports={search,create,format};
