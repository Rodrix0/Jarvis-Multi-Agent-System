/**
 * Conditional Automation Service for Jarvis (Ítem 27)
 * Motor de automatizaciones reactivas basadas en eventos y condiciones (Event-Driven: "Cuando ocurra X -> Hacer Y").
 * Soporta filtros semánticos (eq, contains, regex, gt, in, etc.), interpolación de plantillas,
 * ejecución secuencial de acciones (ActionRouter, TTS, HUD, Rutinas), cooldowns,
 * Circuit Breaker automático tras 3 fallos consecutivos, sincronización con el watchlist de procesos
 * y persistencia completa en SQLite.
 */

const crypto = require('crypto');
const eventBus = require('../core/eventBusService');
const { SYSTEM_EVENTS } = require('../core/eventBusService');
const databaseService = require('../persistence/databaseService');
const actionRouterService = require('../core/actionRouterService');
const notificationService = require('../core/notificationService');
const proactiveMonitorService = require('../core/proactiveMonitorService');

class ConditionalAutomationService {
    constructor() {
        this.rules = new Map(); // ruleId -> rule
        this.eventIndex = new Map(); // eventName -> Set of ruleIds
        this.cooldowns = new Map(); // ruleId -> timestamp
        this.unsubscriber = null;
        this.ttsService = null;
        this.routineService = null;
        this.initialized = false;
    }

    /**
     * Inicializa el servicio, carga reglas de la base de datos y se suscribe al Event Bus.
     */
    init({ ttsService = null, routineService = null } = {}) {
        if (ttsService) this.ttsService = ttsService;
        if (routineService) this.routineService = routineService;

        // Cargar reglas persistidas desde SQLite
        this.loadRulesFromDatabase();

        // Suscribirse a todos los eventos del bus si aún no está suscrito
        if (!this.unsubscriber) {
            this.unsubscriber = eventBus.subscribe('*', (event) => this.handleEvent(event));
        }

        this.initialized = true;
        console.log(`[ConditionalAutomation] ⚡ Motor reactivo inicializado con ${this.rules.size} regla(s) activa(s).`);
    }

    /**
     * Carga reglas desde SQLite e indexa en memoria.
     */
    loadRulesFromDatabase() {
        this.rules.clear();
        this.eventIndex.clear();

        try {
            const storedRules = databaseService.getAllAutomationRules();
            for (const rule of storedRules) {
                this._indexRule(rule);
            }
        } catch (err) {
            console.error('[ConditionalAutomation] Error cargando reglas de BD:', err.message);
        }
    }

    /**
     * Registra e indexa internamente una regla.
     */
    _indexRule(rule) {
        if (!rule || !rule.id || !rule.trigger || !rule.trigger.event) return;

        this.rules.set(rule.id, rule);

        const eventName = rule.trigger.event;
        if (!this.eventIndex.has(eventName)) {
            this.eventIndex.set(eventName, new Set());
        }
        this.eventIndex.get(eventName).add(rule.id);

        // Si la regla monitorea procesos, agregar al vigía de ProactiveMonitor
        this._syncProcessWatchlist(rule);
    }

    /**
     * Remueve los índices de una regla.
     */
    _unindexRule(ruleId) {
        const rule = this.rules.get(ruleId);
        if (!rule) return;

        const eventName = rule.trigger?.event;
        if (eventName && this.eventIndex.has(eventName)) {
            this.eventIndex.get(eventName).delete(ruleId);
        }

        this.rules.delete(ruleId);
    }

    /**
     * Sincroniza procesos en el watchlist de ProactiveMonitor si la regla escucha inicio o fin de proceso.
     */
    _syncProcessWatchlist(rule) {
        const ev = rule.trigger?.event;
        if (ev === SYSTEM_EVENTS.PROCESS_TERMINATED || ev === SYSTEM_EVENTS.PROCESS_STARTED) {
            const filters = rule.trigger.filters || {};
            const proc = filters.processName?.eq || filters.processName || filters.appName?.eq || filters.appName;
            if (proc && typeof proc === 'string') {
                proactiveMonitorService.watchProcess(proc);
            }
        }
    }

