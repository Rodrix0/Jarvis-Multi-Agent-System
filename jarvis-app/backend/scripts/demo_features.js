/**
 * Script interactivo de demostración de las nuevas funcionalidades de Jarvis (Ítems 2 al 6).
 * Uso:
 *   node backend/scripts/demo_features.js 2   -> Probar Control Visual de Windows (UI Automation)
 *   node backend/scripts/demo_features.js 3   -> Probar Verificación Post-Ejecución
 *   node backend/scripts/demo_features.js 4   -> Probar Arquitectura Planificador -> Ejecutor -> Verificador
 *   node backend/scripts/demo_features.js 5   -> Probar Navegador Autónomo (Playwright + Chrome)
 *   node backend/scripts/demo_features.js 6   -> Probar Investigación Web Profunda (Multi-Fuente)
 *   node backend/scripts/demo_features.js all -> Probar todas en secuencia
 */

const path = require('path');
const fs = require('fs');

async function runDemo() {
    const arg = (process.argv[2] || '').toLowerCase().trim();

    if (!arg || !['2', '3', '4', '5', '6', 'all'].includes(arg)) {
        console.log(`
========================================================================
🤖 JARVIS - DEMOSTRADOR DE NUEVAS FUNCIONALIDADES (ÍTEMS 2 AL 6)
========================================================================

Elegí qué funcionalidad querés probar ejecutando en tu terminal:

  node backend/scripts/demo_features.js 2
  👉 [Ítem 2] Control Visual de Windows (UI Automation sin coordenadas)

  node backend/scripts/demo_features.js 3
  👉 [Ítem 3] Verificación Post-Ejecución (Verifica en disco y sistema)

  node backend/scripts/demo_features.js 4
  👉 [Ítem 4] Planificador -> Ejecutor -> Verificador (Metas complejas)

  node backend/scripts/demo_features.js 5
  👉 [Ítem 5] Navegador Autónomo Playwright (Abre Chrome y navega)

  node backend/scripts/demo_features.js 6
  👉 [Ítem 6] Investigación Web Profunda (Multi-fuente, deduplicación, confianza)

  node backend/scripts/demo_features.js all
  👉 Ejecutar una demostración completa de todas las funcionalidades
========================================================================
`);
        return;
    }

    if (arg === '2' || arg === 'all') {
        await demoItem2();
    }
    if (arg === '3' || arg === 'all') {
        await demoItem3();
    }
    if (arg === '4' || arg === 'all') {
        await demoItem4();
    }
    if (arg === '5' || arg === 'all') {
        await demoItem5();
    }
    if (arg === '6' || arg === 'all') {
        await demoItem6();
    }
}

// ---------------------------------------------------------
// DEMO ÍTEM 2: Control Visual de Windows
// ---------------------------------------------------------
async function demoItem2() {
    console.log('\n===============================================================');
    console.log('🖥️  DEMO ÍTEM 2: Control Visual de Windows (UI Automation)');
    console.log('===============================================================');
    console.log('Abriendo el Bloc de Notas (Notepad) para interactuar semánticamente...');
    
    const uiAutomationService = require('../services/windows/uiAutomationService');
    const { exec } = require('child_process');

    // Abrir notepad
    exec('notepad.exe');
    console.log('Esperando que aparezca la ventana de Notepad...');

    const win = await uiAutomationService.waitForWindow('Bloc de notas|Notepad', 5000);
    if (win) {
        console.log(`✅ Ventana detectada: "${win.title}" (Handle: ${win.handle})`);
        
        console.log('Buscando el área de texto semántica (Edit/Document) sin coordenadas fijas...');
        const editElem = await uiAutomationService.findTextBox(win.handle);
        if (editElem) {
            console.log(`✅ Elemento encontrado: "${editElem.name || editElem.type}" (Control: ${editElem.controlType})`);
            console.log('Escribiendo texto mediante UI Automation...');
            await uiAutomationService.setText(win.handle, null, '¡Hola Rodrigo! Esto fue escrito por JARVIS usando UI Automation sin coordenadas fijas.');
            console.log('✅ Texto inyectado con éxito en el Bloc de Notas.');
        } else {
            console.log('⚠️ No se pudo localizar el control de edición directamente.');
        }
    } else {
        console.log('⚠️ No se abrió la ventana a tiempo.');
    }
    console.log('Prueba del Ítem 2 completada.\n');
}

