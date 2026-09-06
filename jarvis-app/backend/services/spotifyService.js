/**
 * spotifyService.js — Integración directa con Spotify Web API
 * 
 * Permite buscar canciones/artistas y reproducirlos en el dispositivo activo
 * sin simular teclas ni nada frágil. 100% API oficial.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const TOKEN_FILE = path.join(__dirname, '..', 'data', 'spotify_tokens.json');
const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';

// Credenciales (se leen del .env)
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const REDIRECT_URI = `http://127.0.0.1:${process.env.PORT || 3000}/api/spotify/callback`;

// Scopes necesarios para buscar y reproducir
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative';

// ─── Token Management ────────────────────────────────────────────────────────

function loadTokens() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[Spotify] Error leyendo tokens:', e.message);
    }
    return null;
}

function saveTokens(tokens) {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function getAuthURL() {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: SCOPES,
        redirect_uri: REDIRECT_URI,
    });
    return `${SPOTIFY_ACCOUNTS}/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
    });

    const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
        },
        body: body.toString(),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Error obteniendo tokens: ${err}`);
    }

    const data = await res.json();
    const tokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in * 1000),
    };
    saveTokens(tokens);
    console.log('[Spotify] ✅ Autenticación exitosa. Tokens guardados.');
    return tokens;
}

async function refreshAccessToken() {
    const tokens = loadTokens();
    if (!tokens || !tokens.refresh_token) {
        throw new Error('No hay refresh token. Necesitas autenticarte primero.');
    }

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
    });

    const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
        },
        body: body.toString(),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Error refrescando token: ${err}`);
    }

    const data = await res.json();
    tokens.access_token = data.access_token;
    tokens.expires_at = Date.now() + (data.expires_in * 1000);
    if (data.refresh_token) tokens.refresh_token = data.refresh_token;
    saveTokens(tokens);
    return tokens;
}

async function getValidToken() {
    let tokens = loadTokens();
    if (!tokens) throw new Error('No autenticado con Spotify.');

    // Si el token expira en menos de 60 segundos, refrescar
    if (Date.now() > tokens.expires_at - 60000) {
        console.log('[Spotify] Token expirado, refrescando...');
        tokens = await refreshAccessToken();
    }
    return tokens.access_token;
}

// ─── API Calls ───────────────────────────────────────────────────────────────

async function spotifyAPI(endpoint, method = 'GET', body = null) {
    const token = await getValidToken();
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${SPOTIFY_API}${endpoint}`, options);

    // 204 No Content es éxito para PUT requests (como play)
    if (res.status === 204) return { success: true };
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Spotify API error (${res.status}): ${err}`);
    }
    return res.json();
}

/**
 * Busca en Spotify y reproduce el primer resultado.
 * @param {string} query - Lo que el usuario quiere escuchar
 * @returns {string} - Mensaje de confirmación
 */