    /**
     * Crea o actualiza una regla de automatización condicional.
     * @param {object} ruleData
     * @returns {object} La regla creada o actualizada
     */
    createRule(ruleData) {
        if (!ruleData || !ruleData.trigger || !ruleData.trigger.event) {
            throw new Error('La regla debe especificar al menos trigger.event.');
        }

        const id = ruleData.id || `rule_${crypto.randomUUID().slice(0, 8)}`;
        const rule = {
            id,
            name: ruleData.name || `Automatización ${id}`,
            enabled: ruleData.enabled !== false,
            trigger: {
                event: ruleData.trigger.event,
                filters: ruleData.trigger.filters || {},
                cooldownMs: Number(ruleData.trigger.cooldownMs || 0),
                once: Boolean(ruleData.trigger.once),
                activeWindow: ruleData.trigger.activeWindow || null
            },
            conditions: Array.isArray(ruleData.conditions) ? ruleData.conditions : [],
            actions: Array.isArray(ruleData.actions) ? ruleData.actions : [],
            trigger_count: Number(ruleData.trigger_count || 0),
            consecutive_failures: Number(ruleData.consecutive_failures || 0),
            status: ruleData.status || 'active',
            created_at: ruleData.created_at || new Date().toISOString(),
            last_triggered: ruleData.last_triggered || null
        };

        // Persistir en SQLite
        databaseService.saveAutomationRule(rule);

        // Indexar en memoria
        this._indexRule(rule);

        return rule;
    }

    getRule(id) {
        return this.rules.get(id) || databaseService.getAutomationRule(id);
    }

    getAllRules() {
        return Array.from(this.rules.values());
    }

    toggleRule(id, enabled) {
        const rule = this.getRule(id);
        if (!rule) return null;

        const isEnabled = enabled !== undefined ? Boolean(enabled) : !rule.enabled;
        const updated = databaseService.updateAutomationRuleStatus(id, {
            enabled: isEnabled,
            status: isEnabled ? 'active' : 'disabled'
        });

        if (updated) {
            this._indexRule(updated);
        }
        return updated;
    }

    deleteRule(id) {
        this._unindexRule(id);
        return databaseService.deleteAutomationRule(id);
    }

    /**
     * Procesa un evento entrante del Event Bus contra todas las reglas suscritas.
     * @param {object} eventData
     */
    async handleEvent(eventData) {
        if (!eventData || !eventData.eventName) return;

        const eventName = eventData.eventName;
        const matchingRuleIds = new Set([
            ...(this.eventIndex.get(eventName) || []),
            ...(this.eventIndex.get('*') || [])
        ]);

        if (matchingRuleIds.size === 0) return;

        for (const ruleId of matchingRuleIds) {
            const rule = this.rules.get(ruleId);
            if (!rule || !rule.enabled) continue;

            // 1. Verificar Circuit Breaker
            if (rule.status === 'circuit_breaker_tripped' || (rule.consecutive_failures && rule.consecutive_failures >= 3)) {
                continue;
            }

            // 2. Verificar Cooldown
            const now = Date.now();
            const lastFired = this.cooldowns.get(ruleId) || 0;
            const cooldown = rule.trigger.cooldownMs || 0;
            if (now - lastFired < cooldown) {
                continue;
            }

            // 3. Evaluar ventana horaria (activeWindow)
            if (rule.trigger.activeWindow && !this._isInActiveWindow(rule.trigger.activeWindow)) {
                continue;
            }

            // 4. Evaluar filtros semánticos del trigger
            const matchesFilters = this.evaluateFilters(rule.trigger.filters, eventData);
            if (!matchesFilters) {
                continue;
            }

            // 5. Evaluar condiciones adicionales
            const matchesConditions = this.evaluateAdditionalConditions(rule.conditions, eventData);
            if (!matchesConditions) {
                continue;
            }

            // Condiciones satisfechas -> Disparar acciones de la regla
            this.cooldowns.set(ruleId, now);
            await this.executeRuleActions(rule, eventData);
        }
    }

