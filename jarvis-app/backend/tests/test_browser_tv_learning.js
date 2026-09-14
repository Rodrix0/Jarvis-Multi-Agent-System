const assert=require('assert/strict');const fs=require('fs');const path=require('path');
const browser=require('../services/browser/browserService');
async function main(){const {page}=await browser.ensureBrowser({headless:true});try{
 const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/index.html'),'utf8');
 const script=fs.readFileSync(path.resolve(__dirname,'../../frontend/app.js'),'utf8');
 const start=html.indexOf('<div class="tv-tab-content" id="tab-apps"');const end=html.indexOf('<div class="tv-tab-content" id="tab-testing"',start);
 await page.setContent(html.slice(start,end).replace('style="display:none"',''));
 await page.addScriptTag({content:`window.requests=[]; window.tvApi=async(url,opts)=>{requests.push({url,body:opts?.body?JSON.parse(opts.body):null});return {};};`+script.slice(script.indexOf('let tvLearningDraft='))});
 await page.evaluate(()=>loadTvLearning());
 await page.locator('#tv-learning-wait').fill('100');
 await page.getByRole('button',{name:'Home',exact:true}).click();
 await page.waitForFunction(()=>!tvLearningBusy);
 await page.locator('#tv-learning-rows').fill('abcdef\nghijkl');
 await page.getByRole('button',{name:'Guardar aprendizaje',exact:true}).click();
 const sent=await page.evaluate(()=>requests.find(r=>r.url==='/api/tv/learning'&&r.body));assert.equal(sent.body.app,'youtube');assert.equal(sent.body.open[0].button,'home');assert.equal(sent.body.rows,'abcdef\nghijkl');
 console.log('PASS: pestaña aprendizaje, grabación de Home y guardado del teclado desde Chrome.');
 }finally{await browser.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
