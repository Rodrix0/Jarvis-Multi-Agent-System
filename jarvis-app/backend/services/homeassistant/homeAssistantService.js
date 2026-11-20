/**
 * Home Assistant Service for Jarvis (Ítem 29)
 * Capa universal de domótica y dispositivos inteligentes.
 * Actúa como orquestador central conectando Jarvis con Home Assistant.
 * Soporta conexión dual (REST API + WebSocket en tiempo real), resolución semántica
 * en lenguaje natural, retransmisión bidireccional al EventBus de Jarvis
 * y modo resiliente de simulación/fallback cuando el hub no está disponible.
 */

const eventBus = require('../core/eventBusService');
const { SYSTEM_EVENTS } = require('../core/eventBusService');

class HomeAssistantService {
    constructor() {
        this.haUrl = process.env.HA_URL || 'http://localhost:8123';
        this.token = process.env.HA_TOKEN || '';
        this.entities = new Map(); // entity_id -> state object
        this.aliases = new Map(); // alias -> entity_id
        this.domainIndex = new Map(); // domain -> Set of entity_ids
        this.ws = null;
        this.wsMessageId = 1;
        this.wsConnected = false;
        this.isMockMode = false;
        this.reconnectTimer = null;
        this.initialized = false;

        // Semillas por defecto para mapeo semántico en español
        this.defaultAliases = {
            // Luces
            'luz': 'light.living_room',
            'luces': 'light.living_room',
            'luz del living': 'light.living_room',
            'luz de la sala': 'light.living_room',
            'luz de la pieza': 'light.dormitorio',
            'luz del dormitorio': 'light.dormitorio',
            'luz de la habitacion': 'light.dormitorio',
            'luz del escritorio': 'light.escritorio',
            'lampara': 'light.living_room',

            // Climatización / Aire Acondicionado
            'aire': 'climate.aire_acondicionado',
            'el aire': 'climate.aire_acondicionado',
            'aire acondicionado': 'climate.aire_acondicionado',
            'clima': 'climate.aire_acondicionado',
            'calefaccion': 'climate.aire_acondicionado',

            // Enchufes y Switches
            'enchufe': 'switch.enchufe_pc',
            'enchufe de la pc': 'switch.enchufe_pc',
            'enchufe pc': 'switch.enchufe_pc',
            'ventilador': 'switch.ventilador',

            // Sensores y Entorno
            'temperatura': 'sensor.temperatura_living',
            'temperatura del living': 'sensor.temperatura_living',
            'sensor de temperatura': 'sensor.temperatura_living',
            'puerta': 'binary_sensor.puerta_principal',
            'puerta principal': 'binary_sensor.puerta_principal',
            'puerta de entrada': 'binary_sensor.puerta_principal',

            // Multimedia / TV
            'tele': 'media_player.aiwa_tv',
            'la tele': 'media_player.aiwa_tv',
            'television': 'media_player.aiwa_tv'
        };

        this._setupDefaultAliases();
    }

    _setupDefaultAliases() {
        for (const [alias, id] of Object.entries(this.defaultAliases)) {
            this.aliases.set(alias.toLowerCase(), id);
        }
    }

    /**
     * Inicializa el servicio. Si no hay token configurado o HA está offline,
     * activa el modo de simulación y fallback con entidades virtuales.
     */
    async init({ haUrl = null, token = null, forceMock = false } = {}) {
        if (haUrl) this.haUrl = haUrl.replace(/\/$/, '');
        if (token) this.token = token;
        this.isMockMode = forceMock;
        if (!forceMock && !this.token) {
            this.entities.clear(); this.domainIndex.clear(); this.initialized = false;
            return { ok: false, mode: 'unavailable', message: 'Home Assistant no está configurado. Falta conectar el servidor con su token.' };
        }

        if (this.isMockMode) {
            this._initMockEntities();
            this.initialized = true;
            console.log('[HomeAssistant] 🏠 Operando en modo tolerancia offline / virtual.');
            return { ok: true, mode: 'mock', entityCount: this.entities.size };
        }

        try {
            // Intentar conectar al servidor real
            await this.syncAllStates();
            this._initWebSocket();
            this.initialized = true;
            console.log(`[HomeAssistant] 🏠 Conectado exitosamente a ${this.haUrl} (${this.entities.size} entidades sincronizadas).`);
            return { ok: true, mode: 'live', entityCount: this.entities.size };
        } catch (err) {
            this.isMockMode = false;
            this.initialized = false;
            this.entities.clear(); this.domainIndex.clear();
            return { ok: false, mode: 'unavailable', entityCount: 0, message: `No pude conectar con Home Assistant: ${err.message}` };
        }
    }

