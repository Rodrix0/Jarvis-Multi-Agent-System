const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FORGE_URL = 'http://127.0.0.1:7860';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const FORGE_BAT_PATH = process.env.JARVIS_FORGE_BAT || 'C:\\Users\\Rodrigo\\Desktop\\IA\\stable-diffusion-webui-forge\\webui-user.bat';
const UPLOAD_DIR = require("./dataPaths").dataPath("uploads");
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const FORGE_STDOUT_LOG = path.join(LOG_DIR, 'forge.out.log');
const FORGE_STDERR_LOG = path.join(LOG_DIR, 'forge.err.log');
const fetch = (url, options = {}) => globalThis.fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(options.method === 'POST' ? 180000 : 3000) });
let forgeStarting = null;
let forgeStartedByJarvis = false;
let forgeRootPid = null;
let forgeChild = null;
let forgeIdleTimer = null;
let activeImageJobs = 0;
const FORGE_IDLE_MS = Math.max(30000, Number(process.env.JARVIS_FORGE_IDLE_MS) || 120000);

function publicImageUrl(filePath) {
    const name = path.basename(String(filePath || ''));
    if (!/^jarvis_(?:img|edit)_\d+\.png$/i.test(name)) throw new Error('La salida no es una imagen generada válida.');
    return `/api/generated-images/${encodeURIComponent(name)}`;
}

