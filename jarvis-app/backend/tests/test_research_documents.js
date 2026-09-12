const assert=require('assert/strict');
const fs=require('fs');const path=require('path');
const jarvis=require('../services/jarvisActionService');
const research=require('../services/ai/researchService');
const workflow=require('../services/researchDocumentService');
async function main(){
 const original=research.research;
 let calls=0;
 research.research=async topic=>{calls++;return {ok:true,topic,uniqueSources:1,sources:[{title:'Fuente de prueba',url:'https://example.test/iguazu',content:'Información recuperada de prueba sobre Iguazú.'}]};};
 const originalFetch=global.fetch;global.fetch=async()=>{throw new Error('No network in unit test');};
 try {
  const dest=path.join(process.env.JARVIS_DESKTOP_DIR,'Investigación');
  const parsed=await jarvis.resolve(`Buscá información sobre Iguazú y haceme un documento en la carpeta "${dest}"`);
  assert.equal(parsed.id,'document.research');assert.equal(parsed.params.topic,'Iguazú');assert.equal(parsed.params.directory,dest);
  const made=await jarvis.execute(parsed.id,parsed.params);assert.equal(made.ok,true,made.message);
  assert.equal(path.dirname(made.data.filePath),dest);
  const read=await require('../services/desktopContentService').read({filePath:made.data.filePath});assert.match(read.data.text,/Información recuperada/);assert.match(read.data.text,/https:\/\/example.test\/iguazu/);
  const next=await jarvis.resolve('Guardá esa información en un PDF en el escritorio');assert.equal(next.id,'document.research');assert.equal(next.params.useLast,true);
  const saved=await jarvis.execute(next.id,next.params);assert.equal(saved.ok,true,saved.message);assert.equal(fs.readFileSync(saved.data.filePath).subarray(0,4).toString(),'%PDF');assert.equal(calls,1);
  assert.equal((await jarvis.resolve('Haceme un documento sobre Córdoba en mis documentos')).params.directory,'documentos');
  assert.equal((await jarvis.resolve('Buscame información de Córdoba')).id,'research.query');
  assert.equal((await jarvis.resolve('Dame información sobre Córdoba')).id,'research.query');
  assert.equal((await jarvis.resolve('creame un txt llamado prueba que diga Hola')).id,'file.create');
  research.research=async topic=>({ok:false,topic,uniqueSources:0,sources:[]});
  assert.equal((await workflow.create({topic:'Sin resultados',directory:dest})).ok,false);
  assert.equal((await workflow.create({useLast:true,directory:dest})).ok,false);
  const urls=research.deduplicate([{url:'https://example.test/?id=1'},{url:'https://example.test/?id=2'}]);assert.equal(urls.length,2);
  console.log('PASS: búsqueda, creación con fuentes, destino, guardado posterior sin repetir búsqueda y fallo sin archivo vacío.');
 }finally{research.research=original;global.fetch=originalFetch;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
