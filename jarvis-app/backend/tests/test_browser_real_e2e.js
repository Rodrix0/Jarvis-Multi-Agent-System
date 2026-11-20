/**
 * Real Browser E2E Test Suite (JARVIS 3.1 Hardening)
 *
 * Pruebas reales de navegación e interacción autónoma contra un servidor HTTP local fixture:
 * 1. Formulario interactivo: Relleno de texto, selección en dropdown, marcado de checkbox y verificación de token.
 * 2. Elementos dinámicos: Espera asíncrona de elementos generados dinámicamente con temporizador.
 * 3. Descarga real verificada: Verificación de archivo descargado en disco, tamaño exacto y validación de hash SHA-256.
 * 4. Pestañas múltiples: Apertura de target='_blank', listado de pestañas, conmutación activa e inspección.
 * 5. Recuperación ante desconexión / crash: Cierre abrupto y recuperación automática transparente.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const browserService = require('../services/browser/browserService');
const { startServer } = require('./fixtures/browserServer');

let passedTests = 0;
let failedTests = 0;

function logPass(name, detail = '') {
    console.log(`  ✅ [PASS] ${name} ${detail ? '(' + detail + ')' : ''}`);
    passedTests++;
}

function logFail(name, err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
    failedTests++;
}

async function runBrowserRealE2E() {
    console.log('\n===============================================================');
    console.log('🌐 INICIANDO SUITE: REAL BROWSER E2E (JARVIS 3.1)');
    console.log('===============================================================\n');

    let fixture = null;
    const tempDownloadDir = path.join(os.tmpdir(), `jarvis_dl_test_${Date.now()}`);

    try {
        // Iniciar servidor fixture local
        fixture = await startServer(0);
        console.log(`[BrowserFixture] Servidor local escuchando en: ${fixture.baseUrl}\n`);

        // 1. Formulario Interactivo (Form Fill & Submit)
        try {
            console.log('--- TEST 1: Formulario Interactivo (Text, Select, Check, Submit) ---');
            await browserService.openPage(`${fixture.baseUrl}/form`);

            await browserService.write('#username', 'Rodrigo_Jarvis_Admin');
            await browserService.selectOption('#category', 'enterprise');
            await browserService.check('#agree');
            await browserService.click('#submitBtn', { waitForNavigation: true });

            const successText = await browserService.getText('#successMsg');
            assert.ok(successText.text.includes('TOKEN_JARVIS_SUCCESS'), 'Debe incluir el token de éxito');
            assert.ok(successText.text.includes('Rodrigo_Jarvis_Admin'), 'Debe reflejar el nombre enviado');
            assert.ok(successText.text.includes('enterprise'), 'Debe reflejar la categoría seleccionada');
            assert.ok(successText.text.includes('acepto=yes'), 'Debe reflejar el checkbox marcado');

            logPass('Formulario Interactivo E2E', 'Token y datos verificados');
        } catch (err) {
            logFail('Formulario Interactivo E2E', err);
        }

        // 2. Elementos Dinámicos con Carga Asíncrona
        try {
            console.log('\n--- TEST 2: Espera de Contenido Dinámico Asíncrono ---');
            await browserService.openPage(`${fixture.baseUrl}/dynamic`);

            // Esperar a que aparezca el elemento inyectado con setTimeout en el cliente
            await browserService.waitForSelector('#asyncReadyElement', { timeout: 4000 });
            const dynamicText = await browserService.getText('#asyncReadyElement');
            assert.strictEqual(dynamicText.text, 'DATOS_ASINCRONOS_COMPLETADOS_JARVIS');

            logPass('Contenido Dinámico Asíncrono', 'Elemento cargado y verificado');
        } catch (err) {
            logFail('Contenido Dinámico Asíncrono', err);
        }

        // 3. Descarga Real con Verificación de Tamaño y Hash SHA-256
        try {
            console.log('\n--- TEST 3: Descarga Real y Validación Criptográfica SHA-256 ---');
            const downloadRes = await browserService.download(`${fixture.baseUrl}/download`, tempDownloadDir);
            assert.ok(downloadRes.ok, 'La descarga debió reportar ok=true');
            assert.ok(fs.existsSync(downloadRes.filePath), 'El archivo descargado debe existir físicamente en disco');

            const fileStat = fs.statSync(downloadRes.filePath);
            assert.strictEqual(fileStat.size, fixture.payloadSize, `El tamaño (${fileStat.size}) debe coincidir con ${fixture.payloadSize}`);

            const fileBuffer = fs.readFileSync(downloadRes.filePath);
            const computedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
            assert.strictEqual(computedHash, fixture.payloadHash, 'El hash SHA-256 del archivo debe coincidir con la firma esperada');

            logPass('Descarga Real SHA-256', `Hash verificado: ${computedHash.slice(0, 16)}...`);
        } catch (err) {
            logFail('Descarga Real SHA-256', err);
        }

        // 4. Gestión de Pestañas Múltiples (Multi-Tabs)
        try {
            console.log('\n--- TEST 4: Gestión de Pestañas Múltiples (Tabs) ---');
            await browserService.openPage(`${fixture.baseUrl}/tabs`);

            // Esperar el evento de nueva pestaña al hacer clic
            const [newPage] = await Promise.all([
                browserService.context.waitForEvent('page', { timeout: 8000 }),
                browserService.click('#openTabLink')
            ]);

            await newPage.waitForLoadState('domcontentloaded');
            const tabs = await browserService.listTabs();
            assert.ok(tabs.length >= 2, 'Deben haber al menos 2 pestañas abiertas');

            // Cambiar a la pestaña nueva
            await browserService.switchTab('/newPage');
            const tabContent = await browserService.getText('#tabContent');
            assert.ok(tabContent.text.includes('Contenido verificado en pestaña secundaria'), 'Debe leer contenido de la nueva pestaña');

            // Volver a la pestaña principal
            await browserService.switchTab(0);
            assert.ok(browserService.activePage.url().includes('/tabs'), 'La pestaña activa debe ser la principal');

            logPass('Gestión de Pestañas Múltiples', `${tabs.length} pestañas operativas y conmutadas`);
        } catch (err) {
            logFail('Gestión de Pestañas Múltiples', err);
        }

        // 5. Resiliencia ante Desconexión o Crash del Navegador
        try {
            console.log('\n--- TEST 5: Resiliencia y Recuperación ante Crash / Desconexión ---');
            // Simular crash o desconexión cerrando el proceso de navegador subyacente
            await browserService.browser.close();
            assert.strictEqual(browserService.browser.isConnected(), false, 'El navegador debe reportar desconectado');

            // Intentar navegar nuevamente: debe reinicializarse de manera transparente
            const recoverNav = await browserService.openPage(`${fixture.baseUrl}/`);
            assert.strictEqual(recoverNav.ok, true, 'Debe navegar exitosamente tras la recuperación');
            assert.ok(recoverNav.title.includes('JARVIS E2E Landing'), 'Debe cargar el título esperado tras el recovery');

            logPass('Crash Recovery Navegador', 'Reconexión transparente confirmada');
        } catch (err) {
            logFail('Crash Recovery Navegador', err);
        }

    } finally {
        // Limpieza de recursos
        console.log('\n--- Limpieza de Recursos ---');
        await browserService.close();
        if (fixture && fixture.close) {
            await fixture.close();
            console.log('Servidor fixture local cerrado.');
        }
        if (fs.existsSync(tempDownloadDir)) {
            try { fs.rmSync(tempDownloadDir, { recursive: true, force: true }); } catch (_) {}
        }
    }

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS BROWSER REAL E2E: ${passedTests} APROBADOS, ${failedTests} FALLIDOS`);
    console.log('===============================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runBrowserRealE2E().catch(err => {
    console.error('Fatal error en suite Real Browser E2E:', err);
    process.exit(1);
});
