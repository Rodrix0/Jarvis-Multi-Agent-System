const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let powerProcess = null;
let lockScreenDaemon = null;

const STATE_FILE = path.join(__dirname, '..', 'data', 'lock_state.txt');
const SECURITY_FILE = path.join(__dirname, '..', 'data', 'security.json');

function isSecurityEnabled() {
    try {
        return fs.existsSync(SECURITY_FILE) && JSON.parse(fs.readFileSync(SECURITY_FILE, 'utf8')).enabled === true;
    } catch (error) {
        console.error('[PowerService] No se pudo leer security.json:', error.message);
        return false;
    }
}

function initPowerListener() {
    if (os.platform() !== 'win32' || !isSecurityEnabled() || powerProcess || lockScreenDaemon) return;

    // 1. Inicializar el archivo de estado
    fs.writeFileSync(STATE_FILE, "HIDE", "utf8");

    // 2. Iniciar el demonio de Python en memoria (invisible). Solo se paga el costo de 2 segundos una vez al inicio del servidor.
    const pythonExe = path.join(__dirname, '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe');
    const lockScript = path.join(__dirname, '..', '..', 'python_engine', 'jarvis_lockscreen.py');
    lockScreenDaemon = spawn(pythonExe, [lockScript], { windowsHide: true });
    
    lockScreenDaemon.on('exit', () => {
        lockScreenDaemon = null;
        console.log("[PowerService] Demonio biométrico desconectado.");
    });

    console.log("[PowerService] Demonio Biométrico cargado en RAM silenciosamente. Latencia optimizada a 0ms.");

    // 3. Iniciar sensores de energía
    const scriptPath = path.join(__dirname, '..', 'scripts', 'powerListener.ps1');
    powerProcess = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-WindowStyle', 'Hidden', '-File', scriptPath], { windowsHide: true });
    
    powerProcess.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        
        if (msg.includes("EVENT:LOCK") || msg.includes("EVENT:SUSPEND") || msg.includes("EVENT:RESUME") || msg.includes("EVENT:UNLOCK")) {
            
            // VERIFICAR SI EL USUARIO TIENE EL ESCUDO ACTIVO
            try {
                const secPath = path.join(__dirname, '..', 'data', 'security.json');
                if (fs.existsSync(secPath)) {
                    const sec = JSON.parse(fs.readFileSync(secPath));
                    if (sec.enabled === false) {
                        console.log("\n[PowerService] Evento detectado, pero la SEGURIDAD BIOMÉTRICA ESTÁ APAGADA.\n");
                        return; // Lo ignoramos
                    }
                }
            } catch (e) { console.error("Error leyendo security.json:", e); }

            console.log(`\n[!!!] EVENTO DETECTADO (${msg}). DESPLEGANDO ESCUDO AL INSTANTE...\n`);
            
            // SIMPLEMENTE ESCRIBIMOS 'SHOW' EN EL ARCHIVO. Python lo leerá en menos de 100ms.
            fs.writeFileSync(STATE_FILE, "SHOW", "utf8");
        }
    });

    powerProcess.stderr.on('data', (err) => console.log(err.toString()));
    powerProcess.on('exit', () => { powerProcess = null; });
}

function stopPowerListener() {
    fs.writeFileSync(STATE_FILE, "HIDE", "utf8");
    if (powerProcess) {
        powerProcess.kill();
        powerProcess = null;
    }
    if (lockScreenDaemon) {
        lockScreenDaemon.kill();
        lockScreenDaemon = null;
    }
    console.log('[PowerService] Escudo detenido; no quedan procesos biométricos residentes.');
}

function setSecurityEnabled(enabled) {
    if (enabled) initPowerListener();
    else stopPowerListener();
}

function launchLockScreen() {
    // Si queremos lanzarlo manual (por la voz o pruebas), simplemente cambiamos el archivo
    fs.writeFileSync(STATE_FILE, "SHOW", "utf8");
}

module.exports = { initPowerListener, launchLockScreen, setSecurityEnabled, isSecurityEnabled };