async function searchAndPlay(query) {
    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('Faltan las credenciales de Spotify en el .env (SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET).');
    }

    const queryLower = query.toLowerCase().trim();
    let contextUri = null;
    let trackUris = null;
    let whatPlaying = '';

    // ──────────────────────────────────────────────────────────────────────
    // PASO 1: Buscar en las playlists PERSONALES del usuario primero
    // ──────────────────────────────────────────────────────────────────────
    try {
        const myPlaylists = await spotifyAPI('/me/playlists?limit=50');
        if (myPlaylists.items && myPlaylists.items.length > 0) {
            // Normalizar para comparación flexible
            const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
            const queryNorm = normalize(queryLower);

            const match = myPlaylists.items.find(p => {
                if (!p || !p.name) return false;
                const nameNorm = normalize(p.name);
                return nameNorm === queryNorm || nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm);
            });

            if (match) {
                contextUri = match.uri;
                whatPlaying = `tu playlist: ${match.name}`;
                console.log(`[Spotify] 📋 Playlist personal encontrada: ${match.name}`);
            }
        }
    } catch (e) {
        console.log('[Spotify] No pude leer playlists personales:', e.message);
    }

    // ──────────────────────────────────────────────────────────────────────
    // PASO 2: Si no matcheó playlist personal, buscar en catálogo público
    // ──────────────────────────────────────────────────────────────────────
    if (!contextUri) {
        const searchParams = new URLSearchParams({
            q: query,
            type: 'track,artist,album',
            limit: 5,
            market: 'AR',
        });
        const results = await spotifyAPI(`/search?${searchParams.toString()}`);

        // Prioridad 1: Artista — SOLO si es match exacto o casi exacto
        if (results.artists && results.artists.items.length > 0) {
            const artist = results.artists.items[0];
            const artistLower = artist.name.toLowerCase().trim();
            // Match estricto: el nombre del artista debe ser igual a la query
            // (permite "duki" == "Duki", pero NO "lucky" == "Lucky Brown")
            if (artistLower === queryLower || artistLower.replace(/[^a-z0-9]/g, '') === queryLower.replace(/[^a-z0-9]/g, '')) {
                contextUri = artist.uri;
                whatPlaying = `artista: ${artist.name}`;
            }
        }

        // Prioridad 2: Canción
        if (!contextUri && results.tracks && results.tracks.items.length > 0) {
            const track = results.tracks.items[0];
            trackUris = [track.uri];
            whatPlaying = `${track.name} de ${track.artists.map(a => a.name).join(', ')}`;
        }

        // Prioridad 3: Álbum
        if (!contextUri && !trackUris && results.albums && results.albums.items.length > 0) {
            const album = results.albums.items[0];
            contextUri = album.uri;
            whatPlaying = `álbum: ${album.name}`;
        }
    }

    if (!contextUri && !trackUris) {
        return `No encontré resultados para "${query}" en Spotify.`;
    }

    // 3. Reproducir — con manejo inteligente de dispositivos
    const playBody = {};
    if (contextUri) playBody.context_uri = contextUri;
    if (trackUris) playBody.uris = trackUris;

    // Intentar obtener un dispositivo activo
    let deviceId = await getActiveDeviceId();

    // Si no hay dispositivo, abrir Spotify y esperar
    if (!deviceId) {
        console.log('[Spotify] No hay dispositivo activo. Abriendo Spotify...');
        exec('start spotify:');

        // Esperar y reintentar hasta 3 veces (Spotify tarda en registrar el dispositivo)
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 3000));
            deviceId = await getActiveDeviceId();
            if (deviceId) break;
            console.log(`[Spotify] Esperando dispositivo... intento ${i + 2}/4`);
        }
    }

    if (!deviceId) {
        try {
            const structuredLogger = require('./diagnostics/structuredLoggerService');
            structuredLogger.error('spotifyService', 'play', {
                code: 'window_not_found',
                message: 'No hay dispositivo de Spotify activo disponible.'
            }, { whatPlaying });
        } catch (e) {}
        return `Encontré "${whatPlaying}" pero Spotify no tiene ningún dispositivo disponible. Abrí Spotify manualmente, dale play a cualquier canción por un segundo, y después pedime de nuevo.`;
    }

    // Transferir la reproducción al dispositivo encontrado (lo activa)
    try {
        await spotifyAPI('/me/player', 'PUT', { device_ids: [deviceId], play: false });
        await new Promise(r => setTimeout(r, 500));
    } catch (e) {
        console.log('[Spotify] Transfer warning (ignorable):', e.message);
    }

    // Ahora sí reproducir, forzando el device_id en la URL
    try {
        await spotifyAPI(`/me/player/play?device_id=${deviceId}`, 'PUT', playBody);
        console.log(`[Spotify] ▶️ Reproduciendo: ${whatPlaying}`);
        try {
            const structuredLogger = require('./diagnostics/structuredLoggerService');
            structuredLogger.info('spotifyService', 'play', { whatPlaying, deviceId });
        } catch (e) {}
        return `Reproduciendo ${whatPlaying}.`;
    } catch (e) {
        console.error('[Spotify] Error final al reproducir:', e.message);
        try {
            const structuredLogger = require('./diagnostics/structuredLoggerService');
            structuredLogger.error('spotifyService', 'play', e, { whatPlaying, deviceId });
        } catch (logErr) {}
        return `Encontré "${whatPlaying}" pero hubo un error al reproducirlo: ${e.message}`;
    }

}

/**
 * Obtiene el ID del primer dispositivo disponible (activo o no).
 */
async function getActiveDeviceId() {
    try {
        const data = await spotifyAPI('/me/player/devices');
        if (data.devices && data.devices.length > 0) {
            // Priorizar el dispositivo activo, sino usar el primero disponible
            const active = data.devices.find(d => d.is_active);
            const device = active || data.devices[0];
            console.log(`[Spotify] Dispositivo encontrado: ${device.name} (${device.type})`);
            return device.id;
        }
    } catch (e) {
        console.log('[Spotify] Error buscando dispositivos:', e.message);
    }
    return null;
}

/**
 * Verifica si Spotify está autenticado.
 */
function isAuthenticated() {
    const tokens = loadTokens();
    return !!(tokens && tokens.refresh_token);
}

module.exports = {
    getAuthURL,
    exchangeCodeForTokens,
    searchAndPlay,
    isAuthenticated,
    getValidToken,
};
