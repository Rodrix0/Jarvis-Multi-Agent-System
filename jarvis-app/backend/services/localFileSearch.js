const fs = require('fs');
const os = require('os');
const path = require('path');
const ignored = new Set(['node_modules', '.git', '.venv', 'venv', 'voice_venv', '__pycache__', 'AppData', 'models', '$RECYCLE.BIN']);
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
async function find(query, options = {}) {
    const roots = options.roots || ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'OneDrive'].map(dir => path.join(os.homedir(), dir));
    const needle = normalize(query.replace(/^(?:el |la )?(?:archivo|documento|carpeta)\s+/i, '').replace(/^"|"$/g, '').trim());
    if (!needle) return null;
    const deadline = Date.now() + (options.timeoutMs || 2500);
    const queue = roots.map(dir => ({ dir, depth: 0 }));
    let seen = 0;
    while (queue.length && Date.now() < deadline && seen < 30000) {
        const { dir, depth } = queue.shift();
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            seen++;
            const full = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) continue;
            const name = normalize(entry.name);
            if (name === needle || (!entry.isDirectory() && normalize(path.parse(entry.name).name) === needle)) return full;
            if (entry.isDirectory() && depth < 7 && !ignored.has(entry.name)) queue.push({ dir: full, depth: depth + 1 });
        }
    }
    return null;
}
module.exports = { find };
