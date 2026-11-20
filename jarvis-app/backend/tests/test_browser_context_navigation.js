const assert=require('assert/strict');const http=require('http');
const nav=require('../services/browser/voiceNavigationService');
async function main(){
 nav.options={headless:true};const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/'?`<main>${Array.from({length:30},(_,i)=>`<a href="/chosen/${i+1}" style="display:block;height:120px;padding:15px">Resultado ${i+1}<span> Miniatura</span></a>`).join('')}</main>`:`<h1>${req.url}</h1>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 try{
  await nav.execute({command:'open',site:url});assert.equal(nav.snapshot.known.length,30);
  await nav.execute({command:'scroll',direction:'down'});assert.ok(nav.snapshot.items[0].index>1);
  const selected=await nav.execute({command:'select',index:22});assert.equal(selected.ok,true,selected.message);assert.ok(selected.data.url.endsWith('/chosen/22'));
  await nav.execute({command:'open',site:url});
  const page=nav.driver.activePage;await page.locator('a').nth(24).scrollIntoViewIfNeeded();const rect=await page.locator('a').nth(24).boundingBox();await page.mouse.move(rect.x+40,rect.y+30);
  assert.ok((await nav.pointed()).href.endsWith('/chosen/25'));
  const pointed=await nav.execute({command:'point'});assert.equal(pointed.ok,true,pointed.message);assert.ok(pointed.data.url.endsWith('/chosen/25'));
  await nav.execute({command:'open',site:url});await page.mouse.move(1,1);assert.equal((await nav.execute({command:'point'})).ok,false);
  const ai=require('../services/aiService');const original=ai.executeLlamaChat;
  ai.executeLlamaChat=async messages=>{const observation=JSON.parse(messages[1].content);assert.equal(observation.observations.totalKnown,30);return {content:JSON.stringify({command:'select',index:20})};};
  try{const result=await nav.interpret('quiero el vigesimosegundo');assert.equal(result.params.index,22);}finally{ai.executeLlamaChat=original;}
  console.log('PASS: índices acumulativos, selección 22 fuera de pantalla, miniatura bajo el cursor, puntero vacío e intérprete contextual.');
 }finally{await nav.driver.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
