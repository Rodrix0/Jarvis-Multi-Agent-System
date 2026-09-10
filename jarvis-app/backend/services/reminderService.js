const fs = require('fs');
const path = require('path');
const notifier = require('node-notifier');

const remindersFile = path.join(__dirname, '..', 'data', 'recordatorios.json');
let schedulerTimer = null;
let schedulerIo = null;

function initMemory() {
    if (!fs.existsSync(path.dirname(remindersFile))) {
        fs.mkdirSync(path.dirname(remindersFile), { recursive: true });
    }
    if (!fs.existsSync(remindersFile)) {
        fs.writeFileSync(remindersFile, JSON.stringify([], null, 2));
    }
}

function getLocalReminders() {
    initMemory();
    try {
        return JSON.parse(fs.readFileSync(remindersFile, 'utf8'));
    } catch {
        return [];
    }
}

function addLocalReminder(timeStr, action, target, message) {
    if (action === 'speak') {
        const now = new Date();
        const [hours, minutes] = String(timeStr).split(':').map(Number);
        if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return false;
        const date = new Date(now);
        date.setHours(hours, minutes, 0, 0);
        if (date < now) date.setDate(date.getDate() + 1);
        return require('./agenda/agendaService').addReminder({ title: message || target || 'Recordatorio', targetDate: require('./agenda/reminderParser').localDate(date), targetTime: timeStr }).ok;
    }
    const reminders = getLocalReminders();
    reminders.push({
        id: Date.now(),
        time: timeStr,      // e.g. "14:00"
        action: action,     // e.g. "send_whatsapp", "speak"
        target: target,     // e.g. "ma"
        message: message,   // e.g. "Hola mami"
        done: false
    });
    fs.writeFileSync(remindersFile, JSON.stringify(reminders, null, 2));
    scheduleNextWake();
    return true;
}

// Enviar notificación a pantalla (Windows 10/11)
function showWindowsNotification(title, message) {
    notifier.notify({
        title: title,
        message: message,
        sound: true, // Reproducir sonido de Windows
        wait: false  // No bloquear el sistema
    }, function (err, response) {
        if (err) console.error("Error mostrando notificación de Windows:", err);
    });
}

// Conectar directamente con la base de datos Supabase
async function fetchExternalTasks() {
    try {
        console.log("[Araña Tareas] Conectando a Supabase para leer tareas personales y grupales...");
        
        const supabaseUrl = process.env.SUPABASE_URL || '';
        // Usar la Service Key que se salta el RLS
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
        const tablePersonal = process.env.SUPABASE_TABLE_PERSONAL || 'tasks';
        const tableGroup = process.env.SUPABASE_TABLE_GROUP || 'group_tasks';

        if (!supabaseUrl || !supabaseKey) {
            return "No puedo leer la base de datos. Faltan las credenciales de Supabase en mi sistema interno (.env).";
        }

        const headers = {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
        };

        // Pedir datos a ambas tablas en paralelo (solo las tareas NO completadas)
        const [respPersonal, respGroup] = await Promise.all([
            fetch(`${supabaseUrl}/rest/v1/${tablePersonal}?select=*&completed=eq.false`, { headers }),
            fetch(`${supabaseUrl}/rest/v1/${tableGroup}?select=*&completed=eq.false`, { headers })
        ]);

        let resultString = "";

        // Procesar Tareas Personales
        if (respPersonal.ok) {
            const dataP = await respPersonal.json();
            if (dataP && dataP.length > 0) {
                resultString += "\n[TAREAS PERSONALES]:\n";
                resultString += dataP.map((item, index) => {
                    const name = item.title || item.tarea || item.task;
                    const subject = item.subject ? ` (${item.subject})` : '';
                    const due = item.due_date ? ` para el ${item.due_date}` : '';
                    return `  ${index + 1}. ${name}${subject}${due}`;
                }).join('\n');
            } else {
                resultString += "\n[TAREAS PERSONALES]: No hay tareas pendientes.";
            }
        } else {
            console.log("Error Personales:", respPersonal.status, await respPersonal.text());
            resultString += "\n[TAREAS PERSONALES]: Error al conectar con Supabase.";
        }

        // Procesar Tareas Grupales
        if (respGroup.ok) {
            const dataG = await respGroup.json();
            if (dataG && dataG.length > 0) {
                resultString += "\n\n[TAREAS GRUPALES]:\n";
                resultString += dataG.map((item, index) => {
                    const name = item.title || item.tarea || item.task;
                    const subject = item.subject ? ` (${item.subject})` : '';
                    const due = item.due_date ? ` para el ${item.due_date}` : '';
                    return `  ${index + 1}. ${name}${subject}${due}`;
                }).join('\n');
            } else {
                resultString += "\n\n[TAREAS GRUPALES]: No hay tareas pendientes.";
            }
        } else {
            console.log("Error Grupales:", respGroup.status, await respGroup.text());
            resultString += "\n\n[TAREAS GRUPALES]: Error al conectar con Supabase.";
        }

        return resultString;
    } catch (e) {
        console.error("Error conectando a Supabase:", e.message);
        return "Ocurrió un error técnico al intentar conectar con la base de datos en la nube.";
    }
}

