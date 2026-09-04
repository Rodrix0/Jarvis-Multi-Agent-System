const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const trashService = require('../core/trashService');
const securityPolicyService = require('../core/securityPolicyService');

class FileService {
    searchFiles(query, extension = null, baseDir = null) {
        const root = baseDir || os.homedir();
        const extFilter = extension ? `*.${extension.replace(/^\./, '')}` : '*.*';
        const cleanQuery = String(query || '').replace(/['"]/g, '').trim();

        const script = `
            Get-ChildItem -Path '${root.replace(/\\/g, '\\\\')}' -Filter '${extFilter}' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*${cleanQuery}*' } |
            Select-Object -First 10 -Property FullName, Name, Length, LastWriteTime |
            ConvertTo-Json
        `;

        try {
            const out = execSync(`powershell.exe -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, { timeout: 12000 }).toString().trim();
            if (!out) return { ok: true, files: [], message: `No se encontraron archivos que coincidan con "${query}".` };

            const data = JSON.parse(out);
            const files = Array.isArray(data) ? data : [data];
            const summary = files.map(f => `• ${f.Name} (${f.FullName})`).join('\n');

            return {
                ok: true,
                files,
                summary,
                message: `Encontré ${files.length} archivo(s):\n${summary}`
            };
        } catch (err) {
            return { ok: false, code: 'ERR_SEARCH_FAILED', message: err.message };
        }
    }

    moveFile(sourcePath, destinationPath) {
        const secSrc = securityPolicyService.validatePathAccess(sourcePath, true);
        if (!secSrc.allowed) return { ok: false, code: secSrc.code, message: secSrc.reason };
        const secDst = securityPolicyService.validatePathAccess(destinationPath, false);
        if (!secDst.allowed) return { ok: false, code: secDst.code, message: secDst.reason };

        if (!fs.existsSync(sourcePath)) {
            return { ok: false, code: 'ERR_SOURCE_NOT_FOUND', message: `El archivo origen ${sourcePath} no existe.` };
        }

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.renameSync(sourcePath, destinationPath);

        return {
            ok: true,
            source: sourcePath,
            destination: destinationPath,
            message: `Archivo movido con éxito a: ${destinationPath}`
        };
    }

    copyFile(sourcePath, destinationPath) {
        if (!fs.existsSync(sourcePath)) {
            return { ok: false, code: 'ERR_SOURCE_NOT_FOUND', message: `El archivo origen ${sourcePath} no existe.` };
        }

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);

        return {
            ok: true,
            source: sourcePath,
            destination: destinationPath,
            message: `Copia creada con éxito en: ${destinationPath}`
        };
    }

    renameFile(filePath, newName) {
        const sec = securityPolicyService.validatePathAccess(filePath, true);
        if (!sec.allowed) return { ok: false, code: sec.code, message: sec.reason };

        if (!fs.existsSync(filePath)) {
            return { ok: false, code: 'ERR_FILE_NOT_FOUND', message: `El archivo ${filePath} no existe.` };
        }

        const dir = path.dirname(filePath);
        const destination = path.join(dir, newName);
        fs.renameSync(filePath, destination);

        return {
            ok: true,
            oldPath: filePath,
            newPath: destination,
            message: `Archivo renombrado a: ${newName}`
        };
    }

    deleteFile(filePath) {
        return trashService.moveToTrash(filePath);
    }
}

const fileService = new FileService();
module.exports = fileService;
