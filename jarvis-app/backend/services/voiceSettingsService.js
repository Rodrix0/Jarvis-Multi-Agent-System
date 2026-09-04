const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = process.env.JARVIS_VOICE_SETTINGS_PATH || path.join(__dirname, '..', 'data', 'voice_settings.json');
const DEFAULTS = Object.freeze({
    engine: 'browser-general',
    localEngineEnabled: true,
    localContextEnabled: true,
    localDeviceIndex: null,
    whisperModel: 'turbo',
    whisperDevice: 'cuda',
    vadAggressiveness: 2,
    speechStartFrames: 3,
    endSilenceMs: 1350,
    preRollMs: 450,
    maxUtteranceSeconds: 45,
    language: 'es-AR',
    microphoneId: '',
    microphoneLabel: 'Micrófono predeterminado',
    confidenceThreshold: 0.58,
    localConfidenceThreshold: 0.68,
    agreementThreshold: 0.42,
    noiseFloor: 0.015,
    proximityMultiplier: 1.65,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    confirmUncertain: false,
    cloudContextEnabled: false
});

function get() {
    try {
        if (!fs.existsSync(SETTINGS_PATH)) return { ...DEFAULTS };
        return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
    } catch (error) {
        console.error('[Voz] Configuración inválida:', error.message);
        return { ...DEFAULTS };
    }
}

function save(patch = {}) {
    const current = get();
    const next = {
        ...current,
        microphoneId: String(patch.microphoneId ?? current.microphoneId).slice(0, 300),
        microphoneLabel: String(patch.microphoneLabel ?? current.microphoneLabel).slice(0, 200),
        localEngineEnabled: boolean(patch.localEngineEnabled, current.localEngineEnabled),
        localContextEnabled: boolean(patch.localContextEnabled, current.localContextEnabled),
        localDeviceIndex: patch.localDeviceIndex === null || patch.localDeviceIndex === '' ? null : clamp(patch.localDeviceIndex, current.localDeviceIndex, 0, 999),
        whisperModel: ['base', 'small', 'medium', 'large-v3', 'turbo'].includes(patch.whisperModel) ? patch.whisperModel : current.whisperModel,
        whisperDevice: ['auto', 'cpu', 'cuda'].includes(patch.whisperDevice) ? patch.whisperDevice : current.whisperDevice,
        vadAggressiveness: clamp(patch.vadAggressiveness, current.vadAggressiveness, 0, 3),
        speechStartFrames: clamp(patch.speechStartFrames, current.speechStartFrames, 1, 10),
        endSilenceMs: clamp(patch.endSilenceMs, current.endSilenceMs, 450, 2500),
        preRollMs: clamp(patch.preRollMs, current.preRollMs, 150, 1000),
        maxUtteranceSeconds: clamp(patch.maxUtteranceSeconds, current.maxUtteranceSeconds, 5, 60),
        confidenceThreshold: clamp(patch.confidenceThreshold, current.confidenceThreshold, 0, 1),
        localConfidenceThreshold: clamp(patch.localConfidenceThreshold, current.localConfidenceThreshold, 0, 1),
        agreementThreshold: clamp(patch.agreementThreshold, current.agreementThreshold, 0, 1),
        noiseFloor: clamp(patch.noiseFloor, current.noiseFloor, 0, 1),
        proximityMultiplier: clamp(patch.proximityMultiplier, current.proximityMultiplier, 1.05, 8),
        echoCancellation: boolean(patch.echoCancellation, current.echoCancellation),
        noiseSuppression: boolean(patch.noiseSuppression, current.noiseSuppression),
        autoGainControl: boolean(patch.autoGainControl, current.autoGainControl),
        confirmUncertain: boolean(patch.confirmUncertain, current.confirmUncertain),
        cloudContextEnabled: false,
        updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
    return next;
}

function clamp(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function boolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

module.exports = { get, save };
