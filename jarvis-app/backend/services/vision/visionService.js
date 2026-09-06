const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CAPTURE_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'takeScreenshot.ps1');
const OCR_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'runWindowsOcr.ps1');
const TEMP_IMAGE = path.join(__dirname, '..', '..', 'data', 'last_screen_capture.png');

const ERROR_REGEX = /\b(error|exception|failed|fallo|crash|fatal|nullreference|unhandled|linea?\s*\d+|warning|advertencia|syntaxerror|typeerror|referenceerror|rejection|build failed)\b/i;

class VisionService {
    constructor() {
        this.lastCaptureTime = 0;
        this.lastContext = null;
    }

    /**
     * Busca la captura más reciente generada en el Escritorio (Captura_*.png)
     */
    getLatestDesktopScreenshot() {
        const desktop = process.env.JARVIS_DESKTOP_DIR || path.join(require('os').homedir(), 'Desktop');
        try {
            if (!fs.existsSync(desktop)) return null;
            const files = fs.readdirSync(desktop)
                .filter(f => /^Captura_.*\.png$/i.test(f))
                .map(f => {
                    const full = path.join(desktop, f);
                    return { path: full, mtime: fs.statSync(full).mtimeMs };
                })
                .sort((a, b) => b.mtime - a.mtime);

            if (files.length > 0) {
                // Si fue creada en los últimos 30 minutos
                if (Date.now() - files[0].mtime < 30 * 60 * 1000) {
                    return files[0].path;
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Captura la pantalla actual y la guarda en la ruta especificada.
     */
    captureScreen(targetPath = TEMP_IMAGE) {
        try {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${CAPTURE_SCRIPT}" -FilePath "${targetPath}"`, { timeout: 8000 });
            if (fs.existsSync(targetPath)) {
                this.lastCaptureTime = Date.now();
                return { ok: true, imagePath: targetPath };
            }
            return { ok: false, error: 'El archivo de captura no se creó.' };
        } catch (err) {
            console.error('[VisionService] Error en captura de pantalla:', err.message);
            return { ok: false, error: err.message };
        }
    }

    /**
     * Extrae texto visible de una imagen usando el motor OCR nativo de Windows 11.
     */
    extractText(imagePath = TEMP_IMAGE) {
        try {
            if (!fs.existsSync(imagePath)) {
                return { ok: false, error: `Imagen no encontrada: ${imagePath}` };
            }

            const rawOut = execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${OCR_SCRIPT}" -ImagePath "${imagePath}"`, { timeout: 10000 }).toString().trim();
            const parsed = JSON.parse(rawOut);
            return parsed;
        } catch (err) {
            console.error('[VisionService] Error en OCR de Windows:', err.message);
            return { ok: false, error: err.message, lines: [], text: '' };
        }
    }

    /**
     * Obtiene el título de la ventana activa en primer plano.
     */
    getActiveWindowTitle() {
        const script = `
            try {
                Add-Type -TypeDefinition @"
                using System;
                using System.Text;
                using System.Runtime.InteropServices;
                public class WinFore {
                    [DllImport("user32.dll")]
                    public static extern IntPtr GetForegroundWindow();
                    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
                    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
                }
"@ -ErrorAction SilentlyContinue

                $h = [WinFore]::GetForegroundWindow()
                if ($h -ne [IntPtr]::Zero) {
                    $sb = New-Object System.Text.StringBuilder 256
                    [WinFore]::GetWindowText($h, $sb, 256) | Out-Null
                    Write-Output $sb.ToString()
                }
            } catch {
                Write-Output ""
            }
        `;
        try {
            const buf = Buffer.from(script, 'utf16le');
            const base64 = buf.toString('base64');
            const out = execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${base64}`, { timeout: 4000 }).toString().trim();
            return out || 'Escritorio de Windows';
        } catch {
            return 'Escritorio de Windows';
        }
    }

    /**
     * Inspección completa de pantalla: captura + OCR + filtrado de errores.
     */
    async inspectScreen(customImagePath = null, userQuestion = '') {
        let imagePath = customImagePath;

        if (!imagePath) {
            const asksAboutCapture = /captura|screenshot|foto|imagen/i.test(userQuestion);
            const latestDesktop = this.getLatestDesktopScreenshot();

            if (asksAboutCapture && latestDesktop) {
                imagePath = latestDesktop;
            } else {
                const cap = this.captureScreen();
                if (!cap.ok && latestDesktop) {
                    imagePath = latestDesktop;
                } else if (cap.ok) {
                    imagePath = cap.imagePath;
                } else {
                    return {
                        ok: false,
                        error: cap.error,
                        activeWindow: this.getActiveWindowTitle(),
                        detectedErrors: [],
                        visibleText: ''
                    };
                }
            }
        }

        const activeWindow = this.getActiveWindowTitle();
        const ocr = this.extractText(imagePath);

        const lines = Array.isArray(ocr.lines) ? ocr.lines : [];
        const detectedErrors = [];

        for (const line of lines) {
            if (ERROR_REGEX.test(line)) {
                detectedErrors.push(line.trim());
            }
        }

        const result = {
            ok: ocr.ok !== false,
            imagePath,
            activeWindow,
            detectedErrors,
            visibleText: ocr.text || lines.join(' '),
            lines
        };

        this.lastContext = result;
        return result;
    }

    /**
     * Diagnostica lo que ocurre en pantalla utilizando el LLM local para responder preguntas como:
     * "Jarvis, fijate qué error salió" o "¿Qué dice la pantalla?".
     */
    async analyzeScreen(userQuestion = '¿Qué error o situación aparece en la pantalla?', customImagePath = null) {
        const context = await this.inspectScreen(customImagePath, userQuestion);

        const errorsSummary = context.detectedErrors.length > 0
            ? context.detectedErrors.map(e => `* ${e}`).join('\n')
            : '(No se detectaron palabras explícitas de excepción en el escaneo directo)';

        const screenContextFormatted = [
            `[CONTEXTO VISUAL Y OCR DE LA PANTALLA O CAPTURA]`,
            `- Archivo analizado: ${context.imagePath || 'pantalla actual'}`,
            `- Ventana activa: ${context.activeWindow}`,
            `- Posibles errores detectados:\n${errorsSummary}`,
            `- Líneas de texto extraídas por OCR:\n${context.lines.slice(0, 30).map(l => `* ${l}`).join('\n')}`,
            `------------------------------------------------------------`
        ].join('\n');

        const prompt = `${screenContextFormatted}\n\nEl usuario preguntó: "${userQuestion}".\nTAREA: Responde con precisión a lo que pide el usuario basándote en la ventana activa y el texto extraído por OCR de la captura. Si pregunta qué dice la captura o pantalla, lista y resume los textos, pestañas o elementos principales detectados. Si pregunta por un error, explica la causa y la solución paso a paso. Sé conciso, directo y llámalo "señor".`;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);

            const response = await fetch('http://127.0.0.1:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: process.env.OLLAMA_MODEL || 'hermes3:latest',
                    messages: [
                        { role: 'system', content: 'Eres Jarvis. Eres un experto en soporte técnico, programación y diagnóstico en Windows. Responde de forma concisa y directa al usuario.' },
                        { role: 'user', content: prompt }
                    ],
                    stream: false
                }),
                signal: controller.signal
            });

            clearTimeout(timer);

            if (response.ok) {
                const data = await response.json();
                if (data.message?.content && data.message.content.trim()) {
                    return {
                        ok: true,
                        reply: data.message.content.trim(),
                        context
                    };
                }
            }
        } catch (e) {
            console.warn('[VisionService] Error o timeout en Ollama para análisis visual:', e.message);
        }

        // Fallback heurístico inmediato si Ollama no respondiera
        let fallbackReply = `Señor, en la captura (ventana "${context.activeWindow}"):`;
        if (context.detectedErrors.length > 0) {
            fallbackReply += ` detecté el siguiente error: "${context.detectedErrors.join(' | ')}".`;
        } else if (context.lines && context.lines.length > 0) {
            fallbackReply += ` se leen las siguientes pestañas y elementos: ${context.lines.slice(0, 10).join(', ')}.`;
        } else if (context.visibleText) {
            fallbackReply += ` el texto visible es: "${context.visibleText.slice(0, 250)}..."`;
        } else {
            fallbackReply += ` no se detectó texto legible en la captura actual.`;
        }

        return {
            ok: true,
            reply: fallbackReply,
            context
        };
    }
}

const visionService = new VisionService();
module.exports = visionService;