async function runDueReminders() {
        const now = new Date();
        const currentHours = now.getHours().toString().padStart(2, '0');
        const currentMinutes = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHours}:${currentMinutes}`; // "14:00"

        const reminders = getLocalReminders();
        let changed = false;

        for (let task of reminders) {
            if (!task.done && task.time === currentTime) {
                console.log(`\n⏰ [ALARMA] Ejecutando Tarea Programada: ${task.action} (${task.target})`);
                task.done = true;
                changed = true;

                // Ejecuciones directas
                if (task.action === "send_whatsapp" || task.action === "send_email") {
                    try {
                        showWindowsNotification("Jarvis - Disparando Acción Externa", `Ejecutando: Enviar mensaje a ${task.target}...`);
                        
                        const pyResponse = await fetch('http://127.0.0.1:8000/execute', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: task.action,
                                target: task.target,
                                message: task.message || ""
                            })
                        });
                        
                        if (pyResponse.ok) {
                            showWindowsNotification("Jarvis - Éxito", `Se envió correctamente el mensaje a ${task.target}.`);
                            
                            // Le avisamos al usuario por voz si queremos o simplemente lo informamos en pantalla
                            schedulerIo.emit('response', {
                                text: "Acabo de enviar el mensaje programado a " + task.target,
                                action: null
                            });
                        }
                    } catch (e) {
                        showWindowsNotification("Jarvis - Error de Conexión", "El motor Python (FastAPI) estaba apagado, la tarea falló.");
                        console.log("[Aviso]: Motor Python apagado en la ejecución programada.");
                    }
                } else if (task.action === "open_app") {
                    showWindowsNotification("Jarvis - Abriendo Sistema", `Abriendo ${task.target} por tarea programada.`);
                    const sysServices = require('./systemService');
                    await sysServices.openApp(task.target, "productividad");
                } else if (task.action === "speak") {
                    showWindowsNotification("Jarvis - ¡Recordatorio!", task.message || "Es hora de la meta programada.");
                    
                    schedulerIo.emit('response', {
                        text: "¡Atención, señor! Recordatorio especial: " + task.message,
                        action: null
                    });
                }
            }
        }

        if (changed) {
            // Filtramos los que ya se hicieron para mantener el archivo limpio
            const pendingReminders = reminders.filter(r => !r.done);
            fs.writeFileSync(remindersFile, JSON.stringify(pendingReminders, null, 2));
        }

        scheduleNextWake();
}

function millisecondsUntil(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    const isCurrentMinute = now.getHours() === hours && now.getMinutes() === minutes;
    if (isCurrentMinute) return 50;
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
}

function scheduleNextWake() {
    if (!schedulerIo) return;
    if (schedulerTimer) clearTimeout(schedulerTimer);
    schedulerTimer = null;

    const delays = getLocalReminders()
        .filter(task => !task.done)
        .map(task => millisecondsUntil(task.time))
        .filter(delay => delay !== null);
    if (delays.length === 0) return;

    schedulerTimer = setTimeout(runDueReminders, Math.min(...delays) + 250);
    schedulerTimer.unref();
}

// Se despierta exactamente al próximo recordatorio en lugar de sondear cada minuto.
function startScheduler(io) {
    initMemory();
    schedulerIo = io;
    console.log("[Sistema Cronos] Planificador de recordatorios bajo demanda encendido.");
    scheduleNextWake();
}

// Borrar todas las tareas locales (alarmas/recordatorios)
function clearLocalReminders() {
    initMemory();
    fs.writeFileSync(remindersFile, JSON.stringify([], null, 2));
    scheduleNextWake();
    return true;
}

module.exports = {
    addLocalReminder,
    getLocalReminders,
    clearLocalReminders,
    fetchExternalTasks,
    startScheduler
};
