const fs = require('fs');
const path = require('path');

const memoriaFile = path.join(__dirname, '..', 'data', 'memoria.json');
const comandosFile = path.join(__dirname, '..', 'data', 'comandos.json');

async function studyAndOptimize() {
    console.log("\n[Background Tuner] 🧠 Iniciando subproceso: Analizando y estudiando historial...");
    
    let memoria = {};
    let comandos = {};
    
    if (fs.existsSync(memoriaFile)) {
        try { memoria = JSON.parse(fs.readFileSync(memoriaFile, 'utf8')); } catch (e) {}
    }
    if (fs.existsSync(comandosFile)) {
        try { comandos = JSON.parse(fs.readFileSync(comandosFile, 'utf8')); } catch (e) {}
    }

    const queries = Object.keys(memoria);
    if (queries.length === 0) {
        console.log("[Background Tuner] 💤 No hay datos históricos para estudiar aún.\n");
        return;
    }

    let comandosNuevos = 0;

    // Estudio Local: En lugar de usar Ollama para todo (lo que gastaría RAM e iría lento),
    // Jarvis genera permutaciones de Lenguaje Natural (NLP) inteligentemente basadas en tu memoria.
    const prefijos = ["quiero ver", "necesito", "ponme", "vamos a", "muéstrame", "arranca", "inicia", "reproduce"];
    
    for (let query of queries) {
        // Extraemos el concepto clave de lo que le pediste (eliminando ruido)
        let nucleo = query.replace(/(youtube|google|chat gpt|chatgpt|gemini|información sobre|información|informacion|en google|y busca|buscame|y pon|pregúntale sobre|estudio_)/gi, '').trim();
        
        if (nucleo.length > 2) {
            let actionDestino = memoria[query];
            
            // Generar variaciones sintácticas que un humano usaría
            let variaciones = [
                nucleo,
                `algo de ${nucleo}`,
                `sobre ${nucleo}`,
                `buscar ${nucleo}`
            ];

            variaciones.forEach(variacion => {
                let limpia = variacion.toLowerCase().replace(/['".,?!]/g, '').trim();
                
                // Si aún no hemos entrenado este comando exacto, lo guardamos
                if (!comandos[limpia] && limpia.length > 0) {
                    comandos[limpia] = actionDestino;
                    comandosNuevos++;
                }
                
                // Mezclamos con distintos verbos
                prefijos.forEach(pref => {
                    let frase = `${pref} ${limpia}`;
                    if (!comandos[frase]) {
                        comandos[frase] = actionDestino;
                        comandosNuevos++;
                    }
                });
            });
        }
    }

    if (comandosNuevos > 0) {
        if (!fs.existsSync(path.dirname(comandosFile))) {
            fs.mkdirSync(path.dirname(comandosFile), { recursive: true });
        }
        fs.writeFileSync(comandosFile, JSON.stringify(comandos, null, 2));
        console.log(`[Background Tuner] 🧠 ¡Estudio exitoso! He generado y aprendido ${comandosNuevos} nuevas variaciones lógicas de tus pedidos.\n`);
    } else {
        console.log("[Background Tuner] 🧠 Repaso completado. Ya domino la información con sus variaciones.\n");
    }
}

function startBackgroundStudying() {
    if (!fs.existsSync(memoriaFile)) return;

    // Solo estudiar cuando la memoria cambió desde la última generación. El antiguo
    // intervalo horario despertaba el equipo incluso cuando no había nada nuevo.
    const memoryChanged = !fs.existsSync(comandosFile)
        || fs.statSync(memoriaFile).mtimeMs > fs.statSync(comandosFile).mtimeMs;
    if (!memoryChanged) return;

    const timer = setTimeout(studyAndOptimize, 8000);
    timer.unref();
}

module.exports = {
    startBackgroundStudying,
    studyAndOptimize
};
