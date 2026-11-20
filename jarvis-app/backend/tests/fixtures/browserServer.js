/**
 * Local HTTP Fixture Server for Browser Real E2E (JARVIS 3.1)
 * Provee páginas y endpoints controlados sin dependencias externas:
 * - /         : Landing page con navegación
 * - /form     : Formulario con campos de texto, select, checkbox y envío
 * - /download : Descarga real con tamaño y hash SHA-256 verificable
 * - /tabs     : Apertura y gestión de pestañas múltiples
 * - /newPage  : Destino de nueva pestaña
 * - /dynamic  : Carga de elementos con retraso asíncrono
 */

const http = require('http');
const crypto = require('crypto');

const DOWNLOAD_PAYLOAD = Buffer.from('JARVIS_3_1_REAL_DOWNLOAD_VALIDATION_BUFFER_DATA_STREAM_OK\n', 'utf8');
const DOWNLOAD_HASH = crypto.createHash('sha256').update(DOWNLOAD_PAYLOAD).digest('hex');
const DOWNLOAD_SIZE = DOWNLOAD_PAYLOAD.length;

function createServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        if (url.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>JARVIS E2E Landing</title></head>
                <body>
                    <h1>JARVIS 3.1 Browser Fixture</h1>
                    <nav>
                        <a id="nav-form" href="/form">Formulario</a>
                        <a id="nav-download" href="/download">Descarga</a>
                        <a id="nav-tabs" href="/tabs">Pestañas</a>
                        <a id="nav-dynamic" href="/dynamic">Contenido Dinámico</a>
                    </nav>
                </body>
                </html>
            `);
            return;
        }

        if (url.pathname === '/form') {
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    const params = new URLSearchParams(body);
                    const name = params.get('username') || 'Anónimo';
                    const category = params.get('category') || 'none';
                    const agreed = params.get('agree') === 'on' ? 'yes' : 'no';

                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head><title>Resultado Formulario</title></head>
                        <body>
                            <h2>Formulario Procesado</h2>
                            <div id="successMsg">TOKEN_JARVIS_SUCCESS: usuario=${name}, categoria=${category}, acepto=${agreed}</div>
                            <a href="/form">Volver</a>
                        </body>
                        </html>
                    `);
                });
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>JARVIS Form E2E</title></head>
                <body>
                    <h1>Formulario de Prueba E2E</h1>
                    <form id="testForm" method="POST" action="/form">
                        <div>
                            <label>Nombre:</label>
                            <input id="username" name="username" type="text" placeholder="Ingresá tu nombre" />
                        </div>
                        <div>
                            <label>Categoría:</label>
                            <select id="category" name="category">
                                <option value="standard">Standard</option>
                                <option value="premium">Premium</option>
                                <option value="enterprise">Enterprise</option>
                            </select>
                        </div>
                        <div>
                            <label>
                                <input id="agree" name="agree" type="checkbox" />
                                Acepto términos y condiciones
                            </label>
                        </div>
                        <button id="submitBtn" type="submit">Enviar Formulario</button>
                    </form>
                </body>
                </html>
            `);
            return;
        }

        if (url.pathname === '/download') {
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': 'attachment; filename="jarvis_real_payload.dat"',
                'Content-Length': DOWNLOAD_SIZE
            });
            res.end(DOWNLOAD_PAYLOAD);
            return;
        }

        if (url.pathname === '/tabs') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>JARVIS Tabs E2E</title></head>
                <body>
                    <h1>Gestor de Pestañas</h1>
                    <a id="openTabLink" href="/newPage" target="_blank">Abrir Nueva Pestaña</a>
                </body>
                </html>
            `);
            return;
        }

        if (url.pathname === '/newPage') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>JARVIS Nueva Pestaña Secundaria</title></head>
                <body>
                    <h1>Pestaña Secundaria Cargada</h1>
                    <p id="tabContent">Contenido verificado en pestaña secundaria.</p>
                </body>
                </html>
            `);
            return;
        }

        if (url.pathname === '/dynamic') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>JARVIS Dynamic E2E</title></head>
                <body>
                    <h1>Carga Asíncrona</h1>
                    <div id="loadingStatus">Esperando datos del servidor...</div>
                    <script>
                        setTimeout(() => {
                            const d = document.createElement('div');
                            d.id = 'asyncReadyElement';
                            d.innerText = 'DATOS_ASINCRONOS_COMPLETADOS_JARVIS';
                            document.body.appendChild(d);
                            document.getElementById('loadingStatus').innerText = 'Listo.';
                        }, 500);
                    </script>
                </body>
                </html>
            `);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    return server;
}

function startServer(port = 0) {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.listen(port, '127.0.0.1', () => {
            const assignedPort = server.address().port;
            const baseUrl = `http://127.0.0.1:${assignedPort}`;
            resolve({
                server,
                port: assignedPort,
                baseUrl,
                payloadHash: DOWNLOAD_HASH,
                payloadSize: DOWNLOAD_SIZE,
                close: () => new Promise(res => server.close(res))
            });
        });
        server.on('error', reject);
    });
}

module.exports = {
    startServer,
    DOWNLOAD_HASH,
    DOWNLOAD_SIZE
};
