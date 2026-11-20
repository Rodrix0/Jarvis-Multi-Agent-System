const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const browser = require('../services/browser/browserService');
async function main() {
    const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/app.js'), 'utf8');
    const start = source.indexOf('function showActionConfirmation(data)');
    const end = source.indexOf("socket.on('response'", start);
    assert.ok(start >= 0 && end > start);
    const {page} = await browser.ensureBrowser({headless:true});
    try {
        await page.setContent('<div id="jarvis-response"></div>');
        await page.addScriptTag({content:`window.jarvisBox = document.getElementById('jarvis-response'); window.showActionToast = () => {}; window.requests = []; window.fetch = async (url, opts) => { window.requests.push({url, body:JSON.parse(opts.body)}); return {ok:true,json:async()=>({ok:true,message:'Acción verificada.'})}; };` + source.slice(start,end)});
        await page.evaluate(()=>showActionConfirmation({status:'awaiting_pin_confirmation',confirmationToken:'test-token'}));
        await page.getByLabel('PIN de seguridad', {exact:true}).fill('1234');
        await page.getByRole('button',{name:'Confirmar acción',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>requests[0]),{url:'/api/actions/confirm',body:{token:'test-token',pin:'1234'}});
        assert.equal(await page.locator('#jarvis-response').innerText(),'Acción verificada.');
        await page.evaluate(()=>showActionConfirmation({status:'awaiting_confirmation',confirmationToken:'cancel-token'}));
        await page.getByRole('button',{name:'Cancelar',exact:true}).click();
        assert.equal((await page.evaluate(()=>requests[1])).url,'/api/actions/cancel');
        assert.equal(await page.locator('#jarvis-response').innerText(),'Acción cancelada.');
        console.log('PASS: confirmar con PIN y cancelar desde el panel, sin ejecutar acciones reales.');
    } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