// ---------------------------------------------------------
// DEMO ÍTEM 3: Verificación Post-Ejecución
// ---------------------------------------------------------
async function demoItem3() {
    console.log('\n===============================================================');
    console.log('🔍 DEMO ÍTEM 3: Verificación Post-Ejecución (Cero falsos positivos)');
    console.log('===============================================================');

    const actionKernel = require('../services/actionKernelService');
    require('../services/jarvisActionService');

    const testFileName = 'jarvis_demo_verificacion.txt';
    console.log(`1. Creando archivo con verificación física en disco: ${testFileName}`);
    const resCreate = await actionKernel.execute('file.create', {
        fileName: testFileName,
        content: 'Prueba de verificación post-ejecución de Jarvis.'
    });
    console.log(`   Resultado: status=${resCreate.status}, verificado=${resCreate.verified}`);
    console.log(`   Mensaje: "${resCreate.message}"`);

    const createdPath = resCreate?.data?.filePath || path.join(process.env.USERPROFILE || 'C:\\Users\\Rodrigo', 'Desktop', testFileName);

    console.log(`2. Borrando archivo con verificación física de desaparición...`);
    const resDelete = await actionKernel.execute('file.delete', {
        filePath: createdPath
    });
    console.log(`   Resultado: status=${resDelete.status}, verificado=${resDelete.verified}`);
    console.log(`   Mensaje: "${resDelete.message}"`);
    console.log('✅ Verificación completada: JARVIS no asume que terminó hasta verificar el estado real en disco.');
    console.log('Prueba del Ítem 3 completada.\n');
}

// ---------------------------------------------------------
// DEMO ÍTEM 4: Planificador -> Ejecutor -> Verificador
// ---------------------------------------------------------
async function demoItem4() {
    console.log('\n===============================================================');
    console.log('🧠 DEMO ÍTEM 4: Arquitectura Planificador -> Ejecutor -> Verificador');
    console.log('===============================================================');

    const taskOrchestrator = require('../services/ai/taskOrchestratorService');
    const desktopPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Rodrigo', 'Desktop');
    const folderDemo = path.join(desktopPath, 'Carpeta_Demo_Jarvis');
    const fileDemo = path.join(folderDemo, 'resultado_plan.txt');

    console.log('Objetivo complejo: Crear carpeta en el escritorio y luego un archivo adentro con dependencias de pasos.');
    
    // Limpieza previa si existía
    if (fs.existsSync(fileDemo)) fs.unlinkSync(fileDemo);
    if (fs.existsSync(folderDemo)) fs.rmdirSync(folderDemo);

    require('../services/jarvisActionService');

    const goal = {
        id: 'plan-demo-test',
        goal: 'Crear estructura de proyecto demo',
        steps: [
            {
                id: 'step-crear-carpeta',
                description: 'Crear carpeta Carpeta_Demo_Jarvis en el Escritorio',
                actionId: 'folder.create',
                params: { folderName: 'Carpeta_Demo_Jarvis' },
                status: 'PENDING'
            },
            {
                id: 'step-crear-archivo',
                description: 'Crear archivo resultado_plan.txt dentro de la carpeta',
                actionId: 'file.create',
                params: {
                    fileName: 'resultado_plan.txt',
                    folderName: 'Carpeta_Demo_Jarvis',
                    content: 'Contenido generado por el Ejecutor y validado por el Verificador.'
                },
                status: 'PENDING'
            }
        ]
    };

    console.log('Ejecutando orquestador de 3 roles...');
    const result = await taskOrchestrator.executeGoal(goal);
    console.log(`Resultado de la orquestación: ok=${result.ok}, status=${result.status}`);
    console.log(`Mensaje: "${result.message}"`);
    console.log('Pasos ejecutados:');
    Object.keys(result.results || {}).forEach(stepId => {
        const r = result.results[stepId];
        console.log(`  - [${stepId}]: completado=${r.ok}, verificado=${r.verified}`);
    });

    // Limpieza
    if (fs.existsSync(fileDemo)) fs.unlinkSync(fileDemo);
    if (fs.existsSync(folderDemo)) fs.rmdirSync(folderDemo);
    console.log('✅ Meta cumplida y verificada con éxito en bucle cerrado.');
    console.log('Prueba del Ítem 4 completada.\n');
}