function enforceSpatialRelations(original, prepared) {
    let result = prepared;
    const source = String(original || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const celestialLocations = [
        ['luna', 'the Moon'], ['marte', 'Mars'], ['venus', 'Venus'], ['mercurio', 'Mercury'],
        ['jupiter', 'Jupiter'], ['saturno', 'Saturn'], ['urano', 'Uranus'], ['neptuno', 'Neptune']
    ];
    for (const [spanish, english] of celestialLocations) {
        if (!new RegExp(`\\ben\\s+(?:la\\s+|el\\s+)?${spanish}\\b`).test(source)) continue;
        if (spanish === 'luna') {
            result = result.replace(/\b(?:under|beneath)\s+(?:the\s+)?moon(?:lit\s+sky)?\b/gi, 'on the surface of the Moon');
        }
        const escaped = english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const isPhysicalLocation = new RegExp(`\\bon\\s+(?:the\\s+)?(?:surface\\s+of\\s+(?:the\\s+)?)?${escaped.replace(/^the\\s+/i, '')}\\b`, 'i').test(result);
        if (!isPhysicalLocation) result += `, physically on the surface of ${english}`;
    }
    return result;
}

function normalizeStyleText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function buildGenerationProfile(userPrompt, options = {}) {
    const source = normalizeStyleText(userPrompt);
    const artisticRequest = /\b(?:dibujo|dibujado|ilustracion|ilustrado|anime|manga|pintura|acuarela|oleo|comic|cartoon|render|3d|pixel art|arte abstracto)\b/.test(source);
    const photographicRequest = /\b(?:foto|fotografia|fotografico|fotorealista|fotorrealista|realista|photo|photograph|photorealistic)\b/.test(source);
    const photographic = photographicRequest || !artisticRequest;

    const explicitProfile = normalizeStyleText(options.quality || process.env.JARVIS_IMAGE_QUALITY);
    const asksFast = /\b(?:rapido|rapida|borrador|preview|vista previa)\b/.test(source);
    const asksMaximum = /\b(?:maxima calidad|calidad maxima|alta calidad|alta resolucion|4k|8k|uhd|ultra hd|ultra realista)\b/.test(source);
    const quality = /^(?:max|maxima|maximum|ultra)$/.test(explicitProfile) || asksMaximum
        ? 'maximum'
        : /^(?:fast|rapida|rapido|draft)$/.test(explicitProfile) || asksFast
            ? 'fast'
            : 'quality';

    const requestedSteps = Number(options.steps) || Number(process.env.JARVIS_IMAGE_STEPS);
    const defaultSteps = quality === 'maximum' ? 30 : quality === 'fast' ? 12 : photographic ? 24 : 20;
    const steps = Math.max(8, Math.min(40, requestedSteps || defaultSteps));
    const requestedOutput = Number(process.env.JARVIS_IMAGE_OUTPUT_SIZE) || 1024;
    const outputWidth = Math.max(512, Math.min(2048, Number(options.width) || requestedOutput));
    const outputHeight = Math.max(512, Math.min(2048, Number(options.height) || requestedOutput));
    const defaultBase = quality === 'maximum' ? Math.max(outputWidth, outputHeight) : quality === 'fast' ? 512 : photographic ? 768 : 640;
    const requestedBase = Number(process.env.JARVIS_IMAGE_BASE_SIZE) || defaultBase;
    const scale = Math.min(1, requestedBase / Math.max(outputWidth, outputHeight));
    const baseWidth = Math.max(512, Math.round((outputWidth * scale) / 64) * 64);
    const baseHeight = Math.max(512, Math.round((outputHeight * scale) / 64) * 64);

    if (photographic) {
        return {
            photographic,
            quality,
            steps,
            width: baseWidth,
            height: baseHeight,
            outputWidth: Math.round(outputWidth),
            outputHeight: Math.round(outputHeight),
            cfgScale: 5,
            qualitySuffix: ', photorealistic documentary photograph, true-to-life natural colors, balanced exposure, subtle contrast, physically accurate lighting, realistic anatomy, detailed natural textures, fine detail',
            negativePrompt: 'illustration, painting, drawing, anime, cartoon, CGI, 3d render, plastic texture, oversaturated colors, neon colors, excessive contrast, heavy HDR, halos, posterization, bad anatomy, deformed, blurred, text, watermark, duplicate, extra limbs'
        };
    }

    return {
        photographic,
        quality,
        steps,
        width: baseWidth,
        height: baseHeight,
        outputWidth: Math.round(outputWidth),
        outputHeight: Math.round(outputHeight),
        cfgScale: 5.5,
        qualitySuffix: ', coherent composition, balanced colors, controlled contrast, clean shapes, fine detail, high quality',
        negativePrompt: 'oversaturated colors, excessive contrast, heavy HDR, halos, posterization, bad anatomy, deformed, blurred, text, watermark, duplicate, extra limbs'
    };
}

async function upscaleBase64Image(base64Image, width, height) {
    const response = await fetch(`${FORGE_URL}/sdapi/v1/extra-single-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
            resize_mode: 1,
            upscaling_resize_w: width,
            upscaling_resize_h: height,
            upscaling_crop: false,
            upscaler_1: 'Lanczos',
            show_extras_results: true,
            image: base64Image
        })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.image) throw new Error('Forge no devolvió la ampliación.');
    return String(data.image).replace(/^data:image\/\w+;base64,/, '');
}

async function preparePrompt(userPrompt) {
    const original = String(userPrompt || '').trim();
    if (!original) throw new Error('Necesito una descripción para generar la imagen.');
    try {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(25000),
            body: JSON.stringify({
                model: process.env.JARVIS_IMAGE_PROMPT_MODEL || 'qwen2.5:3b',
                prompt: `Convertí esta solicitud en un prompt visual breve y preciso en inglés para SDXL. Conservá literalmente los sujetos, cantidades, escenario, relaciones espaciales y estilo solicitados. Una ubicación expresada como "en un lugar" significa que el sujeto está físicamente dentro o sobre ese lugar; no la reemplaces por ese lugar visible a la distancia o como fondo. Regla lingüística: "en la Luna" se traduce "on the surface of the Moon", nunca "under the Moon". Devolvé solamente el prompt, sin comillas, explicación ni Markdown. Solicitud: ${original}`,
                stream: false,
                keep_alive: 0,
                options: { temperature: 0.1, num_predict: 120 }
            })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const prepared = String(data.response || '')
            .replace(/^\s*["'`]+|["'`]+\s*$/g, '')
            .replace(/[*_#]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 700);
        if (prepared) return enforceSpatialRelations(original, prepared);
    } catch (error) {
        console.warn('[ImageService] No pude preparar el prompt en inglés; uso el original:', error.message);
    }
    return original;
}

function cancelForgeIdleShutdown() {
    if (forgeIdleTimer) clearTimeout(forgeIdleTimer);
    forgeIdleTimer = null;
}

function stopForgeProcessTree() {
    const pid = forgeRootPid;
    if (!pid || process.platform !== 'win32' || !forgeChild || forgeChild.exitCode !== null || forgeChild.signalCode !== null) return Promise.resolve(false);
    return new Promise(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
        });
        killer.once('error', () => resolve(false));
        killer.once('exit', code => resolve(code === 0));
    });
}

