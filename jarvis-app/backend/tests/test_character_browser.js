// Dedicated local test server/browser; never starts Jarvis or controls an existing tab.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const express=require('express');const puppeteer=require('puppeteer');
(async()=>{
 const app=express();app.use(express.static(path.resolve(__dirname,'../../frontend')));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 let browser;
 try {
  browser=await puppeteer.launch({headless:true,executablePath:process.env.JARVIS_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-first-run','--disable-extensions']});
  const page=await browser.newPage();await page.setViewport({width:1000,height:1050,deviceScaleFactor:1});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/character-preview.html`);
  await page.waitForFunction(()=>window.previewInstance&&document.querySelectorAll('nav button').length===10);
  const fidelity=await page.evaluate(()=>{
   const d=previewInstance.data,actual=document.createElement('canvas'),reference=document.createElement('canvas');
   actual.width=reference.width=d.width*4;actual.height=reference.height=d.height*4;
   JarvisRig.draw(actual.getContext('2d'),{...d,shadow:[0,0,0,0]},'idle',0);
   const ref=reference.getContext('2d'),s=d.source;ref.drawImage(d._image,s.offset[0]*4,s.offset[1]*4,s.width*s.scale*4,s.height*s.scale*4);
   const a=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data,b=ref.getImageData(0,0,reference.width,reference.height).data;
   let total=0,same=0,error=0;for(let i=0;i<a.length;i+=4){if(b[i+3]<240)continue;total++;const diff=Math.max(...[0,1,2,3].map(j=>Math.abs(a[i+j]-b[i+j])));if(diff<25)same++;error+=diff;}
   return {matching:same/total,error:error/total};
  });
  assert.ok(fidelity.matching>.97,'neutral rig preserves original appearance: '+JSON.stringify(fidelity));
  await new Promise(resolve=>setTimeout(resolve,150));
  const before=await page.$eval('canvas',canvas=>canvas.toDataURL());
  await new Promise(resolve=>setTimeout(resolve,300));
  const after=await page.$eval('canvas',canvas=>canvas.toDataURL());assert.ok(before!==after,'visible character animates: '+JSON.stringify(await page.evaluate(()=>({visible:previewInstance.visible,reduced:previewInstance.reduced.matches,hidden:document.hidden,timer:previewInstance.timer,mode:previewInstance.mode}))));
  await page.click('[data-animation=working]');
  assert.equal(await page.evaluate(()=>previewInstance.mode),'working');
  for(const name of ['working','sit','exercise']){
   const motion=await page.evaluate(name=>{
    const d=previewInstance.data,variant=d._variants[name],canvas=document.createElement('canvas');canvas.width=480;canvas.height=504;
    JarvisRig.draw(canvas.getContext('2d'),d,name,0);const first=canvas.toDataURL();
    JarvisRig.draw(canvas.getContext('2d'),d,name,variant.animations[name].duration/2);
    return {changed:first!==canvas.toDataURL(),clean:variant.source.image.endsWith('-clean.png'),noAxe:!variant.bones.some(b=>/axe/i.test(b.id))};
   },name);
   assert.deepEqual(motion,{changed:true,clean:true,noAxe:true},'clean pose animates without axe fragments: '+name);
  }
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('jarvis-companion-motion',{detail:{enabled:null}})));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await new Promise(resolve=>setTimeout(resolve,100));
  const still=await page.$eval('canvas',canvas=>canvas.toDataURL());
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(await page.$eval('canvas',canvas=>canvas.toDataURL()),still,'reduced motion renders a still pose');
  assert.equal(await page.evaluate(()=>previewInstance.timer),null,'no animation timer in reduced motion');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('jarvis-companion-motion',{detail:{enabled:true}})));
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.notEqual(await page.evaluate(()=>previewInstance.timer),null,'explicit Jarvis setting allows motion independently of Windows');
  await page.click('#motion');await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(await page.evaluate(()=>previewInstance.timer),null,'own pause control stops timer');
  await page.click('#motion');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
  await page.evaluate(()=>{document.querySelector('.stage').style.display='none';});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(await page.evaluate(()=>previewInstance.timer),null,'offscreen character stops its timer');
  await page.evaluate(()=>{document.querySelector('.stage').style.display='grid';});
  await new Promise(resolve=>setTimeout(resolve,150));
  const output=path.resolve(__dirname,'../../../.local/jarvis-character-browser.png');
  fs.mkdirSync(path.dirname(output),{recursive:true});await page.screenshot({path:output,fullPage:true});
  await page.setViewport({width:390,height:900,deviceScaleFactor:1});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile has no horizontal overflow');
  assert.deepEqual(errors,[]);
  console.log('PASS: browser animation, working state, reduced motion, offscreen pause and mobile layout.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