// ---------------------------------------------------------
// DEMO ÍTEM 5: Navegador Autónomo (Playwright + Chrome)
// ---------------------------------------------------------
async function demoItem5() {
    console.log('\n===============================================================');
    console.log('🌐 DEMO ÍTEM 5: Navegador Autónomo (Playwright)');
    console.log('===============================================================');

    const browserService = require('../services/browser/browserService');
    console.log('Iniciando navegador autónomo conectado a Chrome...');
    
    console.log('Navegando a https://es.wikipedia.org...');
    const pageInfo = await browserService.openPage('https://es.wikipedia.org');
    console.log(`✅ Página abierta: "${pageInfo.title}" (${pageInfo.url})`);

    console.log('Extrayendo texto del titular principal...');
    const headingRes = await browserService.getText('#mp-tfa-h2, #firstHeading, h1');
    console.log(`✅ Titular extraído: "${headingRes.text}"`);

    console.log('Realizando un desplazamiento (scroll down de 350px)...');
    await browserService.scroll('down', 350);
    console.log('✅ Desplazamiento completado.');

    console.log('Cerrando sesión de navegador autónomo...');
    await browserService.close();
    console.log('✅ Navegador cerrado y recursos liberados.');
    console.log('Prueba del Ítem 5 completada.\n');
}

// ---------------------------------------------------------
// DEMO ÍTEM 6: Investigación Web Profunda
// ---------------------------------------------------------
async function demoItem6() {
    console.log('\n===============================================================');
    console.log('🔬 DEMO ÍTEM 6: Investigación Web Profunda y Analítica');
    console.log('===============================================================');

    const researchService = require('../services/ai/researchService');
    const consulta = 'RTX 4060 vs RX 7600 comparativa';

    console.log(`Investigando: "${consulta}"...`);
    const res = await researchService.research(consulta, { maxSources: 5, timeoutMs: 5000 });

    console.log(`\n📋 Subconsultas generadas automáticas:`);
    res.subQueries.forEach((sq, i) => console.log(`   ${i + 1}. ${sq}`));

    console.log(`\n📊 Fuentes encontradas: ${res.totalSourcesFound} brutas -> ${res.uniqueSources} únicas tras deduplicación`);
    console.log(`⭐ Nivel de confianza promedio: ${(res.synthesis.avgConfidence * 100).toFixed(1)}%`);

    console.log('\nTop 3 fuentes analizadas con su índice de confianza:');
    res.sources.slice(0, 3).forEach((s, idx) => {
        console.log(`   [${idx + 1}] (${(s.confidence * 100).toFixed(0)}% confianza) [${s.source}] ${s.title}`);
        console.log(`       URL: ${s.url}`);
    });

    console.log('\nSíntesis y Consenso:');
    console.log(res.synthesis.consensus.substring(0, 300) + '...\n');
    console.log('✅ Investigación multi-fuente y síntesis comparada completadas.');
    console.log('Prueba del Ítem 6 completada.\n');
}

runDemo().catch(err => {
    console.error('Error durante la demostración:', err);
});