function scheduleForgeIdleShutdown() {
    cancelForgeIdleShutdown();
    if (!forgeStartedByJarvis || activeImageJobs > 0) return;
    forgeIdleTimer = setTimeout(async () => {
        forgeIdleTimer = null;
        if (!forgeStartedByJarvis || activeImageJobs > 0) return;
        try {
            console.log('[ImageService] Cerrando Forge iniciado por Jarvis luego del período inactivo...');
            const response = await fetch(`${FORGE_URL}/sdapi/v1/server-kill`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(5000)
            });
            if (response.ok) {
                forgeStartedByJarvis = false;
                forgeRootPid = null;
                console.log('[ImageService] Forge cerrado; CPU y RAM liberadas.');
                return;
            }
        } catch (error) {
            console.warn('[ImageService] Forge no admitió el cierre por API:', error.message);
        }
        if (await stopForgeProcessTree()) {
            forgeStartedByJarvis = false;
            forgeRootPid = null;
            console.log('[ImageService] Forge cerrado; CPU y RAM liberadas.');
        } else {
            console.warn('[ImageService] No se pudo cerrar el proceso de Forge iniciado por Jarvis.');
        }
    }, FORGE_IDLE_MS);
    forgeIdleTimer.unref?.();
}

/**
 * Verifica si el API de Forge responde.
 */
