const path = require('path');
const fs = require('fs');
const actionKernel = require('./actionKernelService');
const memoryService = require('./memoryService');
const modeService = require('./modeService');
const observerService = require('./observerService');
const systemService = require('./systemService');
const aiService = require('./aiService');
const tvService = require('./tvService');
const tvVoiceService = require('./tvVoiceService');
const informationDocumentService = require('./informationDocumentService');
const voiceLearningService = require('./voiceLearningService');
const financeService = require('./financeService');
const downloadService = require('./downloadService');

// --- V6 ENTERPRISE SERVICES ---
const fastCommandParser = require('./ai/fastCommandParser');
const emergencyService = require('./core/emergencyService');
const undoManager = require('./core/undoManager');
const explanationService = require('./core/explanationService');
const trashService = require('./core/trashService');
const memoryServiceV6 = require('./memory/memoryService');
const routineService = require('./automation/routineService');
const windowsControlService = require('./windowsControlService');
const homeAssistantService = require('./homeassistant/homeAssistantService');

let registered = false;

function registerActions() {
    if (registered) return;
    registered = true;

    // Emergency Stop
    actionKernel.register({
        id: 'emergency.stop', name: 'Parada de emergencia', description: 'Detiene todos los procesos y silencia audio al instante.',
        parameters: {}, permission: 'standard', examples: ['Detener todo', 'Abortar'],
        execute: async () => emergencyService.triggerEmergencyStop('VOICE_COMMAND')
    });

    // Undo Global
    actionKernel.register({
        id: 'undo.last', name: 'Deshacer última acción', description: 'Revierte la última acción reversible realizada.',
        parameters: {}, permission: 'standard', examples: ['Deshacé lo último'],
        execute: async () => undoManager.undoLast('GLOBAL')
    });

    // Task Management (Ítem 25)
    actionKernel.register({
        id: 'task.cancel', name: 'Cancelar tarea', description: 'Cancela la tarea activa especificada o la más reciente.',
        parameters: { target: 'Tipo o nombre de la tarea a cancelar' }, permission: 'standard', examples: ['Cancelá', 'Cancelá la descarga', 'Detener tarea'],
        execute: async ({ target } = {}) => {
            const taskManager = require('./core/taskManagerService');
            return taskManager.cancelCurrent(target);
        }
    });
    actionKernel.register({
        id: 'task.pause', name: 'Pausar tarea', description: 'Pausa la tarea en ejecución.',
        parameters: { target: 'Tipo o ID de la tarea' }, permission: 'standard', examples: ['Pausá la descarga', 'Pausá'],
        execute: async ({ target } = {}) => {
            const taskManager = require('./core/taskManagerService');
            const active = taskManager.getActiveTasks();
            if (active.length === 0) return { ok: false, message: 'No hay ninguna tarea activa para pausar.' };
            const task = target ? active.find(t => t.type.includes(target) || t.id === target) || active[active.length - 1] : active[active.length - 1];
            return taskManager.pause(task.id);
        }
    });
    actionKernel.register({
        id: 'task.resume', name: 'Reanudar tarea', description: 'Reanuda una tarea pausada.',
        parameters: { target: 'Tipo o ID de la tarea' }, permission: 'standard', examples: ['Reanudá la descarga', 'Continuá la tarea'],
        execute: async ({ target } = {}) => {
            const taskManager = require('./core/taskManagerService');
            const paused = taskManager.listTasks({ status: 'PAUSED' });
            if (paused.length === 0) return { ok: false, message: 'No hay ninguna tarea pausada para reanudar.' };
            const task = target ? paused.find(t => t.type.includes(target) || t.id === target) || paused[0] : paused[0];
            return taskManager.resume(task.id);
        }
    });
    actionKernel.register({
        id: 'task.list', name: 'Listar tareas activas', description: 'Informa las tareas actualmente en ejecución.',
        parameters: {}, permission: 'standard', examples: ['Qué tareas hay activas', 'Listar tareas'],
        execute: async () => {
            const taskManager = require('./core/taskManagerService');
            const active = taskManager.getActiveTasks();
            if (active.length === 0) return { ok: true, count: 0, message: 'No hay ninguna tarea activa en este momento.' };
            const summary = active.map((t, idx) => `${idx + 1}. [${t.type}] ${t.description} (${t.status})`).join('\n');
            return {
                ok: true,
                count: active.length,
                tasks: active,
                message: `Hay ${active.length} tarea${active.length > 1 ? 's' : ''} activa${active.length > 1 ? 's' : ''}:\n${summary}`
            };
        }
    });

    // Persistent Task Recovery (Ítem 28)
    actionKernel.register({
        id: 'task.recover', name: 'Recuperar tareas interrumpidas', description: 'Escanea SQLite y recupera tareas huérfanas de sesiones anteriores.',
        parameters: {}, permission: 'standard', examples: ['Recuperar tareas pendientes', 'Continuar tareas interrumpidas'],
        execute: async () => {
            const taskManager = require('./core/taskManagerService');
            const res = await taskManager.recoverOrphanTasks();
            return {
                ok: true,
                count: res.count,
                recovered: res.recovered,
                data: res,
                message: res.count > 0
                    ? `Se recuperaron ${res.count} tarea${res.count > 1 ? 's' : ''} pendiente${res.count > 1 ? 's' : ''} de sesiones anteriores.`
                    : 'No había tareas pendientes para recuperar.'
            };
        }
    });
    actionKernel.register({
        id: 'task.retry', name: 'Reintentar tarea', description: 'Reintenta una tarea específica por ID o la más reciente fallida.',
        parameters: { taskId: 'ID de la tarea' }, permission: 'standard', examples: ['Reintentar tarea', 'Reintentar'],
        execute: async ({ taskId } = {}) => {
            const taskManager = require('./core/taskManagerService');
            let targetId = taskId;
            if (!targetId) {
                const failed = taskManager.listTasks({ status: 'FAILED' });
                if (failed.length > 0) targetId = failed[0].id;
            }
            if (!targetId) return { ok: false, message: 'No se indicó una tarea para reintentar.' };
            return taskManager.retryTask(targetId);
        }
    });
    actionKernel.register({
        id: 'task.history', name: 'Historial de tareas persistentes', description: 'Consulta el registro de tareas en SQLite con puntos de control.',
        parameters: { limit: 'Límite de registros' }, permission: 'standard', examples: ['Ver historial de tareas', 'Registro de tareas'],
        execute: async ({ limit = 20 } = {}) => {
            const taskManager = require('./core/taskManagerService');
            const history = taskManager.listTasks({ limit: Number(limit) || 20, fromDb: true });
            return {
                ok: true,
                count: history.length,
                tasks: history,
                data: { count: history.length, tasks: history },
                message: `Se encontraron ${history.length} tareas en el registro histórico.`
            };
        }
    });

    // Conditional Automation Engine (Ítem 27)
    actionKernel.register({
        id: 'automation.create-rule', name: 'Crear automatización condicional', description: 'Crea una regla de automatización reactiva por eventos y condiciones.',
        parameters: { rule: 'Objeto o especificación de la regla (trigger, filters, actions)' }, permission: 'standard', examples: ['Crear regla', 'Automatizar cuando termine la descarga'],
        execute: async (params = {}) => {
            const conditionalAutomation = require('./automation/conditionalAutomationService');
            const ruleData = params.rule || params;
            const created = conditionalAutomation.createRule(ruleData);
            return {
                ok: true,
                rule: created,
                data: { rule: created },
                message: `Automatización "${created.name}" creada con éxito (ID: ${created.id}).`
            };
        }
    });
    actionKernel.register({
        id: 'automation.list-rules', name: 'Listar automatizaciones', description: 'Lista todas las reglas de automatización condicional configuradas.',
        parameters: {}, permission: 'standard', examples: ['Listar automatizaciones', 'Ver reglas de automatización'],
        execute: async () => {
            const conditionalAutomation = require('./automation/conditionalAutomationService');
            const rules = conditionalAutomation.getAllRules();
            if (rules.length === 0) return { ok: true, count: 0, rules: [], data: { count: 0, rules: [] }, message: 'No hay reglas de automatización configuradas.' };
            const summary = rules.map((r, i) => `${i + 1}. [${r.enabled ? 'ACTIVA' : 'INACTIVA'}] "${r.name}" (Evento: ${r.trigger.event})`).join('\n');
            return {
                ok: true,
                count: rules.length,
                rules,
                data: { count: rules.length, rules },
                message: `Hay ${rules.length} automatización${rules.length > 1 ? 'es' : ''}:\n${summary}`
            };
        }
    });
    actionKernel.register({
        id: 'automation.toggle-rule', name: 'Alternar regla de automatización', description: 'Habilita o deshabilita una regla por ID.',
        parameters: { id: 'ID de la regla', enabled: 'Opcional booleano' }, permission: 'standard', examples: ['Pausar regla', 'Activar regla'],
        execute: async ({ id, enabled } = {}) => {
            const conditionalAutomation = require('./automation/conditionalAutomationService');
            const updated = conditionalAutomation.toggleRule(id, enabled);
            if (!updated) return { ok: false, message: `No se encontró la regla ${id}.` };
            return {
                ok: true,
                rule: updated,
                data: { rule: updated },
                message: `Regla "${updated.name}" ahora está ${updated.enabled ? 'activada' : 'desactivada'}.`
            };
        }
    });
    actionKernel.register({
        id: 'automation.delete-rule', name: 'Eliminar regla de automatización', description: 'Elimina definitivamente una regla de automatización.',
        parameters: { id: 'ID de la regla a eliminar' }, permission: 'standard', examples: ['Borrar regla de automatización'],
        execute: async ({ id } = {}) => {
            const conditionalAutomation = require('./automation/conditionalAutomationService');
            const deleted = conditionalAutomation.deleteRule(id);
            return {
                ok: deleted,
                message: deleted ? `Regla ${id} eliminada.` : `No se pudo eliminar la regla ${id}.`
            };
        }
    });
    actionKernel.register({
        id: 'automation.test-rule', name: 'Probar regla de automatización', description: 'Ejecuta una simulación (dry-run) de una regla contra datos de prueba.',
        parameters: { id: 'ID de la regla', mockPayload: 'Datos simulados del evento' }, permission: 'standard', examples: ['Probar automatización'],
        execute: async ({ id, mockPayload = {} } = {}) => {
            const conditionalAutomation = require('./automation/conditionalAutomationService');
            return conditionalAutomation.testRule(id, mockPayload);
        }
    });

    // Home Assistant & Domótica (Ítem 29)
    actionKernel.register({
        id: 'ha.command', name: 'Comando de domótica', description: 'Ejecuta una acción o servicio sobre dispositivos inteligentes en Home Assistant.',
        parameters: { text: 'Orden en lenguaje natural', domain: 'Dominio HA', service: 'Servicio HA', entity_id: 'Entidad de HA' }, permission: 'standard',
        examples: ['Prende la luz del living', 'Pone el aire a 24 grados', 'Apaga las luces', 'Prende el enchufe'],
        execute: async (params = {}) => {
            let res;
            if (params.text) {
                res = await homeAssistantService.executeCommand(params.text);
            } else if (params.domain && params.service) {
                res = await homeAssistantService.callService(params.domain, params.service, params);
            } else {
                return { ok: false, message: 'Faltan parámetros para la orden de domótica.' };
            }
            return { ok: res?.success !== false, data: res, message: res?.message || 'Comando de domótica ejecutado.' };
        }
    });
    actionKernel.register({
        id: 'ha.get-state', name: 'Consultar estado de dispositivo', description: 'Consulta el valor o estado de un sensor o entidad de Home Assistant.',
        parameters: { entity_id: 'ID de la entidad a consultar' }, permission: 'standard', examples: ['Estado de la luz', 'Temperatura del living'],
        execute: async ({ entity_id } = {}) => {
            const state = homeAssistantService.getState(entity_id);
            if (!state) return { ok: false, message: `Dispositivo ${entity_id} no encontrado.` };
            return {
                ok: true,
                data: { entity_id, state: state.state, attributes: state.attributes },
                message: `El estado de ${entity_id} es ${state.state}.`
            };
        }
    });
    actionKernel.register({
        id: 'ha.list-devices', name: 'Listar dispositivos inteligentes', description: 'Lista todos los dispositivos domóticos sincronizados.',
        parameters: { domain: 'Filtro opcional por dominio (light, climate, switch, sensor)' }, permission: 'standard', examples: ['Listar luces', 'Ver dispositivos inteligentes'],
        execute: async ({ domain } = {}) => {
            const devices = homeAssistantService.listDevices(domain);
            return {
                ok: true,
                data: { count: devices.length, devices },
                message: `Se encontraron ${devices.length} dispositivos${domain ? ` en el dominio ${domain}` : ''}.`
            };
        }
    });
    actionKernel.register({
        id: 'ha.sync', name: 'Sincronizar Home Assistant', description: 'Sincroniza el inventario completo de entidades con Home Assistant.',
        parameters: {}, permission: 'standard', examples: ['Sincronizar domótica', 'Actualizar dispositivos'],
        execute: async () => {
            await homeAssistantService.syncAllStates();
            return { ok: true, data: { ok: true }, message: 'Dispositivos de Home Assistant sincronizados con éxito.' };
        }
    });

    // Windows Audio
    actionKernel.register({
        id: 'audio.set-volume', name: 'Ajustar volumen', description: 'Ajusta el volumen de Windows de 0 a 100%.',
        parameters: { percent: 'Porcentaje de volumen (0-100)' }, permission: 'standard',
        execute: async ({ percent }) => windowsControlService.audio.setVolume(percent)
    });
    actionKernel.register({
        id: 'audio.toggle-mute', name: 'Silenciar audio', description: 'Alterna el silencio de Windows.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.audio.toggleMute()
    });

    // Windows Display
    actionKernel.register({
        id: 'display.set-brightness', name: 'Ajustar brillo', description: 'Ajusta el brillo de la pantalla de 0 a 100%.',
        parameters: { percent: 'Porcentaje de brillo' }, permission: 'standard',
        execute: async ({ percent }) => windowsControlService.display.setBrightness(percent)
    });
    actionKernel.register({
        id: 'display.screenshot', name: 'Captura de pantalla', description: 'Toma una captura de pantalla y la guarda en el Escritorio.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.display.takeScreenshot()
    });

    // Windows System Telemetry & Process
    actionKernel.register({
        id: 'system.get-battery', name: 'Consultar batería', description: 'Consulta el nivel y estado de la batería.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.power.getBatteryStatus()
    });
    actionKernel.register({
        id: 'system.get-top-consumers', name: 'Consultar consumo de RAM/CPU', description: 'Lista las 5 aplicaciones que más recursos consumen.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.process.getTopResourceConsumers()
    });
    actionKernel.register({
        id: 'system.get-disk-space', name: 'Consultar espacio en disco', description: 'Consulta el espacio disponible en discos.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.metrics.getDiskSpace()
    });
    actionKernel.register({
        id: 'clipboard.read', name: 'Leer portapapeles', description: 'Lee el texto actual del portapapeles.',
        parameters: {}, permission: 'standard',
        execute: async () => windowsControlService.clipboard.readClipboard()
    });

    // Window & Tab Controls (Fast deterministic UI actions)
    actionKernel.register({
        id: 'window.minimize', name: 'Minimizar ventana', description: 'Minimiza la ventana activa.',
        parameters: {}, permission: 'standard', examples: ['Minimiza', 'Minimizar ventana'],
        execute: async () => windowsControlService.windowTab.minimizeActive()
    });
    actionKernel.register({
        id: 'window.minimize-all', name: 'Minimizar todo / Mostrar escritorio', description: 'Minimiza todas las ventanas abiertas.',
        parameters: {}, permission: 'standard', examples: ['Minimiza todo', 'Mostrar escritorio'],
        execute: async () => windowsControlService.windowTab.minimizeAll()
    });
    actionKernel.register({
        id: 'window.maximize', name: 'Maximizar ventana', description: 'Maximiza la ventana activa.',
        parameters: {}, permission: 'standard', examples: ['Maximiza', 'Pantalla completa'],
        execute: async () => windowsControlService.windowTab.maximizeActive()
    });
    actionKernel.register({
        id: 'window.close', name: 'Cerrar ventana', description: 'Cierra la ventana o aplicación activa.',
        parameters: {}, permission: 'standard', examples: ['Cerrar ventana', 'Cerra el programa'],
        execute: async () => windowsControlService.windowTab.closeWindow()
    });
    actionKernel.register({
        id: 'window.next', name: 'Cambiar de ventana', description: 'Cambia a la siguiente ventana abierta.',
        parameters: {}, permission: 'standard', examples: ['Cambia de ventana', 'Siguiente ventana'],
        execute: async () => windowsControlService.windowTab.nextWindow()
    });
    actionKernel.register({
        id: 'tab.next', name: 'Siguiente pestaña', description: 'Avanza a la siguiente pestaña en el navegador o editor.',
        parameters: {}, permission: 'standard', examples: ['Siguiente pestaña', 'Cambia de pestaña'],
        execute: async () => windowsControlService.windowTab.nextTab()
    });
    actionKernel.register({
        id: 'tab.prev', name: 'Pestaña anterior', description: 'Retrocede a la pestaña anterior en el navegador o editor.',
        parameters: {}, permission: 'standard', examples: ['Pestaña anterior', 'Anterior pestaña'],
        execute: async () => windowsControlService.windowTab.prevTab()
    });
    actionKernel.register({
        id: 'tab.close', name: 'Cerrar pestaña', description: 'Cierra la pestaña actual.',
        parameters: {}, permission: 'standard', examples: ['Cerrar pestaña', 'Cerra'],
        execute: async () => windowsControlService.windowTab.closeTab()
    });
    actionKernel.register({
        id: 'tab.new', name: 'Nueva pestaña', description: 'Abre una nueva pestaña.',
        parameters: {}, permission: 'standard', examples: ['Nueva pestaña'],
        execute: async () => windowsControlService.windowTab.newTab()
    });
    actionKernel.register({
        id: 'tab.go-to', name: 'Ir a pestaña específica', description: 'Cambia a una pestaña específica por número (1 a 9).',
        parameters: { index: 'Número de pestaña' }, permission: 'standard', examples: ['Andá a la pestaña 4', 'Pestaña 5', 'Ir a la pestaña 1'],
        execute: async ({ index }) => windowsControlService.windowTab.goToTab(index)
    });

    // WhatsApp Messaging
    actionKernel.register({
        id: 'whatsapp.send', name: 'Enviar mensaje de WhatsApp', description: 'Envía un mensaje de WhatsApp a un contacto especificado.',
        parameters: { contact: 'Nombre del contacto', message: 'Mensaje a enviar' }, permission: 'standard',
        examples: ['Mandale un mensaje a Color Cartón que diga te amo', 'Enviá un mensaje a mamá que diga llego en 10', 'Un mensaje a Color Cartón que diga te amo'],
        execute: async ({ contact, message }) => windowsControlService.whatsapp.sendMessage(contact, message)
    });

    // UI Automation (Semantic Windows Control)
    const uiAutomationService = require('./windows/uiAutomationService');
    actionKernel.register({
        id: 'ui.click', name: 'Hacer clic semántico en botón', description: 'Hace clic en un botón o control de una ventana por su nombre visible sin depender de coordenadas fijas.',
        parameters: { window: 'Título de la ventana', element: 'Nombre del botón o control' }, permission: 'standard',
        examples: ['Hacé clic en Aceptar', 'Apretá el botón Descargar en Chrome', 'Hacé clic en Cerrar en el Bloc de notas'],
        execute: async ({ window, element, options }) => {
            const res = await uiAutomationService.clickElement(window, element, options);
            return {
                ok: true,
                message: `Hice clic en "${element}" en la ventana "${window}". Método: ${res.method || 'UIAutomation'}.`,
                data: res
            };
        }
    });
    actionKernel.register({
        id: 'ui.type', name: 'Escribir texto en campo', description: 'Escribe texto en un campo o caja de búsqueda de una ventana.',
        parameters: { window: 'Título de la ventana', element: 'Nombre del campo de texto', text: 'Texto a ingresar' }, permission: 'standard',
        examples: ['Escribí en el campo Buscar', 'Escribí en la barra de direcciones'],
        execute: async ({ window, element, text, options }) => {
            const res = await uiAutomationService.setText(window, element, text, options);
            return {
                ok: true,
                message: `Escribí "${text}" en el campo "${element || 'principal'}" de "${window}".`,
                data: res
            };
        }
    });
    actionKernel.register({
        id: 'ui.inspect', name: 'Inspeccionar controles de ventana', description: 'Lista los botones y campos visibles de una ventana.',
        parameters: { window: 'Título de la ventana' }, permission: 'standard',
        execute: async ({ window }) => {
            const win = await uiAutomationService.findWindow(window);
            if (!win) return { ok: false, message: `No encontré la ventana "${window}".` };
            const hwnd = win.Hwnd || win.hwnd;
            const res = await uiAutomationService._runBridge(['-Action', 'find-elements', '-Hwnd', String(hwnd)]);
            return {
                ok: true,
                message: `Inspección completada: ${res.count || 0} controles encontrados.`,
                window: win,
                elementsCount: res.count || 0,
                elements: res.elements || []
            };
        }
    });

    // Autonomous Browser Subsystem (Playwright)
    const browserService = require('./browser/browserService');
    actionKernel.register({
        id: 'browser.open', name: 'Abrir página web en navegador autónomo', description: 'Navega a un sitio web en el navegador autónomo Playwright.',
        parameters: { url: 'URL del sitio web' }, permission: 'standard',
        execute: async ({ url, options }) => {
            const res = await browserService.openPage(url, options);
            return { ok: true, message: `Página "${res.title}" cargada exitosamente.`, data: res };
        }
    });
    actionKernel.register({
        id: 'browser.click', name: 'Hacer clic en elemento web', description: 'Hace clic en un botón, enlace o elemento de la página web actual.',
        parameters: { selector: 'Selector CSS o texto del elemento' }, permission: 'standard',
        execute: async ({ selector, options }) => {
            const res = await browserService.click(selector, options);
            return { ok: true, message: `Clic ejecutado en "${selector}".`, data: res };
        }
    });
    actionKernel.register({
        id: 'browser.type', name: 'Escribir en formulario web', description: 'Escribe texto en un campo de texto o búsqueda web.',
        parameters: { selector: 'Selector del campo', text: 'Texto a escribir' }, permission: 'standard',
        execute: async ({ selector, text, options }) => {
            const res = await browserService.write(selector, text, options);
            return { ok: true, message: `Escribí en "${selector}".`, data: res };
        }
    });
    actionKernel.register({
        id: 'browser.get-text', name: 'Leer contenido web', description: 'Extrae el texto visible de la página o de un elemento.',
        parameters: { selector: 'Selector opcional (por defecto toda la página)' }, permission: 'standard',
        execute: async ({ selector, options }) => {
            const res = await browserService.getText(selector || 'body', options);
            return { ok: true, message: `Contenido extraído (${res.length} caracteres).`, data: res };
        }
    });
    actionKernel.register({
        id: 'browser.scroll', name: 'Desplazar página web', description: 'Hace scroll hacia abajo o arriba en la página web.',
        parameters: { direction: 'down o up', amount: 'Píxeles' }, permission: 'standard',
        execute: async ({ direction, amount, options }) => {
            const res = await browserService.scroll(direction, amount, options);
            return { ok: true, message: `Scroll realizado.`, data: res };
        }
    });
    actionKernel.register({
        id: 'browser.close', name: 'Cerrar navegador autónomo', description: 'Cierra la sesión del navegador autónomo.',
        parameters: {}, permission: 'standard',
        execute: async () => {
            const res = await browserService.close();
            return { ok: true, message: 'Navegador autónomo cerrado.', data: res };
        }
    });

    // Advanced Web Research Subsystem
    const researchService = require('./ai/researchService');
    actionKernel.register({
        id: 'research.query', name: 'Investigación web profunda', description: 'Realiza una investigación analítica multi-fuente con subconsultas y síntesis comparada.',
        parameters: { question: 'Pregunta o tema a investigar', options: 'Opciones adicionales (timeout, maxSources)' }, permission: 'standard',
        execute: async ({ question, query, options }) => {
            const topic = question || query;
            const res = await researchService.research(topic, options);
            return {
                ok: true,
                message: `Investigación sobre "${topic}" completada con ${res.uniqueSources} fuentes analizadas.`,
                data: res
            };
        }
    });

    // Vision Subsystem (Screen OCR & Error Diagnosis)
    const visionService = require('./vision/visionService');
    actionKernel.register({
        id: 'vision.analyze-screen', name: 'Analizar pantalla y diagnosticar error', description: 'Captura la pantalla, extrae el texto por OCR e interpreta el error o contenido visible.',
        parameters: { query: 'Pregunta o consulta del usuario', imagePath: 'Ruta de imagen opcional' }, permission: 'standard', examples: ['Fijate qué error salió', 'Qué dice la pantalla'],
        execute: async ({ query, imagePath }) => {
            const res = await visionService.analyzeScreen(query || '¿Qué error o situación aparece en pantalla?', imagePath);
            return {
                ok: true,
                reply: res.reply,
                message: res.reply,
                context: res.context
            };
        }
    });

    // File & Folder Operations with Rollback
    const fileOperationsService = require('./core/fileOperationsService');
    const verificationService = require('./core/verificationService');
    actionKernel.register({
        id: 'file.create', name: 'Crear archivo o documento', description: 'Crea un archivo (.txt, .docx) o nota en el Escritorio o carpeta.',
        parameters: { fileName: 'Nombre del archivo', content: 'Contenido opcional', format: 'txt o docx', folderName: 'Carpeta opcional', topic: 'Tema opcional' }, permission: 'standard',
        execute: async ({ fileName, content, format = 'txt', folderName, topic }) => fileOperationsService.createFile({ fileName, content, format, folderName, topic }),
        verifier: async (output, { fileName, folderName }) => {
            const target = output?.filePath || (folderName && fileName ? path.join(fileOperationsService.getDesktopPath(), folderName, fileName) : null);
            if (target) {
                return verificationService.verifyFileCreated(target, { timeoutMs: 2000 });
            }
            return { verified: true };
        }
    });
    actionKernel.register({
        id: 'folder.create', name: 'Crear carpeta', description: 'Crea una carpeta en el Escritorio.',
        parameters: { folderName: 'Nombre de la carpeta' }, permission: 'standard',
        execute: async ({ folderName }) => fileOperationsService.createFolder({ folderName }),
        verifier: async (output, { folderName }) => {
            const target = output?.folderPath || (folderName ? path.join(fileOperationsService.getDesktopPath(), folderName) : null);
            if (target) {
                return verificationService.verifyFolderCreated(target, { timeoutMs: 2000 });
            }
            return { verified: true };
        }
    });
    actionKernel.register({
        id: 'folder.delete', name: 'Eliminar carpeta', description: 'Mueve una carpeta a la papelera segura de Jarvis.',
        parameters: { folderName: 'Nombre de la carpeta' }, permission: 'standard',
        execute: async ({ folderName }) => fileOperationsService.deleteFolder(folderName),
        verifier: async (output, { folderName }) => {
            if (folderName) {
                const target = path.join(fileOperationsService.getDesktopPath(), folderName);
                return verificationService.verifyDeleted(target, { timeoutMs: 2000 });
            }
            return { verified: true };
        }
    });
    actionKernel.register({
        id: 'file.delete', name: 'Mover archivo a papelera segura', description: 'Mueve un archivo a la papelera segura de Jarvis.',
        parameters: { filePath: 'Ruta o nombre del archivo' }, permission: 'standard',
        execute: async ({ filePath }) => trashService.moveToTrash(filePath),
        verifier: async (output, { filePath }) => {
            if (filePath && filePath !== 'last_screenshot') {
                return verificationService.verifyDeleted(filePath, { timeoutMs: 2000 });
            }
            return { verified: true };
        }
    });
    actionKernel.register({
        id: 'file.restore', name: 'Restaurar archivo de papelera', description: 'Restaura un archivo previamente eliminado.',
        parameters: { identifier: 'Nombre del archivo' }, permission: 'standard',
        execute: async ({ identifier }) => trashService.restoreFromTrash(identifier)
    });

    // Memory V6
    actionKernel.register({
        id: 'memory.query-v6', name: 'Consultar memoria', description: 'Consulta recuerdos y preferencias almacenadas.',
        parameters: { topic: 'Tema a consultar' }, permission: 'standard',
        execute: async ({ topic }) => {
            const results = memoryServiceV6.queryMemory(topic, true);
            if (results.length === 0) return { message: `No tengo recuerdos registrados sobre "${topic}".` };
            const summary = results.map(r => `• ${r.value}`).join('\n');
            return { message: `Esto es lo que recuerdo sobre ${topic}:\n${summary}` };
        }
    });
    actionKernel.register({
        id: 'memory.forget-v6', name: 'Olvidar memoria', description: 'Olvida recuerdos sobre un tema específico.',
        parameters: { topic: 'Tema a olvidar' }, permission: 'standard',
        execute: async ({ topic }) => memoryServiceV6.forgetMemory(topic)
    });

    // --- Coding Agent Autónomo (Ítem 41) ---
    const { codingAgentService } = require('./developer/codingAgentService');
    actionKernel.register({
        id: 'code.autonomous_fix',
        name: 'Reparar código con Coding Agent',
        description: 'Mapea el repositorio, localiza archivos relevantes, modifica código, compila, auto-repara errores y genera diff.',
        parameters: { instruction: 'Instrucción o bug a solucionar', projectPath: 'Ruta al proyecto o repositorio' },
        permission: 'standard',
        riskLevel: 'MEDIUM',
        examples: ['Arreglá el sistema de inventario de mi Unity', 'Repará el error en el controller de mi API'],
        execute: async ({ instruction, projectPath }) => {
            const targetPath = projectPath || process.cwd();
            const result = await codingAgentService.executeAutonomousFix({
                projectPath: targetPath,
                instruction
            });
            return {
                ok: result.ok,
                data: result,
                message: result.report || result.error
            };
        }
    });

    // --- Integración Git con Gobernanza de Ramas Protegidas (Ítem 42) ---
    const { gitIntegrationService } = require('./developer/gitIntegrationService');
    actionKernel.register({
        id: 'git.status',
        name: 'Estado de Git',
        description: 'Consulta el estado detallado del repositorio Git (rama, modificaciones, staged, untracked).',
        parameters: { projectPath: 'Ruta del repositorio (opcional)' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ projectPath } = {}) => {
            const res = gitIntegrationService.getStatus(projectPath);
            return { ok: res.isGit, data: res, message: res.isGit ? `Rama: ${res.branch}, Cambios: ${res.totalChanges}` : res.error };
        }
    });

    actionKernel.register({
        id: 'git.diff',
        name: 'Diferencias Git',
        description: 'Muestra las diferencias (diff) del repositorio o de un archivo específico.',
        parameters: { projectPath: 'Ruta del repo', file: 'Archivo específico (opcional)', staged: 'Ver solo staged' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ projectPath, file, staged } = {}) => {
            const res = gitIntegrationService.getDiff(projectPath, { file, staged });
            return { ok: res.ok, data: res, message: res.diff };
        }
    });

    actionKernel.register({
        id: 'git.safe_branch',
        name: 'Asegurar Rama Segura',
        description: 'Garantiza que Jarvis trabaje en una rama segura (jarvis/<slug>) sin tocar ramas protegidas como main o master.',
        parameters: { projectPath: 'Ruta del repo', taskName: 'Nombre descriptivo de la tarea o fix' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ projectPath, taskName } = {}) => {
            const res = gitIntegrationService.ensureSafeBranch(projectPath, taskName);
            return { ok: res.ok, data: res, message: res.message };
        }
    });

    actionKernel.register({
        id: 'git.safe_commit',
        name: 'Commit Seguro con Política',
        description: 'Realiza un commit en Git validando que la rama actual NO esté protegida y agregando firma de auditoría.',
        parameters: { projectPath: 'Ruta del repo', message: 'Mensaje de commit', files: 'Archivos específicos (opcional)' },
        permission: 'standard',
        riskLevel: 'MEDIUM',
        execute: async ({ projectPath, message, files } = {}) => {
            const res = gitIntegrationService.commit(projectPath, message, { files });
            return { ok: res.ok, data: res, message: res.summary || res.error };
        }
    });

    actionKernel.register({
        id: 'git.rollback',
        name: 'Rollback Git Seguro',
        description: 'Restaura el árbol de trabajo o revierte el último commit preservando la integridad.',
        parameters: { projectPath: 'Ruta del repo', mode: 'working_tree o commit' },
        permission: 'standard',
        riskLevel: 'MEDIUM',
        execute: async ({ projectPath, mode } = {}) => {
            const res = gitIntegrationService.rollback(projectPath, mode);
            return { ok: res.ok, data: res, message: res.message || res.error };
        }
    });

    actionKernel.register({
        id: 'git.summary',
        name: 'Resumen de Cambios Git',
        description: 'Compara la rama actual de Jarvis contra la base (main) y genera un reporte legible de cambios.',
        parameters: { projectPath: 'Ruta del repo', baseBranch: 'Rama base (default: main)' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ projectPath, baseBranch } = {}) => {
            const res = gitIntegrationService.summarizeWork(projectPath, baseBranch);
            return { ok: res.ok, data: res, message: res.summary || res.error };
        }
    });

    // --- Snapshots Universales antes de Modificar Proyectos (Ítem 43) ---
    const { snapshotService } = require('./developer/snapshotService');
    actionKernel.register({
        id: 'snapshot.create',
        name: 'Crear Snapshot de Proyecto',
        description: 'Genera un punto de restauración atómico (Git o Manifiesto) antes de realizar modificaciones en un proyecto o carpeta.',
        parameters: { projectPath: 'Ruta del proyecto', label: 'Etiqueta descriptiva del snapshot' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ projectPath, label } = {}) => {
            const res = await snapshotService.createSnapshot(projectPath, label);
            return { ok: true, data: res, message: `Snapshot ${res.id} creado (${res.provider}, ${res.filesCount} archivos).` };
        }
    });

    actionKernel.register({
        id: 'snapshot.restore',
        name: 'Restaurar Snapshot de Proyecto',
        description: 'Restaura un snapshot atómico revirtiendo cambios en archivos y limpiando archivos nuevos agregados.',
        parameters: { snapshotId: 'ID del snapshot a restaurar' },
        permission: 'standard',
        riskLevel: 'HIGH',
        execute: async ({ snapshotId } = {}) => {
            const res = await snapshotService.restoreSnapshot(snapshotId);
            return { ok: res.ok, data: res, message: res.message };
        }
    });

    actionKernel.register({
        id: 'snapshot.list',
        name: 'Listar Snapshots',
        description: 'Lista los snapshots disponibles para un proyecto o carpeta.',
        parameters: { projectPath: 'Ruta del proyecto (opcional)' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ projectPath } = {}) => {
            const list = snapshotService.listSnapshots(projectPath);
            return { ok: true, data: list, message: `${list.length} snapshots disponibles.` };
        }
    });

    // --- Motor de Plantillas de Documentos y Estilos Guardados (Ítem 44) ---
    const { documentTemplateService } = require('./developer/documentTemplateService');
    actionKernel.register({
        id: 'document.template_create',
        name: 'Crear Documento desde Plantilla',
        description: 'Genera un documento Word (.docx) formal utilizando plantillas (universidad, cv, informe_tecnico, monografia, presentacion, trabajo_practico) y estilos guardados.',
        parameters: { template: 'Nombre de la plantilla', style: 'Estilo visual (opcional)', title: 'Título del documento', data: 'Datos estructurados para la plantilla' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ template, style, title, data = {} } = {}) => {
            const res = await documentTemplateService.renderDocument({ template, style, data, title });
            return { ok: res.ok, data: res, message: `Documento generado con plantilla '${res.template}' y estilo '${res.style}' en: ${res.filePath}` };
        }
    });

    actionKernel.register({
        id: 'document.template_list',
        name: 'Listar Plantillas de Documentos',
        description: 'Lista todas las plantillas de documentos profesionales disponibles en Jarvis.',
        parameters: {},
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async () => {
            const templates = documentTemplateService.listTemplates();
            return { ok: true, data: templates, message: `${templates.length} plantillas disponibles.` };
        }
    });

    actionKernel.register({
        id: 'document.style_list',
        name: 'Listar Estilos Guardados',
        description: 'Lista los estilos de diseño visual (incorporados y personalizados) para documentos.',
        parameters: {},
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async () => {
            const styles = documentTemplateService.listStyles();
            return { ok: true, data: styles, message: `${styles.length} estilos de diseño disponibles.` };
        }
    });

    actionKernel.register({
        id: 'document.style_save',
        name: 'Guardar Estilo de Documento',
        description: 'Guarda un nuevo estilo visual personalizado con paleta de colores y tipografía.',
        parameters: { name: 'Nombre del estilo', styleConfig: 'Configuración visual (font, primaryColor, secondaryColor...)' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ name, styleConfig } = {}) => {
            const saved = documentTemplateService.saveStyle(name, styleConfig);
            return { ok: true, data: saved, message: `Estilo '${saved.name}' guardado exitosamente.` };
        }
    });

    // --- Sistema de Perfiles de Comportamiento (Ítem 45) ---
    const { behaviorProfileService } = require('./intelligence/behaviorProfileService');
    actionKernel.register({
        id: 'profile.switch',
        name: 'Cambiar Perfil de Comportamiento',
        description: 'Conmuta el perfil activo (NORMAL, CODING, GAMING, STUDY, HOME) adaptando herramientas, modelos LLM y verbosidad.',
        parameters: { profileId: 'ID del perfil (NORMAL, CODING, GAMING, STUDY, HOME)' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ profileId } = {}) => {
            const res = behaviorProfileService.switchProfile(profileId);
            return { ok: res.ok, data: res, message: res.message };
        }
    });

    actionKernel.register({
        id: 'profile.current',
        name: 'Consultar Perfil Activo',
        description: 'Obtiene la configuración del perfil de comportamiento activo en Jarvis.',
        parameters: {},
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async () => {
            const profile = behaviorProfileService.getActiveProfile();
            return { ok: true, data: profile, message: `Perfil activo: ${profile.name} (${profile.id})` };
        }
    });

    actionKernel.register({
        id: 'profile.list',
        name: 'Listar Perfiles de Comportamiento',
        description: 'Lista los perfiles de comportamiento disponibles en Jarvis.',
        parameters: {},
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async () => {
            const profiles = behaviorProfileService.listProfiles();
            return { ok: true, data: profiles, message: `${profiles.length} perfiles disponibles.` };
        }
    });

    // --- Contexto de Actividad en Tiempo Real (Ítem 46) ---
    const { activityContextService } = require('./intelligence/activityContextService');
    actionKernel.register({
        id: 'context.current',
        name: 'Contexto de Actividad Actual',
        description: 'Obtiene el contexto en tiempo real: aplicación activa, archivo en foco, proyecto, monitor, hora y dispositivos cercanos.',
        parameters: {},
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async () => {
            const ctx = await activityContextService.getCurrentContext();
            return { ok: true, data: ctx, message: `Activo: ${ctx.app} | Archivo: ${ctx.file || 'Ninguno'} | Proyecto: ${ctx.project || 'Ninguno'}` };
        }
    });

    actionKernel.register({
        id: 'context.resolve_implicit',
        name: 'Resolver Comando Implícito',
        description: 'Interpreta y resuelve órdenes con pronombres ("compilalo", "guardalo", "cerralo") según la app y archivo activo.',
        parameters: { utterance: 'Comando del usuario (e.g. "compilalo", "cerralo")' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ utterance } = {}) => {
            const res = await activityContextService.resolveImplicitCommand(utterance);
            return { ok: res.ok, data: res, message: res.message };
        }
    });

    // --- Clipboard Inteligente Bajo Demanda (Ítem 47) ---
    const { smartClipboardService } = require('./intelligence/smartClipboardService');
    actionKernel.register({
        id: 'clipboard.process',
        name: 'Procesar Portapapeles Inteligente',
        description: 'Procesa el portapapeles bajo comando ("arreglame esto", "mandale esto a mamá", "explicame esto", "traducí esto").',
        parameters: { utterance: 'Comando o instrucción deíctica del usuario', explicitText: 'Texto opcional' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ utterance, explicitText } = {}) => {
            const res = await smartClipboardService.processClipboardIntent({ utterance, explicitText });
            return { ok: res.ok, data: res, message: res.message || res.error };
        }
    });

    actionKernel.register({
        id: 'clipboard.read',
        name: 'Leer Portapapeles Bajo Demanda',
        description: 'Lee el contenido actual del portapapeles de Windows de forma segura (sin espionaje pasivo).',
        parameters: {},
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async () => {
            const text = smartClipboardService.readClipboard();
            const type = smartClipboardService.classifyContent(text);
            return { ok: true, data: { text, type }, message: `Portapapeles (${type}): ${text.slice(0, 60)}...` };
        }
    });

    actionKernel.register({
        id: 'clipboard.write',
        name: 'Escribir en Portapapeles',
        description: 'Copia un texto en el portapapeles de Windows.',
        parameters: { text: 'Texto a escribir' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ text } = {}) => {
            const ok = smartClipboardService.writeClipboard(text);
            return { ok, message: ok ? 'Copiado al portapapeles.' : 'Error al copiar al portapapeles.' };
        }
    });

    // --- Historial de Acciones y Timeline (Ítem 48) ---
    const { actionTimelineService } = require('./core/actionTimelineService');
    actionKernel.register({
        id: 'timeline.query',
        name: 'Consultar Historial de Acciones',
        description: 'Responde consultas sobre las acciones recientes de Jarvis (ej. "¿qué hiciste en los últimos 20 minutos?").',
        parameters: { utterance: 'Consulta temporal del usuario' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ utterance } = {}) => {
            const res = actionTimelineService.queryTimeline(utterance);
            return { ok: res.ok, data: res, message: res.message };
        }
    });

    actionKernel.register({
        id: 'timeline.recent',
        name: 'Listar Línea Temporal',
        description: 'Obtiene la lista cronológica de las acciones ejecutadas en los últimos minutos.',
        parameters: { minutes: 'Ventana en minutos (default: 20)' },
        permission: 'standard',
        riskLevel: 'LOW',
        execute: async ({ minutes = 20 } = {}) => {
            const res = actionTimelineService.getTimeline(Number(minutes));
            return { ok: true, data: res, message: res.formattedText };
        }
    });

    actionKernel.register({
        id: 'timeline.undo_last',
        name: 'Deshacer Último Cambio',
        description: 'Revierte la última acción reversible registrada en la línea temporal (archivos, código, git o sistema).',
        parameters: {},
        permission: 'standard',
        riskLevel: 'MEDIUM',
        execute: async () => {
            const res = await actionTimelineService.undoLastAction();
            return { ok: res.ok, data: res, message: res.message || res.error };
        }
    });

    // Routines & Explanations
    actionKernel.register({
        id: 'routine.execute', name: 'Ejecutar rutina', description: 'Ejecuta una rutina de sistema configurada.',
        parameters: { routineName: 'Nombre de la rutina' }, permission: 'standard',
        execute: async ({ routineName }) => routineService.executeRoutine(routineName)
    });
    actionKernel.register({
        id: 'explain.query', name: 'Explicar decisión o historial', description: 'Explica decisiones operativas y muestra historial.',
        parameters: { query: 'Consulta de explicación' }, permission: 'standard', riskLevel: 'LOW',
        execute: async ({ query }) => {
            const explanation = await explanationService.explainDecision(query);
            return { ok: true, message: explanation, explanation };
        }
    });

    actionKernel.register({
        id: 'explain.last_decision', name: 'Explicar última decisión', description: 'Retorna la trazabilidad y explicación detallada de la última decisión tomada.',
        parameters: { tool: 'Filtro opcional por herramienta' }, permission: 'standard', riskLevel: 'LOW',
        execute: async ({ tool } = {}) => {
            const dec = explanationService.getLastDecision(tool);
            if (!dec) return { ok: false, message: 'No hay decisiones registradas recientemente.' };
            return { ok: true, data: dec, message: dec.userExplanation };
        }
    });

    actionKernel.register({
        id: 'explain.action', name: 'Explicar acción específica', description: 'Consulta la explicación y motivo de una acción específica.',
        parameters: { action: 'Nombre o filtro de la acción' }, permission: 'standard', riskLevel: 'LOW',
        execute: async ({ action } = {}) => {
            const explanation = await explanationService.explainDecision(action);
            return { ok: true, message: explanation };
        }
    });

    // --- Sistema de Objetivos Jerárquicos y Ejecución Autónoma (Ítem 50) ---
    const goalManager = require('./goals/goalManagerService');
    actionKernel.register({
        id: 'goal.plan', name: 'Planificar Objetivo', description: 'Desglosa una meta de alto nivel en un plan de subobjetivos jerárquicos.',
        parameters: { instruction: 'Meta o instrucción del usuario' }, permission: 'standard', riskLevel: 'LOW',
        execute: async ({ instruction } = {}) => {
            const goal = goalManager.planGoalFromInstruction(instruction);
            return { ok: true, goal, message: `Objetivo planificado con ${goal.subgoals.length} subobjetivos.` };
        }
    });

    actionKernel.register({
        id: 'goal.plan_and_execute', name: 'Planificar y Ejecutar Objetivo', description: 'Planifica y comienza la ejecución autónoma paso a paso de una meta.',
        parameters: { instruction: 'Meta o instrucción del usuario', maxSteps: 'Número máximo de pasos' }, permission: 'standard', riskLevel: 'MEDIUM',
        execute: async ({ instruction, maxSteps = 20 } = {}) => {
            const goal = goalManager.planGoalFromInstruction(instruction);
            const res = await goalManager.executeGoalStepByStep(goal.id, { maxSteps: Number(maxSteps) });
            return { ok: res.ok, data: res, message: `Ejecutados ${res.stepsExecuted} pasos para el objetivo "${goal.title}". Progreso: ${res.progress.progressPercentage}%.` };
        }
    });

    actionKernel.register({
        id: 'goal.step', name: 'Avanzar Paso de Objetivo', description: 'Ejecuta el siguiente subobjetivo pendiente de un objetivo activo.',
        parameters: { goalId: 'ID del objetivo' }, permission: 'standard', riskLevel: 'MEDIUM',
        execute: async ({ goalId } = {}) => {
            const res = await goalManager.stepGoal(goalId);
            return { ok: res.ok, data: res, message: res.message || res.error };
        }
    });

    actionKernel.register({
        id: 'goal.progress', name: 'Consultar Progreso de Objetivo', description: 'Consulta el estado actual, porcentaje de avance y lista de subobjetivos.',
        parameters: { goalId: 'ID del objetivo' }, permission: 'standard', riskLevel: 'LOW',
        execute: async ({ goalId } = {}) => {
            const prog = goalManager.getGoalProgress(goalId);
            if (!prog) return { ok: false, message: 'Objetivo no encontrado.' };
            return { ok: true, data: prog, progress: prog, message: `Objetivo "${prog.title}": ${prog.progressPercentage}% (${prog.completedSteps}/${prog.totalSteps} pasos).` };
        }
    });

    actionKernel.register({
        id: 'goal.pause', name: 'Pausar Objetivo', description: 'Pausa temporalmente la ejecución autónoma de un objetivo.',
        parameters: { goalId: 'ID del objetivo' }, permission: 'standard', riskLevel: 'LOW',
        execute: async ({ goalId } = {}) => {
            const res = goalManager.pauseGoal(goalId);
            return { ok: true, data: res, message: 'Objetivo pausado con éxito.' };
        }
    });

    actionKernel.register({
        id: 'goal.resume', name: 'Reanudar Objetivo', description: 'Reanuda la ejecución autónoma de un objetivo pausado.',
        parameters: { goalId: 'ID del objetivo' }, permission: 'standard', riskLevel: 'LOW',
        execute: async ({ goalId } = {}) => {
            const res = goalManager.resumeGoal(goalId);
            return { ok: true, data: res, message: 'Objetivo reanudado con éxito.' };
        }
    });

    actionKernel.register({
        id: 'voice.wake', name: 'Despertar a Jarvis', description: 'Sale del modo descanso y acepta órdenes hasta que el usuario lo apague.',
        parameters: {}, permission: 'standard', examples: ['Jarvis, prendete', 'Prendete', 'Despertate'],
        execute: async () => {
            const statePath = path.join(__dirname, '..', 'data', 'local_voice_state.json');
            let wasAwake = false;
            try {
                const cur = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                if (cur && cur.state === 'awake') wasAwake = true;
            } catch (_) {}
            try {
                fs.writeFileSync(statePath, JSON.stringify({ state: 'awake', updatedAt: Date.now() }, null, 2));
            } catch (_) {}
            if (wasAwake) {
                return { message: 'Ya estoy en línea y escuchando. ¿Qué necesitás?', data: { voiceState: 'awake' }, evidence: { stateChanged: false } };
            }
            return { message: 'Estoy en línea. ¿Qué necesitás?', data: { voiceState: 'awake' }, evidence: { stateChanged: true } };
        }
    });
    actionKernel.register({
        id: 'voice.sleep', name: 'Poner a Jarvis en descanso', description: 'Ignora órdenes normales y conserva solamente la escucha de la frase de activación.',
        parameters: {}, permission: 'standard', examples: ['Jarvis, apagate', 'Apagate', 'Dormite', 'Modo descanso'],
        execute: async () => {
            const statePath = path.join(__dirname, '..', 'data', 'local_voice_state.json');
            try {
                fs.writeFileSync(statePath, JSON.stringify({ state: 'dormant', updatedAt: Date.now() }, null, 2));
            } catch (_) {}
            return { message: 'Entendido, entrando en modo espera.', data: { voiceState: 'dormant' }, evidence: { stateChanged: true } };
        }
    });

    actionKernel.register({
        id: 'voice.correct', name: 'Corregir una transcripción',
        description: 'Aprende una corrección personal sin agregar el título a una lista fija.',
        parameters: { from: 'Texto entendido', to: 'Texto correcto' }, permission: 'memory-write',
        examples: ['No dije Lodo Hero, dije Dorohedoro'],
        execute: async ({ from, to }) => {
            memoryService.addCorrection(from, to);
            return { message: `Entendido. Cuando escuche “${from}”, lo corregiré como “${to}”.`, evidence: { stored: true, from, to } };
        }
    });

    actionKernel.register({
        id: 'memory.preference', name: 'Recordar una preferencia',
        description: 'Guarda solamente preferencias que el usuario pide recordar de forma explícita.',
        parameters: { key: 'Tema', value: 'Preferencia' }, permission: 'memory-write',
        examples: ['Recordá que prefiero Netflix en la tele'],
        execute: async ({ key, value }) => {
            const item = memoryService.addPreference(key, value, 'explicit-voice');
            return { message: 'Guardé esa preferencia. Podés verla o borrarla desde el panel de memoria.', data: item, evidence: { stored: true, id: item.id } };
        }
    });

    actionKernel.register({
        id: 'memory.clear', name: 'Borrar recuerdos',
        description: 'Borra una categoría o toda la memoria central.',
        parameters: { collection: 'preferences, corrections, conversations, summaries o all' },
        permission: 'destructive', confirmation: true,
        confirmationMessage: ({ collection }) => `¿Confirmás que querés borrar ${collection === 'all' ? 'toda la memoria' : collection}?`,
        examples: ['Borrá todas tus correcciones'],
        execute: async ({ collection = 'all' }) => {
            memoryService.clear(collection);
            return { message: 'Memoria borrada.', evidence: { collection, cleared: true } };
        }
    });

    // TV Volume and Learning Actions (BroadLink / TV)
    actionKernel.register({
        id: 'tv.set-volume', name: 'Ajustar volumen de la televisión',
        description: 'Ajusta el volumen exacto de la televisión por control BroadLink del 0 al 100%.',
        parameters: { percent: 'Porcentaje de volumen (0-100)' }, permission: 'physical-device',
        examples: ['Poné el volumen de la tele al 30', 'Volumen de la tele al 70%'],
        execute: async ({ percent }) => tvService.setVolume(percent)
    });
    actionKernel.register({
        id: 'tv.adjust-volume', name: 'Subir/Bajar volumen de la televisión',
        description: 'Sube o baja el volumen de la televisión por control BroadLink.',
        parameters: { delta: 'Diferencia de volumen (-100 a 100)' }, permission: 'physical-device',
        examples: ['Subí el volumen de la tele', 'Bajá el volumen de la tele 20'],
        execute: async ({ delta }) => tvService.adjustVolume(delta)
    });
    actionKernel.register({
        id: 'tv.get-volume', name: 'Consultar volumen de la televisión',
        description: 'Obtiene el volumen actual estimado de la televisión.',
        parameters: {}, permission: 'standard',
        examples: ['¿A cuánto está el volumen de la tele?', 'Volumen de la tele'],
        execute: async () => tvService.getVolume()
    });
    actionKernel.register({
        id: 'tv.calibrate-volume', name: 'Calibrar volumen de la televisión',
        description: 'Sincroniza el nivel actual del televisor con la memoria de Jarvis.',
        parameters: { level: 'Nivel actual en pantalla (0-100)' }, permission: 'standard',
        examples: ['El volumen de la tele está en 25', 'Calibrá el volumen de la tele a 15'],
        execute: async ({ level }) => tvService.calibrateVolume(level)
    });
    actionKernel.register({
        id: 'tv.learn-button', name: 'Aprender botón del control remoto',
        description: 'Pone al BroadLink en modo aprendizaje para capturar una tecla física (volup, voldown, power, etc.).',
        parameters: { button: 'Nombre del botón (volup, voldown, power, netflix, etc.)' }, permission: 'physical-device',
        examples: ['Aprendé subir volumen', 'Aprendé bajar volumen'],
        execute: async ({ button }) => {
            await tvService.learnButton(button);
            return { ok: true, message: `¡Excelente! Aprendí el botón ${button} del control remoto con éxito.` };
        }
    });

    actionKernel.register({
        id: 'tv.enter-netflix', name: 'Ingresar a perfil en Netflix',
        description: 'Presiona OK para ingresar al perfil de Rodri en Netflix.',
        parameters: {}, permission: 'physical-device',
        examples: ['Ingresá a Netflix', 'Entrá a mi cuenta de Netflix'],
        execute: async () => tvService.enterNetflixProfile()
    });
    actionKernel.register({
        id: 'tv.open-search', name: 'Abrir buscador de Netflix',
        description: 'Navega hacia el buscador de Netflix y abre el teclado en pantalla.',
        parameters: {}, permission: 'physical-device',
        examples: ['Andá a la búsqueda', 'Abrí el buscador de Netflix'],
        execute: async () => tvService.openNetflixSearch()
    });

    actionKernel.register({
        id: 'tv.control', name: 'Controlar TV y Netflix',
        description: 'Ejecuta únicamente una intención validada por el controlador de TV.',
        parameters: { intent: 'Intención estructurada de TV' }, permission: 'physical-device',
        dependencies: [{ id: 'broadlink', label: 'BroadLink configurado', check: async () => ({ available: await tvService.isAvailable(), detail: 'Debe estar en la misma red que la PC.' }) }],
        examples: ['Prendé la tele y abrí Netflix', 'Buscá The Walking Dead', 'Bajá dos veces'],
        execute: async ({ intent }, context) => {
            const message = await context.executeTvIntent(intent, context.onTvProgress);
            return { message, evidence: { intent: intent.action, deviceAccepted: true } };
        }
    });

    actionKernel.register({
        id: 'system.open', name: 'Abrir aplicación o sitio en la notebook',
        description: 'Abre una aplicación detectada o un sitio conocido y comprueba si el lanzador aceptó la orden.',
        parameters: { appName: 'Aplicación o sitio' }, permission: 'desktop-control',
        examples: ['Abrí Spotify', 'Abrí Netflix en la computadora'],
        retry: true,
        execute: async ({ appName }) => {
            const success = await systemService.openApp(appName, modeService.getActiveMode().id);
            return success
                ? { message: `Abrí ${appName} en la computadora.`, evidence: { launcherAccepted: true, appName } }
                : { ok: false, message: `No pude abrir ${appName}.`, evidence: { launcherAccepted: false, appName } };
        },
        verifier: async (output, { appName }) => {
            return verificationService.verifyAppOpened(appName, {
                timeoutMs: 4000,
                retryFn: () => systemService.openApp(appName, modeService.getActiveMode().id)
            });
        }
    });

    actionKernel.register({
        id: 'system.media-search', name: 'Buscar contenido multimedia en la notebook',
        description: 'Abre directamente resultados de YouTube o Netflix en la computadora, sin pasar por el razonamiento general.',
        parameters: { platform: 'youtube o netflix', query: 'Canal, película, serie o video' }, permission: 'desktop-control',
        examples: ['Buscá el canal de Kurzgesagt en YouTube', 'Buscá The Walking Dead en Netflix en la compu'],
        execute: async ({ platform, query }) => {
            const success = await systemService.openMediaSearch(platform, query);
            const label = platform === 'youtube' ? 'YouTube' : 'Netflix';
            return success
                ? { message: `Abrí la búsqueda de ${query} en ${label} desde la computadora.`, evidence: { launcherAccepted: true, platform, query } }
                : { ok: false, message: `No pude abrir la búsqueda en ${label}.`, evidence: { launcherAccepted: false, platform, query } };
        }
    });

    actionKernel.register({
        id: 'document.create-info', name: 'Crear documento informativo en el Escritorio',
        description: 'Genera localmente un informe de Word cuando el usuario pide información sobre un tema.',
        parameters: { topic: 'Tema solicitado' }, permission: 'desktop-control',
        dependencies: [{ id: 'ollama', label: 'Motor local Ollama', check: () => true }],
        examples: ['Dame información sobre computación cuántica', 'Buscame info de Alan Turing'],
        execute: async ({ topic }) => {
            const result = await informationDocumentService.createOnDesktop(topic);
            return {
                message: `Preparé la información sobre ${topic} y guardé el documento en tu Escritorio como ${require('path').basename(result.filePath)}.`,
                data: { filePath: result.filePath },
                evidence: { fileCreated: true, filePath: result.filePath }
            };
        }
    });

    actionKernel.register({
        id: 'information.dollar', name: 'Consultar cotización del dólar',
        description: 'Consulta la cotización argentina actual y devuelve datos reales de compra y venta.',
        parameters: { type: 'oficial, blue, MEP, tarjeta u otro tipo opcional' },
        permission: 'standard', examples: ['¿Cuánto está el dólar?', 'Decime el dólar blue', 'Cotización del dólar MEP'],
        execute: async ({ type = '' }) => {
            const quote = await financeService.getDollarQuote(type);
            return { message: quote.message, evidence: { liveData: true, provider: 'DolarApi', type } };
        }
    });

    actionKernel.register({
        id: 'download.url', name: 'Descargar un enlace',
        description: 'Descarga localmente el enlace explícito entregado por el usuario.',
        parameters: { url: 'Enlace HTTP o HTTPS', audioOnly: 'Descargar solamente audio' },
        permission: 'desktop-control', examples: ['Descargame esto https://…', 'Bajá el audio de este enlace https://…'],
        execute: async ({ url, audioOnly = false }) => {
            if (!/^https?:\/\/\S+$/i.test(String(url || ''))) throw new Error('Necesito un enlace HTTP o HTTPS válido.');
            const directory = await downloadService.downloadMedia(url, Boolean(audioOnly));
            return {
                message: `Terminé la descarga y la guardé en ${directory}.`,
                data: { directory }, evidence: { downloadCompleted: true, directory, url }
            };
        }
    });

    actionKernel.register({
        id: 'system.learn-command', name: 'Enseñar un comando manual',
        description: 'Guarda una frase manual asociada a una aplicación; no genera variaciones automáticas.',
        parameters: { trigger: 'Frase', appName: 'Aplicación' }, permission: 'memory-write',
        examples: ['Cuando diga trabajo, abrí Visual Studio Code'],
        execute: async ({ trigger, appName }) => {
            systemService.saveCustomCommand(trigger, appName);
            return { message: `Guardé “${trigger}” para abrir ${appName}.`, evidence: { stored: true, trigger, appName } };
        }
    });

    actionKernel.register({
        id: 'observer.set', name: 'Modo observador',
        description: 'Activa o desactiva la lectura local de la ventana activa.',
        parameters: { enabled: 'Booleano' }, permission: 'screen-observation',
        examples: ['Activá el observador', 'Desactivá el observador'],
        execute: async ({ enabled }) => {
            const state = observerService.toggleObserver(Boolean(enabled));
            return { message: `Modo observador ${state ? 'activado' : 'desactivado'}.`, evidence: { enabled: state } };
        }
    });

    actionKernel.register({
        id: 'mode.activate', name: 'Activar modo', description: 'Cambia el modo de operación existente.',
        parameters: { modeId: 'ID o nombre' }, permission: 'standard', examples: ['Activá modo estudio'],
        execute: async ({ modeId }) => {
            const target = modeService.getAllModes().find(mode => mode.id === normalize(modeId) || normalize(mode.name) === normalize(modeId));
            if (!target || !modeService.setActiveMode(target.id)) return { ok: false, message: `No existe el modo ${modeId}.` };
            return { message: `Activé el modo ${target.name}.`, data: { modeId: target.id }, evidence: { active: modeService.getActiveMode().id === target.id } };
        }
    });

    actionKernel.register({
        id: 'assistant.respond', name: 'Comprensión general contextual',
        description: 'Responde libremente con el modo activo, el tema actual, recuerdos recientes y contexto de pantalla autorizado.',
        parameters: { text: 'Solicitud libre' }, permission: 'standard',
        dependencies: [{ id: 'ai-engine', label: 'Motor de IA', check: () => true }],
        examples: ['Explicame esto', 'Seguí con lo anterior', 'Ayudame con mi proyecto'],
        execute: async ({ text, referenceContext = [] }, context) => {
            const preferences = memoryService.snapshot().preferences;
            const memoryContext = referenceContext.length
                ? `Contexto de la conversación actual:\n${referenceContext.map(turn => `${turn.role}: ${turn.text}`).join('\n')}`
                : '';
            const preferenceContext = preferences.length
                ? `Preferencias que el usuario autorizó recordar:\n${preferences.map(item => `${item.key}: ${item.value}`).join('\n')}`
                : '';
            const screenContext = observerService.getScreenContext();
            const combined = [memoryContext, preferenceContext, screenContext].filter(Boolean).join('\n\n');
            const message = await aiService.getAIResponse(text, modeService.getActiveMode(), combined || null, context.inpaintingMask);
            // El texto sí fue producido, pero aiService todavía contiene herramientas
            // heredadas que no devuelven evidencia estructurada. Nunca las marcamos
            // como ejecución verificada hasta que migren a una acción propia.
            return { message, verified: false, evidence: { responseProduced: true, externalSideEffectsVerified: false, topic: memoryService.detectTopic(text) } };
        }
    });
}

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[!?;:¡¿]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseCorrection(text) {
    const match = String(text).match(/no\s+dije\s+[“"']?(.+?)[”"']?\s*,?\s*dije\s+[“"']?(.+?)[”"']?[.!]?$/i);
    return match && { from: match[1].trim(), to: match[2].trim() };
}

function parsePreference(text) {
    const match = String(text).match(/(?:record[aá]|acordate)(?:\s+de)?\s+que\s+(.+)/i);
    if (!match) return null;
    return { key: memoryService.detectTopic(match[1]), value: match[1].trim() };
}

function parseDesktopMediaSearch(text) {
    const clean = normalize(text);
    const wantsSearch = /\b(busca|buscame|buscar|encontra|encontrame|pone|poneme|reproduce|reproducime|quiero ver|mostrar)\b/.test(clean);
    if (!wantsSearch) return null;
    const wantsTv = /\b(tele|television|tv)\b/.test(clean);
    const wantsComputer = /\b(compu|computadora|pc|notebook|laptop)\b/.test(clean);
    let platform = '';
    if (/\byoutube\b/.test(clean) && !wantsTv) platform = 'youtube';
    if (/\bnetflix\b/.test(clean) && wantsComputer && !wantsTv) platform = 'netflix';
    if (!platform) return null;

    let query = clean
        .replace(/^.*?\b(?:busca|buscame|buscar|encontra|encontrame|pone|poneme|reproduce|reproducime|quiero ver|mostrar)\b\s*/, '')
        .replace(/\b(?:en|desde)\s+(?:mi\s+|la\s+)?(?:compu|computadora|pc|notebook|laptop)\b.*$/, '')
        .replace(/\b(?:en|por)\s+(?:youtube|netflix)\b/g, '')
        .replace(/\b(?:youtube|netflix)\b/g, '')
        .replace(/^\s*(?:el\s+canal|canal|la\s+pelicula|la\s+serie|pelicula|serie|video)\s+(?:de\s+)?/, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!query) return null;
    return { platform, query };
}

function parseInformationDocument(text) {
    const clean = String(text || '').trim();
    
    // Formas variadas: "quiero buscar información de...", "haceme un documento de...", "crear informe sobre...", etc.
    const match = clean.match(/(?:dame|busc(?:a|ame)|consegui(?:me)?|investiga|quiero\s+buscar|necesito)\s+(?:algo\s+de\s+)?(?:informaci[oó]n|info|datos)(?:\s+(?:detallada|completa|completos))?\s+(?:sobre|de|acerca\s+de)\s+(.+)/i)
        || clean.match(/(?:hac(?:e|eme)|cre(?:a|ame)|gener(?:a|ame)|redact(?:a|ame))\s+(?:un\s+)?(?:documento|informe|word|resumen|reporte|docx)(?:\s+(?:completo|detallado))?\s+(?:sobre|de|acerca\s+de)\s+(.+)/i)
        || clean.match(/^(?:informame|inf[oó]rmame)\s+(?:sobre|de)\s+(.+)/i);
        
    if (!match) return null;
    
    let topic = match[1]
        .replace(/\s+y\s+(?:guard(?:a|alo)|crea|gener[aá]|dej[aá]|dejalo|pon[eé]lo)(?:me)?\s+(?:un\s+)?(?:documento|word|docx|en\s+el\s+escritorio|en\s+mi\s+escritorio).*$/i, '')
        .replace(/\s+(?:en|para)\s+el\s+escritorio.*$/i, '')
        .replace(/[.!?]+$/, '')
        .trim();
        
    return topic.length >= 2 ? { topic } : null;
}

function parseDownload(text) {
    const raw = String(text || '');
    const url = raw.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;!?]+$/, '');
    if (!url || !/\b(descarga|descargar|descargame|baja|bajar|bajame|guarda|guardar|guardame)\b/i.test(normalize(raw))) return null;
    return { url, audioOnly: /\b(audio|musica|cancion|mp3)\b/i.test(normalize(raw)) };
}

