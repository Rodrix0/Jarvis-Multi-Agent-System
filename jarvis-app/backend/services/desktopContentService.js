const fs = require('fs');
const path = require('path');
const os = require('os');
const desktop = () => process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
function location(value) {
    const raw = String(value || 'escritorio').trim().replace(/^['"]|['"]$/g, '');
    const aliases = { escritorio: desktop(), desktop: desktop(), documentos: path.join(os.homedir(),'Documents'), descargas: path.join(os.homedir(),'Downloads'), imagenes: path.join(os.homedir(),'Pictures') };
    return aliases[raw.toLowerCase()] || (path.isAbsolute(raw) ? raw : path.join(desktop(), raw));
}
async function resolveFile(value) {
    const candidate = location(value);
    if (fs.existsSync(candidate)) return candidate;
    return require('./localFileSearch').find(String(value || ''), { roots: [desktop(), ...['Documents','Downloads','Pictures','Music','Videos'].map(dir=>path.join(os.homedir(),dir))] });
}
async function list({ directory = 'escritorio', recursive = false, limit = 300 } = {}) {
    const root = location(directory);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { ok: false, message: `No existe la carpeta ${root}.` };
    const entries = []; const queue = [{ dir: root, depth: 0 }];
    const max = Math.max(1, Math.min(5000, Number(limit) || 300));
    const ignored = new Set(['node_modules','.git','.venv','venv','voice_venv','__pycache__']);
    while (queue.length && entries.length < max) {
        const { dir, depth } = queue.shift();
        let found; try { found = await fs.promises.readdir(dir,{withFileTypes:true}); } catch { continue; }
        for (const entry of found) {
            if (entries.length >= max) break;
            if (entry.isSymbolicLink()) continue;
            const full = path.join(dir,entry.name);
            entries.push({ name: path.relative(root,full), path: full, type: entry.isDirectory()?'folder':'file' });
            if (recursive && entry.isDirectory() && depth < 7 && !ignored.has(entry.name)) queue.push({dir:full,depth:depth+1});
        }
    }
    const truncated = entries.length >= max || queue.length > 0;
    return { ok:true, data:{directory:root,entries,truncated}, evidence:{directory:root,count:entries.length}, message: entries.length ? `${root}:\n${entries.map(e=>`${e.type==='folder'?'Carpeta':'Archivo'}: ${e.name}`).join('\n')}${truncated?'\nEl listado alcanzó el límite; podés indicar una subcarpeta.':''}` : `La carpeta ${root} está vacía.` };
}
async function read({ filePath, maxChars = 18000 } = {}) {
    const file = await resolveFile(filePath);
    if (!file) return {ok:false,message:`No encontré ${filePath}.`};
    const stat = await fs.promises.stat(file);
    if (stat.isDirectory()) return list({directory:file});
    if (stat.size > 25*1024*1024) return {ok:false,message:'El archivo supera los 25 MB admitidos para lectura; indicá un archivo más pequeño.'};
    const ext=path.extname(file).toLowerCase(); let text;
    if (ext==='.pdf') text=(await require('pdf-parse')(new Uint8Array(await fs.promises.readFile(file)), { version: 'v2.0.550' })).text;
    else if (['.docx','.pptx'].includes(ext)) {
        const zip=await require('jszip').loadAsync(await fs.promises.readFile(file));
        const files=Object.keys(zip.files).filter(name=>ext==='.docx'?name==='word/document.xml':/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
        const cheerio=require('cheerio');
        text=(await Promise.all(files.map(async name=>{const $=cheerio.load(await zip.file(name).async('string'),{xmlMode:true});return $('w\\:p, a\\:p').map((_,p)=>$(p).text()).get().join('\n');}))).join('\n');
    } else if (['.xlsx','.xls','.csv'].includes(ext)) {
        const xlsx=require('xlsx');const book=xlsx.readFile(file);text=book.SheetNames.map(name=>`${name}\n${xlsx.utils.sheet_to_csv(book.Sheets[name])}`).join('\n');
    } else if (['.txt','.md','.json','.js','.ts','.py','.html','.css','.log','.xml','.yaml','.yml','.ini','.ps1','.bat','.cmd','.sql'].includes(ext) || ext==='') text=await fs.promises.readFile(file,'utf8');
    else return {ok:false,message:`Puedo abrir ${path.basename(file)} con su aplicación, pero no tengo un lector de contenido para ${ext}.`};
    const max=Math.max(1,Math.min(100000,Number(maxChars)||18000));
    return {ok:true,data:{filePath:file,text:text.slice(0,max),truncated:text.length>max},evidence:{filePath:file,size:stat.size},message:text.slice(0,max)+(text.length>max?'\n[Contenido recortado por extensión.]':'')};
}
async function search({query,baseDir,extension}={}) {
    if (!baseDir) {
        const roots = [desktop(), ...['Documents','Downloads','Pictures','Music','Videos'].map(dir=>path.join(os.homedir(),dir))].filter(dir=>fs.existsSync(dir));
        const results = await Promise.all(roots.map(dir=>search({query,baseDir:dir,extension})));
        const files = results.flatMap(result=>result.files || []).slice(0,100);
        const truncated = results.some(result=>result.data?.truncated) || files.length === 100;
        return { ok:true, files, data:{files,truncated}, message:files.length?files.map(file=>file.path).join('\n'):`No encontré coincidencias con ${query} en las carpetas personales.` };
    }
    const result=await list({directory:baseDir||'escritorio',recursive:true,limit:5000});
    if (!result.ok) return result;
    const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const files=result.data.entries.filter(e=>normalize(e.name).includes(normalize(query))&&(!extension||path.extname(e.path).toLowerCase()==='.'+String(extension).replace(/^\./,''))).slice(0,100);
    return {ok:true,data:{files,truncated:result.data.truncated},files,message:files.length?files.map(f=>f.path).join('\n'):`No encontré coincidencias con ${query} en ${result.data.directory}.`};
}
module.exports={desktop,location,resolveFile,list,read,search};
