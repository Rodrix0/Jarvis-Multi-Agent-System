const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const COMMANDS_PATH = path.join(DATA_DIR, 'comandos.json');
const MEMORY_PATH = path.join(DATA_DIR, 'memoria.json');
const ARCHIVE_PATH = path.join(DATA_DIR, 'comandos.generated.archive.json');
const PREFIXES = ['quiero ver', 'necesito', 'ponme', 'vamos a', 'muéstrame', 'arranca', 'inicia', 'reproduce'];

function generatedKeys(memory) {
    const result = new Set();
    for (const query of Object.keys(memory || {})) {
        const core = query.replace(/(youtube|google|chat gpt|chatgpt|gemini|información sobre|información|informacion|en google|y busca|buscame|y pon|pregúntale sobre|estudio_)/gi, '').trim();
        if (core.length <= 2) continue;
        for (const variation of [core, `algo de ${core}`, `sobre ${core}`, `buscar ${core}`]) {
            const clean = variation.toLowerCase().replace(/['".,?!]/g, '').trim();
            if (!clean) continue;
            result.add(clean);
            for (const prefix of PREFIXES) result.add(`${prefix} ${clean}`);
        }
    }
    return result;
}

function migrate({ apply = false } = {}) {
    const commands = fs.existsSync(COMMANDS_PATH) ? JSON.parse(fs.readFileSync(COMMANDS_PATH, 'utf8')) : {};
    const memory = fs.existsSync(MEMORY_PATH) ? JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8')) : {};
    const generated = generatedKeys(memory);
    const archived = {};
    const preserved = {};
    for (const [key, value] of Object.entries(commands)) {
        if (generated.has(key)) archived[key] = value;
        else preserved[key] = value;
    }
    const report = {
        memoryEntries: Object.keys(memory).length,
        total: Object.keys(commands).length,
        generated: Object.keys(archived).length,
        preserved: Object.keys(preserved).length,
        preservedKeys: Object.keys(preserved).slice(0, 30)
    };
    if (apply && Object.keys(archived).length) {
        fs.writeFileSync(ARCHIVE_PATH, JSON.stringify({ archivedAt: new Date().toISOString(), commands: archived }, null, 2));
        fs.writeFileSync(COMMANDS_PATH, JSON.stringify(preserved, null, 2));
    }
    return report;
}

if (require.main === module) {
    const apply = process.argv.includes('--apply');
    console.log(JSON.stringify(migrate({ apply }), null, 2));
}

module.exports = { migrate, generatedKeys };