async function checkForgeStatus() {
    try {
        const response = await fetch(`${FORGE_URL}/sdapi/v1/options`, { 
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

/**
 * Arranca Forge en segundo plano silenciosamente.
 */
function startForgeAttempt(attemptNumber) {
    return new Promise((resolve, reject) => {
        console.log(`[ImageService] Iniciando Stable Diffusion Forge en background (intento ${attemptNumber}/2)...`);
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const logMode = attemptNumber === 1 ? 'w' : 'a';
        const stdout = fs.openSync(FORGE_STDOUT_LOG, logMode);
        const stderr = fs.openSync(FORGE_STDERR_LOG, logMode);
        let forgeProcess;
        try {
            forgeProcess = spawn('cmd.exe', ['/c', FORGE_BAT_PATH], {
                detached: true,
                windowsHide: true,
                stdio: ['ignore', stdout, stderr],
                cwd: path.dirname(FORGE_BAT_PATH)
            });
        } finally {
            fs.closeSync(stdout);
            fs.closeSync(stderr);
        }
        forgeStartedByJarvis = true;
        forgeChild = forgeProcess;
        forgeRootPid = forgeProcess.pid;
        forgeProcess.unref();

        let settled = false;
        let polls = 0;
        const finish = (handler, value) => {
            if (settled) return;
            settled = true;
            clearInterval(interval);
            handler(value);
        };
        const interval = setInterval(async () => {
            polls++;
            if (await checkForgeStatus()) {
                console.log('[ImageService] Forge iniciado exitosamente. API lista.');
                finish(resolve, true);
            } else if (polls > 60) {
                console.error('[ImageService] Timeout esperando a Forge.');
                finish(reject, new Error('Timeout al iniciar Forge.'));
            }
        }, 2000);
        forgeProcess.once('error', error => finish(reject, error));
        forgeProcess.once('exit', code => {
            if (!settled) finish(reject, new Error(`Forge terminó durante el inicio (código ${code ?? 'desconocido'}).`));
        });
    });
}

async function startForgeSilently() {
    if (!fs.existsSync(FORGE_BAT_PATH)) throw new Error('No encontré la instalación de Forge.');
    if (forgeStarting) return forgeStarting;
    forgeStarting = (async () => {
        let lastError;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                return await startForgeAttempt(attempt);
            } catch (error) {
                lastError = error;
                console.warn(`[ImageService] Falló el inicio de Forge: ${error.message}`);
                await stopForgeProcessTree();
                forgeStartedByJarvis = false;
                forgeRootPid = null;
                if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        throw lastError;
    })();
    return forgeStarting
        .catch(error => {
            forgeStartedByJarvis = false;
            forgeRootPid = null;
            throw error;
        })
        .finally(() => { forgeStarting = null; });
}

/**
 * Cambia el modelo activo en Forge (sd_model_checkpoint).
 * Toma unos segundos dependiendo de la memoria.
 */
async function switchModel(modelName) {
    console.log(`[ImageService] Solicitando cambio de modelo a: ${modelName}...`);
    try {
        const response = await fetch(`${FORGE_URL}/sdapi/v1/options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sd_model_checkpoint: modelName })
        });
        if (!response.ok) {
            console.error(`[ImageService] Falló el cambio de modelo: HTTP ${response.status}`);
            return false;
        }
        console.log(`[ImageService] Modelo cambiado exitosamente a ${modelName}.`);
        return true;
    } catch (e) {
        console.error(`[ImageService] Error cambiando modelo a ${modelName}:`, e);
        return false;
    }
}

/**
 * Fuerza el estilo realista y genera la imagen
 */
async function generateImageNow(userPrompt, options = {}) {
    const preparedPrompt = await preparePrompt(userPrompt);
    const profile = buildGenerationProfile(userPrompt, options);
    // Verificar si Forge esta corriendo
    const isOnline = await checkForgeStatus();
    if (!isOnline) {
        try {
            await startForgeSilently();
        } catch (e) {
            throw new Error("No se pudo iniciar el generador de imágenes. " + e.message);
        }
    }

    // Cambiar al modelo base (Juggernaut)
    if (!await switchModel('juggernautXL_ragnarokBy.safetensors')) throw new Error('Forge no pudo cargar el modelo de imágenes configurado.');

    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Perfil equilibrado para SDXL: el render base preserva calidad y una ampliación
    // rápida recupera la salida 1024 px sin exigir una segunda difusión completa.
    const finalPrompt = preparedPrompt + profile.qualitySuffix;

    console.log(`[ImageService] Generando imagen: "${finalPrompt}"`);
    
    try {
        const response = await fetch(`${FORGE_URL}/sdapi/v1/txt2img`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(Math.max(300000, Math.min(900000, profile.steps * 30000 + 60000))),
            body: JSON.stringify({
                prompt: finalPrompt,
                negative_prompt: profile.negativePrompt,
                steps: profile.steps,
                cfg_scale: profile.cfgScale,
                width: profile.width,
                height: profile.height,
                sampler_name: 'DPM++ 2M',
                scheduler: 'Karras'
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        let base64Image = data.images[0];
        
        if (!base64Image) {
            throw new Error("El API no devolvió una imagen.");
        }

        if (profile.outputWidth !== profile.width || profile.outputHeight !== profile.height) {
            try {
                base64Image = await upscaleBase64Image(base64Image, profile.outputWidth, profile.outputHeight);
                console.log(`[ImageService] Imagen ampliada a ${profile.outputWidth}x${profile.outputHeight}.`);
            } catch (error) {
                console.warn('[ImageService] No pude ampliar la imagen; conservo el render base:', error.message);
            }
        }

        const filename = `jarvis_img_${Date.now()}.png`;
        const filepath = path.join(UPLOAD_DIR, filename);

        // Guardar la imagen física
        fs.writeFileSync(filepath, Buffer.from(base64Image, 'base64'));

        // Guardar copia en Jarvis_Pelis y enviar notificación nativa
        try {
            const pelisDir = path.join(os.homedir(), 'Downloads', 'Jarvis_Pelis');
            if (fs.existsSync(pelisDir)) {
                const pelisFilePath = path.join(pelisDir, filename);
                fs.copyFileSync(filepath, pelisFilePath);
                console.log(`[ImageService] Foto guardada en Jarvis_Pelis: ${pelisFilePath}`);
                const notifier = require('node-notifier');
                notifier.notify({
                    title: 'J.A.R.V.I.S. - Foto Generada',
                    message: `Nueva foto guardada en tu carpeta Jarvis_Pelis.`,
                    sound: true,
                    wait: false
                });
            }
        } catch (_) {}
        
        console.log(`[ImageService] Imagen guardada en: ${filepath}`);
        
        return filepath;

    } catch (e) {
        console.error("[ImageService] Error generando imagen:", e);
        throw e;
    }
}

async function generateImage(userPrompt, options = {}) {
    cancelForgeIdleShutdown();
    activeImageJobs++;
    try {
        return await generateImageNow(userPrompt, options);
    } finally {
        activeImageJobs = Math.max(0, activeImageJobs - 1);
        if (activeImageJobs === 0) {
            await unloadVRAM();
            scheduleForgeIdleShutdown();
        }
    }
}

/**
 * Libera la memoria VRAM descargando el modelo de Forge.
 */
async function unloadVRAM() {
    try {
        console.log("[ImageService] Descargando modelo de VRAM para liberar memoria...");
        await fetch(`${FORGE_URL}/sdapi/v1/unload-checkpoint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000)
        });
        console.log("[ImageService] Memoria VRAM liberada exitosamente.");
    } catch (e) {
        console.error("[ImageService] Error al liberar VRAM:", e);
    }
}

/**
 * Edita una imagen existente usando img2img
 */
async function editImageNow(imagePath, userPrompt, denoisingStrength = 0.55, maskBase64 = null) {
    const isOnline = await checkForgeStatus();
    if (!isOnline) {
        try {
            await startForgeSilently();
        } catch (e) {
            throw new Error("No se pudo iniciar el generador de imágenes. " + e.message);
        }
    }

    const useInpainting = maskBase64 != null;

    if (useInpainting) {
        // Juggernaut XL para Inpainting Realista
        if (!await switchModel('juggernautXL_ragnarokBy.safetensors')) throw new Error('No pude cargar el modelo para editar la imagen.');
        if (maskBase64.startsWith('data:image')) maskBase64 = maskBase64.split(',')[1];
    } else {
        // Modelo viejo para edición sin máscara
        if (!await switchModel('instruct-pix2pix-00-22000.safetensors')) throw new Error('No pude cargar el modelo para editar la imagen.');
    }

    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Leer la imagen original y convertir a base64
    let initImageBase64 = '';
    try {
        const fileData = fs.readFileSync(imagePath);
        initImageBase64 = fileData.toString('base64');
    } catch (e) {
        throw new Error("No se pudo leer la imagen proporcionada: " + imagePath);
    }

    let finalPrompt = userPrompt;
    let negativePrompt = "cartoon, illustration, 3d render, low quality, bad anatomy, deformed, blurred, worst quality, text, watermark, mutated, ugly";
    
    let payload = {};

    if (useInpainting) {
        const qualitySuffix = ", (masterpiece:1.2), (best quality:1.2), highly detailed, sharp focus, professional photograph, 8k uhd, RAW photo";
        finalPrompt = userPrompt + qualitySuffix;
        negativePrompt = "(worst quality:1.4), (low quality:1.4), cartoon, illustration, 3d render, bad anatomy, deformed, blurred, text, watermark, mutated, ugly, extra limbs, duplicate";
        
        payload = {
            init_images: [initImageBase64],
            mask: maskBase64,
            prompt: finalPrompt,
            negative_prompt: negativePrompt,
            steps: 35,
            cfg_scale: 5.5,
            denoising_strength: 0.75,
            sampler_name: "DPM++ 2M Karras",
            inpaint_full_res: true,
            inpaint_full_res_padding: 32,
            inpainting_fill: 1,
            mask_blur: 6
        };
        console.log(`[ImageService] INPAINTING con Juggernaut XL: "${finalPrompt}"`);
    } else {
        payload = {
            init_images: [initImageBase64],
            prompt: finalPrompt,
            negative_prompt: negativePrompt,
            steps: 30,
            denoising_strength: 1.0,
            image_cfg_scale: 1.5,
            cfg_scale: 7.5,
            sampler_name: "DPM++ 2M Karras",
            mask: null,
            include_init_images: false
        };
        console.log(`[ImageService] PIX2PIX (sin máscara): "${finalPrompt}"`);
    }
    
    try {
        const response = await fetch(`${FORGE_URL}/sdapi/v1/img2img`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        const base64Image = data.images[0];
        
        if (!base64Image) {
            throw new Error("El API no devolvió una imagen editada.");
        }

        const filename = `jarvis_edit_${Date.now()}.png`;
        const filepath = path.join(UPLOAD_DIR, filename);

        // Guardar la imagen física
        fs.writeFileSync(filepath, Buffer.from(base64Image, 'base64'));
        
        console.log(`[ImageService] Imagen editada guardada en: ${filepath}`);
        
        return filepath;

    } catch (e) {
        console.error("[ImageService] Error editando imagen:", e);
        throw e;
    }
}

async function editImage(imagePath, userPrompt, denoisingStrength = 0.55, maskBase64 = null) {
    cancelForgeIdleShutdown();
    activeImageJobs++;
    try {
        return await editImageNow(imagePath, userPrompt, denoisingStrength, maskBase64);
    } finally {
        activeImageJobs = Math.max(0, activeImageJobs - 1);
        if (activeImageJobs === 0) {
            await unloadVRAM();
            scheduleForgeIdleShutdown();
        }
    }
}

async function shutdown() {
    cancelForgeIdleShutdown();
    if (!forgeStartedByJarvis) return;
    await stopForgeProcessTree();
    forgeStartedByJarvis = false; forgeRootPid = null; forgeChild = null;
}

module.exports = {
    shutdown,
    generateImage,
    editImage,
    checkForgeStatus,
    unloadVRAM,
    publicImageUrl,
    preparePrompt,
    buildGenerationProfile
};
