// Controls only the WinForms process launched by this test; never closes user applications.
const assert = require('assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const ui = require('../services/windows/uiAutomationService');
async function main() {
    const child = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'fixtures/test_dialog.ps1')], { windowsHide:true, stdio:['ignore','pipe','pipe'] });
    let diagnostic = '';
    child.stderr.on('data', chunk => { diagnostic += chunk; });
    child.stdout.on('data', chunk => { diagnostic += chunk; });
    let failure;
    child.on('error', error => { failure = error; });
    try {
        const win = await ui.waitForWindow('JARVIS_TEST_WINDOW', 10000, 200);
        if (failure) throw failure;
        assert.ok(win, `La ventana de prueba debe existir; proceso ${child.pid}, salida ${child.exitCode}: ${diagnostic}`);
        const hwnd = win.Hwnd || win.hwnd;
        const value = 'Jarvis verifica texto: áéíóú 123';
        const written = await ui.setText(hwnd, '', value, { automationId:'txtInput' });
        assert.equal(written.ok, true);
        const read = await ui.getText(hwnd, { automationId:'txtInput', controlType:'Edit' });
        assert.equal(read, value);
        const clicked = await ui.clickElement(hwnd, 'Aceptar');
        assert.equal(clicked.ok, true);
        console.log('PASS: ventana real, escritura, lectura exacta y clic en el proceso de prueba.');
    } finally { if (child.exitCode === null) child.kill(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
