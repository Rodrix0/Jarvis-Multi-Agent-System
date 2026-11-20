const assert=require('assert/strict');const http=require('http');
const parser=require('../services/ai/browserVoiceIntentParser');
const nav=require('../services/browser/voiceNavigationService');
async function main(){
 assert.equal(parser.parse('buscá ucp').params.query,'ucp');
 assert.deepEqual(parser.parse('entra a youtube y busca la cobra').params,{command:'search',site:'youtube',query:'la cobra'});
 assert.equal(parser.parse('entra al primer link')?.params.index,1);
 assert.equal(parser.parse('mirá quiero el 2do')?.params.index,2);
 assert.equal(parser.parse('bajá el volumen',{active:true}),null);
 assert.equal(parser.parse('buscá información de Córdoba y haceme un documento',{active:true}),null);
 assert.equal(parser.parse('buscá una película',{tv:true}),null);
 assert.equal(parser.parse('buscá UCP',{tv:false}).id,'browser.voice');
 nav.options={headless:true};
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/second'?'<main><h1>Segunda página</h1><a href="/login">Ingresar</a></main>':req.url==='/login'?'<h1>Entrada correcta</h1>':'<main><h1>Resultados</h1><a href="/first" style="display:block;height:100px">Primero</a><a href="/second" style="display:block;height:100px">Segundo</a><div style="height:1000px"></div><a href="/third">Tercero</a></main>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 try{
  let result=await nav.execute({command:'open',site:url});assert.equal(result.ok,true,result.message);assert.equal(result.data.items[1].label,'Segundo');
  result=await nav.execute({command:'select',index:2});assert.equal(result.ok,true,result.message);assert.ok(result.data.url.endsWith('/second'));
  result=await nav.execute({command:'click',label:'Ingresar'});assert.equal(result.ok,true,result.message);assert.ok(result.data.url.endsWith('/login'));
  await nav.execute({command:'open',site:url});
  await nav.execute({command:'scroll',direction:'down'});result=await nav.execute({command:'scroll',direction:'down'});assert.equal(result.data.items[0].label,'Tercero');
  result=await nav.execute({command:'select',index:9});assert.equal(result.ok,false);
  await nav.execute({command:'stop'});assert.equal(nav.isActive(),false);
  assert.equal((await nav.execute({command:'select',index:1})).ok,false);
  console.log('PASS: órdenes encadenadas, ordinales, links reales, scroll, contexto y separación de TV/documentos.');
 }finally{await nav.driver.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
