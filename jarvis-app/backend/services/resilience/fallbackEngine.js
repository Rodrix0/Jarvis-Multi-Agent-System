/**
 * fallbackEngine.js
 * 
 * Ítem 36: Fallbacks Inteligentes (Degradación Elegante Multi-Nivel)
 * 
 * Implementa una Cadena de Responsabilidad / Pipeline de Degradación Multi-Tier:
 * - Tier 1: Estrategia Primaria (API oficial / de alta fidelidad).
 * - Tier 2: Estrategia Secundaria (Automatización UI / Red local / Scraping directo).
 * - Tier 3: Estrategia de Último Recurso (Atajos de hardware / APIs públicas de respaldo).
 * 
 * Características avanzadas:
 * - Integración con Circuit Breakers (Fast-Skip: si el circuito de un tier está OPEN,
 *   lo omite en <1ms sin esperar timeouts).
 * - Trazabilidad completa (informa qué tier resolvió la petición y cuáles fallaron).
 * - Auditoría en StructuredLogger en cada intento y conmutación.
 */

const { exec } = require('child_process');
const { circuitBreakerManager } = require('./circuitBreakerService');

class FallbackChain {
    constructor(id, name) {
        this.id = id;
        this.name = name || id;
        this.tiers = [];
    }

    addTier({ name, execute, circuitBreakerResource = null, timeoutMs = 8000, description = '' }) {
        if (!name || typeof execute !== 'function') {
            throw new Error(`Tier inválido para cadena ${this.id}`);
        }
        this.tiers.push({
            name,
            execute,
            circuitBreakerResource,
            timeoutMs,
            description
        });
        return this;
    }

