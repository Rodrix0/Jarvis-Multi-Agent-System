/**
 * test_document_templates.js
 * 
 * Suite de pruebas unitarias para el Ítem 44:
 * Mejorar Documentos con Sistema de Plantillas y Estilos Guardados.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { documentTemplateService } = require('../services/developer/documentTemplateService');
const fileOperationsService = require('../services/core/fileOperationsService');
const actionKernel = require('../services/actionKernelService');
require('../services/jarvisActionService');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${totalTests}. ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${totalTests}. ${name}`);
        console.error(`     Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
}

async function testAsync(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${totalTests}. ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${totalTests}. ${name}`);
        console.error(`     Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
}

async function runSuite() {
    console.log('===============================================================');
    console.log('📄 INICIANDO SUITE DE PRUEBAS: ÍTEM 44 - PLANTILLAS Y ESTILOS');
    console.log('===============================================================');

    const tempOutputDir = path.join(__dirname, 'temp_docs_output');
    try {
        fs.rmSync(tempOutputDir, { recursive: true, force: true });
    } catch (e) {}
    fs.mkdirSync(tempOutputDir, { recursive: true });

    // Test 1: Catálogo de plantillas contiene las 6 requeridas
    test('listTemplates retorna las 6 plantillas profesionales requeridas', () => {
        const templates = documentTemplateService.listTemplates();
        const ids = templates.map(t => t.id);
        assert.ok(ids.includes('universidad'));
        assert.ok(ids.includes('cv'));
        assert.ok(ids.includes('informe_tecnico'));
        assert.ok(ids.includes('monografia'));
        assert.ok(ids.includes('presentacion'));
        assert.ok(ids.includes('trabajo_practico'));
        assert.strictEqual(templates.length, 6);
    });

    // Test 2: Catálogo de estilos y guardado persistente de estilos personalizados
    test('listStyles y saveStyle permiten gestionar estilos visuales predefinidos y personalizados', () => {
        const styles = documentTemplateService.listStyles();
        const names = styles.map(s => s.name);
        assert.ok(names.includes('MODERN_CYBER'));
        assert.ok(names.includes('CLASSIC_ACADEMIC'));
        assert.ok(names.includes('ELEGANT_EXECUTIVE'));
        assert.ok(names.includes('CLEAN_MINIMAL'));

        // Guardar estilo personalizado
        const custom = documentTemplateService.saveStyle('VIOLET_STUDIO', {
            font: 'Consolas',
            primaryColor: '#6A0DAD',
            secondaryColor: '#9370DB'
        });
        assert.strictEqual(custom.name, 'VIOLET_STUDIO');
        assert.strictEqual(custom.font, 'Consolas');

        const retrieved = documentTemplateService.getStyle('VIOLET_STUDIO');
        assert.strictEqual(retrieved.primaryColor, '6A0DAD');
    });

    // Test 3: Plantilla Universidad (con portada, abstract, desarrollo y APA)
    await testAsync('renderDocument genera documento válido para plantilla "universidad"', async () => {
        const outPath = path.join(tempOutputDir, 'test_universidad.docx');
        const res = await documentTemplateService.renderDocument({
            template: 'universidad',
            style: 'CLASSIC_ACADEMIC',
            title: 'Análisis de Redes Neuronales Convolucionales',
            data: {
                institution: 'Universidad de Buenos Aires',
                career: 'Ingeniería en Informática',
                subject: 'Inteligencia Artificial Avanzada',
                author: 'Rodrigo',
                abstract: 'Resumen formal del trabajo de investigación sobre visión artificial.',
                content: 'Desarrollo extenso sobre arquitecturas ResNet y Vision Transformers.',
                conclusions: 'Los transformers demostraron superioridad en generalización.',
                bibliography: '1. Vaswani et al. (2017). Attention Is All You Need.'
            },
            outputPath: outPath
        });

        assert.strictEqual(res.ok, true);
        assert.ok(fs.existsSync(outPath));
        assert.ok(res.sizeBytes > 2000);
    });

    // Test 4: Plantilla CV (Currículum Vitae)
    await testAsync('renderDocument genera documento válido para plantilla "cv"', async () => {
        const outPath = path.join(tempOutputDir, 'test_cv.docx');
        const res = await documentTemplateService.renderDocument({
            template: 'cv',
            style: 'MODERN_CYBER',
            title: 'CV Rodrigo',
            data: {
                fullName: 'Rodrigo',
                profession: 'Lead Software & AI Engineer',
                email: 'rodrigo@ai.local',
                phone: '+54 9 11 1234-5678',
                location: 'Argentina',
                summary: 'Especialista en arquitectura distribuida y agentes autónomos.',
                experience: [
                    {
                        role: 'Principal AI Architect',
                        company: 'Autonomous Systems Corp',
                        period: '2023 - Presente',
                        tasks: ['Diseño del núcleo autónomo JARVIS.', 'Integración de modelos locales LLM.']
                    }
                ],
                skills: 'Node.js, Python, PyTorch, C#, Unity, Git, Docker, LLMs.'
            },
            outputPath: outPath
        });

        assert.strictEqual(res.ok, true);
        assert.ok(fs.existsSync(outPath));
        assert.ok(res.sizeBytes > 2000);
    });

    // Test 5: Plantilla Informe Técnico (con tabla de especificaciones)
    await testAsync('renderDocument genera documento válido para plantilla "informe_tecnico"', async () => {
        const outPath = path.join(tempOutputDir, 'test_informe_tecnico.docx');
        const res = await documentTemplateService.renderDocument({
            template: 'informe_tecnico',
            style: 'CLEAN_MINIMAL',
            title: 'Auditoría de Rendimiento de Jarvis Core',
            data: {
                author: 'Jarvis Diagnostics Engine',
                systemStatus: '100% Operativo - 0 Regresiones',
                summary: 'Informe técnico detallado de la infraestructura y telemetría de Jarvis.',
                metrics: 'TTFT: 410ms | Intent: 8ms | CPU: 8% | RAM: 7GB.',
                recommendations: 'Proceder con el despliegue del subsistema de perfiles.'
            },
            outputPath: outPath
        });

        assert.strictEqual(res.ok, true);
        assert.ok(fs.existsSync(outPath));
        assert.ok(res.sizeBytes > 2000);
    });

    // Test 6: Plantilla Monografía
    await testAsync('renderDocument genera documento válido para plantilla "monografia"', async () => {
        const outPath = path.join(tempOutputDir, 'test_monografia.docx');
        const res = await documentTemplateService.renderDocument({
            template: 'monografia',
            style: 'ELEGANT_EXECUTIVE',
            title: 'Evolución de la Inteligencia Artificial Simbiótica',
            data: {
                author: 'Equipo Jarvis',
                problemStatement: 'La necesidad de interfaces de control operacional resilientes y con gobernanza de riesgos.',
                content: 'Marco metodológico basado en máquinas de estados finitos y circuit breakers.'
            },
            outputPath: outPath
        });

        assert.strictEqual(res.ok, true);
        assert.ok(fs.existsSync(outPath));
        assert.ok(res.sizeBytes > 2000);
    });

    // Test 7: Plantilla Presentación (Slide Deck)
    await testAsync('renderDocument genera documento válido para plantilla "presentacion"', async () => {
        const outPath = path.join(tempOutputDir, 'test_presentacion.docx');
        const res = await documentTemplateService.renderDocument({
            template: 'presentacion',
            style: 'MODERN_CYBER',
            title: 'Roadmap Jarvis 2.0: De Asistente a Sistema Operativo Autónomo',
            data: {
                presenter: 'Rodrigo',
                agenda: ['1. Arquitectura de Kernel', '2. Coding Agent y Git', '3. Próximos Hitos']
            },
            outputPath: outPath
        });

        assert.strictEqual(res.ok, true);
        assert.ok(fs.existsSync(outPath));
        assert.ok(res.sizeBytes > 2000);
    });

    // Test 8: Plantilla Trabajo Práctico (TP)
    await testAsync('renderDocument genera documento válido para plantilla "trabajo_practico"', async () => {
        const outPath = path.join(tempOutputDir, 'test_tp.docx');
        const res = await documentTemplateService.renderDocument({
            template: 'trabajo_practico',
            style: 'CLASSIC_ACADEMIC',
            title: 'Implementación de Algoritmos de Búsqueda Heurística',
            data: {
                institution: 'Facultad de Ingeniería',
                subject: 'Algoritmos y Estructuras de Datos',
                tpNumber: '4',
                commission: 'C-2026',
                members: ['Rodrigo (Legajo 12345)', 'Compañero (Legajo 67890)'],
                content: 'Resolución de problemas de caminos mínimos usando A* y Dijkstra.'
            },
            outputPath: outPath
        });

        assert.strictEqual(res.ok, true);
        assert.ok(fs.existsSync(outPath));
        assert.ok(res.sizeBytes > 2000);
    });

    // Test 9: Integración en fileOperationsService (retrocompatibilidad y modo template)
    await testAsync('fileOperationsService.createFile admite templates y mantiene retrocompatibilidad estándar', async () => {
        // Modo estándar sin template (retrocompatibilidad)
        const stdRes = await fileOperationsService.createFile({
            fileName: 'balance_clasico.docx',
            content: 'Ingresos: $5000\nEgresos: $2000',
            format: 'docx'
        });
        assert.strictEqual(stdRes.ok, true);
        assert.ok(fs.existsSync(stdRes.filePath));
        fs.unlinkSync(stdRes.filePath); // Limpiar

        // Modo avanzado con template
        const tplRes = await fileOperationsService.createFile({
            fileName: 'informe_avanzado.docx',
            format: 'docx',
            template: 'informe_tecnico',
            style: 'MODERN_CYBER',
            templateData: { summary: 'Informe generado vía fileOperationsService con plantilla.' }
        });
        assert.strictEqual(tplRes.ok, true);
        assert.ok(fs.existsSync(tplRes.filePath));
        fs.unlinkSync(tplRes.filePath); // Limpiar
    });

    // Test 10: Integración en ActionKernel (document.template_create y document.template_list)
    await testAsync('ActionKernel ejecuta document.template_create y document.template_list', async () => {
        const listRes = await actionKernel.execute('document.template_list', {});
        assert.strictEqual(listRes.ok, true);
        assert.strictEqual(listRes.data.length, 6);

        const createRes = await actionKernel.execute('document.template_create', {
            template: 'informe_tecnico',
            title: 'Informe Kernel Test',
            style: 'MODERN_CYBER',
            data: { summary: 'Test ejecutado vía ActionKernel' }
        });
        assert.strictEqual(createRes.ok, true);
        assert.ok(createRes.data.filePath);
        if (fs.existsSync(createRes.data.filePath)) {
            fs.unlinkSync(createRes.data.filePath);
        }
    });

    // Limpieza de directorio temporal
    try {
        fs.rmSync(tempOutputDir, { recursive: true, force: true });
    } catch (e) {}

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 44 PASARON EXITOSAMENTE.\n');
    } else {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Fatal error en test_document_templates:', err);
    process.exit(1);
});
