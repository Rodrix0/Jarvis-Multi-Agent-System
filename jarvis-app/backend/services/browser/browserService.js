/**
 * Autonomous Browser Service for Jarvis (Playwright + Native Chrome)
 * Permite a Jarvis navegar la web de forma autónoma, interactuar con SPAs,
 * completar formularios, hacer clics semánticos, descargar y subir archivos.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const eventBus = require('../core/eventBusService');

const CHROME_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

class BrowserService {
    constructor() {
        this.browser = null;
        this.context = null;
        this.activePage = null;
        this.executablePath = this._detectBrowserExecutable();
        this.downloads = [];
    }

    /**
     * Detecta el binario de Chrome o Edge instalado en el sistema.
     */
    _detectBrowserExecutable() {
        for (const p of CHROME_PATHS) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        return null;
    }

    /**
     * Asegura que exista una instancia activa de Playwright con Google Chrome.
     */
    async ensureBrowser(options = {}) {
        if (!this.executablePath) {
            throw new Error('No se encontró Google Chrome ni Microsoft Edge instalado en el sistema.');
        }

        if (this.browser && (!this.browser.isConnected || !this.browser.isConnected())) {
            this.browser = null;
            this.context = null;
            this.activePage = null;
        }

        if (!this.browser) {
            const headless = options.headless !== undefined ? options.headless : true;
            this.browser = await chromium.launch({
                executablePath: this.executablePath,
                headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--ignore-certifcate-errors',
                    '--ignore-certifcate-errors-spki-list'
                ]
            });

            this.context = await this.browser.newContext({
                viewport: { width: 1280, height: 800 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });

            this.activePage = await this.context.newPage();
            this.activePage.setDefaultTimeout(options.timeout || 15000);
        }

        if (!this.activePage || this.activePage.isClosed()) {
            this.activePage = await this.context.newPage();
        }

        return { browser: this.browser, context: this.context, page: this.activePage };
    }

    /**
     * Navega a una URL y espera la carga de la página.
     */
    async openPage(url, options = {}) {
        await this.ensureBrowser(options);
        const targetUrl = url.startsWith('http') ? url : `https://${url}`;
        
        console.log(`[BrowserService] 🌐 Navegando a: ${targetUrl}...`);
        await this.activePage.goto(targetUrl, {
            waitUntil: options.waitUntil || 'domcontentloaded',
            timeout: options.timeout || 20000
        });

        const title = await this.activePage.title();
        const currentUrl = this.activePage.url();

        return {
            ok: true,
            title,
            url: currentUrl
        };
    }

    /**
     * Busca un elemento en la página y comprueba su existencia y visibilidad.
     */
    async findElement(selector, options = {}) {
        await this.ensureBrowser(options);
        const locator = this.activePage.locator(selector).first();
        const count = await locator.count();
        const visible = count > 0 ? await locator.isVisible().catch(() => false) : false;

        return {
            ok: count > 0,
            selector,
            count,
            visible
        };
    }

    /**
     * Hace clic en un elemento web (CSS selector, XPath, o texto: text=Aceptar).
     */
    async click(selector, options = {}) {
        await this.ensureBrowser(options);
        console.log(`[BrowserService] 🖱️ Clic en: ${selector}...`);
        const locator = this.activePage.locator(selector).first();
        await locator.click({ timeout: options.timeout || 8000 });

        if (options.waitForNavigation) {
            await this.waitForNavigation(options);
        }

        return {
            ok: true,
            selector,
            url: this.activePage.url()
        };
    }

    /**
     * Escribe texto en un campo de formulario o caja de búsqueda.
     */
    async write(selector, text, options = {}) {
        await this.ensureBrowser(options);
        console.log(`[BrowserService] ⌨️ Escribiendo en ${selector}: "${text}"...`);
        const locator = this.activePage.locator(selector).first();

        if (options.clear !== false) {
            await locator.fill(text, { timeout: options.timeout || 8000 });
        } else {
            await locator.type(text, { timeout: options.timeout || 8000 });
        }

        if (options.pressEnter) {
            await locator.press('Enter');
            if (options.waitForNavigation) {
                await this.waitForNavigation(options);
            }
        }

        return {
            ok: true,
            selector,
            textWritten: text
        };
    }

    /**
     * Descarga un archivo a través de un clic o evento de descarga con verificación y eventos proactivos.
     */
    async download(urlOrSelector, destinationDir, options = {}) {
        await this.ensureBrowser(options);
        const downloadFolder = destinationDir || process.env.JARVIS_DOWNLOADS_DIR || path.join(require('os').homedir(), 'Downloads');
        fs.mkdirSync(downloadFolder, { recursive: true });

        const downloadId = `dl-${Date.now()}`;
        console.log(`[BrowserService] 📥 Iniciando descarga [${downloadId}] hacia: ${downloadFolder}...`);

        eventBus.publish('DOWNLOAD_STARTED', {
            downloadId,
            target: urlOrSelector,
            destinationDir: downloadFolder
        });

        try {
            let download;
            if (urlOrSelector.startsWith('http')) {
                // Descarga directa vía navegador
                [download] = await Promise.all([
                    this.activePage.waitForEvent('download', { timeout: options.timeout || 30000 }),
                    this.activePage.goto(urlOrSelector).catch(() => {})
                ]);
            } else {
                // Descarga activada por clic en un botón o enlace
                [download] = await Promise.all([
                    this.activePage.waitForEvent('download', { timeout: options.timeout || 30000 }),
                    this.click(urlOrSelector)
                ]);
            }

            const suggestedFilename = download.suggestedFilename();
            const targetPath = path.join(downloadFolder, suggestedFilename);
            await download.saveAs(targetPath);
            const size = fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0;

            const record = {
                downloadId,
                ok: true,
                filePath: targetPath,
                filename: suggestedFilename,
                size,
                status: 'COMPLETED',
                timestamp: new Date().toISOString()
            };
            this.downloads.push(record);

            eventBus.publish('DOWNLOAD_COMPLETED', record);
            return record;
        } catch (err) {
            const errRecord = {
                downloadId,
                ok: false,
                error: err.message,
                status: 'FAILED',
                timestamp: new Date().toISOString()
            };
            this.downloads.push(errRecord);
            eventBus.publish('DOWNLOAD_FAILED', errRecord);
            throw err;
        }
    }

    /**
     * Devuelve el historial del gestor de descargas de la sesión actual.
     */
    getDownloadHistory() {
        return [...this.downloads];
    }

    /**
     * Sube uno o varios archivos a un input de tipo file.
     */
    async upload(selector, filePath, options = {}) {
        await this.ensureBrowser(options);
        console.log(`[BrowserService] 📤 Subiendo archivo ${filePath} a ${selector}...`);
        const locator = this.activePage.locator(selector).first();
        await locator.setInputFiles(filePath, { timeout: options.timeout || 10000 });

        return {
            ok: true,
            selector,
            uploadedFile: filePath
        };
    }

    /**
     * Desplaza la página web verticalmente hacia abajo, arriba o hasta el fondo.
     */
    async scroll(direction = 'down', amount = 500, options = {}) {
        await this.ensureBrowser(options);
        console.log(`[BrowserService] 📜 Scroll ${direction} (${amount}px)...`);

        await this.activePage.evaluate(({ dir, amt }) => {
            if (dir === 'bottom') {
                window.scrollTo(0, document.body.scrollHeight);
            } else if (dir === 'top') {
                window.scrollTo(0, 0);
            } else if (dir === 'up') {
                window.scrollBy(0, -amt);
            } else {
                window.scrollBy(0, amt);
            }
        }, { dir: direction, amt: amount });

        await this.activePage.waitForTimeout(options.delay || 400);
        return {
            ok: true,
            direction,
            amount
        };
    }

    /**
     * Extrae el texto visible limpio de un elemento o de la página entera.
     */
    async getText(selector = 'body', options = {}) {
        await this.ensureBrowser(options);
        const locator = this.activePage.locator(selector).first();
        const text = await locator.innerText({ timeout: options.timeout || 8000 }).catch(async () => {
            return this.activePage.evaluate(() => document.body.innerText);
        });

        const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
        return {
            ok: true,
            selector,
            text: cleanText.slice(0, options.maxLength || 5000),
            length: cleanText.length
        };
    }

    /**
     * Espera a que termine una redirección o carga de navegación.
     */
    async waitForNavigation(options = {}) {
        await this.ensureBrowser(options);
        await this.activePage.waitForLoadState(options.state || 'domcontentloaded', {
            timeout: options.timeout || 15000
        }).catch(() => {});

        return {
            ok: true,
            url: this.activePage.url()
        };
    }

    /**
     * Selecciona una opción en un <select> HTML.
     */
    async selectOption(selector, value, options = {}) {
        await this.ensureBrowser(options);
        const locator = this.activePage.locator(selector).first();
        await locator.selectOption(value, { timeout: options.timeout || 8000 });
        return { ok: true, selector, value };
    }

    /**
     * Marca un checkbox.
     */
    async check(selector, options = {}) {
        await this.ensureBrowser(options);
        const locator = this.activePage.locator(selector).first();
        await locator.check({ timeout: options.timeout || 8000 });
        return { ok: true, selector, checked: true };
    }

    /**
     * Desmarca un checkbox.
     */
    async uncheck(selector, options = {}) {
        await this.ensureBrowser(options);
        const locator = this.activePage.locator(selector).first();
        await locator.uncheck({ timeout: options.timeout || 8000 });
        return { ok: true, selector, checked: false };
    }

    /**
     * Espera a que un selector esté presente y visible en el DOM.
     */
    async waitForSelector(selector, options = {}) {
        await this.ensureBrowser(options);
        const locator = this.activePage.locator(selector).first();
        await locator.waitFor({ state: options.state || 'visible', timeout: options.timeout || 10000 });
        return { ok: true, selector };
    }

    /**
     * Lista todas las pestañas abiertas en el contexto actual.
     */
    async listTabs() {
        if (!this.context) return [];
        const pages = this.context.pages();
        const tabs = [];
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            tabs.push({
                index: i,
                url: p.url(),
                title: await p.title().catch(() => ''),
                isActive: p === this.activePage
            });
        }
        return tabs;
    }

    /**
     * Cambia la pestaña activa por índice o coincidencia de URL/Título.
     */
    async switchTab(target) {
        if (!this.context) throw new Error('No hay contexto de navegador activo.');
        const pages = this.context.pages();
        if (pages.length === 0) throw new Error('No hay pestañas abiertas.');

        if (typeof target === 'number') {
            if (target >= 0 && target < pages.length) {
                this.activePage = pages[target];
                await this.activePage.bringToFront().catch(() => {});
                return { ok: true, index: target, url: this.activePage.url() };
            }
            throw new Error(`Índice de pestaña fuera de rango: ${target}`);
        }

        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            const title = await p.title().catch(() => '');
            if (p.url().includes(target) || title.includes(target)) {
                this.activePage = p;
                await this.activePage.bringToFront().catch(() => {});
                return { ok: true, index: i, url: this.activePage.url(), title };
            }
        }

        throw new Error(`No se encontró ninguna pestaña que coincida con: ${target}`);
    }

    /**
     * Cierra la pestaña activa o la sesión completa del navegador.
     */
    async close() {
        if (this.browser) {
            console.log('[BrowserService] 🛑 Cerrando sesión de navegador...');
            await this.browser.close().catch(() => {});
            this.browser = null;
            this.context = null;
            this.activePage = null;
        }
        return { ok: true, closed: true };
    }
}

const browserService = new BrowserService();
module.exports = browserService;
