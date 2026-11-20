const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const trashService = require('../core/trashService');
const securityPolicyService = require('../core/securityPolicyService');

class FileService {
    async searchFiles(query, extension = null, baseDir = null) {
        return require('../desktopContentService').search({ query, extension, baseDir });
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
        if (fs.existsSync(destinationPath)) return { ok: false, message: `Ya existe ${destinationPath}. Indicá otro destino.` };
        try { fs.renameSync(sourcePath, destinationPath); }
        catch (error) {
            if (error.code !== 'EXDEV' || !fs.statSync(sourcePath).isFile()) throw error;
            fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
            fs.unlinkSync(sourcePath);
        }

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
        fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);

        return {
            ok: true,
            source: sourcePath,
            destination: destinationPath,
            message: `Copia creada con éxito en: ${destinationPath}`
        };
    }

    renameFile(filePath, newName) {
        require('../core/fileOperationsService').validateName(String(newName || ''));
        const sec = securityPolicyService.validatePathAccess(filePath, true);
        if (!sec.allowed) return { ok: false, code: sec.code, message: sec.reason };

        if (!fs.existsSync(filePath)) {
            return { ok: false, code: 'ERR_FILE_NOT_FOUND', message: `El archivo ${filePath} no existe.` };
        }

        const dir = path.dirname(filePath);
        const destination = path.join(dir, newName);
        if (fs.existsSync(destination)) return { ok: false, message: `Ya existe ${destination}. Indicá otro nombre.` };
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
