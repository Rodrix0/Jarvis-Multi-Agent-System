const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Passive observer: this component never executes or repeats a Jarvis command.
class DesktopCompanionService {
    constructor({ now = Date.now, launch = spawn, platform = process.platform, settingsPath = require("./dataPaths").dataPath("desktop_companion.json") } = {}) {
        this.now = now; this.launch = launch; this.platform = platform; this.settingsPath = settingsPath;
        this.clients = new Map(); this.registered = false; this.child = null; this.lastLaunch = -Infinity;
        this.enabled = true; this.animations = true; this.previewUntil = 0; this.revision = 0; this.error = null; this.speaking = false;
        this.token = crypto.randomBytes(24).toString('hex');
        this.activity = { state: 'idle', title: 'Jarvis está acá', text: 'Cuando me pidas algo, te aviso cómo va.', at: now() };
        try { const saved=JSON.parse(fs.readFileSync(settingsPath, 'utf8'));this.enabled=saved.enabled!==false;this.animations=saved.animations!==false; } catch (_) {}
    }
    configure(enabled, animations = this.animations) {
        this.enabled = enabled === true;
        this.animations = animations === true;
        fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
        fs.writeFileSync(this.settingsPath, JSON.stringify({ enabled: this.enabled, animations: this.animations }));
        if (this.enabled) this.ensureStarted();
    }
    presence(id, data) {
        if (!data || typeof data.visible !== 'boolean') return;
        this.registered = true;
        this.clients.set(id, { visible: data.visible });
        // Socket.IO manages liveness even when Chromium throttles hidden tabs.
        this.ensureStarted();
    }
    detach(id) { this.clients.delete(id); }
    observe(event, data = {}) {
        if (data == null) return;
        let state, title, text;
        if (event === 'action_status') {
            if (['heard', 'accepted', 'working'].includes(data.phase)) { state = 'working'; title = 'Me pongo a trabajar…'; }
            else return; // A response carries the authoritative final result.
            text = data.message || title;
        } else if (event === 'response') {
            const asksQuestion = /\?\s*$/.test(String(data.voiceText || data.text || '').trim());
            state = data.confirmationToken || data.status === 'needs_input' || (asksQuestion && data.status !== 'failed') ? 'waiting' : ['working', 'running', 'queued', 'pending'].includes(data.status) ? 'working' : data.status === 'failed' ? 'failed' : data.status === 'completed' ? 'completed' : 'reply';
            title = { working: 'Estoy trabajando…', waiting: 'Necesito tu respuesta', failed: 'No pude completarlo', completed: 'Listo, jefe', reply: 'Jarvis te responde' }[state];
            text = data.voiceText || data.text || title;
        } else if (event === 'notification') {
            state = 'notice'; title = data.title || 'Aviso de Jarvis'; text = data.message || '';
        } else if (event === 'tv_progress' && this.activity.state === 'working') {
            state = 'working'; title = 'Estoy trabajando…'; text = typeof data === 'string' ? data : data.message;
            if (!text) return;
        } else return;
        // One broadcast can be observed through several connected sockets.
        text = String(text).replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 420);
        if (state === this.activity.state && text === this.activity.text && this.now() - this.activity.at < 750) return;
        this.activity = { state, title: String(title).slice(0, 80), text, at: this.now() }; this.revision++;
        // An open interface owns speech. Only fill the gap when every UI is closed;
        // local voice replies with suppressTts already have their own audio owner.
        if (event === 'response' && !data.suppressTts && this.enabled && this.registered && this.clients.size === 0 && this.speak) {
            Promise.resolve().then(() => this.speak(text)).catch(() => { this.error = 'El aviso quedó en pantalla; no se pudo reproducir la voz.'; });
        }
    }
    snapshot() {
        const interfaceVisible = [...this.clients.values()].some(c => c.visible);
        return { enabled: this.enabled, animations: this.animations, visible: this.enabled && this.registered && (!interfaceVisible || this.previewUntil > this.now()), ...this.activity, revision: this.revision, running: Boolean(this.child), speaking: this.speaking, error: this.error };
    }
    ensureStarted() {
        if (!this.enabled || this.platform !== 'win32' || this.child || this.now() - this.lastLaunch < 15000) return;
        this.lastLaunch = this.now(); this.error = null;
        const script = path.join(__dirname, '../scripts/desktopCompanion.ps1');
        const child = this.launch('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', String(this.port || 3000), '-Token', this.token], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        this.child = child;
        let diagnostic = '';
        child.stderr?.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-3000); });
        child.on('error', err => { this.error = `No se pudo iniciar el personaje: ${err.message}`; if (this.child === child) this.child = null; });
        child.on('exit', code => { if (this.child === child) this.child = null; if (code) { this.error = 'El personaje no pudo iniciarse. Revisá logs/desktop-companion.log.'; try { fs.mkdirSync(path.join(__dirname, '../../logs'), { recursive: true }); fs.appendFileSync(path.join(__dirname, '../../logs/desktop-companion.log'), diagnostic + '\n'); } catch (_) {} } });
    }
    install(app, io, port) {
        this.port = port;
        this.speak = text => require('./ttsService').speak(text);
        const speech = require('./bargeInService');
        speech.on('speech_started', () => { this.speaking = true; });
        speech.on('speech_ended', () => { this.speaking = false; });
        const emit = io.emit;
        const service = this;
        io.emit = function(event, ...args) { service.observe(event, args[0]); return emit.call(this, event, ...args); };
        io.on('connection', socket => {
            socket.onAnyOutgoing((event, data) => this.observe(event, data));
            const report = () => socket.emit('companion_status', this.snapshot());
            socket.on('companion_presence', data => { this.presence(socket.id, data); report(); });
            socket.on('companion_config', data => {
                if (!data || typeof data.enabled !== 'boolean') return;
                if(data.animations!==undefined && typeof data.animations!=='boolean')return;
                try { this.configure(data.enabled, data.animations??this.animations); } catch (_) { this.error = 'No se pudo guardar la preferencia del personaje.'; }
                io.emit('companion_status', this.snapshot());
            });
            socket.on('companion_preview', () => { this.registered = true; this.previewUntil = this.now() + 12000; this.ensureStarted(); report(); });
            socket.on('disconnect', () => this.detach(socket.id));
        });
        app.get('/api/companion/state', (req, res) => {
            if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.get('X-Jarvis-Companion') !== this.token) return res.sendStatus(403);
            res.set('Cache-Control', 'no-store').json(this.snapshot());
        });
        // Deliberately leave no scheduled tasks, login entries or startup registration.
        process.once('exit', () => this.child?.kill());
    }
}
module.exports = { DesktopCompanionService };
