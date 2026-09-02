const os = require('os');
const databaseService = require('../persistence/databaseService');
const eventBus = require('./eventBusService');

class HealthService {
    constructor() {
        this.metrics = {
            intentLatencies: [],
            aiLatencies: [],
            errorCount: 0,
            executionCount: 0,
            circuitBreakers: {}
        };
    }

    recordMetric(type, value) {
        if (type === 'intentLatency') {
            this.metrics.intentLatencies.push(value);
            if (this.metrics.intentLatencies.length > 50) this.metrics.intentLatencies.shift();
        } else if (type === 'aiLatency') {
            this.metrics.aiLatencies.push(value);
            if (this.metrics.aiLatencies.length > 50) this.metrics.aiLatencies.shift();
        } else if (type === 'error') {
            this.metrics.errorCount++;
        } else if (type === 'execution') {
            this.metrics.executionCount++;
        }
    }

    async getSystemHealth() {
        let dbOk = false;
        try {
            const check = databaseService.db.prepare('SELECT 1 AS ok').get();
            dbOk = Boolean(check && check.ok === 1);
        } catch (e) {
            dbOk = false;
        }

        const avgIntentLatency = this.metrics.intentLatencies.length > 0
            ? Math.round(this.metrics.intentLatencies.reduce((a, b) => a + b, 0) / this.metrics.intentLatencies.length)
            : 0;

        const avgAiLatency = this.metrics.aiLatencies.length > 0
            ? Math.round(this.metrics.aiLatencies.reduce((a, b) => a + b, 0) / this.metrics.aiLatencies.length)
            : 0;

        const freeMemMB = Math.round(os.freemem() / 1024 / 1024);
        const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
        const cpuUsage = os.loadavg()[0] || 0;

        return {
            status: dbOk ? 'HEALTHY' : 'DEGRADED',
            timestamp: new Date().toISOString(),
            database: { ok: dbOk, mode: 'WAL' },
            memory: { freeMB: freeMemMB, totalMB: totalMemMB, usedPercent: Math.round(((totalMemMB - freeMemMB) / totalMemMB) * 100) },
            cpu: { loadAvg: cpuUsage },
            metrics: {
                avgIntentLatencyMs: avgIntentLatency,
                avgAiLatencyMs: avgAiLatency,
                totalExecutions: this.metrics.executionCount,
                totalErrors: this.metrics.errorCount
            }
        };
    }
}

const healthService = new HealthService();
module.exports = healthService;
