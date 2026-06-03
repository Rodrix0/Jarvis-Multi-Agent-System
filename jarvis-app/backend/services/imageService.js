const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FORGE_URL = 'http://127.0.0.1:7860';
const FORGE_BAT_PATH = 'C:\\Users\\Rodrigo\\Desktop\\IA\\stable-diffusion-webui-forge\\webui-user.bat';
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');

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
    return new Promise((resolve, reject) => {
        console.log("[ImageService] Iniciando Stable Diffusion Forge en background...");
        // spawn cmd.exe /c start /b para que no abra ventana visible al usuario.
        // O alternativamente spawn detached sin stdout.
        const forgeProcess = spawn('cmd.exe', ['/c', FORGE_BAT_PATH], {
            detached: true,
            windowsHide: true,
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
    });
}

/**
 * Fuerza el estilo realista y genera la imagen
 */
async function generateImage(userPrompt) {
    // Verificar si Forge esta corriendo
    const isOnline = await checkForgeStatus();
    if (!isOnline) {
        try {
            await startForgeSilently();
        } catch (e) {
            throw new Error("No se pudo iniciar el generador de imágenes. " + e.message);
        }
    }

    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Asegurar realismo inyectando sufijos obligatorios
    const realisticSuffix = ", photorealistic, 8k resolution, highly detailed photograph, cinematic lighting, ultra-realistic, RAW photo, masterpiece, best quality";
    const finalPrompt = userPrompt + realisticSuffix;
    const negativePrompt = "cartoon, illustration, 3d render, low quality, bad anatomy, deformed, blurred, worst quality, text, watermark";

    console.log(`[ImageService] Generando imagen: "${finalPrompt}"`);
    
    try {
        const response = await fetch(`${FORGE_URL}/sdapi/v1/txt2img`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: finalPrompt,
                negative_prompt: negativePrompt,
                steps: 20,
                width: 1024,
                height: 1024,
                sampler_name: "Euler a"
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

module.exports = {
    generateImage,
    checkForgeStatus,
    unloadVRAM
};