    /**
     * Inicializa entidades virtuales para pruebas y operación offline.
     */
    _initMockEntities() {
        const mockList = [
            {
                entity_id: 'light.living_room',
                state: 'off',
                attributes: { friendly_name: 'Luz Living', brightness: 255, supported_color_modes: ['brightness'] },
                last_changed: new Date().toISOString()
            },
            {
                entity_id: 'light.dormitorio',
                state: 'off',
                attributes: { friendly_name: 'Luz Dormitorio', brightness: 200 },
                last_changed: new Date().toISOString()
            },
            {
                entity_id: 'climate.aire_acondicionado',
                state: 'off',
                attributes: {
                    friendly_name: 'Aire Acondicionado Living',
                    current_temperature: 24,
                    temperature: 24,
                    hvac_modes: ['off', 'cool', 'heat', 'fan_only'],
                    hvac_mode: 'off'
                },
                last_changed: new Date().toISOString()
            },
            {
                entity_id: 'switch.enchufe_pc',
                state: 'on',
                attributes: { friendly_name: 'Enchufe PC Escritorio' },
                last_changed: new Date().toISOString()
            },
            {
                entity_id: 'switch.ventilador',
                state: 'off',
                attributes: { friendly_name: 'Ventilador' },
                last_changed: new Date().toISOString()
            },
            {
                entity_id: 'sensor.temperatura_living',
                state: '23.8',
                attributes: { friendly_name: 'Temperatura Living', unit_of_measurement: '°C', device_class: 'temperature' },
                last_changed: new Date().toISOString()
            },
            {
                entity_id: 'binary_sensor.puerta_principal',
                state: 'off',
                attributes: { friendly_name: 'Puerta Principal', device_class: 'door' },
                last_changed: new Date().toISOString()
            },
            {
                entity_id: 'media_player.aiwa_tv',
                state: 'on',
                attributes: { friendly_name: 'Smart TV Aiwa Living', volume_level: 0.35, is_volume_muted: false },
                last_changed: new Date().toISOString()
            }
        ];

        for (const item of mockList) {
            this._storeEntity(item);
        }
    }

    _storeEntity(entity) {
        this.entities.set(entity.entity_id, entity);

        // Indexar por dominio
        const domain = entity.entity_id.split('.')[0];
        if (!this.domainIndex.has(domain)) {
            this.domainIndex.set(domain, new Set());
        }
        this.domainIndex.get(domain).add(entity.entity_id);

        // Indexar alias por friendly_name
        if (entity.attributes && entity.attributes.friendly_name) {
            const cleanName = this._normalize(entity.attributes.friendly_name);
            this.aliases.set(cleanName, entity.entity_id);
        }
    }

