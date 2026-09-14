const BrowserService=require('./browserService').constructor;
function installPointerObserver(){
 if(window.__jarvisPointerInstalled)return;window.__jarvisPointerInstalled=true;
 document.addEventListener('pointermove',e=>{window.__jarvisPointer={x:e.clientX,y:e.clientY};},{passive:true,capture:true});
 document.addEventListener('pointerout',e=>{if(!e.relatedTarget)window.__jarvisPointer=null;},{passive:true});
 window.addEventListener('blur',()=>{window.__jarvisPointer=null;});
}
class VoiceNavigationService {
 constructor(){this.driver=new BrowserService();this.until=0;this.busy=false;this.options={headless:false};this.snapshot=null;this.history=[];this.pointerContexts=new WeakSet();this.resultFilters=new WeakMap();}
 suspend(){this.until=0;}
 platform(){try{const host=new URL(this.driver.activePage?.url()).hostname;return host==='youtube.com'||host.endsWith('.youtube.com')?'youtube':null;}catch(_){return null;}}
 isActive(){return this.until>0 && !!this.driver.context && (!this.driver.browser?.isConnected || this.driver.browser.isConnected()) && this.driver.context.pages().some(p=>!p.isClosed());}
 async syncActivePage(){
  if(!this.driver.context)return;
  const pages=this.driver.context.pages().filter(p=>!p.isClosed());
  for(const p of pages){if(await p.evaluate(()=>document.hasFocus() && document.visibilityState==='visible').catch(()=>false)){this.driver.activePage=p;return;}}
  if(!this.driver.activePage || this.driver.activePage.isClosed())this.driver.activePage=pages.at(-1)||null;
 }
 async page(){await this.syncActivePage();await this.driver.ensureBrowser(this.options);this.until=Date.now()+1800000;
 if(!this.pointerContexts.has(this.driver.context)){await this.driver.context.addInitScript(installPointerObserver);this.pointerContexts.add(this.driver.context);}
 for(const frame of this.driver.activePage.frames())await frame.evaluate(installPointerObserver).catch(()=>{});
 return this.driver.activePage;}
 async pointed(){
 const page=await this.page();
 for(const frame of page.frames().reverse()){
  const item=await frame.evaluate(()=>{
   const p=window.__jarvisPointer;if(!p || !document.hasFocus())return null;
   const hit=document.elementFromPoint(p.x,p.y);if(!hit || hit.tagName==='IFRAME')return null;
   let link=hit.closest('a[href],button,[role="button"]');
   if(!link){const card=hit.closest('ytd-video-renderer,ytd-rich-item-renderer,ytd-compact-video-renderer');link=card?.querySelector('a#video-title,a#video-title-link,a[href*="/watch?"]');}
   if(!link)return null;
   document.querySelectorAll('[data-jarvis-pointed]').forEach(e=>e.removeAttribute('data-jarvis-pointed'));
   link.setAttribute('data-jarvis-pointed','true');return {label:(link.getAttribute('aria-label')||link.innerText||link.getAttribute('title')||'').slice(0,240),href:link.href||'',x:p.x,y:p.y};
  }).catch(()=>null);
  if(item)return {...item,frame};
 }return null;
 }
 async interpret(text){return require('./navigationInterpreter').interpret(text,this);}
 async scrollPage(direction='down'){
  const page=await this.page();
  return page.evaluate(async direction=>{
   const visible=e=>{const r=e.getBoundingClientRect();return r.width>100&&r.height>100&&r.bottom>0&&r.top<innerHeight;};
   const scrollable=e=>e&&e.scrollHeight>e.clientHeight+4&&e.clientHeight>100&&(/auto|scroll/.test(getComputedStyle(e).overflowY)||e===document.scrollingElement);
   let target=null;const pointer=window.__jarvisPointer;
   if(pointer){let e=document.elementFromPoint(pointer.x,pointer.y);while(e){if(scrollable(e)){target=e;break;}e=e.parentElement;}}
   if(!target){const candidates=[...document.querySelectorAll('main,[role="main"],section,div')].filter(e=>visible(e)&&scrollable(e));const root=document.scrollingElement;if(scrollable(root))candidates.push(root);candidates.sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);target=candidates[0];}
   if(!target)return {moved:false,atBoundary:false};
   const before=target.scrollTop;const delta=(direction==='up'?-1:1)*Math.max(150,target.clientHeight*.8);
   target.scrollTo({top:before+delta,behavior:'instant'});
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const after=target.scrollTop;return {moved:Math.abs(after-before)>1,before,after,atBoundary:direction==='up'?after<=1:after+target.clientHeight>=target.scrollHeight-2,container:target.tagName};
  },direction);
 }
 async inspect(){
  for(let attempt=0;attempt<3;attempt++){
   try{return await this.readVisiblePage();}catch(error){
    if(attempt===2 || !/context was destroyed|navigation/i.test(error.message))throw error;
    await this.driver.activePage.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});
    await this.driver.activePage.waitForTimeout(500);
   }
  }
 }
 async readVisiblePage(){
  const page=await this.page();
  await page.locator('body').waitFor({state:'attached',timeout:8000});
  if(/\/sorry\/|captcha|challenge/i.test(page.url()))return {ok:false,status:'needs_input',message:'El sitio muestra una verificación de acceso. Completala en la ventana del navegador y después decime «mostrame las opciones».',data:{url:page.url(),items:[]}};
  const resultSelector=page.url().includes('bing.com/search')?'#b_results .b_algo h2 a':page.url().includes('youtube.com/results')?'ytd-video-renderer a#video-title,ytd-channel-renderer a#main-link':null;
  if(resultSelector)await page.locator(resultSelector).filter({visible:true}).first().waitFor({state:'visible',timeout:6000}).catch(()=>{});
  const filter=this.resultFilters.get(page);
  const observed=await page.evaluate(resultType=>{
   const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>10&&r.height>8&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&s.visibility!=='hidden'&&s.display!=='none';};
   const groups=['ytd-video-renderer a#video-title,ytd-rich-item-renderer a#video-title-link,ytd-compact-video-renderer a#video-title,ytd-channel-renderer a#main-link','#b_results .b_algo h2 a','a:has(h3)','main a,main button,[role="main"] a,[role="main"] button','a,button,[role="button"]'];
   const selectors=resultType==='channel'?['ytd-channel-renderer a#main-link']:location.hostname.endsWith('youtube.com')&&location.pathname==='/results'?[groups[0]]:location.hostname.endsWith('bing.com')&&location.pathname==='/search'?[groups[1]]:location.hostname.endsWith('google.com')&&location.pathname==='/search'?[groups[2]]:groups;
   // Keep rendered results below the viewport, but exclude stale hidden SPA cards.
   const rendered=e=>{const r=e.getBoundingClientRect();return r.width>10&&r.height>8&&e.checkVisibility({visibilityProperty:true});};
   let candidates=[];for(const selector of selectors){candidates=[...document.querySelectorAll(selector)].filter(rendered);if(candidates.length)break;}
   const registryKey=location.href+'|'+(resultType||'all');
   if(window.__jarvisRegistryUrl!==registryKey){window.__jarvisRegistryUrl=registryKey;window.__jarvisRegistry=new Map();}
   const registry=window.__jarvisRegistry;
   const seen=new Set();const result=[];
   document.querySelectorAll('[data-jarvis-choice]').forEach(e=>e.removeAttribute('data-jarvis-choice'));
   document.getElementById('jarvis-voice-numbers')?.remove();
   for(const e of candidates){const label=(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').trim().replace(/\s+/g,' ');const href=e.href||'';const key=href||label;if(!label||seen.has(key))continue;seen.add(key);
    if(!registry.has(key))registry.set(key,{index:registry.size+1,label:label.slice(0,240),href});
    const item=registry.get(key);item.y=e.getBoundingClientRect().top+scrollY;e.setAttribute('data-jarvis-choice',String(item.index));
    if(visible(e))result.push({...item});if(registry.size>=2000)break;
   }
   const overlay=document.createElement('div');overlay.id='jarvis-voice-numbers';overlay.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647';
   for(const item of result){const e=document.querySelector(`[data-jarvis-choice="${item.index}"]`);const r=e.getBoundingClientRect();const badge=document.createElement('span');badge.textContent=String(item.index);badge.style.cssText=`position:absolute;left:${Math.max(0,r.left-25)}px;top:${Math.max(0,r.top)}px;background:#1246ad;color:white;font:bold 16px Arial;padding:3px 7px;border-radius:5px;border:1px solid white;`;overlay.appendChild(badge);}
   document.body.appendChild(overlay);
   if(!window.__jarvisVoiceScroll){window.__jarvisVoiceScroll=true;window.addEventListener('scroll',()=>document.getElementById('jarvis-voice-numbers')?.remove(),{passive:true});}
   return {items:result,known:[...registry.values()],scrollY};
  },filter?.url===page.url()?filter.type:null);
  const items=observed.items;
  this.snapshot={url:page.url(),...observed};
  return {ok:true,message:items.length?`Opciones visibles:\n${items.map(i=>`${i.index}. ${i.label}`).join('\n')}\nPodés decir «ese» señalándolo con el mouse, un número o «seguí bajando».`:'No encontré enlaces o botones visibles para seleccionar. Puede haber una carga pendiente o un aviso en la página.',data:this.snapshot};
 }
 async execute(params){
  if(this.busy)return {ok:false,message:'Esperá a que termine la navegación actual.'};this.busy=true;
  try{
   const {command}=params;
   if(command==='clarify')return {ok:false,status:'needs_input',message:params.question||'Indicá qué elemento querés elegir.'};
   if(command==='stop'){this.until=0;return {ok:true,message:'Terminé la navegación por voz. La página queda abierta.'};}
   if(!['open','search'].includes(command)&&!this.isActive())return {ok:false,status:'needs_input',message:'Primero decime qué buscar o «entrá a YouTube» para iniciar la navegación por voz.'};
   const wasActive=this.isActive();
   const page=await this.page();
   if(command==='open'||command==='search'){
    const site=params.site || (wasActive && this.platform()==='youtube'?'youtube':'bing');
    const base=site==='youtube'?'https://www.youtube.com':site==='google'?'https://www.google.com':site==='bing'?'https://www.bing.com':site;
    if(command==='open'){
     if(!/^https?:\/\//i.test(base))throw new Error('Indicá un sitio o enlace válido.');
     const target=new URL(base);const root=['youtube','google','bing'].includes(site)&&target.pathname==='/'&&!target.search;
     const matches=p=>{try{const u=new URL(p.url());return root?u.hostname.replace(/^www\./,'')===target.hostname.replace(/^www\./,''):u.href===target.href;}catch(_){return false;}};
     const existing=this.driver.context.pages().find(p=>!p.isClosed()&&matches(p));
     if(existing){this.driver.activePage=existing;await existing.bringToFront();}
     else {await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});await page.bringToFront();}
    }else{
     const query=String(params.query||'').trim();if(!query)throw new Error('Indicá qué querés buscar.');
     let usedForm=false;
     if(site==='youtube'&&this.platform()==='youtube'){
      const field=page.locator('input[name="search_query"],input#search').filter({visible:true}).first();
      if(await field.count()){
       await field.fill(query,{timeout:4000});await field.press('Enter');
       await page.waitForURL(u=>u.pathname==='/results'&&u.searchParams.get('search_query')===query,{timeout:10000});usedForm=true;
      }
     }
     if(!usedForm){const url=site==='youtube'?'https://www.youtube.com/results?search_query='+encodeURIComponent(query):site==='google'?'https://www.google.com/search?q='+encodeURIComponent(query):'https://www.bing.com/search?q='+encodeURIComponent(query);await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});}
     if(site==='youtube' && params.resultType==='channel'){
      await page.getByRole('button',{name:/^(?:Filtros de búsqueda|Search filters|Filtros|Filters)$/i}).first().click({timeout:5000});
      const filter=page.locator('ytd-search-filter-renderer a').filter({hasText:/^\s*(?:Canales|Channels)\s*$/i}).first();
      await filter.click({timeout:5000});
      await page.waitForURL(u=>u.pathname==='/results'&&u.searchParams.has('sp'),{timeout:8000});
      await page.locator('ytd-channel-renderer').filter({visible:true}).first().waitFor({state:'visible',timeout:8000});
      this.resultFilters.set(page,{url:page.url(),type:'channel'});
     }
     await page.bringToFront();
    }
    require('../tvVoiceService').deactivateSession();
   }else if(command==='scroll'){
    const movement=await this.scrollPage(params.direction);
    if(!movement.moved){const current=await this.inspect();return {...current,ok:movement.atBoundary,message:movement.atBoundary?'Llegué al límite de esta lista.':'No encontré una lista que pueda desplazarse en esta página.',data:{...current.data,movement}};}
    this.lastMovement=movement;
   }else if(command==='back')await page.goBack({waitUntil:'domcontentloaded',timeout:12000});
   else if(command==='select'||command==='click'||command==='point'){
    let target;
    if(command==='select'){
     const inspected=await this.inspect();if(!inspected.ok)return inspected;
     let selected=this.snapshot.known.find(item=>item.index===Number(params.index));
     const deadline=Date.now()+6000;
     while(!selected && Date.now()<deadline){const before=this.snapshot.known.length;const movement=await this.scrollPage('down');await page.waitForTimeout(250);await this.inspect();selected=this.snapshot.known.find(item=>item.index===Number(params.index));if(this.snapshot.known.length===before && !movement.moved)break;}
     if(!selected)return {ok:false,status:'needs_input',message:`Identifiqué ${this.snapshot.known.length} resultados. No encontré ese número después de avanzar por la página.`};
     target=page.locator(`[data-jarvis-choice="${selected.index}"]`);
     if(!await target.count()){await page.evaluate(y=>scrollTo(0,y),selected.y||0);await page.waitForTimeout(300);await this.inspect();}

    }else if(command==='point'){
     const pointed=await this.pointed();if(!pointed)return {ok:false,status:'needs_input',message:'Apuntá con el mouse al video o enlace dentro de la ventana de navegación y repetí el pedido.'};
     if(params.expectedHref && params.expectedHref!==pointed.href)return {ok:false,status:'needs_input',message:'El elemento señalado cambió mientras interpretaba la orden. Volvé a apuntar al que querés y repetí el pedido.'};
     target=pointed.frame.locator('[data-jarvis-pointed="true"]');
    }else{
     const label=String(params.label||'').trim();
     target=page.getByRole('link',{name:label,exact:true}).or(page.getByRole('button',{name:label,exact:true})).filter({visible:true});
     if(await target.count()!==1)return {ok:false,status:'needs_input',message:`No hay un único botón o enlace visible llamado «${label}». Decime el texto exacto o elegí un resultado por número.`};
    }
    const popup=page.waitForEvent('popup',{timeout:1500}).catch(()=>null);
    await target.click({timeout:7000});const opened=await popup;
    if(opened){this.driver.activePage=opened;await opened.waitForURL(url=>/^https?:$/.test(url.protocol),{timeout:12000}).catch(()=>{});await opened.waitForLoadState('domcontentloaded',{timeout:12000}).catch(()=>{});}
    else await page.waitForLoadState('domcontentloaded',{timeout:12000}).catch(()=>{});
   }else if(command!=='inspect')throw new Error('Orden de navegación no reconocida.');
   // Wait briefly for SPA results instead of retaining controls from the previous page.
   await this.driver.activePage.waitForTimeout(400);
   const result=await this.inspect();this.history.push({command:params,url:result.data?.url,ok:result.ok});this.history=this.history.slice(-8);return result;
  }catch(error){return {ok:false,message:'No pude completar la navegación: '+error.message};}
  finally{this.busy=false;}
 }
}
module.exports=new VoiceNavigationService();
