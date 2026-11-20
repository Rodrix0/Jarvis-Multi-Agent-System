const path = require('path');

// The installed app stores private data outside its program directory.
// Resolve the physical folder directly so Windows directory junctions are
// only a compatibility path for older Python and PowerShell helpers.
const dataDir = path.resolve(process.env.JARVIS_DATA_DIR || path.join(__dirname, '..', 'data'));

module.exports = { dataDir, dataPath: (...parts) => path.join(dataDir, ...parts) };
