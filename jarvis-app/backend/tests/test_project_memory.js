/**
 * Test Suite para el Ítem 16: Memoria por Proyectos (projectMemoryService.js)
 * Verifica:
 *   1. Creación e inicialización de namespaces aislados de proyectos (projects/).
 *   2. Almacenamiento estructurado del dossier (summary, decisions, files, facts, tasks).
 *   3. Gestión y progresión de tareas del proyecto (pending -> completed).
 *   4. Detección de intenciones y cambio de contexto ("Seguimos con Unity", "Facultad").
 *   5. Montaje de Contexto Compuesto (User Core + Project Dossier + Recuerdos Recientes).
 *   6. Aislamiento estricto de memoria (cero contaminación entre proyectos).
 */

const projectMemoryService = require('../services/memory/projectMemoryService');
const databaseService = require('../services/persistence/databaseService');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 16 - MEMORIA POR PROYECTOS ===\n');
    let passed = 0;
    let total = 0;

    // Limpieza inicial para idempotencia de pruebas
    try {
        databaseService.db.prepare("DELETE FROM projects_manifest WHERE id IN ('unity_horror', 'universidad', 'jarvis')").run();
    } catch (_) {}

    function assert(condition, message) {
        total++;
        if (condition) {
            console.log(`  [PASS] ${message}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${message}`);
        }
    }

    // 1. Creación de Proyectos
    console.log('--- Test 1: Creación de Namespaces de Proyectos ---');
    const pUnity = projectMemoryService.createOrUpdateProject({
        id: 'unity_horror',
        name: 'Unity Horror Game',
        aliases: ['unity', 'horror', 'juego'],
        summary: 'Juego narrativo de terror ambientado en bosque/camping desarrollado en Unity URP.'
    });
    assert(pUnity.ok === true && pUnity.id === 'unity_horror', 'Proyecto Unity Horror creado');

    const pFacu = projectMemoryService.createOrUpdateProject({
        id: 'universidad',
        name: 'Universidad / Facultad',
        aliases: ['facultad', 'facu', 'universidad', 'carrera'],
        summary: 'Materias y tesis de Ingeniería en Sistemas.'
    });
    assert(pFacu.ok === true && pFacu.id === 'universidad', 'Proyecto Universidad creado');

    const pJarvis = projectMemoryService.createOrUpdateProject({
        id: 'jarvis',
        name: 'Jarvis Multi-Agent System',
        aliases: ['jarvis', 'asistente', 'ia'],
        summary: 'Asistente inteligente con control total de Windows y seguridad multicapa.'
    });
    assert(pJarvis.ok === true && pJarvis.id === 'jarvis', 'Proyecto Jarvis creado');

    // 2. Población del Dossier Técnico de Unity Horror
    console.log('\n--- Test 2: Almacenamiento Estructurado del Dossier Técnico ---');
    // Hechos (Facts)
    projectMemoryService.addFact('unity_horror', 'Usa Unity URP 2022.3');
    projectMemoryService.addFact('unity_horror', 'Estilo visual PS1 retro');
    projectMemoryService.addFact('unity_horror', 'Target 60 FPS en PC');
    const factsCheck = projectMemoryService.getProject('unity_horror');
    assert(factsCheck.important_facts.length === 3, '3 hechos técnicos registrados en Unity Horror');

    // Decisiones de Arquitectura (Decisions)
    const dec1 = projectMemoryService.addDecision('unity_horror', 'Uso de Cinemachine', 'Transiciones cinemáticas fluidas en eventos de terror');
    assert(dec1.ok === true, 'Decisión arquitectónica de Cinemachine registrada');

    // Archivos Clave (Files)
    const f1 = projectMemoryService.addFileRef('unity_horror', 'Assets/Scripts/PlayerController.cs', 'code', 'Controlador principal del personaje');
    assert(f1.ok === true, 'Referencia a script de jugador guardada');

    // Tareas (Tasks)
    const t1 = projectMemoryService.addTask('unity_horror', 'Implementar shaders de niebla volumetrica', 'high');
    const t2 = projectMemoryService.addTask('unity_horror', 'Ajustar colisiones de arboles en el bosque', 'medium');
    assert(t1.ok === true && t2.ok === true, 'Tareas técnicas añadidas al backlog de Unity Horror');

    // Actualizar tarea
    projectMemoryService.updateTaskStatus('unity_horror', t1.task.id, 'completed');
    const unityProject = projectMemoryService.getProject('unity_horror');
    const completedTask = unityProject.tasks.find(t => t.id === t1.task.id);
    assert(completedTask.status === 'completed', 'Estado de tarea actualizado a completed');

    // 3. Detección Inteligente de Intención de Cambio de Proyecto
    console.log('\n--- Test 3: Detección Inteligente de Intención ("Seguimos con Unity") ---');
    const intentUnity = projectMemoryService.detectProjectIntent('Seguimos con Unity');
    assert(intentUnity.detected === true && intentUnity.projectId === 'unity_horror', 'Reconoce "Seguimos con Unity" -> unity_horror');

    const intentFacu = projectMemoryService.detectProjectIntent('Vamos al proyecto de la facu');
    assert(intentFacu.detected === true && intentFacu.projectId === 'universidad', 'Reconoce "Vamos al proyecto de la facu" -> universidad');

    const intentRandom = projectMemoryService.detectProjectIntent('Que clima hace hoy?');
    assert(intentRandom.detected === false, 'No confunde preguntas generales con cambio de proyecto');

    // 4. Registro de Interacción y Diálogo Específico
    console.log('\n--- Test 4: Historial de Diálogo Aislado ---');
    projectMemoryService.recordInteraction(
        'unity_horror',
        '¿Qué cantidad de árboles tenía mi bosque?',
        'El mapa actual contiene 319 árboles generados en el terreno principal.'
    );
    const updatedWithDialog = projectMemoryService.getProject('unity_horror');
    assert(updatedWithDialog.recent_context.length === 2, 'Diálogo registrado en la memoria de Unity Horror');

    // 5. Montaje de Contexto Compuesto
    console.log('\n--- Test 5: Montaje de Contexto Compuesto (User Core + Unity Dossier) ---');
    const mounted = projectMemoryService.mountProjectContext('Seguimos con Unity');
    assert(mounted.mounted === true, 'Contexto montado con éxito');
    assert(mounted.projectId === 'unity_horror', 'Proyecto activo es unity_horror');
    
    const contextText = mounted.contextText;
    assert(contextText.includes('NUCLEO DE USUARIO'), 'Contiene sección User Core');
    assert(contextText.includes('Unity URP 2022.3'), 'Contiene hechos clave de Unity');
    assert(contextText.includes('Cinemachine'), 'Contiene decisiones de arquitectura');
    assert(contextText.includes('319 árboles'), 'Contiene recuerdos recientes de Unity');
    assert(!contextText.includes('Ingeniería en Sistemas'), 'No contiene datos de Universidad (Aislamiento de namespaces respetado)');

    console.log(`\n=== RESULTADO FINAL: ${passed}/${total} PRUEBAS APROBADAS ===`);
    if (passed !== total) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en tests de project memory:', err);
    process.exit(1);
});
