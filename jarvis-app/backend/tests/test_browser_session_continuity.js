const assert=require('assert/strict');
const nav=require('../services/browser/voiceNavigationService');
const jarvis=require('../services/jarvisActionService');
const system=require('../services/systemService');
const fast=require('../services/ai/fastCommandParser');
async function main(){
 nav.options={headless:true};const page=await nav.page();let documents=0;
 await page.route('https://www.youtube.com/**',async route=>{
  if(route.request().resourceType()!=='document')return route.abort();documents++;
  await route.fulfill({contentType:'text/html; charset=utf-8',body:`<style>body{overflow:hidden}main{height:400px;overflow:auto}</style><form action="/results"><input name="search_query"><button>Buscar</button></form><main><ytd-video-renderer style="display:none"><a id="video-title" href="/watch?v=hidden" title="Resultado oculto">Oculto</a></ytd-video-renderer>${Array.from({length:30},(_,i)=>`<ytd-video-renderer><a id="video-title" href="/watch?v=${i}" style="display:block;height:140px">Video ${i}</a></ytd-video-renderer>`).join('')}</main>`});
 });
 try{
  let request=await jarvis.resolve('abrir YouTube');assert.equal(request.id,'browser.voice');assert.equal((await jarvis.execute(request.id,request.params)).ok,true);
  assert.equal(nav.snapshot.known.length,30,'se cuentan los resultados fuera de pantalla, sin tarjetas ocultas');assert.ok(!nav.snapshot.known.some(i=>i.href.includes('hidden')));
  const original=nav.driver.activePage;const browser=nav.driver.browser;
  request=await jarvis.resolve('buscá algún creador');assert.equal(request.params.site,undefined);assert.equal((await jarvis.execute(request.id,request.params)).ok,true);
  assert.equal(new URL(original.url()).searchParams.get('search_query'),'algún creador');
  const navigations=documents;request=await jarvis.resolve('abrí YouTube');await jarvis.execute(request.id,request.params);
  assert.equal(documents,navigations,'abrir de nuevo no recarga ni borra la búsqueda');assert.equal(nav.driver.activePage,original);assert.equal(nav.driver.browser,browser);assert.equal(nav.driver.context.pages().length,1);
  await system.openApp('youtube');assert.equal(documents,navigations,'ruta legacy también reutiliza');
  await system.openMediaSearch('youtube','otro creador');assert.equal(nav.driver.activePage,original);assert.equal(nav.driver.context.pages().length,1);
  await nav.execute({command:'scroll',direction:'down'});const down=await page.locator('main').evaluate(e=>e.scrollTop);assert.ok(down>0);
  await nav.execute({command:'scroll',direction:'up'});assert.ok(await page.locator('main').evaluate(e=>e.scrollTop)<down);
  assert.notEqual(fast.parse('andá para arriba').action,'voice.wake');
  await page.evaluate(()=>{const card=document.createElement('ytd-channel-renderer');card.innerHTML='<a id="main-link" href="/@channel" style="display:block;height:100px">Canal</a>';document.querySelector('main').prepend(card);});
  nav.resultFilters.set(page,{url:page.url(),type:'channel'});await nav.inspect();
  assert.equal(nav.snapshot.known.length,1,'el filtro excluye videos anteriores incluso durante la transición visible de YouTube');
  assert.equal(nav.snapshot.known[0].index,1);assert.ok(nav.snapshot.known[0].href.endsWith('/@channel'));
  nav.until=Date.now()-3600000;assert.equal(nav.isActive(),true,'una página abierta no pierde su contexto por un reloj arbitrario');
  require('../services/tvVoiceService').activateSession();assert.equal(nav.isActive(),false,'cambiar a TV suspende el contexto del navegador');
  console.log('PASS: abrir → buscar → reabrir sin recarga, ruta legacy, una ventana/pestaña, scroll real en contenedor, contexto y TV.');
 }finally{await nav.driver.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
