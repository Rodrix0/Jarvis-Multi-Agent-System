const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpeg = require('ffmpeg-static');

const pythonExe = path.join(__dirname, '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe');

const puppeteer = require('puppeteer');
const https = require('https');

async function downloadImageGallery(url) {
    const downloadsDir = path.join(os.homedir(), 'Downloads', 'Jarvis_Downloads', 'Galeria_' + Date.now());
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }

    console.log(`[DownloadService] Iniciando scraping de galería con Puppeteer: ${url}`);
    
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Scroll hasta abajo para cargar imágenes lazy-loaded
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                let distance = 300;
                let timer = setInterval(() => {
                    let scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if(totalHeight >= scrollHeight - window.innerHeight){
                        clearInterval(timer);
                        resolve();
                    }
                }, 200);
            });
        });

        // Esperar un poquito más a que las imágenes terminen de renderizar
        await new Promise(r => setTimeout(r, 2000));

        // Extraer URLs de imágenes (filtrando iconos pequeños o logos genéricos)
        const imageUrls = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            return imgs.map(img => img.src).filter(src => {
                if (!src || !src.startsWith('http')) return false;
                // Excluir avatares y logos chicos si es posible (ajustable por heurística)
                if (src.includes('avatar') || src.includes('logo')) return false;
                return true;
            });
        });

        // Filtrar duplicados
        const uniqueUrls = [...new Set(imageUrls)];
        console.log(`[DownloadService] Encontradas ${uniqueUrls.length} imágenes para descargar.`);

        let downloadedCount = 0;

        // Función auxiliar para descargar una imagen
        const downloadSingleImage = (imgUrl, index) => {
            return new Promise((resolve) => {
                const ext = path.extname(new URL(imgUrl).pathname) || '.jpg';
                const filePath = path.join(downloadsDir, `imagen_${index + 1}${ext}`);
                const file = fs.createWriteStream(filePath);
                
                https.get(imgUrl, (response) => {
                    if (response.statusCode === 200) {
                        response.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            downloadedCount++;
                            resolve();
                        });
                    } else {
                        file.close();
                        fs.unlink(filePath, () => resolve()); // Fallo silencioso de esta img
                    }
                }).on('error', () => {
                    file.close();
                    fs.unlink(filePath, () => resolve());
                });
            });
        };

        // Descargar en lotes de a 5 para no saturar
        for (let i = 0; i < uniqueUrls.length; i += 5) {
            const batch = uniqueUrls.slice(i, i + 5);
            await Promise.all(batch.map((u, idx) => downloadSingleImage(u, i + idx)));
        }

        console.log(`[DownloadService] Galería descargada: ${downloadedCount} imágenes en ${downloadsDir}`);
        return downloadsDir;

    } catch (e) {
        console.error(`[DownloadService] Error en scraping de galería:`, e);
        throw e;
    } finally {
        await browser.close();
    }
}

function downloadDirectImage(url) {
    return new Promise((resolve, reject) => {
        const downloadsDir = path.join(os.homedir(), 'Downloads', 'Jarvis_Downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }

        const ext = path.extname(new URL(url).pathname) || '.jpg';
        const filename = `imagen_${Date.now()}${ext}`;
        const filePath = path.join(downloadsDir, filename);
        const file = fs.createWriteStream(filePath);

        const client = url.startsWith('https') ? https : require('http');
        
        client.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log(`[DownloadService] Imagen directa descargada: ${filePath}`);
                    resolve(downloadsDir);
                });
            } else {
                file.close();
                fs.unlink(filePath, () => {});
                reject(new Error(`Fallo al descargar imagen. HTTP Code: ${response.statusCode}`));
            }
        }).on('error', (err) => {
            file.close();
            fs.unlink(filePath, () => {});
            reject(err);
        });
    });
}

function downloadMedia(url, isAudioOnly) {
    const isDirectImage = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url);
    if (isDirectImage) {
        return downloadDirectImage(url);
    }

    // Si es Pinterest o Instagram, desviar al scraper de imágenes (se quitó cafecito)
    if (url.includes('pinterest.com') || url.includes('instagram.com/p/')) {
        return downloadImageGallery(url);
    }

    return new Promise((resolve, reject) => {
        const downloadsDir = path.join(os.homedir(), 'Downloads', 'Jarvis_Downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }

        const args = [
            '-m', 'yt_dlp',
            url,
            '-o', path.join(downloadsDir, '%(title)s.%(ext)s'),
            '--no-playlist',
            '--ffmpeg-location', ffmpeg,
            '--js-runtimes', 'node',
            '--remote-components', 'ejs:github'
        ];

        if (isAudioOnly) {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
        } else {
            args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
        }

        console.log(`[DownloadService] Ejecutando yt-dlp para: ${url}`);

        const child = spawn(pythonExe, args);
        let task = null;
        try {
            const taskManager = require('./core/taskManagerService');
            task = taskManager.createTask({
                type: 'download',
                description: `Descarga de ${isAudioOnly ? 'audio' : 'video'} (${url.substring(0, 40)}...)`,
                childProcess: child,
                cancelFn: () => {
                    try { child.kill('SIGKILL'); } catch (e) {}
                }
            });
            taskManager.startTask(task.id);
        } catch (e) {}

        child.stdout.on('data', (data) => {
            console.log(`[yt-dlp] ${data.toString().trim()}`);
        });

        child.stderr.on('data', (data) => {
            console.error(`[yt-dlp err] ${data.toString().trim()}`);
        });

        child.on('close', (code) => {
            if (task) {
                try {
                    const taskManager = require('./core/taskManagerService');
                    if (code === 0) {
                        taskManager.completeTask(task.id, downloadsDir);
                    } else {
                        taskManager.failTask(task.id, `yt-dlp exited con código ${code}`);
                    }
                } catch (e) {}
            }
            if (code === 0) {
                try {
                    const eventBus = require('./core/eventBusService');
                    const { SYSTEM_EVENTS } = require('./core/eventBusService');
                    eventBus.publish(SYSTEM_EVENTS.DOWNLOAD_COMPLETED, {
                        url,
                        destination: downloadsDir,
                        isAudioOnly,
                        message: `Descarga completada en ${downloadsDir}`
                    });
                } catch (e) {}
                console.log(`[DownloadService] Descarga completada con éxito en ${downloadsDir}`);
                resolve(downloadsDir);
            } else {
                reject(new Error(`yt-dlp exited con código ${code}`));
            }
        });
    });
}

module.exports = {
    downloadMedia
};