    /**
     * Sincroniza todas las entidades desde la REST API de Home Assistant.
     */
    async syncAllStates() {
        if (this.isMockMode) {
            return Array.from(this.entities.values());
        }

        const res = await this._fetchWithTimeout(`${this.haUrl}/api/states`, {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        this.entities.clear();
        this.domainIndex.clear();
        this._setupDefaultAliases();

        for (const item of data) {
            this._storeEntity(item);
        }

        return data;
    }

    /**
     * Ejecuta una llamada de servicio en Home Assistant (/api/services/<domain>/<service>).
     */
    async callService(domain, service, serviceData = {}) {
        const entityId = serviceData.entity_id;

        // Si estamos en modo simulación / mock
        if (this.isMockMode) {
            return this._mockServiceCall(domain, service, serviceData);
        }

        try {
            const url = `${this.haUrl}/api/services/${domain}/${service}`;
            const res = await this._fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(serviceData)
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`Error en Home Assistant (${res.status}): ${errText || res.statusText}`);
            }

            const updatedStates = await res.json().catch(() => []);
            if (Array.isArray(updatedStates)) {
                for (const state of updatedStates) {
                    this._updateEntityState(state);
                }
            }

            return { success: true, domain, service, entity_id: entityId, data: serviceData };
        } catch (err) {
            console.error(`[HomeAssistant] Error al ejecutar servicio ${domain}.${service}:`, err.message);
            throw err;
        }
    }

    _mockServiceCall(domain, service, serviceData) {
        const entityId = serviceData.entity_id;
        const current = entityId ? this.entities.get(entityId) : null;
        const oldState = current ? current.state : null;
        let newState = oldState;

        if (service === 'turn_on') newState = 'on';
        else if (service === 'turn_off') newState = 'off';
        else if (service === 'toggle') newState = oldState === 'on' ? 'off' : 'on';
        else if (service === 'set_temperature') {
            newState = 'heat_cool';
            if (current && current.attributes) {
                current.attributes.temperature = serviceData.temperature;
            }
        }

        if (current) {
            current.state = newState;
            current.last_changed = new Date().toISOString();
            if (serviceData.brightness !== undefined && current.attributes) {
                current.attributes.brightness = serviceData.brightness;
            }

            // Emitir evento canónico en el bus de Jarvis
            this._notifyStateChange(entityId, oldState, newState, current.attributes);
        }

        return {
            success: true,
            mode: 'mock',
            domain,
            service,
            entity_id: entityId,
            newState
        };
    }

    /**
     * Consulta el estado de una entidad específica.
     */
    getState(entityId) {
        return this.entities.get(entityId) || null;
    }

    /**
     * Obtiene todos los estados actuales registrados en memoria.
     */
    getAllStates() {
        return Array.from(this.entities.values());
    }

    /**
     * Inicia conexión WebSocket para recibir cambios en tiempo real (state_changed).
     */
    _initWebSocket() {
        if (typeof WebSocket === 'undefined' || this.isMockMode) return;

        try {
            const wsUrl = this.haUrl.replace(/^http/, 'ws') + '/api/websocket';
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                // Esperar mensaje 'auth_required' de HA
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this._handleWsMessage(message);
                } catch (e) {
                    console.error('[HomeAssistant] Error parseando mensaje WS:', e.message);
                }
            };