function parseDollar(text) {
    const clean = normalize(text);
    if (!/\b(dolar|cotizacion)\b/.test(clean)) return null;
    if (!/\b(cuanto|precio|cotizacion|valor|esta|decime|dame|consulta|consultame)\b/.test(clean)) return null;
    return { type: financeService.requestedDollarType(clean) };
}

async function resolve(text) {
    registerActions();
    let clean = String(text || '').trim();
    // Normalización fonética para términos comúnmente malinterpretados por STT
    clean = clean
        .replace(/\b(?:un\s+)?(?:tequi\s*te|tequiste|tequi|te\s+que\s+te|tequis|tx\s*t|t\s+x\s+t)\b/gi, 'txt')
        .replace(/\b(crear|creame|crea|hacer|haceme|hace|generar|genera)\s+(?:un\s+)?tequila\b/gi, '$1 un txt')
        .replace(/\bmini\s+misa\b/gi, 'minimiza')
        .replace(/\bminimisa\b/gi, 'minimiza')
        .replace(/\bmaxi\s+misa\b/gi, 'maximiza')
        .replace(/\bmaximisa\b/gi, 'maximiza');
    const lower = normalize(clean);

    // 1. Wake & Sleep (ignorar si es sobre tele, luces o apps externas)
    const isDeviceTarget = /\b(?:tele|television|tv|pantalla|monitor|pc|computadora|luz|luces|aire)\b/i.test(lower);
    if (!isDeviceTarget) {
        const mentionsJarvis = /\bjarvis\b/i.test(clean);
        const isSleepKeyword = /\b(?:apaga(?:te)?|dormite|duermete|a\s+dormir|a\s+descansar|modo\s+descanso|modo\s+reposo|entra\s+en\s+(?:modo\s+)?descanso|entra\s+en\s+(?:modo\s+)?reposo|ponete\s+en\s+(?:modo\s+)?descanso|ponete\s+en\s+(?:modo\s+)?reposo|silencia(?:te)?|desactiva(?:te)?)\b/i.test(lower);
        const isNegated = /\bno\s+(?:te\s+)?apagu/i.test(lower);
        if ((isSleepKeyword && mentionsJarvis && !isNegated)
            || /^(?:buenas\s+noches(?:\s+jarvis)?|hasta\s+luego(?:\s+jarvis)?|chau\s+jarvis|adios\s+jarvis)$/i.test(lower)) {
            return { id: 'voice.sleep', params: {} };
        }
        if (/\b(?:prende(?:te)?|encende(?:te)?|desperta(?:te)?|despierta|despiertate|reactiva(?:te)?|activa(?:te)?|arriba|levantate)\b/i.test(lower)
            || /^(?:hola\s+jarvis|buen\s+dia\s+jarvis|buenas\s+jarvis|hey\s+jarvis|che\s+jarvis|ok\s+jarvis|jarvis)$/i.test(lower)) {
            return { id: 'voice.wake', params: {} };
        }
    }

    // 2. Parada de Emergencia (Voz)
    if (/\b(?:detener todo|para todo|parar todo|abortar|emergencia|cancela todo|cancelar todo)\b/i.test(lower)) {
        return { id: 'emergency.stop', params: {} };
    }

    // 2.5 Gestión y Cancelación de Tareas (Ítem 25)
    if (/\b(?:cancel(?:a|ar|ame)|deten(?:er|e)|fren(?:a|ar))\s+(?:la\s+)?(?:descarga|bajada)\b/i.test(lower)) {
        return { id: 'task.cancel', params: { target: 'download' } };
    }
    if (/\b(?:cancel(?:a|ar|ame)|deten(?:er|e)|fren(?:a|ar))\s+(?:la\s+)?(?:instalacion|tarea|accion|proceso|busqueda|investigacion)\b/i.test(lower)) {
        return { id: 'task.cancel', params: { target: 'task' } };
    }
    if (/^(?:(?:jarvis\s+)?(?:cancel(?:a|ar|ame)|fren(?:a|ar))\s*)$/i.test(lower) || /^(?:cancel[aá]|cancelar|cancela\s+eso|cancela\s+la\s+orden)$/i.test(lower)) {
        return { id: 'task.cancel', params: { target: null } };
    }
    if (/\b(?:paus(?:a|ar|ame)|pon\s+en\s+pausa)\s+(?:la\s+)?(?:descarga|tarea|proceso)?\b/i.test(lower) || /^(?:paus[aá]|pausar)$/i.test(lower)) {
        return { id: 'task.pause', params: { target: null } };
    }
    if (/\b(?:reanud(?:a|ar|ame)|continu(?:a|ar|ame)|segu[ií]|seguir)\s+(?:la\s+)?(?:descarga|tarea|proceso)?\b/i.test(lower) || /^(?:reanud[aá]|reanudar|continuar)$/i.test(lower)) {
        return { id: 'task.resume', params: { target: null } };
    }
    if (/\b(?:qu[eé]\s+tareas\s+(?:hay|est[aá]n)\s+activas|listar\s+tareas|tareas\s+activas)\b/i.test(lower)) {
        return { id: 'task.list', params: {} };
    }

    // 3. Deshacer Global (Undo)
    if (/\b(?:deshac(?:e|er)?|deshace lo ultimo|deshace eso|revertir|deshacer)\b/i.test(lower)) {
        return { id: 'undo.last', params: {} };
    }

    // 4. Fast Command Parser (Volumen, Brillo, Captura, Batería, Top RAM, Portapapeles, Espacio en Disco)
    const fastParsed = fastCommandParser.parse(clean);
    if (fastParsed.match) {
        return { id: fastParsed.action, params: fastParsed.params || {} };
    }

    // 5. Memoria V6 (Consultar, Olvidar)
    const memQueryMatch = lower.match(/(?:qu[eé]\s+record[aá]s|qu[eé]\s+sabes|qu[eé]\s+tenes\s+guardado)\s+(?:sobre|de|acerca\s+de)\s+(.+)/i);
    if (memQueryMatch) {
        return { id: 'memory.query-v6', params: { topic: memQueryMatch[1].trim() } };
    }
    const memForgetMatch = lower.match(/^(?:olvid[aá]|borr[aá]\s+lo\s+aprendido\s+sobre|olvidate\s+de)\s+(.+)/i);
    if (memForgetMatch) {
        return { id: 'memory.forget-v6', params: { topic: memForgetMatch[1].trim() } };
    }

    // 6. Explicabilidad e Historial
    if (/\b(?:qu[eé]\s+hiciste|ultimas\s+acciones|por\s+qu[eé]\s+me\s+preguntaste|explicame)\b/i.test(lower)) {
        return { id: 'explain.query', params: { query: clean } };
    }

    // 7. Sistema de Archivos y Carpetas (Crear, Borrar y Restaurar)
    
    // 7.1 Crear carpeta con archivo Word o TXT adentro (Comando compuesto)
    const folderAndFileMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|gener[aá]|generar)\s+(?:una\s+)?carpeta\s*(?:llamada|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|que\s+se\s+llame\s+|titulada|de\s+nombre\s+|de\s+)?\s*([a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]+?)\s+(?:y\s+)?(?:cre[aá]|crear|creame|hac[eé]|haceme|hacer|pon[eé]|poner|met[eé]|meter|redact[aá]|redactar)?\s*(?:dentro|adentro|en\s+ella)?\s*(?:un\s+|una\s+)?(word|documento|docx|txt|archivo(?:\s+de\s+texto)?|nota)\s*(?:llamado|con\s+nombre\s+(?:de\s+)?)?\s*([^\s:]+)?\s*(?:que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|sobre|acerca\s+de|diciendo|:)?\s*([\s\S]*)$/i);
    if (folderAndFileMatch) {
        let folderName = folderAndFileMatch[1].trim().replace(/^de\s+/i, '').replace(/[.!?]+$/, '').trim();
        const type = (folderAndFileMatch[2] || '').toLowerCase();
        let name = (folderAndFileMatch[3] || '').trim();
        let contentOrTopic = (folderAndFileMatch[4] || '').trim().replace(/^(?:diga|que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|sobre|acerca\s+de|diciendo|:)\s*/i, '').trim();
        const isWord = /word|docx|documento/i.test(type);
        const format = isWord ? 'docx' : 'txt';

        if (!name || /^(?:que|con|sobre|acerca|de|diga)$/i.test(name)) {
            name = isWord ? `Documento_${Date.now()}` : `Nota_${Date.now()}`;
        }
        return {
            id: 'file.create',
            params: {
                folderName,
                fileName: name,
                content: contentOrTopic,
                topic: contentOrTopic,
                format
            }
        };
    }

    // 7.2 Crear carpeta sola
    const createFolderMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|gener[aá]|generar)\s+(?:una\s+)?carpeta\s*(?:llamada|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|que\s+se\s+llame\s+|titulada|de\s+nombre\s+|de\s+)?\s*([a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]+)$/i);
    if (createFolderMatch && createFolderMatch[1]) {
        let folderName = createFolderMatch[1].trim().replace(/^de\s+/i, '').replace(/[.!?]+$/, '').trim();
        if (folderName) {
            return { id: 'folder.create', params: { folderName } };
        }
    }

    // 7.3 Eliminar carpeta
    const delFolderMatch = clean.match(/^(?:borr(?:ar|[aá]|ame)|elimin(?:ar|[aá]|ame)|sac(?:ar|[aá]|ame)|quit(?:ar|[aá]|ame)|mand(?:ar|[aá]|ame)\s+a\s+la\s+papelera)\s+(?:la\s+|esta\s+)?carpeta\s*(?:llamada|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|de\s+nombre\s+|titulada|de\s+)?\s*([a-zA-Z0-9_\-\.áéíóúÁÉÍÓÚñÑ ]+)$/i);
    if (delFolderMatch && delFolderMatch[1]) {
        let folderName = delFolderMatch[1].trim().replace(/^de\s+/i, '').replace(/[.!?]+$/, '').trim();
        if (folderName) {
            return { id: 'folder.delete', params: { folderName } };
        }
    }

    // 7.4 Creación de archivos TXT / Notas explícitos
    const createTxtMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|escrib[ií]|escribir|gener[aá]|generar)\s+(?:un\s+|una\s+)?(?:txt|archivo\s+de\s+texto|nota|texto)\s*(?:llamad[oa]|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|titulad[oa])?\s*([^\s:]+)?\s*(?:sobre|acerca\s+de|con\s+tema|que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|diciendo|:)?\s*([\s\S]*)$/i);
    if (createTxtMatch) {
        let possibleName = (createTxtMatch[1] || '').trim();
        let topicOrContent = (createTxtMatch[2] || '').trim();
        let fileName = '';
        let content = topicOrContent;

        if (possibleName && !/^(?:que|con|sobre|acerca|de)$/i.test(possibleName)) {
            fileName = possibleName.endsWith('.txt') ? possibleName : `${possibleName}.txt`;
        } else {
            if (/^(?:que|con|sobre|acerca|de)$/i.test(possibleName)) {
                content = `${possibleName} ${content}`.trim().replace(/^(?:que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|sobre|acerca\s+de|diciendo|:)\s*/i, '');
            }
            fileName = `Nota_${Date.now()}.txt`;
        }
        return { id: 'file.create', params: { fileName, content, topic: content, format: 'txt' } };
    }

    // 7.5 Creación de Word (.docx) explícito
    const createWordMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|redact[aá]|redactar|gener[aá]|generar)\s+(?:un\s+|una\s+)?(?:word|docx|documento\s+de\s+word|documento)\s*(?:llamad[oa]|con\s+(?:el\s+)?nombre\s+(?:de\s+)?|titulad[oa])?\s*([^\s:]+)?\s*(?:sobre|acerca\s+de|con\s+tema|que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|:)?\s*([\s\S]*)$/i);
    if (createWordMatch) {
        let possibleName = (createWordMatch[1] || '').trim();
        let topicOrContent = (createWordMatch[2] || '').trim();
        let fileName = '';
        let content = topicOrContent;

        if (possibleName && !/^(?:que|con|sobre|acerca|de)$/i.test(possibleName)) {
            fileName = possibleName.endsWith('.docx') ? possibleName : `${possibleName}.docx`;
        } else {
            if (/^(?:que|con|sobre|acerca|de)$/i.test(possibleName)) {
                content = `${possibleName} ${content}`.trim().replace(/^(?:que\s+diga|con\s+el\s+contenido\s+(?:de\s+)?|con\s+texto|sobre|acerca\s+de|diciendo|:)\s*/i, '');
            }
            fileName = `Documento_${Date.now()}.docx`;
        }
        return { id: 'file.create', params: { fileName, topic: content, content, format: 'docx' } };
    }

    // 7.6 Creación general de archivo
    const createFileMatch = clean.match(/^(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|escrib[ií]|gener[aá])\s+(?:un\s+|una\s+)?(?:archivo|documento)\s*(?:llamado|con\s+nombre|titulado)?\s*([^\s:]+\.[a-zA-Z0-9]+|[a-zA-Z0-9_\-]+)\s*(?:que\s+diga|con\s+el\s+contenido|con\s+texto|diciendo|:)?\s*([\s\S]*)$/i);
    if (createFileMatch && createFileMatch[1]) {
        let name = createFileMatch[1].trim();
        let content = (createFileMatch[2] || '').trim();
        if (!name.includes('.')) name += '.txt';
        return { id: 'file.create', params: { fileName: name, content, format: 'txt' } };
    }

    // 7.7 Borrado inteligente de capturas / fotos / imágenes
    if (/\b(?:borr(?:ar|[aá]|ame)|elimin(?:ar|[aá]|ame)|sac(?:ar|[aá]|ame)|quit(?:ar|[aá]|ame)|mand(?:ar|[aá]|ame)\s+a\s+la\s+papelera)\s+(?:la\s+|las\s+|esta\s+)?(?:ultima\s+|última\s+)?(?:captura|screenshot|foto|fotos|imagen|imagenes|pantallazo)\b/i.test(lower)) {
        return { id: 'file.delete', params: { filePath: 'last_screenshot' } };
    }

    // 7.8 Borrado de archivos generales
    const delFileMatch = clean.match(/^(?:borr(?:ar|[aá]|ame)|elimin(?:ar|[aá]|ame)|sac(?:ar|[aá]|ame)|quit(?:ar|[aá]|ame)|mand(?:ar|[aá]|ame)\s+a\s+la\s+papelera)\s+(?:el\s+archivo\s+|la\s+foto\s+|la\s+imagen\s+|el\s+documento\s+|el\s+|la\s+)?([a-zA-Z0-9_\-\.áéíóúÁÉÍÓÚñÑ ]+?)(?:\s+de\s+mi\s+escritorio|\s+del\s+escritorio)?$/i);
    if (delFileMatch && delFileMatch[1]) {
        let target = delFileMatch[1].trim();
        if (target) {
            return { id: 'file.delete', params: { filePath: target } };
        }
    }

    // 7.9 Restaurar archivos
    const restoreFileMatch = clean.match(/^(?:recuper(?:ar|[aá]|ame)|restaur(?:ar|[aá]|ame))\s+(?:el\s+archivo\s+|la\s+carpeta\s+)?([a-zA-Z0-9_\-\.áéíóúÁÉÍÓÚñÑ ]+?)(?:\s+de\s+la\s+papelera)?$/i);
    if (restoreFileMatch && restoreFileMatch[1]) {
        return { id: 'file.restore', params: { identifier: restoreFileMatch[1].trim() } };
    }

    // 8. Rutinas (Modo Estudio, Modo Juego)
    if (/\b(?:modo\s+estudio|modo\s+juego)\b/i.test(lower)) {
        const rName = lower.includes('estudio') ? 'modo estudio' : 'modo juego';
        return { id: 'routine.execute', params: { routineName: rName } };
    }

    const correction = parseCorrection(clean);
    if (correction) return { id: 'voice.correct', params: correction };
    const preference = parsePreference(clean);
    if (preference) return { id: 'memory.preference', params: preference };

    const download = parseDownload(clean);
    if (download) return { id: 'download.url', params: download };

    const dollar = parseDollar(clean);
    if (dollar) return { id: 'information.dollar', params: dollar };

    const mediaSearch = parseDesktopMediaSearch(clean);
    if (mediaSearch) return { id: 'system.media-search', params: mediaSearch };

    const informationDocument = parseInformationDocument(clean);
    if (informationDocument) return { id: 'document.create-info', params: informationDocument };

    const tvIntent = tvVoiceService.parseTvIntent(clean);
    if (tvIntent) {
        if (tvIntent.action === 'cancel') return { id: 'emergency.stop', params: {} };
        if (tvIntent.action === 'set_volume') return { id: 'tv.set-volume', params: { percent: tvIntent.percent } };
        if (tvIntent.action === 'adjust_volume') return { id: 'tv.adjust-volume', params: { delta: tvIntent.delta } };
        if (tvIntent.action === 'get_volume') return { id: 'tv.get-volume', params: {} };
        if (tvIntent.action === 'calibrate_volume') return { id: 'tv.calibrate-volume', params: { level: tvIntent.level } };
        if (tvIntent.action === 'learn_button') return { id: 'tv.learn-button', params: { button: tvIntent.button } };
        if (tvIntent.action === 'toggle_mute') return { id: 'tv.toggle-mute', params: {} };

        if (tvIntent.action === 'open_pc') return { id: 'system.open', params: { appName: 'Netflix' } };
        const broadLinkAvailable = await tvService.isAvailable();
        if (!broadLinkAvailable) {
            tvVoiceService.deactivateSession();
            if (tvIntent.title) {
                return { id: 'system.media-search', params: { platform: 'netflix', query: tvIntent.title } };
            }
            if (['choose_device', 'netflix', 'continue_watching', 'search', 'enter_netflix', 'open_search'].includes(tvIntent.action)) {
                return { id: 'system.open', params: { appName: 'Netflix' } };
            }
        }
        if (tvIntent.action === 'enter_netflix') return { id: 'tv.enter-netflix', params: {} };
        if (tvIntent.action === 'open_search') return { id: 'tv.open-search', params: {} };
        return { id: 'tv.control', params: { intent: tvIntent } };
    }
    if (tvVoiceService.isSessionActive() && !tvVoiceService.switchesAwayFromTv(clean)) {
        return { id: 'tv.control', params: { intent: { action: 'clarify' } } };
    }

    if (/\b(activar|activa|prende|encende)\b.*\b(observador|observacion)\b/.test(lower)) return { id: 'observer.set', params: { enabled: true } };
    if (/\b(desactivar|desactiva|apaga)\b.*\b(observador|observacion)\b/.test(lower)) return { id: 'observer.set', params: { enabled: false } };
    const mode = lower.match(/activar\s+(?:el\s+)?modo\s+(.+)/);
    if (mode) return { id: 'mode.activate', params: { modeId: mode[1] } };

    const sys = systemService.handleSystemCommand(clean);
    if (sys.isTraining) return { id: 'system.learn-command', params: { trigger: sys.trigger, appName: sys.appName } };
    if (sys.isSystemCommand) return { id: 'system.open', params: { appName: sys.appName } };

    const learned = voiceLearningService.resolveVerifiedPhrase(clean);
    if (learned) return learned;

    const refs = memoryService.resolveReferences(clean);
    return { id: 'assistant.respond', params: { text: clean, referenceContext: refs.context || [] } };
}