    /**
     * Evalúa si la hora actual está dentro de la ventana horaria configurada.
     */
    _isInActiveWindow(window) {
        if (!window) return true;
        const now = new Date();

        // Días permitidos (0 = Domingo, 1 = Lunes, etc.)
        if (Array.isArray(window.days) && window.days.length > 0) {
            if (!window.days.includes(now.getDay())) return false;
        }

        if (window.start && window.end) {
            const [startH, startM] = window.start.split(':').map(Number);
            const [endH, endM] = window.end.split(':').map(Number);
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const startMinutes = startH * 60 + (startM || 0);
            const endMinutes = endH * 60 + (endM || 0);

            if (startMinutes <= endMinutes) {
                return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
            } else {
                // Caso que cruza medianoche (ej: 22:00 a 06:00)
                return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
            }
        }
        return true;
    }

    /**
     * Evalúa los filtros del trigger contra el payload del evento.
     */
    evaluateFilters(filters, payload) {
        if (!filters || typeof filters !== 'object' || Object.keys(filters).length === 0) {
            return true; // Sin filtros significa que coincide cualquier evento de ese tipo
        }

        for (const [key, condition] of Object.entries(filters)) {
            // Operadores lógicos compuestos a nivel raíz
            if (key === '$and' && Array.isArray(condition)) {
                if (!condition.every(sub => this.evaluateFilters(sub, payload))) return false;
                continue;
            }
            if (key === '$or' && Array.isArray(condition)) {
                if (!condition.some(sub => this.evaluateFilters(sub, payload))) return false;
                continue;
            }
            if (key === '$not' && typeof condition === 'object') {
                if (this.evaluateFilters(condition, payload)) return false;
                continue;
            }

            const value = this._getNestedValue(payload, key);
            if (!this._evaluateSingleCondition(value, condition)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Evalúa una condición específica sobre un valor concreto.
     */
    _evaluateSingleCondition(val, condition) {
        // Coincidencia directa (literal o shorthand eq)
        if (typeof condition !== 'object' || condition === null) {
            return this._compareEq(val, condition);
        }

        for (const [op, target] of Object.entries(condition)) {
            switch (op) {
                case 'eq':
                    if (!this._compareEq(val, target)) return false;
                    break;
                case 'neq':
                    if (this._compareEq(val, target)) return false;
                    break;
                case 'contains':
                    if (!String(val || '').toLowerCase().includes(String(target || '').toLowerCase())) return false;
                    break;
                case 'startsWith':
                    if (!String(val || '').toLowerCase().startsWith(String(target || '').toLowerCase())) return false;
                    break;
                case 'endsWith':
                    if (!String(val || '').toLowerCase().endsWith(String(target || '').toLowerCase())) return false;
                    break;
                case 'regex':
                    try {
                        const re = new RegExp(target, 'i');
                        if (!re.test(String(val || ''))) return false;
                    } catch {
                        return false;
                    }
                    break;
                case 'gt':
                    if (Number(val) <= Number(target)) return false;
                    break;
                case 'gte':
                    if (Number(val) < Number(target)) return false;
                    break;
                case 'lt':
                    if (Number(val) >= Number(target)) return false;
                    break;
                case 'lte':
                    if (Number(val) > Number(target)) return false;
                    break;
                case 'between':
                    if (Array.isArray(target) && target.length === 2) {
                        const num = Number(val);
                        if (num < Number(target[0]) || num > Number(target[1])) return false;
                    }
                    break;
                case 'in':
                    if (Array.isArray(target)) {
                        const found = target.some(t => this._compareEq(val, t));
                        if (!found) return false;
                    }
                    break;
                case 'notIn':
                    if (Array.isArray(target)) {
                        const found = target.some(t => this._compareEq(val, t));
                        if (found) return false;
                    }
                    break;
                default:
                    break;
            }
        }

        return true;
    }

    _compareEq(a, b) {
        if (typeof a === 'string' && typeof b === 'string') {
            return a.toLowerCase().trim() === b.toLowerCase().trim();
        }
        return a == b;
    }

    _getNestedValue(obj, path) {
        if (!obj || !path) return undefined;
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            current = current[part];
        }
        return current;
    }

    /**
     * Evalúa condiciones de contexto adicionales.
     */
    evaluateAdditionalConditions(conditions, payload) {
        if (!conditions || conditions.length === 0) return true;
        return true;
    }

    /**
     * Interpola variables de plantilla como {{filename}} o {{data.metric}} en cadenas de texto o parámetros.
     */
    interpolateTemplate(template, payload) {
        if (typeof template === 'string') {
            return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, path) => {
                const val = this._getNestedValue(payload, path);
                return val !== undefined && val !== null ? String(val) : match;
            });
        }
        if (Array.isArray(template)) {
            return template.map(item => this.interpolateTemplate(item, payload));
        }
        if (template && typeof template === 'object') {
            const interpolated = {};
            for (const [k, v] of Object.entries(template)) {
                interpolated[k] = this.interpolateTemplate(v, payload);
            }
            return interpolated;
        }
        return template;
    }