    async execute(params = {}, context = {}) {
        const tiersAttempted = [];
        const startTotal = Date.now();

        for (let i = 0; i < this.tiers.length; i++) {
            const tier = this.tiers[i];
            const tierIndex = i + 1;

            // 1. Fast-Skip por Circuit Breaker
            if (tier.circuitBreakerResource) {
                const breaker = circuitBreakerManager.getBreaker(tier.circuitBreakerResource);
                if (breaker && breaker.isOpen()) {
                    const remainingSec = breaker.getRemainingCooldownSeconds();
                    console.log(`[FallbackEngine] ⏩ Fast-Skip en '${tier.name}' (Tier ${tierIndex}): Circuit Breaker está ABIERTO (${remainingSec}s restantes).`);
                    tiersAttempted.push({
                        tier: tier.name,
                        tierIndex,
                        status: 'skipped_circuit_open',
                        reason: `Circuit Breaker abierto (${remainingSec}s restantes)`
                    });
                    continue; // Saltar inmediatamente al siguiente tier
                }
            }

            // 2. Intentar ejecutar el tier con timeout
            const startTier = Date.now();
            try {
                console.log(`[FallbackEngine] 🔄 Intentando Tier ${tierIndex} ('${tier.name}') para '${this.name}'...`);

                const result = await Promise.race([
                    tier.execute(params, context),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Timeout en ${tier.name} (${tier.timeoutMs}ms)`)), tier.timeoutMs)
                    )
                ]);

                const durationTier = Date.now() - startTier;
                const isDegraded = i > 0;

                // Si tenía circuit breaker, registrar éxito
                if (tier.circuitBreakerResource) {
                    const breaker = circuitBreakerManager.getBreaker(tier.circuitBreakerResource);
                    if (breaker) breaker.recordSuccess();
                }

                // Log estructurado de éxito
                try {
                    const structuredLogger = require('../diagnostics/structuredLoggerService');
                    structuredLogger.log({
                        level: isDegraded ? 'WARN' : 'INFO',
                        module: 'fallbackEngine',
                        action: `tier_resolved_${this.id}`,
                        result: 'success',
                        duration: durationTier,
                        metadata: {
                            chain: this.id,
                            tierUsed: tier.name,
                            tierIndex,
                            isDegraded,
                            tiersAttemptedCount: tiersAttempted.length
                        }
                    });
                } catch (e) {}

                return {
                    ok: true,
                    result,
                    tierUsed: tier.name,
                    tierIndex,
                    isDegraded,
                    tiersAttempted,
                    totalDurationMs: Date.now() - startTotal,
                    message: isDegraded
                        ? `Operación completada mediante '${tier.name}' (Tier ${tierIndex}, degradado desde Tier 1).`
                        : `Operación completada con éxito en '${tier.name}'.`
                };
            } catch (err) {
                const durationTier = Date.now() - startTier;
                console.warn(`[FallbackEngine] ⚠️ Falló Tier ${tierIndex} ('${tier.name}'): ${err.message} (${durationTier}ms)`);

                // Si tenía circuit breaker, registrar fallo
                if (tier.circuitBreakerResource) {
                    const breaker = circuitBreakerManager.getBreaker(tier.circuitBreakerResource);
                    if (breaker) breaker.recordFailure(err);
                }

                // Registrar intento fallido
                tiersAttempted.push({
                    tier: tier.name,
                    tierIndex,
                    status: 'failed',
                    error: err.message,
                    durationMs: durationTier
                });

                try {
                    const structuredLogger = require('../diagnostics/structuredLoggerService');
                    structuredLogger.log({
                        level: 'WARN',
                        module: 'fallbackEngine',
                        action: `tier_failed_${this.id}`,
                        result: 'error',
                        duration: durationTier,
                        error: { code: 'tier_failed', message: err.message },
                        metadata: {
                            chain: this.id,
                            tier: tier.name,
                            tierIndex,
                            nextTierAvailable: i + 1 < this.tiers.length
                        }
                    });
                } catch (e) {}
            }
        }

        // Si todos los tiers fallaron
        return {
            ok: false,
            error: `Todos los niveles de fallback (${this.tiers.length}) fallaron para la cadena '${this.name}'.`,
            tiersAttempted,
            totalDurationMs: Date.now() - startTotal
        };
    }
}

class FallbackEngine {
    constructor() {
        this.chains = new Map();
        this.initDefaultChains();
    }

    getChain(chainId) {
        return this.chains.get(chainId);
    }

    registerChain(chain) {
        this.chains.set(chain.id, chain);
        return chain;
    }

    createChain(id, name) {
        const chain = new FallbackChain(id, name);
        this.registerChain(chain);
        return chain;
    }

    async executeChain(chainId, params = {}, context = {}) {
        const chain = this.chains.get(chainId);
        if (!chain) {
            return { ok: false, error: `Cadena de fallback '${chainId}' no encontrada.` };
        }
        return await chain.execute(params, context);
    }

    initDefaultChains() {
        // ─────────────────────────────────────────────────────────────────────
        // 1. Cadena Spotify / Multimedia (Ítem 36):
        //    Tier 1: API de Spotify
        //    Tier 2: Buscar en la app de Windows (URI)
        //    Tier 3: Enviar atajo multimedia global (Play/Pause)
        // ─────────────────────────────────────────────────────────────────────
        const spotifyChain = new FallbackChain('spotify', 'Spotify Multimedia Fallback');

        // Tier 1: API oficial
        spotifyChain.addTier({
            name: 'spotify_api',
            circuitBreakerResource: 'spotify',
            timeoutMs: 4000,
            description: 'API oficial de Spotify Web para búsqueda y reproducción remota',
            execute: async (params) => {
                const spotifyService = require('../spotifyService');
                if (!spotifyService.isAuthenticated()) {
                    throw new Error('Spotify no está autenticado con token OAuth.');
                }
                const res = await spotifyService.searchAndPlay(params.query || 'playlist');
                if (typeof res === 'string' && res.toLowerCase().includes('error')) {
                    throw new Error(res);
                }
                return res;
            }
        });

        // Tier 2: App nativa de Windows (URI scheme)
        spotifyChain.addTier({
            name: 'windows_app_search',
            timeoutMs: 3000,
            description: 'Búsqueda directa en la app de escritorio de Spotify mediante URI',
            execute: async (params) => {
                return new Promise((resolve, reject) => {
                    const queryEncoded = encodeURIComponent(params.query || '');
                    const cmd = `start spotify:search:${queryEncoded}`;
                    exec(cmd, (err) => {
                        if (err) return reject(new Error(`Error abriendo app de Spotify: ${err.message}`));
                        resolve(`Buscando "${params.query}" en la aplicación de Spotify de Windows.`);
                    });
                });
            }
        });

        // Tier 3: Atajo multimedia global de hardware (VK_MEDIA_PLAY_PAUSE)
        spotifyChain.addTier({
            name: 'global_media_key',
            timeoutMs: 2500,
            description: 'Envío de pulsación global de tecla multimedia Play/Pause a Windows',
            execute: async () => {
                return new Promise((resolve, reject) => {
                    // WScript Shell envía tecla Play/Pause (código 179 / 0xB3)
                    const psCommand = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]179)"`;
                    exec(psCommand, (err) => {
                        if (err) return reject(new Error(`Falla al enviar tecla multimedia: ${err.message}`));
                        resolve('Enviado comando multimedia Play a Windows.');
                    });
                });
            }
        });

        this.registerChain(spotifyChain);

