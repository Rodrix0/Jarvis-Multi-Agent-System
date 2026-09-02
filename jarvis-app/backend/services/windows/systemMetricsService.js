const { execSync } = require('child_process');
const os = require('os');

class SystemMetricsService {
    getDiskSpace() {
        const script = `
            Get-PSDrive -PSProvider FileSystem | 
            Select-Object Name, @{Name="Free_GB";Expression={[math]::Round($_.Free / 1GB, 1)}}, @{Name="Total_GB";Expression={[math]::Round(($_.Used + $_.Free) / 1GB, 1)}} | 
            ConvertTo-Json
        `;
        try {
            const out = execSync(`powershell.exe -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, { timeout: 6000 }).toString().trim();
            const list = JSON.parse(out);
            const array = Array.isArray(list) ? list : [list];
            const summary = array.map(d => `• Disco ${d.Name}:: ${d.Free_GB} GB libres de ${d.Total_GB} GB`).join('\n');
            return {
                ok: true,
                disks: array,
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
