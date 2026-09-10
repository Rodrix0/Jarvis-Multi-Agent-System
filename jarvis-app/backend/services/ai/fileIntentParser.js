const stripQuotes = text => String(text||'').trim().replace(/^["“']|["”']$/g,'');
function parse(text) {
    let raw=String(text||'').trim();
    const normalized=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if (/^(?:lee|leeme|leer)\s+(?:(?:el|la)\s+)?(?:pantalla|captura|portapapeles|clipboard)\b/.test(normalized)) return null;
    if (/^(?:lee(?:me)?|lista(?:r|me)?|mostra(?:me)?|revisa|escanea|que (?:hay|tengo))\s+(?:(?:todo|toda)\s+)?(?:(?:en|el|mi|tu)\s+)*(?:escritorio)(?:\s+completo)?$/.test(normalized)) return {id:'directory.list',params:{directory:'escritorio'}};
    let m=raw.match(/^(?:le[eé](?:me)?|leer|mostr[aá](?:me)?\s+el\s+contenido\s+de)\s+(?:(?:el|mi)\s+)?(?:archivo\s+|documento\s+)?(.+)$/i);
    if(m)return {id:'file.read',params:{filePath:stripQuotes(m[1])}};
    m=raw.match(/^(?:list[aá](?:r|me)?|mostr[aá](?:me)?)\s+(?:el\s+contenido\s+de\s+)?(?:la\s+)?carpeta\s+(.+)$/i);
    if(m)return {id:'directory.list',params:{directory:stripQuotes(m[1])}};
    m=raw.match(/^(?:busc[aá](?:r|me)?|encontr[aá](?:me)?)\s+(?:el\s+)?(?:archivo|documento)\s+(.+)$/i);
    if(m)return {id:'file.search',params:{query:stripQuotes(m[1])}};
    if(!/^(?:crea(?:r|me)?|hace(?:r|me)?|genera(?:r|me)?)\s/.test(normalized))return null;
    const compound = raw.match(/^(?:cre[aá](?:r|me)?|hac[eé](?:r|me)?)\s+(?:una\s+)?carpeta\s+(?:llamada\s+|que\s+se\s+llame\s+)?(.+?)\s+y\s+(.+)$/i);
    if (compound) {
        let second = compound[2].replace(/^(?:adentro|dentro)(?:\s+de\s+ella)?\s+/i, '').replace(/\s+(?:adentro|dentro)$/i, '');
        if (!/^(?:cre|hac|gener)/i.test(second)) second = 'creame '+second;
        const child = parse(second);
        if (child?.id === 'file.create') return { ...child, params: { ...child.params, folderName: stripQuotes(compound[1]) } };
    }
    // Compound folder + file requests remain with the existing compound parser.
    if(/\bcarpeta\b.*\b(?:adentro|dentro|y)\b.*\b(?:archivo|txt|word|nota|documento)\b/.test(normalized)) return null;
    const folder=raw.match(/^(?:cre[aá](?:r|me)?|hac[eé](?:r|me)?|gener[aá](?:r|me)?)\s+(?:una\s+)?carpeta(?:\s+(.*))?$/i);
    if(folder){let name=(folder[1]||'Nueva carpeta').replace(/^(?:llamada|con el nombre de|que se llame|de nombre)\s+/i,'').replace(/\s+(?:en|sobre)\s+(?:el|mi)\s+escritorio$/i,'');return {id:'folder.create',params:{folderName:stripQuotes(name)}};}
    m=raw.match(/^(?:cre[aá](?:r|me)?|hac[eé](?:r|me)?|gener[aá](?:r|me)?)\s+(?:un\s+|una\s+)?(archivo(?:\s+de\s+texto)?|txt|nota|word|docx|pdf|xlsx|excel|pptx|powerpoint|documento(?:\s+de\s+word)?)\s*([\s\S]*)$/i);
    if(!m)return null;
    let rest=m[2];let content='';let topic=null;
    const delimiter=/\s+(?:que\s+diga|con\s+(?:el\s+)?(?:contenido|texto)(?:\s+de)?|diciendo)\s+/i.exec(' '+rest);
    if(delimiter){const source=' '+rest;content=source.slice(delimiter.index+delimiter[0].length);rest=source.slice(0,delimiter.index).trim();}
    else {const subject=/\s+(?:sobre|acerca\s+de)\s+(.+)$/i.exec(' '+rest);if(subject){topic=subject[1];rest=(' '+rest).slice(0,subject.index).trim();}}
    let folderName=null;const destination=rest.match(/\s+en\s+(?:(?:la|mi)\s+)?carpeta\s+(.+)$/i);
    if(destination){folderName=stripQuotes(destination[1]);rest=rest.slice(0,destination.index);}
    rest=rest.replace(/\s+(?:en|sobre)\s+(?:el|mi)\s+escritorio$/i,'').replace(/^(?:llamad[oa]|que se llame|con el nombre de)\s+/i,'');
    if(/^(?:vacio|vacío|en blanco)$/i.test(rest))rest='';
    let format=/word|docx|documento/i.test(m[1])?'docx':/pdf/i.test(m[1])?'pdf':/xlsx|excel/i.test(m[1])?'xlsx':/pptx|powerpoint/i.test(m[1])?'pptx':'txt';
    let fileName=stripQuotes(rest);const extension=fileName.match(/\.([a-z0-9]+)$/i);
    if(extension)format=extension[1].toLowerCase();
    else if(fileName)fileName+='.'+format;
    return {id:'file.create',params:{fileName,content:stripQuotes(content),format,...(folderName?{folderName}:{}),...(topic?{topic}: {})}};
}
module.exports={parse};