async function process(text, context = {}) {
    registerActions();
    const operationMetricsService = require('./diagnostics/operationMetricsService');
    const trace = operationMetricsService.startTrace('turn', { text });

    let request;
    try {
        request = await trace.timeStage('intent_detection', async () => resolve(text));
    } catch (err) {
        trace.finish({ status: 'FAILED', error: err });
        throw err;
    }

    await trace.timeStage('memory_search', async () => {
        memoryService.addTurn('user', text, { actionId: request.id });
    });

    let result;
    try {
        result = await trace.timeStage('tool_execution', async () => {
            return actionKernel.execute(request.id, request.params, context);
        });
    } catch (err) {
        trace.recordToolError(err);
        trace.finish({ status: 'FAILED', error: err });
        throw err;
    }

    voiceLearningService.recordVerifiedExecution({
        utterance: text, actionId: request.id, params: request.params, result
    });
    if (result.message) memoryService.addTurn('assistant', result.message, { actionId: request.id, status: result.status, verified: result.verified });

    trace.finish({
        status: result.ok !== false ? 'SUCCESS' : 'FAILED',
        error: result.ok !== false ? null : result.message,
        metadata: { actionId: request.id }
    });

    return result;
}

registerActions();
module.exports = { process, resolve, describe: actionKernel.describe, execute: actionKernel.execute, confirm: actionKernel.confirm, cancelConfirmation: actionKernel.cancelConfirmation };
