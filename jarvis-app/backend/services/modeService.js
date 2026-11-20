const fs = require('fs');
const path = require('path');

const modesFilePath = require("./dataPaths").dataPath("modes.json");

function getModesData() {
    try {
        const data = fs.readFileSync(modesFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Error al leer modes.json:", err);
        return { activeMode: "productividad", modes: [] };
    }
}

function saveModesData(data) {
    fs.writeFileSync(modesFilePath, JSON.stringify(data, null, 2));
}

function getAllModes() {
    return getModesData().modes;
}

function getActiveMode() {
    const data = getModesData();
    return data.modes.find(m => m.id === data.activeMode) || data.modes[0];
}

function setActiveMode(modeId) {
    const data = getModesData();
    const exists = data.modes.some(m => m.id === modeId);
    if (exists) {
        data.activeMode = modeId;
        saveModesData(data);
        return true;
    }
    return false;
}

function addMode(mode) {
    const data = getModesData();
    mode.id = mode.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    if (!mode.prompt) {
        mode.prompt = `Eres Jarvis, un asistente virtual. Trabajas bajo el modo ${mode.name}. Por favor, compórtate y responde basado en la siguiente instrucción principal: ${mode.description}`;
    }
    
    data.modes.push(mode);
    saveModesData(data);
    return mode;
}

module.exports = {
    getAllModes,
    getActiveMode,
    setActiveMode,
    addMode
};
