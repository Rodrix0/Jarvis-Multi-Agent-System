const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '../../frontend');
const output = path.resolve(__dirname, '../../logs/ui-workspace');
const fakeSocket = `window.__incoming={};window.__sent=[];window.__outgoing=[];window.__socket={connected:true,on(e,f){(window.__incoming[e]??=[]).push(f);return this;},onAnyOutgoing(f){window.__outgoing.push(f)},emit(e,d){window.__sent.push({e,d});window.__outgoing.forEach(f=>f(e,d));},off(){}};window.io=()=>window.__socket;window.__receive=(e,d)=>(window.__incoming[e]||[]).forEach(f=>f(d));`;
const fixtures = {
    '/api/capabilities': [{ id: 'folder.create', name: 'Crear carpeta', description: 'Organizá tus archivos.', permission: 'standard', available: true, examples: ['Creame una carpeta llamada Proyectos'] }],
    '/api/voice/local/status': { online: true, state: 'dormant', engine: 'Local', devices: [] },
    '/api/voice/settings': { confidenceThreshold: .7, agreementThreshold: .7 },
    '/api/memory': { preferences: [], corrections: [], facts: [], recentTurns: [] },
    '/api/voice/learning': { vocabulary: [], phrases: [] }
};
async function main() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/socket.io/socket.io.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fakeSocket); }
        if (url.pathname === '/api/voice/local/state' && req.method === 'POST') {
            let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{fixtures['/api/voice/local/status'].state=JSON.parse(body).state;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));});return;
        }
        if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(fixtures[url.pathname] || {})); }
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream');
        res.end(fs.readFileSync(file));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
    let browser;
    try {
        browser = await chromium.launch({ executablePath, headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
        const page = await context.newPage(); const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('https://**', route => route.abort());
        await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => __receive('init_data', { modes: [{ id: 'assistant', name: 'Asistente general', description: '' }, { id: 'study', name: 'Estudio', description: '' }, { id: 'work', name: 'Productividad', description: '' }], activeModeId: 'assistant' }));
        assert.equal(await page.locator('.sidebar-brand').count(), 1);
        const status=page.locator('#main-assistant-status');
        await page.waitForFunction(()=>document.getElementById('main-assistant-status')?.textContent==='En reposo');
        assert.equal(await page.locator('dialog').evaluate(e=>e.open),false,'state is visible with settings closed');
        assert.equal(await status.isVisible(),true);
        await page.getByRole('button',{name:'Activar voz de Jarvis',exact:true}).click();
        await page.waitForFunction(()=>document.getElementById('main-assistant-status').textContent==='Escuchando');
        assert.ok(await page.locator('canvas').evaluateAll(elements => elements.every(canvas => canvas.getContext('2d') !== null)), 'character uses 2D Canvas rather than a WebGL renderer');
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        await page.getByRole('button', { name: /Creá algo nuevo/ }).click();
        assert.equal(await page.locator('#manual-text-input').inputValue(), 'Creame un documento sobre ');
        assert.equal(await page.evaluate(() => __sent.filter(x => x.e === 'process_speech').length), 0, 'suggestions only prepare commands');
        await page.locator('#manual-text-input').fill('Mensaje de prueba');
        await page.locator('#manual-text-input').press('Shift+Enter');
        assert.match(await page.locator('#manual-text-input').inputValue(), /\n/);
        await page.locator('#manual-text-input').press('Enter');
        assert.equal(await page.evaluate(() => __sent.filter(x => x.e === 'process_speech').length), 1);
        assert.equal(await status.innerText(),'Pedido pendiente');
        await page.evaluate(() => __receive('action_status', { phase: 'accepted', text: 'Mensaje de prueba', message: 'Me pongo a trabajar…' }));
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.workspace.conversations.v1'))[0].messages.length), 1, 'acknowledgment does not duplicate the message');
        assert.equal(await page.locator('.transcript-box .live-avatar').getAttribute('data-state'), 'working');
        await page.evaluate(()=>__receive('action_status',{phase:'working',message:'Preparando el documento'}));
        assert.equal(await status.innerText(),'Trabajando');
        assert.equal(await page.locator('#main-voice-status').innerText(),'Voz escuchando','voice and task states are separate');
        await page.locator('.conversation-row').first().click();
        assert.equal(await page.locator('.transcript-box').isVisible(), true, 'history navigation cannot detach a running response');
        await page.evaluate(() => __receive('response', { text: 'Documento de prueba terminado.\nLa información está lista.', suppressTts: true, status: 'completed' }));
        assert.equal(await status.innerText(),'Escuchando','completion restores real voice state');
        await page.screenshot({ path: path.join(output, 'conversation.png'), fullPage: true });
        await page.getByRole('button', { name: /Nueva conversación/ }).click();
        await page.locator('.conversation-row').first().click();
        assert.match(await page.locator('.conversation-history').innerText(), /Documento de prueba terminado/);
        assert.equal(await page.evaluate(() => __sent.filter(x => x.e === 'process_speech').length), 1, 'opening history does not execute it');
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('.conversation-row').count(), 1, 'history persists');
        await page.evaluate(()=>__receive('response',{text:'¿En qué carpeta querés guardarlo?',suppressTts:true,status:'needs_input'}));
        assert.equal(await status.innerText(),'Esperando tu respuesta');
        await page.getByRole('button',{name:/Nueva conversación/}).click();
        await page.getByRole('button', { name: 'Abrir herramientas', exact: true }).click();
        await page.screenshot({path:path.join(output,'tools.png'),fullPage:true});
        await page.locator('.capability-card').first().click();
        assert.equal(await page.locator('#manual-text-input').inputValue(), 'Creame una carpeta llamada Proyectos');
        await page.getByRole('button', { name: /Ajustes y voz/ }).click();
        assert.equal(await page.locator('dialog').evaluate(e => e.open), true);
        await page.screenshot({path:path.join(output,'settings.png'),fullPage:true});
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /Adjuntar/ }).click();
        assert.equal(await page.locator('#dropzone').isVisible(), true);
        await page.getByRole('button', { name: /Adjuntar/ }).click();
        await page.getByRole('button', { name: /Enlace/ }).click();
        assert.equal(await page.locator('#context-url').isVisible(), true);
        await page.getByRole('button', { name: /Enlace/ }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        assert.equal(await status.isVisible(),true,'main status remains visible on mobile');
        const statusBounds=await page.locator('.assistant-presence').boundingBox(),toast=page.locator('.jarvis-action-toast.visible');
        assert.ok(statusBounds.y+statusBounds.height<=844,'main status stays inside viewport');
        if(await toast.count()) { const toastBounds=await toast.boundingBox();assert.ok(!toastBounds||toastBounds.y+toastBounds.height<=statusBounds.y,'notices never cover the main status'); }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile has no horizontal overflow');
        await page.getByRole('button', { name: 'Abrir menú lateral' }).click();
        assert.equal(await page.locator('body').evaluate(e => e.classList.contains('sidebar-open')), true);
        await page.getByRole('button', { name: 'Cerrar menú lateral' }).click({ position: { x: 320, y: 70 } });
        await page.evaluate(() => { __socket.connected = false; __receive('disconnect'); });
        assert.equal(await status.innerText(),'Sin conexión');
        assert.equal(await page.locator('.presence-toggle').isDisabled(),true,'disconnected state cannot pretend to activate voice');
        await page.locator('#manual-text-input').fill('No ejecutar desconectado');
        await page.getByRole('button', { name: 'Enviar mensaje' }).click();
        assert.equal(await page.evaluate(() => __sent.filter(x => x.e === 'process_speech').length), 0);
        assert.deepEqual(errors, [], 'no uncaught frontend errors');
        console.log('PASS: escritorio/móvil, avatar sin WebGL, historial persistente, envío único, Shift+Enter, herramientas, ajustes y desconexión.');
    } finally { await browser?.close(); await new Promise(r => server.close(r)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
