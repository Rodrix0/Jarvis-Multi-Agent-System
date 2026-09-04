const fs = require('fs');
const path = require('path');
const watchdogService = require('../core/watchdogService');
const toolRegistryService = require('../core/toolRegistryService');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'data', 'broadlink.json');

class TVService {
    constructor() {
        this.estimatedState = 'OFF'; // 'OFF', 'BOOTING', 'HOME', 'NETFLIX', 'YOUTUBE', 'PLAYING'
        this.confirmedState = 'UNKNOWN';
        this.activeApp = null;
    }

    async isAvailable() {
        if (watchdogService.isCircuitOpen('broadlink')) {
            toolRegistryService.setToolHealth('tv.search', 'CIRCUIT_OPEN');
            return false;
        }

        try {
            if (!fs.existsSync(CONFIG_PATH)) return false;
            const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            const isOk = Boolean(cfg.device?.host);
            toolRegistryService.setToolHealth('tv.search', isOk ? 'AVAILABLE' : 'OFFLINE');
            return isOk;
        } catch (e) {
            watchdogService.recordServiceFailure('broadlink', e.message);
            toolRegistryService.setToolHealth('tv.search', 'OFFLINE');
            return false;
        }
    }

    async sendKey(keyName) {
        const available = await this.isAvailable();
        if (!available) {
            return { ok: false, code: 'ERR_TV_OFFLINE', message: 'BroadLink no está disponible o el circuito está abierto.' };
        }

        console.log(`[TVService] 📺 Tecla IR emitida: [${keyName}] (Estado estimado previo: ${this.estimatedState})`);
        return { ok: true, key: keyName, estimatedState: this.estimatedState };
    }

    async openApp(appName) {
        const clean = String(appName || '').toLowerCase();
        this.estimatedState = clean.includes('youtube') ? 'YOUTUBE' : 'NETFLIX';
        this.activeApp = this.estimatedState;

        console.log(`[TVService] 📺 Controlando TV para abrir ${this.activeApp}. Estado estimado: ${this.estimatedState}`);
        return { ok: true, app: this.activeApp, estimatedState: this.estimatedState, message: `Controlando televisión para abrir ${this.activeApp}.` };
    }

    resyncHome() {
        this.estimatedState = 'HOME';
        this.activeApp = null;
        console.log('[TVService] 📺 Secuencia de resincronización enviada. Estado forzado a: HOME.');
        return { ok: true, estimatedState: 'HOME', message: 'Televisión resincronizada a la pantalla principal.' };
    }
}

const tvService = new TVService();
module.exports = tvService;
