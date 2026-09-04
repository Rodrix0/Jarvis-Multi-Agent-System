const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptsDir = path.join(__dirname, '..', 'scripts');
const dataDir = path.join(__dirname, '..', 'data');
const appsPath = path.join(dataDir, 'installed_apps.json');
const psScript = path.join(scriptsDir, 'scanInstalledApps.ps1');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function triggerBackgroundScan(force = false) {
    const cacheMaxAgeMs = 12 * 60 * 60 * 1000; // 12 horas
    if (!force && fs.existsSync(appsPath) && Date.now() - fs.statSync(appsPath).mtimeMs < cacheMaxAgeMs) {
        console.log('[App Discovery] Usando índice de aplicaciones en caché.');
        return;
    }
    console.log("\n[App Discovery] 🔍 Iniciando rastreo silencioso de aplicaciones y elementos del Escritorio...");
    execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', psScript], { maxBuffer: 1024 * 5000 }, (error, stdout) => {
        if (error) {
            console.error("[App Discovery] Error escaneando apps:", error);
            return;
        }
        try {
            const startIndex = stdout.indexOf('{');
            const rawJson = startIndex !== -1 ? stdout.substring(startIndex) : "{}";
            
            const appsObj = JSON.parse(rawJson);
            fs.writeFileSync(appsPath, JSON.stringify(appsObj, null, 2), 'utf8');
            console.log(`[App Discovery] ✅ ¡Listo! Se aprendieron ${Object.keys(appsObj).length} accesos directos desde el Escritorio y Menú de Inicio.`);
        } catch(e) {
            console.error("[App Discovery] Error procesando los datos extraídos del Disco Duro:", e);
        }
    });
}

function getAppDictionary() {
    if (fs.existsSync(appsPath)) {
        try {
            return JSON.parse(fs.readFileSync(appsPath, 'utf8'));
        } catch(e) {
            return {};
        }
    }
    return {};
}

module.exports = {
    triggerBackgroundScan,
    getAppDictionary
};
