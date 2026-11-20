const unquote = s => String(s || '').trim().replace(/^["“']|["”']$/g, '');
function parse(text) {
    let raw = String(text || '').trim();
    const search = /^(?:busc[aá](?:me|r)?|investig[aá](?:me|r)?|averigu[aá](?:me|r)?|consegu[ií](?:me)?|(?:dame|traeme)(?=\s+(?:informaci[oó]n|info|datos)\b)|(?:quiero|necesito)\s+(?:que\s+busques|buscar))\s+/i;
    const doc = /\b(?:documento|informe|reporte|word|docx|pdf|txt|archivo)\b/i;
    const follow = /^(?:ahora\s+)?(?:guard[aá](?:lo|melo|me)?|hac[eé](?:me)?|cre[aá](?:me)?|gener[aá](?:me)?)(?=\s|$)/i.test(raw) && /\b(?:esa|esta|la)\s+informaci[oó]n\b|\b(?:esos|estos|los)\s+resultados\b|\bguard(?:alo|amelo)\b|\b(?:con|de|sobre)\s+(?:eso|esto)\b/i.test(raw.normalize('NFD').replace(/[\u0300-\u036f]/g,''));
    const aboutDoc = /^(?:hac[eé](?:me)?|cre[aá](?:me)?|gener[aá](?:me)?|redact[aá](?:me)?)\s+/i.test(raw) && doc.test(raw) && /\s(?:sobre|acerca de)\s/i.test(raw) && !/\bque diga\b|\bcon (?:el )?(?:texto|contenido)\b/i.test(raw);
    if (!search.test(raw) && !follow && !aboutDoc) return null;
    if (search.test(raw) && /\ben\s+(?:youtube|netflix|spotify)\b/i.test(raw) && !/\binformaci[oó]n\b|\bdatos\b/i.test(raw)) return null;
    if (search.test(raw) && /^(?:el\s+)?(?:archivo|documento|carpeta|video|canci[oó]n)\s/i.test(raw.replace(search,''))) return null;
    const document = follow || aboutDoc || (search.test(raw) && /\by\s+(?:hac|cre|gener|guard|redact)/i.test(raw) && (doc.test(raw) || /\by\s+guard/i.test(raw)));
    const params = {};
    if (document) {
        params.format = /\bpdf\b/i.test(raw)?'pdf':/\b(?:txt|texto)\b/i.test(raw)?'txt':'docx';
        const dest = raw.match(/\s+(?:y\s+)?(?:guard[aá](?:lo|melo|me)?\s+)?en\s+(?:(?:el|mi|mis|la|las)\s+)?(?:carpeta\s+)?((?:[A-Za-z]:[\\/]|["“][A-Za-z]:[\\/]).+|escritorio|documentos|descargas|["“][^"”]+["”])\s*$/i);
        if (dest) { params.directory = unquote(dest[1]); raw = raw.slice(0,dest.index); }
        if (!dest) {
            const folder = raw.match(/\s+(?:y\s+)?(?:guard[aá](?:lo|melo|me)?\s+)?en\s+(?:(?:la|mi)\s+)?carpeta\s+(.+)$/i);
            if(folder){params.directory=unquote(folder[1]);raw=raw.slice(0,folder.index);}
        }
        const name = raw.match(/\s+(?:llamado|llamada|con (?:el )?nombre(?: de)?)\s+(.+?)\s*$/i);
        if (name) { params.fileName=unquote(name[1]);raw=raw.slice(0,name.index); }
        if (follow) return { id:'document.research', params:{...params,useLast:true} };
    }
    let topic = aboutDoc ? raw.replace(/^.*?\s(?:sobre|acerca de)\s+/i,'') : raw.replace(search,'').replace(/^(?:informaci[oó]n|info|datos)(?:\s+(?:completa|detallada))?\s+(?:(?:sobre|de|acerca de)\s+)?/i,'');
    if(document) topic=topic.replace(/\s+y\s+(?:hac|cre|gener|guard|redact)[\s\S]*$/i,'');
    topic=topic.trim().replace(/[.!?]+$/,'');
    return topic ? { id:document?'document.research':'research.query',params:document?{...params,topic}:{question:topic,options:{quick:true}} } : null;
}
module.exports={parse};
