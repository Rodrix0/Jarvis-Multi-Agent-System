const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

let isObserving = false;
let screenBreadcrumbs = []; 
let pollingInterval = null;

// Verifica si la carpeta de scripts y data existen
const scriptsDir = path.join(__dirname, '..', 'scripts');
const dataDir = require("./dataPaths").dataPath();
if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const psClientPath = path.join(scriptsDir, 'getActiveWindow.ps1');
const observacionPath = path.join(dataDir, 'historial_observador.json');

// Cargar historial previo si existe para una memoria y aprendizaje a largo plazo
if (fs.existsSync(observacionPath)) {
    try { screenBreadcrumbs = JSON.parse(fs.readFileSync(observacionPath, 'utf8')); } catch (e) { screenBreadcrumbs = []; }
}

function saveObserverHistory() {
    // Guardar asincrónicamente para no trabar el proceso
    fs.writeFile(observacionPath, JSON.stringify(screenBreadcrumbs, null, 2), (err) => {
        if (err) console.error("[Observer] Error guardando historial:", err);
    });
}

function toggleObserver(state) {
    if (state === undefined) {
        isObserving = !isObserving;
    } else {
        isObserving = state;
    }

    if (isObserving) {
        if (!pollingInterval) {
            console.log("\n[👁️  Observer] MODO OBSERVADOR PERMANENTE ACTIVADO. Jarvis está aprendiendo toda tu actividad...");
            pollingInterval = setInterval(pollActiveWindow, 5000); 
        }
    } else {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            console.log("\n[👀 Observer] MODO OBSERVADOR APAGADO.");
        }
    }
    return isObserving;
}

function pollActiveWindow() {
    execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', psClientPath], (error, stdout) => {
        if (!error && stdout) {
            let activeTitle = stdout.trim();
            if (activeTitle.length > 2 && 
                !activeTitle.includes("npm") && 
                !activeTitle.includes("powershell") && 
                activeTitle !== "Windows Input Experience" && 
                activeTitle !== "Program Manager") {
                
                // Obtener el título del último objeto que miró (evitando doble registro seguido)
                let lastAdded = screenBreadcrumbs.length > 0 ? screenBreadcrumbs[screenBreadcrumbs.length - 1].title : null;
                
                if (lastAdded !== activeTitle) {
                    screenBreadcrumbs.push({
                        time: new Date().toISOString(),
                        title: activeTitle
                    });
                    
                    // Almacenamiento Permanente Masivo
                    saveObserverHistory();
                }
            }
        }
    });
}

function getScreenContext() {
    if (screenBreadcrumbs.length === 0) return null;
    
    // Para que la IA no se vuelva loca procesando miles de líneas al instante cuando le hablas hoy,
    // le pasamos tus últimas 15 interacciones como un resumen súper enfocado de tu contexto actual y de las horas recientes.
    const historialReciente = screenBreadcrumbs.slice(-15).reverse().map(item => item.title).join(" | ");

    return `IMPORTANTE: Tengo acceso al historial fotográfico permanente de las ventanas del software del usuario. Las ventanas más recientes que ha estado viendo (de la más actual a las pasadas horas) son: [ ${historialReciente} ]. Usa este conocimiento para saber sus hábitos o a qué se refiere si menciona algo vago.`;
}

module.exports = {
    toggleObserver,
    getScreenContext,
    isObserving: () => isObserving
};