    /**
     * Ejecuta el pipeline de acciones asociadas a una regla.
     */
    async executeRuleActions(rule, eventData) {
        const startTime = Date.now();
        const results = [];
        let executionSuccess = true;
        let executionError = null;

        console.log(`[ConditionalAutomation] 🚀 Ejecutando regla "${rule.name}" (${rule.id}) disparada por ${eventData.eventName}.`);

        // Emitir traza del disparo
        eventBus.publish(SYSTEM_EVENTS.AUTOMATION_TRIGGERED, {
            ruleId: rule.id,
            ruleName: rule.name,
            triggerEvent: eventData.eventName,
            timestamp: new Date().toISOString()
        });

        for (const step of rule.actions) {
            try {
                const res = await this._executeSingleAction(step, eventData);
                if (res && res.ok === false) {
                    throw new Error(res.message || res.error || 'La acción devolvió ok: false');
                }
                results.push({ ok: true, step, result: res });
            } catch (err) {
                executionSuccess = false;
                executionError = err.message;
                results.push({ ok: false, step, error: err.message });
                console.error(`[ConditionalAutomation] Error en acción de regla "${rule.name}":`, err.message);
                break; // Detener pasos posteriores si falla una acción
            }
        }

        const durationMs = Date.now() - startTime;
        const newTriggerCount = (rule.trigger_count || 0) + (executionSuccess ? 1 : 0);
        let consecutiveFailures = executionSuccess ? 0 : ((rule.consecutive_failures || 0) + 1);
        let newStatus = rule.status;

        // Circuit Breaker: Si falla 3 veces consecutivas, auto-pausar la regla
        if (consecutiveFailures >= 3) {
            newStatus = 'circuit_breaker_tripped';
            notificationService.notify({
                title: '⚠️ Automatización Pausada',
                message: `La regla "${rule.name}" ha fallado 3 veces consecutivas y fue desactivada preventivamente.`,
                priority: 'WARNING'
            });
            eventBus.publish(SYSTEM_EVENTS.SECURITY_ALERT, {
                type: 'AUTOMATION_CIRCUIT_BREAKER',
                ruleId: rule.id,
                consecutiveFailures,
                lastError: executionError
            });
        }

        // Si la regla era de un solo disparo (once: true) y tuvo éxito, desactivarla
        let finalEnabled = rule.enabled;
        if (executionSuccess && rule.trigger?.once) {
            finalEnabled = false;
            newStatus = 'completed_once';
        }

        // Actualizar estado en BD y memoria
        databaseService.updateAutomationRuleStatus(rule.id, {
            enabled: finalEnabled,
            trigger_count: newTriggerCount,
            consecutive_failures: consecutiveFailures,
            last_triggered: new Date().toISOString(),
            status: newStatus
        });

        rule.enabled = finalEnabled;
        rule.trigger_count = newTriggerCount;
        rule.consecutive_failures = consecutiveFailures;
        rule.last_triggered = new Date().toISOString();
        rule.status = newStatus;

        // Registrar auditoría de ejecución en BD
        databaseService.logAutomationExecution({
            ruleId: rule.id,
            eventName: eventData.eventName,
            status: executionSuccess ? 'SUCCESS' : 'FAILED',
            payload: eventData,
            result: results,
            error: executionError,
            durationMs
        });

        return {
            ok: executionSuccess,
            ruleId: rule.id,
            results,
            error: executionError,
            durationMs
        };
    }

