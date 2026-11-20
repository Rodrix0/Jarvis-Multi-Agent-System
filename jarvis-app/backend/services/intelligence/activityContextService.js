/**
 * activityContextService.js
 * 
 * Motor de Contexto de Actividad en Tiempo Real para JARVIS.
 * 
 * Capacidades:
 * - Detección y parseo de App activa (Unity, VS Code, Chrome, etc.)
 * - Extracción precisa de Archivo activo (e.g. Forest_Main.unity, PlayerController.cs)
 * - Identificación de Proyecto activo y stack tecnológico
 * - Información del Monitor activo (resolución, pantalla primaria/secundaria)
 * - Contexto cronológico y fase del día (MADRUGADA, MAÑANA, TARDE, NOCHE)
 * - Dispositivos cercanos y domótica conectada
 * - Resolución de Pronombres y Comandos Implícitos ("Compilalo", "Guardalo", "Cerralo")
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const eventBus = require('../core/eventBusService');

const PS_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'getActivityContext.ps1');

class ActivityContextService {
    constructor() {
        this.psScriptPath = PS_SCRIPT_PATH;
        this.lastContext = null;
        this.lastFetchMs = 0;
        this.cacheTtlMs = 800; // Caché ultra-rápida de 800ms
    }

    /**
     * Consulta el sistema operativo Windows para obtener la ventana activa.
     */
    _fetchRawWindowInfo() {
        if (!fs.existsSync(this.psScriptPath)) {
            return { Title: '', ProcessName: '', ProcessId: 0, Hwnd: 0, Monitor: { Width: 1920, Height: 1080, IsPrimary: true } };
        }

        try {
            const stdout = execSync(`powershell -ExecutionPolicy Bypass -File "${this.psScriptPath}"`, {
                stdio: ['pipe', 'pipe', 'pipe'],
                encoding: 'utf8',
                windowsHide: true,
                timeout: 3000
            });
            return JSON.parse(stdout.trim());
        } catch {
            return { Title: '', ProcessName: '', ProcessId: 0, Hwnd: 0, Monitor: { Width: 1920, Height: 1080, IsPrimary: true } };
        }
    }

    /**
     * Parsea el título y proceso de la ventana para extraer aplicación, archivo y proyecto.
     */
    parseWindowContext(rawTitle = '', processName = '') {
        const title = String(rawTitle || '').trim();
        const proc = String(processName || '').toLowerCase();

        let app = 'Desconocido';
        let file = null;
        let project = null;
        let stack = 'general';

        // 1. Identificación de la Aplicación
        if (proc.includes('unity') || title.includes('Unity')) {
            app = 'Unity';
            stack = 'unity_csharp';
        } else if (proc.includes('code') || title.includes('Visual Studio Code')) {
            app = 'Visual Studio Code';
            stack = 'development';
        } else if (proc.includes('devenv') || title.includes('Visual Studio')) {
            app = 'Visual Studio';
            stack = 'dotnet_csharp';
        } else if (proc.includes('chrome')) {
            app = 'Google Chrome';
            stack = 'web';
        } else if (proc.includes('firefox') || proc.includes('msedge')) {
            app = 'Navegador Web';
            stack = 'web';
        } else if (proc.includes('spotify') || title.includes('Spotify')) {
            app = 'Spotify';
            stack = 'media';
        } else if (proc.includes('winword') || title.includes('Word')) {
            app = 'Microsoft Word';
            stack = 'documents';
        } else if (proc.includes('cmd') || proc.includes('powershell') || proc.includes('windowsterminal')) {
            app = 'Terminal';
            stack = 'terminal';
        } else if (title.length > 0) {
            app = title.split('-').pop()?.trim() || proc || 'Aplicación';
        }

        // 2. Extracción de Archivo Activo por regex de extensiones
        // e.g. Forest_Main.unity, PlayerController.cs, index.js, script.py, Documento.docx
        const fileMatch = title.match(/([\w.-]+\.(unity|cs|js|ts|jsx|tsx|py|cpp|c|h|java|json|md|html|css|docx|xlsx|txt|asset|prefab))/i);
        if (fileMatch) {
            file = {
                name: fileMatch[1],
                extension: `.${fileMatch[2].toLowerCase()}`
            };
        }

        // 3. Extracción de Proyecto
        if (app === 'Unity') {
            // Unity Title format: Unity 2022.3.x - Forest_Main.unity - MyGameProject - PC, Mac...
            const parts = title.split('-').map(p => p.trim());
            if (parts.length >= 3) {
                project = parts[2];
            } else if (parts.length >= 2) {
                project = parts[1];
            }
        } else if (app === 'Visual Studio Code') {
            // VS Code: filename - project - Visual Studio Code
            const parts = title.split(' - ');
            if (parts.length >= 3) {
                project = parts[parts.length - 2].trim();
            } else if (parts.length >= 2 && !parts[0].includes('.')) {
                project = parts[0].trim();
            }
        }

        return {
            app,
            processName: proc || null,
            file: file ? file.name : null,
            fileExtension: file ? file.extension : null,
            project,
            stack
        };
    }

    /**
     * Calcula el contexto temporal (hora, momento del día, día de semana).
     */
    getTimeContext() {
        const now = new Date();
        const hour = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const formatted = `${String(hour).padStart(2, '0')}:${minutes}`;

        let phase = 'MAÑANA';
        if (hour >= 0 && hour < 6) phase = 'MADRUGADA';
        else if (hour >= 6 && hour < 13) phase = 'MAÑANA';
        else if (hour >= 13 && hour < 20) phase = 'TARDE';
        else phase = 'NOCHE';

        const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const dayOfWeek = days[now.getDay()];
        const isWeekend = now.getDay() === 0 || now.getDay() === 6;

        return {
            iso: now.toISOString(),
            formatted,
            hour,
            phase,
            dayOfWeek,
            isWeekend
        };
    }

    /**
     * Obtiene los dispositivos cercanos en la red o conectados.
     */
    async getNearbyDevices() {
        const devices = [];
        try {
            const tvService = require('../tvService');
            const tvStatus = tvService.getStatus?.() || { power: 'UNKNOWN' };
            devices.push({ type: 'tv', name: 'Smart TV Living', status: tvStatus.power });
        } catch {}

        try {
            const homeAssistant = require('../homeassistant/homeAssistantService');
            const haStatus = homeAssistant.getStatus?.();
            devices.push({ type: 'iot_hub', name: 'Home Assistant', status: haStatus?.connected ? 'ONLINE' : 'STANDBY' });
        } catch {}

        return devices;
    }

    /**
     * Obtiene la instantánea global completa del contexto de actividad actual.
     */
    async getCurrentContext(mockWindow = null) {
        const now = Date.now();
        if (!mockWindow && this.lastContext && (now - this.lastFetchMs < this.cacheTtlMs)) {
            return this.lastContext;
        }

        const raw = mockWindow || this._fetchRawWindowInfo();
        const parsed = this.parseWindowContext(raw.Title, raw.ProcessName);
        const time = this.getTimeContext();
        const devices = await this.getNearbyDevices();

        const context = {
            title: raw.Title || 'Sin ventana activa',
            app: parsed.app,
            process: parsed.processName,
            file: parsed.file,
            fileExtension: parsed.fileExtension,
            project: parsed.project,
            stack: parsed.stack,
            monitor: {
                width: raw.Monitor?.Width || 1920,
                height: raw.Monitor?.Height || 1080,
                isPrimary: raw.Monitor?.IsPrimary !== false,
                resolution: `${raw.Monitor?.Width || 1920}x${raw.Monitor?.Height || 1080}`
            },
            time,
            devices,
            timestamp: new Date().toISOString()
        };

        if (!mockWindow) {
            this.lastContext = context;
            this.lastFetchMs = now;
        }

        return context;
    }

    /**
     * Resuelve comandos con pronombres o instrucciones deícticas implícitas
     * (e.g. "compilalo", "guardalo", "cerralo", "ejecutalo", "corregilo").
     */
    async resolveImplicitCommand(utterance, contextOverride = null) {
        const text = String(utterance || '').toLowerCase().trim();
        const ctx = contextOverride || await this.getCurrentContext();

        // 1. Intención: Compilar ("compilalo", "compila", "build")
        if (text.includes('compilalo') || text.includes('compila') || text.includes('build')) {
            const targetProject = ctx.project || 'Proyecto Activo';
            const targetFile = ctx.file || 'archivo principal';
            return {
                ok: true,
                isImplicit: true,
                intent: 'COMPILE',
                actionId: 'code.autonomous_fix',
                target: {
                    app: ctx.app,
                    file: targetFile,
                    project: targetProject,
                    stack: ctx.stack
                },
                resolvedInstruction: `Compilar el proyecto '${targetProject}' enfocado en '${targetFile}' (${ctx.app}).`,
                message: `Detecté que estás en ${ctx.app} con ${targetFile}. Iniciando compilación de ${targetProject}.`
            };
        }

        // 2. Intención: Corregir / Arreglar ("arreglalo", "corregilo", "fix")
        if (text.includes('arreglalo') || text.includes('corregilo') || text.includes('reparalo') || text.includes('fix')) {
            const targetFile = ctx.file || 'código activo';
            return {
                ok: true,
                isImplicit: true,
                intent: 'AUTONOMOUS_FIX',
                actionId: 'code.autonomous_fix',
                target: {
                    app: ctx.app,
                    file: targetFile,
                    project: ctx.project
                },
                resolvedInstruction: `Reparar errores autónomamente en '${targetFile}'.`,
                message: `Iniciando auto-reparación sobre ${targetFile} en ${ctx.app}.`
            };
        }

        // 3. Intención: Cerrar ("cerralo", "cerra esto", "cerrar")
        if (text.includes('cerralo') || text.includes('cerra esto') || text.includes('cerrar ventana')) {
            return {
                ok: true,
                isImplicit: true,
                intent: 'CLOSE_WINDOW',
                actionId: 'window.close',
                target: {
                    app: ctx.app,
                    title: ctx.title
                },
                resolvedInstruction: `Cerrar la ventana activa de ${ctx.app}.`,
                message: `Cerrando ventana de ${ctx.app} (${ctx.title}).`
            };
        }

        // 4. Intención: Minimizar ("minimizalo")
        if (text.includes('minimizalo') || text.includes('ocultalo')) {
            return {
                ok: true,
                isImplicit: true,
                intent: 'MINIMIZE_WINDOW',
                actionId: 'window.minimize',
                target: {
                    app: ctx.app,
                    title: ctx.title
                },
                resolvedInstruction: `Minimizar la ventana activa de ${ctx.app}.`,
                message: `Minimizando ${ctx.app}.`
            };
        }

        // 5. Intención: Guardar ("guardalo", "salvalo")
        if (text.includes('guardalo') || text.includes('salvalo') || text.includes('guarda')) {
            return {
                ok: true,
                isImplicit: true,
                intent: 'SAVE_DOCUMENT',
                actionId: 'file.save_active',
                target: {
                    app: ctx.app,
                    file: ctx.file
                },
                resolvedInstruction: `Guardar cambios en '${ctx.file || ctx.app}'.`,
                message: `Guardando cambios en ${ctx.file || ctx.app}.`
            };
        }

        return {
            ok: false,
            isImplicit: false,
            message: `No se detectó un comando implícito deíctico en: "${utterance}".`
        };
    }
}

const activityContextService = new ActivityContextService();

module.exports = {
    ActivityContextService,
    activityContextService
};