        // ─────────────────────────────────────────────────────────────────────
        // 2. Cadena TV / Control Remoto (Ítem 36):
        //    Tier 1: API LAN (Socket / IP control)
        //    Tier 2: BroadLink Infrarrojo (IR)
        // ─────────────────────────────────────────────────────────────────────
        const tvChain = new FallbackChain('tv', 'TV Remote Fallback');

        // Tier 1: Conexión IP / API LAN
        tvChain.addTier({
            name: 'tv_lan_api',
            circuitBreakerResource: 'tv_lan',
            timeoutMs: 2000,
            description: 'Conexión IP directa por API LAN hacia la TV',
            execute: async (params) => {
                const tvService = require('../tvService');
                const tvStatus = tvService.getPublicStatus ? tvService.getPublicStatus() : {};
                if (!tvStatus.ip || tvStatus.ip === 'unknown') {
                    throw new Error('TV no tiene IP LAN configurada para control directo.');
                }
                // Si existiese soporte LAN IP nativo, se invoca aquí
                throw new Error('API LAN no conectada en este modelo de TV.');
            }
        });

        // Tier 2: Emisión Infrarroja vía BroadLink RM4
        tvChain.addTier({
            name: 'broadlink_ir',
            circuitBreakerResource: 'broadlink',
            timeoutMs: 4000,
            description: 'Emisión de comando Infrarrojo (IR) mediante BroadLink RM4',
            execute: async (params) => {
                const tvService = require('../tvService');
                const button = String(params.button || params.command || 'power').toLowerCase();
                const res = await tvService.sendButtons([button], 300);
                return res || { ok: true, button, provider: 'broadlink_ir' };
            }
        });

        this.registerChain(tvChain);

        // ─────────────────────────────────────────────────────────────────────
        // 3. Cadena Búsqueda Web (Ítem 36):
        //    Tier 1: SearXNG (Metabuscador local)
        //    Tier 2: DuckDuckGo (Instant Answer / Lite)
        //    Tier 3: Bing (Búsqueda de respaldo)
        // ─────────────────────────────────────────────────────────────────────
        const webChain = new FallbackChain('web_search', 'Búsqueda Web Fallback');

        // Tier 1: SearXNG
        webChain.addTier({
            name: 'searxng',
            circuitBreakerResource: 'searxng',
            timeoutMs: 2500,
            description: 'Metabuscador privado local SearXNG',
            execute: async (params) => {
                const searxUrl = process.env.SEARXNG_URL || 'http://127.0.0.1:8888';
                const query = encodeURIComponent(params.query || '');
                const res = await fetch(`${searxUrl}/search?q=${query}&format=json`, { signal: AbortSignal.timeout(2000) });
                if (!res.ok) throw new Error(`SearXNG error HTTP ${res.status}`);
                const data = await res.json();
                return { source: 'searxng', results: data.results || [] };
            }
        });

        // Tier 2: DuckDuckGo
        webChain.addTier({
            name: 'duckduckgo',
            timeoutMs: 3000,
            description: 'Búsqueda en DuckDuckGo Instant Answers API',
            execute: async (params) => {
                const query = encodeURIComponent(params.query || '');
                const url = `https://api.duckduckgo.com/?q=${query}&format=json&no_html=1`;
                const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
                if (!res.ok) throw new Error(`DuckDuckGo error HTTP ${res.status}`);
                const data = await res.json();
                return {
                    source: 'duckduckgo',
                    heading: data.Heading,
                    abstract: data.AbstractText || (data.RelatedTopics?.[0]?.Text) || ''
                };
            }
        });

        // Tier 3: Bing / Fallback seguro
        webChain.addTier({
            name: 'bing',
            timeoutMs: 3000,
            description: 'Búsqueda de contingencia en Bing',
            execute: async (params) => {
                return {
                    source: 'bing',
                    query: params.query,
                    url: `https://www.bing.com/search?q=${encodeURIComponent(params.query || '')}`,
                    message: `Consulta redirigida a Bing Search.`
                };
            }
        });

        this.registerChain(webChain);
    }

    getChainsStatus() {
        const result = {};
        for (const [id, chain] of this.chains.entries()) {
            result[id] = {
                id: chain.id,
                name: chain.name,
                tiers: chain.tiers.map((t, idx) => ({
                    index: idx + 1,
                    name: t.name,
                    circuitBreakerResource: t.circuitBreakerResource,
                    timeoutMs: t.timeoutMs,
                    description: t.description
                }))
            };
        }
        return result;
    }
}

const fallbackEngine = new FallbackEngine();
module.exports = {
    FallbackChain,
    FallbackEngine,
    fallbackEngine
};
