const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FORGE_URL = 'http://127.0.0.1:7860';
const FORGE_BAT_PATH = 'C:\\Users\\Rodrigo\\Desktop\\IA\\stable-diffusion-webui-forge\\webui-user.bat';
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
const fetch = (url, options = {}) => globalThis.fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(options.method === 'POST' ? 180000 : 3000) });
let forgeStarting = null;

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
async function startForgeSilently() {
    if (!fs.existsSync(FORGE_BAT_PATH)) throw new Error('No encontré la instalación de Forge.');
    if (forgeStarting) return forgeStarting;
    forgeStarting = new Promise((resolve, reject) => {
        console.log("[ImageService] Iniciando Stable Diffusion Forge en background...");
        // spawn cmd.exe /c start /b para que no abra ventana visible al usuario.
        // O alternativamente spawn detached sin stdout.
        const forgeProcess = spawn('cmd.exe', ['/c', FORGE_BAT_PATH], {
            detached: true,
            windowsHide: true,
            stdio: 'ignore',
            cwd: path.dirname(FORGE_BAT_PATH)
        });

        forgeProcess.unref(); // Permite que node termine aunque esto siga corriendo

        // Hacemos polling hasta que el API responda
        let attempts = 0;
        const interval = setInterval(async () => {
            attempts++;
            const isOnline = await checkForgeStatus();
            if (isOnline) {
                clearInterval(interval);
                console.log("[ImageService] Forge iniciado exitosamente. API lista.");
                resolve(true);
            } else if (attempts > 60) { // Timeout de 2 mins (60 * 2000ms)
                clearInterval(interval);
                console.error("[ImageService] Timeout esperando a Forge.");
                reject(new Error("Timeout al iniciar Forge."));
            }
        }, 2000);
        forgeProcess.on('error', error => { clearInterval(interval); reject(error); });
        forgeProcess.on('exit', code => { if (code) { clearInterval(interval); reject(new Error(`Forge terminó durante el inicio (código ${code}).`)); } });
    });
    return forgeStarting.finally(() => { forgeStarting = null; });
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
async function generateImage(userPrompt, options = {}) {
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

    // Prompt engineering optimizado para Juggernaut XL
    const qualitySuffix = ", (masterpiece:1.2), (best quality:1.2), highly detailed, sharp focus, professional photograph, 8k uhd, RAW photo";
    const finalPrompt = userPrompt + qualitySuffix;
    const negativePrompt = "(worst quality:1.4), (low quality:1.4), cartoon, illustration, 3d render, bad anatomy, deformed, blurred, text, watermark, mutated, ugly, extra limbs, extra fingers, poorly drawn face, duplicate, morbid";

    console.log(`[ImageService] Generando imagen: "${finalPrompt}"`);
    
    try {
        const response = await fetch(`${FORGE_URL}/sdapi/v1/txt2img`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: finalPrompt,
                negative_prompt: negativePrompt,
                steps: Math.max(1, Math.min(50, Number(options.steps) || 30)),
                cfg_scale: 6,
                width: Math.max(256, Math.min(1536, Math.round((Number(options.width) || 1024) / 64) * 64)),
                height: Math.max(256, Math.min(1536, Math.round((Number(options.height) || 1024) / 64) * 64)),
                sampler_name: "DPM++ 2M Karras"
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        const base64Image = data.images[0];
        
        if (!base64Image) {
            throw new Error("El API no devolvió una imagen.");
        }

        const filename = `jarvis_img_${Date.now()}.png`;
        const filepath = path.join(UPLOAD_DIR, filename);

        // Guardar la imagen física
        fs.writeFileSync(filepath, Buffer.from(base64Image, 'base64'));
        
        console.log(`[ImageService] Imagen guardada en: ${filepath}`);
        
        // Iniciar proceso de descarga de modelo de la VRAM (asíncrono)
        unloadVRAM();

        return filepath;

    } catch (e) {
        console.error("[ImageService] Error generando imagen:", e);
        throw e;
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
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("[ImageService] Memoria VRAM liberada exitosamente.");
    } catch (e) {
        console.error("[ImageService] Error al liberar VRAM:", e);
    }
}

/**
 * Edita una imagen existente usando img2img
 */
async function editImage(imagePath, userPrompt, denoisingStrength = 0.55, maskBase64 = null) {
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
        
        // Iniciar proceso de descarga de modelo de la VRAM (asíncrono)
        unloadVRAM();

        return filepath;

    } catch (e) {
        console.error("[ImageService] Error editando imagen:", e);
        throw e;
    }
}

module.exports = {
    generateImage,
    editImage,
    checkForgeStatus,
    unloadVRAM
};
