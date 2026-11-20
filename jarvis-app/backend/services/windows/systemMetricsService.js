const { execSync } = require('child_process');
const os = require('os');

class SystemMetricsService {
    getDiskSpace() {
        try {
            const fs = require('fs');
            const driveLetters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
            const disks = [];

            for (const letter of driveLetters) {
                try {
                    const root = `${letter}:\\`;
                    const stat = fs.statfsSync(root);
                    if (stat && stat.blocks > 0) {
                        const totalGB = Math.round((Number(stat.blocks) * Number(stat.bsize) / (1024 * 1024 * 1024)) * 10) / 10;
                        const freeGB = Math.round((Number(stat.bavail) * Number(stat.bsize) / (1024 * 1024 * 1024)) * 10) / 10;
                        disks.push({ Name: letter, Free_GB: freeGB, Total_GB: totalGB });
                    }
                } catch (_) {}
            }

            if (disks.length === 0) {
                disks.push({ Name: 'C', Free_GB: 0, Total_GB: 0 });
            }

            const summary = disks.map(d => `• Disco ${d.Name}: ${d.Free_GB} GB libres de ${d.Total_GB} GB`).join('\n');
            return {
                ok: true,
                disks,
                summary,
                message: `Estado del almacenamiento:\n${summary}`
            };
        } catch (err) {
            return { ok: false, code: 'ERR_DISK_METRICS', message: err.message };
        }
    }

    getSystemOverview() {
        const disk = this.getDiskSpace();
        const freeMemMB = Math.round(os.freemem() / 1024 / 1024);
        const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);

        return {
            ok: true,
            memory: { freeMB: freeMemMB, totalMB: totalMemMB, usedPercent: Math.round(((totalMemMB - freeMemMB) / totalMemMB) * 100) },
            disks: disk.disks || [],
            summary: `Memoria RAM: ${freeMemMB} MB libres de ${totalMemMB} MB.\n${disk.summary || ''}`
        };
    }
}

const systemMetricsService = new SystemMetricsService();
module.exports = systemMetricsService;