            this.ws.onclose = () => {
                this.wsConnected = false;
                // Reintento automático de conexión con backoff
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => this._initWebSocket(), 5000);
            };

            this.ws.onerror = (err) => {
                console.warn('[HomeAssistant] Error en conexión WebSocket:', err.message || err);
            };
        } catch (err) {
            console.warn('[HomeAssistant] No se pudo crear WebSocket nativo:', err.message);
        }
    }

    _handleWsMessage(message) {
        if (message.type === 'auth_required') {
            this.ws.send(JSON.stringify({
                type: 'auth',
                access_token: this.token
            }));
            return;
        }

        if (message.type === 'auth_ok') {
            this.wsConnected = true;
            // Suscribirse al evento de cambio de estado
            this.ws.send(JSON.stringify({
                id: this.wsMessageId++,
                type: 'subscribe_events',
                event_type: 'state_changed'
            }));
            return;
        }

        if (message.type === 'event' && message.event && message.event.event_type === 'state_changed') {
            const data = message.event.data || {};
            const entityId = data.entity_id;
            const newState = data.new_state;
            const oldState = data.old_state;

            if (entityId && newState) {
                this._updateEntityState(newState);
                this._notifyStateChange(
                    entityId,
                    oldState ? oldState.state : null,
                    newState.state,
                    newState.attributes || {}
                );
            }
        }
    }

    _updateEntityState(stateObj) {
        if (!stateObj || !stateObj.entity_id) return;
        this._storeEntity(stateObj);
    }

    /**
     * Notifica el cambio de estado hacia el Event Bus canónico de Jarvis.
     * Esto alimenta directamente a Item 27 (Conditional Automations).
     */
    _notifyStateChange(entityId, oldState, newState, attributes = {}) {
        const domain = entityId.split('.')[0];
        eventBus.publish(SYSTEM_EVENTS.HA_STATE_CHANGED, {
            entityId,
            domain,
            oldState,
            newState,
            attributes,
            timestamp: new Date().toISOString()
        });
    }

    // ==========================================
    // RESOLUCIÓN SEMÁNTICA Y LENGUAJE NATURAL
    // ==========================================

    _normalize(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[¿?¡!.,;:]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Resuelve una frase en lenguaje natural hacia una entidad de Home Assistant.
     * Ejemplo: "luz del living" -> "light.living_room"
     * Ejemplo: "temperatura" -> "sensor.temperatura_living"
     */
    resolveEntity(text) {
        const clean = this._normalize(text);

        // 1. Coincidencia directa en alias
        if (this.aliases.has(clean)) {
            return this.aliases.get(clean);
        }

        // 2. Búsqueda por substring en alias
        for (const [alias, id] of this.aliases.entries()) {
            if (clean.includes(alias) || alias.includes(clean)) {
                return id;
            }
        }

        // 3. Búsqueda en friendly_names de entidades actuales
        for (const [id, entity] of this.entities.entries()) {
            const fn = this._normalize(entity.attributes?.friendly_name || '');
            if (fn && (clean.includes(fn) || fn.includes(clean))) {
                return id;
            }
        }

        // 4. Búsqueda por tipo básico según dominio
        if (/\b(?:luz|luces|lampara)\b/.test(clean)) {
            const lights = this.domainIndex.get('light');
            if (lights && lights.size > 0) return Array.from(lights)[0];
        }
        if (/\b(?:aire|clima|frio|calor)\b/.test(clean)) {
            const climates = this.domainIndex.get('climate');
            if (climates && climates.size > 0) return Array.from(climates)[0];
        }
        if (/\b(?:enchufe|switch|toma)\b/.test(clean)) {
            const switches = this.domainIndex.get('switch');
            if (switches && switches.size > 0) return Array.from(switches)[0];
        }

        return null;
    }

    /**
     * Interpreta y ejecuta una orden en lenguaje natural para domótica.
     * Retorna { success, message, entityId, state, action }
     */
    async executeCommand(text) {
        if (!this.initialized) {
            const status = await this.init();
            if (!status.ok) return { success: false, message: status.message };
        }
        const clean = this._normalize(text);

        // 1. Apagar todas las luces
        if (/\b(?:apaga(?:r)?|apagarme)\s+(?:todas\s+las\s+)?luces\b/.test(clean)) {
            const lights = Array.from(this.domainIndex.get('light') || []);
            for (const l of lights) {
                await this.callService('light', 'turn_off', { entity_id: l });
            }
            return {
                success: true,
                message: `Apagué ${lights.length > 0 ? `las ${lights.length} luces` : 'todas las luces'}.`,
                count: lights.length
            };
        }

        // 2. Control de Aire Acondicionado / Climatización con temperatura
        const tempMatch = clean.match(/(?:pon|pone|coloca|cambia|sete(?:a|ar)|ajusta|prende)?.*?(?:el\s+)?aire.*?(?:en|a)?\s*(\d{1,2})\s*(?:grados|°)?/i)
            || clean.match(/(?:a|en)\s*(\d{1,2})\s*(?:grados|°).*?(?:el\s+)?aire/i);
        if (tempMatch) {
            const temp = parseInt(tempMatch[1], 10);
            const climateId = this.resolveEntity('aire');
            if (climateId) {
                await this.callService('climate', 'set_temperature', { entity_id: climateId, temperature: temp });
                return {
                    success: true,
                    message: `Configuré el aire acondicionado a ${temp} grados.`,
                    entityId: climateId,
                    temperature: temp
                };
            }
        }

        // 3. Consulta de Temperatura / Sensores
        if (/\b(?:cuanta|que|cual\s+es\s+la|como\s+esta\s+la)\s+temperatura\b/.test(clean) || clean === 'temperatura' || clean === 'temperatura living') {
            const sensorId = this.resolveEntity('temperatura');
            const sensor = sensorId ? this.getState(sensorId) : null;
            if (sensor) {
                const val = sensor.state;
                const unit = sensor.attributes?.unit_of_measurement || 'grados';
                return {
                    success: true,
                    message: `La temperatura actual es de ${val} ${unit}.`,
                    entityId: sensorId,
                    value: val
                };
            }
        }

        // 4. Encendido genérico de luz o dispositivo
        if (/\b(?:prende|encende|activa|abrir)\b/.test(clean)) {
            const entityId = this.resolveEntity(clean);
            if (!entityId) {
                return { success: false, message: 'No identifiqué qué dispositivo encender.' };
            }
            const domain = entityId.split('.')[0];
            const service = domain === 'cover' ? 'open_cover' : 'turn_on';
            await this.callService(domain, service, { entity_id: entityId });
            const friendly = this.entities.get(entityId)?.attributes?.friendly_name || entityId;
            return {
                success: true,
                message: `Encendí ${friendly}.`,
                entityId,
                state: 'on'
            };
        }

        // 5. Apagado genérico de luz o dispositivo
        if (/\b(?:apaga|desactiva|apagar|cerrar)\b/.test(clean)) {
            const entityId = this.resolveEntity(clean);
            if (!entityId) {
                return { success: false, message: 'No identifiqué qué dispositivo apagar.' };
            }
            const domain = entityId.split('.')[0];
            const service = domain === 'cover' ? 'close_cover' : 'turn_off';
            await this.callService(domain, service, { entity_id: entityId });
            const friendly = this.entities.get(entityId)?.attributes?.friendly_name || entityId;
            return {
                success: true,
                message: `Apagué ${friendly}.`,
                entityId,
                state: 'off'
            };
        }

        return { success: false, message: 'Comando de domótica no reconocido.' };
    }

    /**
     * Helpers de conveniencia directa
     */
    async turnOn(entityId, options = {}) {
        const domain = entityId.split('.')[0];
        return this.callService(domain, 'turn_on', { entity_id: entityId, ...options });
    }

    async turnOff(entityId) {
        const domain = entityId.split('.')[0];
        return this.callService(domain, 'turn_off', { entity_id: entityId });
    }

    async toggle(entityId) {
        const domain = entityId.split('.')[0];
        return this.callService(domain, 'toggle', { entity_id: entityId });
    }

    async setTemperature(entityId, temperature) {
        return this.callService('climate', 'set_temperature', { entity_id: entityId, temperature });
    }

    listDevices(domainFilter = null) {
        const result = [];
        for (const entity of this.entities.values()) {
            const domain = entity.entity_id.split('.')[0];
            if (!domainFilter || domain === domainFilter) {
                result.push({
                    entity_id: entity.entity_id,
                    domain,
                    state: entity.state,
                    name: entity.attributes?.friendly_name || entity.entity_id,
                    attributes: entity.attributes
                });
            }
        }
        return result;
    }

    getPublicStatus() {
        return {
            connected: this.initialized && !this.isMockMode,
            isMockMode: this.isMockMode,
            haUrl: this.haUrl,
            entityCount: this.entities.size,
            domains: Array.from(this.domainIndex.keys())
        };
    }

    async _fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            return res;
        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    }

    close() {
        clearTimeout(this.reconnectTimer);
        if (this.ws) {
            try {
                this.ws.close();
            } catch (e) {}
            this.ws = null;
        }
        this.wsConnected = false;
    }
}

const homeAssistantService = new HomeAssistantService();
module.exports = homeAssistantService;
