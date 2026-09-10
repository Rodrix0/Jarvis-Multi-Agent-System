/**
 * Deep Web Research Service for Jarvis
 * Reemplaza el scraping plano por un pipeline de investigación analítica:
 * Pregunta -> 3-5 subconsultas -> Multi-fuente -> Deduplicación ->
 * Extracción de contenido -> Cálculo de confianza (0-1) -> Síntesis comparada.
 */

const cheerio = require('cheerio');

class ResearchService {
    constructor() {
        this.headersBing = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
        };
        this.headersDuck = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
    }

    /**
     * Descompone la consulta original en 3 a 5 subconsultas específicas
     * para abarcar diferentes ángulos (especificaciones, comparativas, precios, opiniones).
     */
    generateSubQueries(question) {
        const clean = String(question || '').toLowerCase().trim();
        const base = clean
            .replace(/^(?:investig[aá]|averigu[aá]|busc[aá]|consult[aá]|compar[aá]|quiero\s+saber|decime)\s+(?:sobre|de|acerca\s+de)?\s*/i, '')
            .trim();

        const queries = new Set();
        queries.add(base);

        if (/\b(?:gpu|placa\s+de\s+video|tarjeta\s+gr[aá]fica|computadora|pc|notebook|procesador|cpu)\b/i.test(base)) {
            queries.add(`${base} mejores opciones calidad precio`);
            queries.add(`${base} comparativa rendimiento benchmarks`);
            queries.add(`${base} opiniones y recomendaciones`);
            queries.add(`${base} precios argentina`);
        } else if (/\b(?:versus|vs|o\b|comparar|mejor\s+que)\b/i.test(base)) {
            queries.add(`${base} diferencias ventajas y desventajas`);
            queries.add(`${base} benchmark comparativa tecnica`);
            queries.add(`${base} cual conviene comprar`);
        } else if (/\b(?:error|bug|soluci[oó]n|falla|no\s+funciona|problema)\b/i.test(base)) {
            queries.add(`${base} solution fix solved`);
            queries.add(`${base} causa y como resolver`);
            queries.add(`${base} foro soporte oficial`);
        } else {
            queries.add(`${base} guia completa caracteristicas`);
            queries.add(`${base} comparativa mejores alternativas`);
            queries.add(`${base} analisis y opiniones`);
        }

        return Array.from(queries).slice(0, 5);
    }

    /**
     * Ejecuta una búsqueda en Bing y extrae resultados orgánicos estructurados.
     */
    async searchBing(query, timeoutMs = 6000) {
        const results = [];
        try {
            const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=es-AR&setlang=es`;
            const res = await fetch(url, { headers: this.headersBing, signal: AbortSignal.timeout(timeoutMs) });
            if (!res.ok) return results;

            const html = await res.text();
            const $ = cheerio.load(html);

            $('#b_results > li.b_algo').each((_, elem) => {
                const title = $(elem).find('h2 a').text().trim();
                const link = $(elem).find('h2 a').attr('href');
                const snippet = $(elem).find('.b_caption p, .b_algoSlug, p').first().text().trim();
                
                if (title && link && link.startsWith('http')) {
                    results.push({
                        title,
                        url: link,
                        date: new Date().toISOString().split('T')[0],
                        source: 'Bing',
                        content: snippet || title
                    });
                }
            });
        } catch (_) {}
        return results;
    }

    /**
     * Ejecuta una búsqueda en DuckDuckGo y extrae resultados orgánicos estructurados.
     */
    async searchDuckDuckGo(query, timeoutMs = 6000) {
        const results = [];
        try {
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const res = await fetch(url, { headers: this.headersDuck, signal: AbortSignal.timeout(timeoutMs) });
            if (!res.ok) return results;

            const html = await res.text();
            const $ = cheerio.load(html);

            $('.result').each((_, elem) => {
                const title = $(elem).find('.result__title a').text().trim();
                let link = $(elem).find('.result__url').attr('href') || $(elem).find('.result__title a').attr('href');
                const snippet = $(elem).find('.result__snippet').text().trim();

                // Desempaquetar URL de redirección de DuckDuckGo si aplica
                if (link && link.includes('uddg=')) {
                    const match = link.match(/uddg=([^&]+)/);
                    if (match) link = decodeURIComponent(match[1]);
                }

                if (title && link && link.startsWith('http')) {
                    results.push({
                        title,
                        url: link,
                        date: new Date().toISOString().split('T')[0],
                        source: 'DuckDuckGo',
                        content: snippet || title
                    });
                }
            });
        } catch (_) {}
        return results;
    }

    /**
     * Deduplica resultados basándose en URLs canónicas normalizadas.
     */
    deduplicate(results) {
        const seen = new Set();
        const deduplicated = [];

        for (const item of results) {
            try {
                const parsed = new URL(item.url);
                // Eliminar parámetros de rastreo
                parsed.searchParams.delete('utm_source');
                parsed.searchParams.delete('utm_medium');
                parsed.searchParams.delete('utm_campaign');
                parsed.searchParams.delete('ref');
                const canonical = `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/+$/, '');

                if (!seen.has(canonical)) {
                    seen.add(canonical);
                    deduplicated.push(item);
                }
            } catch (_) {
                if (!seen.has(item.url)) {
                    seen.add(item.url);
                    deduplicated.push(item);
                }
            }
        }
        return deduplicated;
    }

    /**
     * Extrae y pondera cada fuente calculando su nivel de confianza (0.0 a 1.0).
     */
    extractAndScore(results, originalQuestion) {
        const words = String(originalQuestion || '').toLowerCase()
            .replace(/[¿?¡!.,;:]/g, '')
            .split(/\s+/)
            .filter(w => w.length >= 4);

        const authoritativeDomains = [
            'wikipedia.org', 'github.com', 'stackoverflow.com', 'techpowerup.com',
            'tomshardware.com', 'xataka.com', 'hardzone.es', 'geeknetic.es',
            'mercadolibre.com.ar', 'compragamer.com', 'libreopcion.com'
        ];

        return results.map(item => {
            let score = 0.65; // Confianza base para resultados de motores indexados

            const fullText = `${item.title} ${item.content}`.toLowerCase();

            // 1. Densidad de coincidencias con la consulta original
            let matchCount = 0;
            for (const word of words) {
                if (fullText.includes(word)) matchCount++;
            }
            const matchRatio = words.length > 0 ? (matchCount / words.length) : 0.5;
            score += Math.min(0.20, matchRatio * 0.20);

            // 2. Longitud y densidad informativa del snippet
            if (item.content && item.content.length > 80) {
                score += 0.05;
            }

            // 3. Ponderación por autoridad de dominio
            try {
                const hostname = new URL(item.url).hostname.toLowerCase();
                if (authoritativeDomains.some(dom => hostname.endsWith(dom))) {
                    score += 0.08;
                }
            } catch (_) {}

            const confidence = Math.min(0.98, Math.max(0.50, Math.round(score * 100) / 100));

            return {
                title: item.title,
                url: item.url,
                date: item.date || new Date().toISOString().split('T')[0],
                source: item.source || 'Web',
                content: item.content,
                confidence
            };
        }).sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Sintetiza y compara los resultados de las diferentes fuentes.
     */
    synthesize(scoredSources, topic) {
        if (!scoredSources || scoredSources.length === 0) {
            return {
                summary: `No se encontraron fuentes concluyentes sobre "${topic}".`,
                consensus: 'Sin datos disponibles.',
                topSources: []
            };
        }

        const top = scoredSources.slice(0, 6);
        const avgConfidence = Math.round((top.reduce((acc, s) => acc + s.confidence, 0) / top.length) * 100) / 100;

        const summaryPoints = top.map((s, idx) => `[${idx + 1}] ${s.title}: ${s.content}`).join('\n\n');

        return {
            summary: `Se analizaron ${scoredSources.length} fuentes sobre "${topic}".`,
            consensus: summaryPoints,
            topSources: top,
            avgConfidence
        };
    }

    /**
     * Flujo completo de investigación analítica:
     * pregunta -> subqueries -> multi-fuente -> deduplicar -> ponderar -> sintetizar.
     */
    async research(question, options = {}) {
        const start = Date.now();
        console.log(`\n[ResearchService] 🔬 Iniciando investigación analítica sobre: "${question}"...`);

        // 1. Generar 3 a 5 subconsultas
        const subQueries = this.generateSubQueries(question);
        console.log(`[ResearchService] 📋 Subconsultas generadas (${subQueries.length}):`, subQueries);

        // 2. Búsquedas concurrentes multi-fuente
        const fetchPromises = [];
        for (const q of subQueries) {
            fetchPromises.push(this.searchBing(q, options.timeoutMs || 5000));
            fetchPromises.push(this.searchDuckDuckGo(q, options.timeoutMs || 5000));
        }

        const rawResultsArray = await Promise.all(fetchPromises);
        const combined = rawResultsArray.flat();
        console.log(`[ResearchService] 🌐 Fuentes brutas recuperadas: ${combined.length}`);

        // 3. Deduplicación
        const deduplicated = this.deduplicate(combined);
        console.log(`[ResearchService] ✂️ Fuentes tras deduplicación: ${deduplicated.length}`);

        // 4. Extracción de contenido y cálculo de confianza (0-1)
        const scored = this.extractAndScore(deduplicated, question);

        // 5. Comparar y sintetizar hallazgos
        const synthesis = this.synthesize(scored, question);
        const elapsedMs = Date.now() - start;

        console.log(`[ResearchService] 📊 Investigación completada en ${elapsedMs}ms con confianza media: ${synthesis.avgConfidence || 0}\n`);

        return {
            ok: scored.length > 0,
            topic: question,
            subQueries,
            totalSourcesFound: combined.length,
            uniqueSources: scored.length,
            sources: scored.slice(0, options.maxSources || 10),
            synthesis,
            elapsedMs
        };
    }
}

const researchService = new ResearchService();
module.exports = researchService;
