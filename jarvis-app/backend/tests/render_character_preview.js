// Export frames from the actual local renderer without editing the supplied photograph.
const fs=require('node:fs'),path=require('node:path');
const express=require('express'),puppeteer=require('puppeteer');
(async()=>{
 const app=express();app.use(express.static(path.resolve(__dirname,'../../frontend')));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 let browser;
 try{
  browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-first-run','--disable-extensions']});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/character-preview.html`);
  await page.waitForFunction(()=>window.previewInstance);
  const repaired=process.argv.includes('--repaired');
  const dir=path.resolve(__dirname,repaired?'../../../.local/jarvis-clean-frames':'../../../.local/jarvis-original-frames');fs.mkdirSync(dir,{recursive:true});
  let frame=0;
  for(const name of (repaired?['working','sit','exercise']:['idle','wave','walk','working','sit','exercise','celebrate','question','speaking']))for(let i=0;i<20;i++){
   const png=await page.evaluate((name,t)=>{
    const d=previewInstance.data,c=document.createElement('canvas');c.width=480;c.height=504;
    const ctx=c.getContext('2d');ctx.fillStyle='#16231f';ctx.fillRect(0,0,c.width,c.height);
    const fg=document.createElement('canvas');fg.width=c.width;fg.height=c.height;JarvisRig.draw(fg.getContext('2d'),d,name,t);ctx.drawImage(fg,0,0);
    return c.toDataURL('image/png').split(',')[1];
   },name,i*.1);
   fs.writeFileSync(path.join(dir,String(frame++).padStart(3,'0')+'.png'),Buffer.from(png,'base64'));
  }
  console.log(`Exported ${frame} original-character frames to ${dir}`);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
