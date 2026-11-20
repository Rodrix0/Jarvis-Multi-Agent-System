const { exec } = require('child_process');

// Stremio Cinemeta API (pública, sin API key)
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

/**
 * Busca películas o series usando Cinemeta (addon oficial de Stremio).
 * Devuelve un array de resultados con id, nombre, año, poster, descripción, etc.
 */
async function searchContent(query, type = 'auto') {
    const results = [];

    try {
        // Series primero (la gente busca más series que pelis)
        const types = type === 'auto' ? ['series', 'movie'] : [type];

        for (const t of types) {
            const url = `${CINEMETA_BASE}/catalog/${t}/top/search=${encodeURIComponent(query)}.json`;
            console.log(`[StreamingService] Buscando ${t}: ${url}`);

            const response = await fetch(url, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(10000) // 10s timeout
            });

            if (!response.ok) {
                console.warn(`[StreamingService] Cinemeta respondió HTTP ${response.status} para ${t}`);
                continue;
            }

            const data = await response.json();
            if (data.metas && data.metas.length > 0) {
                for (const meta of data.metas.slice(0, 5)) { // Max 5 por tipo
                    results.push({
                        id: meta.id, // IMDb ID (ej: tt1234567)
                        type: t,
                        name: meta.name,
                        year: meta.releaseInfo || meta.year || '',
                        poster: meta.poster || '',
                        description: meta.description || '',
                        rating: parseFloat(meta.imdbRating || meta.rating || '0') || 0,
                        genres: meta.genres || [],
                    });
                }
            }
        }
    } catch (e) {
        console.error('[StreamingService] Error buscando contenido:', e.message);
    }

    // Ordenar por rating de mayor a menor para que el contenido popular gane
    results.sort((a, b) => b.rating - a.rating);

    return results;
}

/**
 * Obtiene detalles completos de una película o serie por su IMDb ID.
 */
async function getDetails(imdbId, type = 'movie') {
    try {
        const url = `${CINEMETA_BASE}/meta/${type}/${imdbId}.json`;
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) return null;

        const data = await response.json();
        return data.meta || null;
    } catch (e) {
        console.error('[StreamingService] Error obteniendo detalles:', e.message);
        return null;
    }
}

/**
 * Abre contenido directamente en Stremio via web.
 * Funciona con Stremio instalado o sin instalar.
 */
function openInStremio(imdbId, type = 'movie') {
    const webUrl = `https://web.stremio.com/#/detail/${type}/${imdbId}`;
    console.log(`[StreamingService] Abriendo en Stremio Web: ${webUrl}`);
    exec(`start "" "${webUrl}"`, (err) => {
        if (err) {
            console.error('[StreamingService] Error abriendo Stremio Web:', err.message);
        }
    });
}

/**
 * Busca y devuelve una lista numerada para que el usuario elija.
 */
async function searchAndList(query, type = 'auto') {
    const results = await searchContent(query, type);

    if (results.length === 0) {
        return {
            found: false,
            results: [],
            message: `No encontre resultados para "${query}". Intenta con otro nombre.`
        };
    }

    // Tomar los mejores 6 resultados
    const top = results.slice(0, 6);

    // Construir mensaje con lista numerada
    let message = `🔍 Resultados para "${query}":\n\n`;
    top.forEach((r, i) => {
        const tipo = r.type === 'movie' ? '🎬 Pelicula' : '📺 Serie';
        message += `${i + 1}. ${r.name} (${r.year}) - ${tipo} ⭐${r.rating}\n`;
    });
    return {
        found: true,
        results: top,
        message: message
    };
}

/**
 * Busca contenido y opcionalmente abre el primer resultado directamente en Stremio Web.
 */
async function searchAndOpen(query, type = 'auto', openFirst = true) {
    const results = await searchContent(query, type);

    if (results.length === 0) {
        return {
            found: false,
            results: [],
            message: `No encontré resultados para "${query}".`
        };
    }

    const first = results[0];
    if (openFirst) {
        openInStremio(first.id, first.type);
    }

    return {
        found: true,
        results: results.slice(0, 5),
        opened: first,
        message: `Encontré "${first.name}" (${first.year}) ⭐${first.rating}. Abriendo en Stremio.`
    };
}

module.exports = {
    searchContent,
    getDetails,
    openInStremio,
    searchAndList,
    searchAndOpen
};