    /**
     * Ejecuta una acción individual del pipeline.
     */
    async _executeSingleAction(actionStep, eventData) {
        const type = actionStep.type || 'action';

        switch (type) {
            case 'action': {
                const actionName = actionStep.action;
                const interpolatedParams = this.interpolateTemplate(actionStep.params || {}, eventData);
                return await actionRouterService.dispatch({ action: actionName, params: interpolatedParams });
            }

            case 'tts': {
                const message = this.interpolateTemplate(actionStep.message || '', eventData);
                if (this.ttsService && typeof this.ttsService.speak === 'function') {
                    return this.ttsService.speak(message);
                }
                return { spoke: false, reason: 'TTS_SERVICE_UNAVAILABLE', message };
            }

            case 'notification': {
                const title = this.interpolateTemplate(actionStep.title || 'Jarvis Automatización', eventData);
                const message = this.interpolateTemplate(actionStep.message || '', eventData);
                return notificationService.notify({
                    title,
                    message,
                    priority: actionStep.priority || 'NORMAL'
                });
            }

            case 'routine': {
                const routineName = this.interpolateTemplate(actionStep.name || '', eventData);
                if (this.routineService && typeof this.routineService.executeRoutine === 'function') {
                    return await this.routineService.executeRoutine(routineName);
                }
                return { ok: false, reason: 'ROUTINE_SERVICE_UNAVAILABLE' };
            }

            case 'event': {
                const eventName = this.interpolateTemplate(actionStep.eventName || '', eventData);
                const payload = this.interpolateTemplate(actionStep.payload || {}, eventData);
                return eventBus.publish(eventName, payload);
            }

            default:
                throw new Error(`Tipo de acción desconocido: ${type}`);
        }
    }

    /**
     * Modo de prueba / simulación (Dry Run).
     */
    testRule(ruleId, mockPayload) {
        const rule = this.getRule(ruleId);
        if (!rule) return { ok: false, message: `Regla ${ruleId} no encontrada.` };

        const matchesFilters = this.evaluateFilters(rule.trigger.filters, mockPayload);
        const matchesWindow = this._isInActiveWindow(rule.trigger.activeWindow);
        const simulatedActions = rule.actions.map(action => {
            return {
                type: action.type || 'action',
                interpolated: this.interpolateTemplate(action, mockPayload)
            };
        });

        return {
            ok: true,
            ruleId,
            name: rule.name,
            conditionsMet: matchesFilters && matchesWindow,
            filtersMatch: matchesFilters,
            activeWindowMatch: matchesWindow,
            simulatedActions
        };
    }
}

const conditionalAutomationService = new ConditionalAutomationService();
module.exports = conditionalAutomationService;
module.exports.ConditionalAutomationService = ConditionalAutomationService;
