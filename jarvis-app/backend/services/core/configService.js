const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'config.json');

const DEFAULT_CONFIG = {
    system: {
        env: 'production',
        port: 3000,
        locale: 'es-AR',
        safeMode: false
    },
    features: {
        whatsappEnabled: true,
        emailEnabled: true,
        broadlinkEnabled: true,
        androidTvEnabled: false,
        sandboxEnabled: true,
        quietModeEnabled: false,
        proactiveEnabled: true
    },
    timeouts: {
        powershellMs: 15000,
        pythonMs: 30000,
        ollamaMs: 45000,
        downloadMs: 120000
    },
    budgets: {
        maxSteps: 20,
        maxRuntimeMs: 120000,
        maxLLMCalls: 5,
        maxRetries: 2,
        maxParallelTasks: 3,
        maxPlanRevisions: 3
    }
};

class ConfigService {
    constructor() {
        this.config = this.loadConfig();
    }

    loadConfig() {
        if (!fs.existsSync(CONFIG_FILE)) {
            fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
            return DEFAULT_CONFIG;
        }

        try {
            const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            return this.validateAndMerge(raw);
        } catch (err) {
            console.error('[Config] Error leyendo config.json, usando valores por defecto:', err.message);
            return DEFAULT_CONFIG;
        }
    }

    validateAndMerge(userConfig) {
        return {
            system: { ...DEFAULT_CONFIG.system, ...(userConfig.system || {}) },
            features: { ...DEFAULT_CONFIG.features, ...(userConfig.features || {}) },
            timeouts: { ...DEFAULT_CONFIG.timeouts, ...(userConfig.timeouts || {}) },
            budgets: { ...DEFAULT_CONFIG.budgets, ...(userConfig.budgets || {}) }
        };
    }

    get(pathKey, defaultValue = null) {
        const parts = pathKey.split('.');
        let current = this.config;
        for (const p of parts) {
            if (current && typeof current === 'object' && p in current) {
                current = current[p];
            } else {
                return defaultValue;
            }
        }
        return current;
    }

    isFeatureEnabled(featureName) {
        return Boolean(this.get(`features.${featureName}`, false));
    }

    update(partialConfig) {
        this.config = this.validateAndMerge({ ...this.config, ...partialConfig });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
        return this.config;
    }
}

const configService = new ConfigService();
module.exports = configService;
