const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const modeService = require('./services/modeService');
const systemService = require('./services/systemService');
const aiService = require('./services/aiService');
const observerService = require('./services/observerService');
const appDiscoveryService = require('./services/appDiscoveryService');
const reminderService = require('./services/reminderService');
const powerService = require('./services/powerService');
const tvService = require('./services/tvService');
const tvVoiceService = require('./services/tvVoiceService');
const voiceInputService = require('./services/voiceInputService');
const voiceUnderstandingService = require('./services/voiceUnderstandingService');
const voiceSettingsService = require('./services/voiceSettingsService');
const memoryService = require('./services/memoryService');
const jarvisActionService = require('./services/jarvisActionService');
const ttsService = require('./services/ttsService');
const wakeWordService = require('./services/wakeWordService');
const bargeInService = require('./services/bargeInService');
const responseFormatterService = require('./services/responseFormatterService');
const voiceLearningService = require('./services/voiceLearningService');
const shopRoutes = require('./routes/shopRoutes');

// --- JARVIS OS V6 ENTERPRISE SERVICES ---
const eventBus = require('./services/core/eventBusService');
const databaseService = require('./services/persistence/databaseService');
const emergencyService = require('./services/core/emergencyService');
const healthService = require('./services/core/healthService');
const undoManager = require('./services/core/undoManager');
const explanationService = require('./services/core/explanationService');
const trashService = require('./services/core/trashService');
const goalManagerService = require('./services/goals/goalManagerService');
const agendaService = require('./services/agenda/agendaService');
const schedulerService = require('./services/agenda/schedulerService');
const notificationService = require('./services/core/notificationService');
const windowsControlService = require('./services/windowsControlService');
eventBus.setDatabaseService(databaseService);

const app = express();
let localVoiceStatus = { online: false, engine: 'Vosk + WebRTC VAD + faster-whisper', fullyLocal: true };
let lastLocalSpeech = { text: '', at: 0 };

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use('/api/shop', shopRoutes);
app.use(express.static(path.join(__dirname, '../frontend'), {
    maxAge: 0,
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    perMessageDeflate: true
});
notificationService.setSocketIO(io);
notificationService.setTtsService(ttsService);
bargeInService.init({ ttsService, wakeWordService, io });

// --- SERVICIOS PROACTIVOS Y AUTOMATIZACIÓN (Ítems 26 y 27) ---
const proactivePolicyService = require('./services/core/proactivePolicyService');
const proactiveMonitorService = require('./services/core/proactiveMonitorService');
const conditionalAutomationService = require('./services/automation/conditionalAutomationService');
const routineService = require('./services/automation/routineService');

proactivePolicyService.init({ ttsService, io, modeService });
proactiveMonitorService.start();
conditionalAutomationService.init({ ttsService, routineService });

// --- RECUPERACIÓN DE TAREAS PERSISTENTES (Ítem 28) ---
const taskManagerService = require('./services/core/taskManagerService');
taskManagerService.recoverOrphanTasks().catch(err => {
    console.error('[Server] Error en recuperación de tareas huérfanas:', err.message);
});

// --- HOME ASSISTANT & DOMÓTICA (Ítem 29) ---
const homeAssistantService = require('./services/homeassistant/homeAssistantService');
homeAssistantService.init().catch(err => {
    console.error('[Server] Error al inicializar Home Assistant:', err.message);
});

// --- DASHBOARD & TELEMETRÍA (Ítem 31) ---
const dashboardService = require('./services/diagnostics/dashboardService');
dashboardService.startLiveStreaming(io, 2000);

// Reenviar eventos de Jarvis OS al HUD
eventBus.subscribe('*', (ev) => {
    io.emit('jarvis_event', ev);
});

// --- ENDPOINTS JARVIS OS V6 ---
app.get('/api/dashboard/status', async (req, res) => {
    try {
        const data = await dashboardService.getDashboardData();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS MÉTRICAS POR OPERACIÓN (Ítem 32) ---
const operationMetricsService = require('./services/diagnostics/operationMetricsService');
app.get('/api/metrics/summary', (req, res) => {
    try {
        const summary = operationMetricsService.getSummary(req.query.hours || 24);
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/metrics/traces', (req, res) => {
    try {
        const traces = operationMetricsService.getRecentTraces(req.query.limit || 50, req.query);
        res.json(traces);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/metrics/diagnosis', (req, res) => {
    try {
        const diagnosis = operationMetricsService.diagnoseBottlenecks();
        res.json(diagnosis);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS LOGS ESTRUCTURADOS Y FORENSE (Ítem 33) ---
const structuredLoggerService = require('./services/diagnostics/structuredLoggerService');
app.get('/api/logs/query', (req, res) => {
    try {
        const logs = structuredLoggerService.query(req.query);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/logs/forensics', (req, res) => {
    try {
        const forensics = structuredLoggerService.diagnose(req.query.hours || 24);
        res.json(forensics);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS AUTORREPARACIÓN DE SERVICIOS (Ítem 34) ---
const autoHealService = require('./services/resilience/autoHealService');
app.get('/api/services/status', (req, res) => {
    try {
        res.json(autoHealService.getServicesStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/services/:id/restart', async (req, res) => {
    try {
        const result = await autoHealService.forceRestart(req.params.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/services/heal-now', async (req, res) => {
    try {
        const results = await autoHealService.checkAllServices();
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS CIRCUIT BREAKERS (Ítem 35) ---
const { circuitBreakerManager } = require('./services/resilience/circuitBreakerService');
app.get('/api/circuit-breakers/status', (req, res) => {
    try {
        res.json(circuitBreakerManager.getStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/circuit-breakers/:id/reset', (req, res) => {
    try {
        const ok = circuitBreakerManager.resetBreaker(req.params.id);
        res.json({ ok, breakerId: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS FALLBACKS INTELIGENTES (Ítem 36) ---
const { fallbackEngine } = require('./services/resilience/fallbackEngine');
app.get('/api/fallbacks/chains', (req, res) => {
    try {
        res.json(fallbackEngine.getChainsStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/fallbacks/execute/:id', async (req, res) => {
    try {
        const result = await fallbackEngine.executeChain(req.params.id, req.body.params || req.body, req.body.context || {});
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINT CONTROL DE CONFIANZA (Ítem 37) ---
const { confidenceEngine } = require('./services/intelligence/confidenceEngine');
app.post('/api/confidence/evaluate', (req, res) => {
    try {
        const { candidateIntent, text, context } = req.body;
        const evaluation = confidenceEngine.evaluate(candidateIntent || {}, text || '', context || {});
        res.json(evaluation);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS GOBERNANZA DE RIESGO Y PIN (Ítem 38) ---
const { riskAssessmentService } = require('./services/security/riskAssessmentService');
app.post('/api/risk/evaluate', (req, res) => {
    try {
        const { actionId, params } = req.body;
        const riskLevel = riskAssessmentService.classify(actionId, params);
        const reqs = riskAssessmentService.getRequirements(riskLevel);
        res.json({ actionId, riskLevel, requirements: reqs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/security/pin/verify', (req, res) => {
    try {
        const result = riskAssessmentService.verifyPin(req.body.pin);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS SECRET MANAGER (Ítem 39) ---
const { secretVaultService } = require('./services/security/secretVaultService');
app.get('/api/secrets', (req, res) => {
    try {
        res.json(secretVaultService.listSecrets());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/secrets/store', (req, res) => {
    try {
        const { key, value, metadata } = req.body;
        const result = secretVaultService.storeSecret(key, value, metadata);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/secrets/token', (req, res) => {
    try {
        const { key, ttlSeconds, singleUse } = req.body;
        const tokenData = secretVaultService.getSecretToken(key, ttlSeconds, singleUse);
        res.json(tokenData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/secrets/:key', (req, res) => {
    try {
        const ok = secretVaultService.deleteSecret(req.params.key);
        res.json({ ok, key: req.params.key });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS CODING AGENT REAL (Ítem 41) ---
const { codingAgentService } = require('./services/developer/codingAgentService');
app.post('/api/coding-agent/analyze', (req, res) => {
    try {
        const { projectPath, instruction } = req.body;
        const targetPath = projectPath || process.cwd();
        const stack = codingAgentService.detectProjectStack(targetPath);
        const structure = codingAgentService.mapProjectStructure(stack.rootDir);
        const relevant = codingAgentService.locateRelevantFiles(targetPath, instruction || '', structure);
        res.json({ stack, totalFiles: structure.length, relevantFiles: relevant.slice(0, 15) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/coding-agent/execute', async (req, res) => {
    try {
        const { projectPath, instruction, maxIterations } = req.body;
        const result = await codingAgentService.executeAutonomousFix({
            projectPath: projectPath || process.cwd(),
            instruction,
            maxIterations: maxIterations || 3
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS INTEGRACIÓN GIT (Ítem 42) ---
const { gitIntegrationService } = require('./services/developer/gitIntegrationService');
app.get('/api/git/status', (req, res) => {
    try {
        const result = gitIntegrationService.getStatus(req.query.path);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/git/diff', (req, res) => {
    try {
        const result = gitIntegrationService.getDiff(req.query.path, {
            file: req.query.file,
            staged: req.query.staged === 'true'
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/git/branch', (req, res) => {
    try {
        const { projectPath, taskName } = req.body;
        const result = gitIntegrationService.ensureSafeBranch(projectPath, taskName);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/git/commit', (req, res) => {
    try {
        const { projectPath, message, files, allowProtected } = req.body;
        const result = gitIntegrationService.commit(projectPath, message, { files, allowProtected });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/git/rollback', (req, res) => {
    try {
        const { projectPath, mode, target } = req.body;
        const result = gitIntegrationService.rollback(projectPath, mode, target);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/git/summary', (req, res) => {
    try {
        const result = gitIntegrationService.summarizeWork(req.query.path, req.query.baseBranch);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS SNAPSHOTS DE PROYECTO (Ítem 43) ---
const { snapshotService } = require('./services/developer/snapshotService');
app.post('/api/snapshots/create', async (req, res) => {
    try {
        const { projectPath, label } = req.body;
        const result = await snapshotService.createSnapshot(projectPath, label);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/snapshots/restore', async (req, res) => {
    try {
        const { snapshotId } = req.body;
        const result = await snapshotService.restoreSnapshot(snapshotId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/snapshots/list', (req, res) => {
    try {
        const result = snapshotService.listSnapshots(req.query.path);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/snapshots/prune', (req, res) => {
    try {
        const { maxAgeHours, maxPerProject } = req.body;
        const result = snapshotService.pruneOldSnapshots(maxAgeHours, maxPerProject);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PLANTILLAS DE DOCUMENTOS Y ESTILOS (Ítem 44) ---
const { documentTemplateService } = require('./services/developer/documentTemplateService');
app.post('/api/documents/generate', async (req, res) => {
    try {
        const result = await documentTemplateService.renderDocument(req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/documents/templates', (req, res) => {
    try {
        res.json(documentTemplateService.listTemplates());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/documents/styles', (req, res) => {
    try {
        res.json(documentTemplateService.listStyles());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/documents/styles', (req, res) => {
    try {
        const { name, styleConfig } = req.body;
        const result = documentTemplateService.saveStyle(name, styleConfig);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PERFILES DE COMPORTAMIENTO (Ítem 45) ---
const { behaviorProfileService } = require('./services/intelligence/behaviorProfileService');
app.get('/api/profiles/current', (req, res) => {
    try {
        res.json(behaviorProfileService.getActiveProfile());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/profiles/switch', (req, res) => {
    try {
        const { profileId, reason } = req.body;
        const result = behaviorProfileService.switchProfile(profileId, reason);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/profiles/list', (req, res) => {
    try {
        res.json(behaviorProfileService.listProfiles());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/profiles/custom', (req, res) => {
    try {
        const { id, config } = req.body;
        const result = behaviorProfileService.saveCustomProfile(id, config);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS CONTEXTO DE ACTIVIDAD (Ítem 46) ---
const { activityContextService } = require('./services/intelligence/activityContextService');
app.get('/api/context/current', async (req, res) => {
    try {
        const ctx = await activityContextService.getCurrentContext();
        res.json(ctx);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/context/resolve', async (req, res) => {
    try {
        const { utterance } = req.body;
        const result = await activityContextService.resolveImplicitCommand(utterance);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS SMART CLIPBOARD (Ítem 47) ---
const { smartClipboardService } = require('./services/intelligence/smartClipboardService');
app.post('/api/clipboard/process', async (req, res) => {
    try {
        const result = await smartClipboardService.processClipboardIntent(req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/clipboard/read', (req, res) => {
    try {
        const text = smartClipboardService.readClipboard();
        const type = smartClipboardService.classifyContent(text);
        res.json({ text, type });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/clipboard/write', (req, res) => {
    try {
        const ok = smartClipboardService.writeClipboard(req.body.text);
        res.json({ ok });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS ACTION TIMELINE (Ítem 48) ---
const { actionTimelineService } = require('./services/core/actionTimelineService');
app.get('/api/timeline/recent', (req, res) => {
    try {
        const minutes = req.query.minutes ? Number(req.query.minutes) : 20;
        const result = actionTimelineService.getTimeline(minutes);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/timeline/query', (req, res) => {
    try {
        const { utterance } = req.body;
        const result = actionTimelineService.queryTimeline(utterance);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/timeline/undo', async (req, res) => {
    try {
        const result = await actionTimelineService.undoLastAction();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});









app.post('/api/emergency-stop', (req, res) => {
    const result = emergencyService.triggerEmergencyStop(req.body.source || 'REST_API');
    res.json(result);
});

app.get('/api/health', async (req, res) => {
    const health = await healthService.getSystemHealth();
    res.json(health);
});

app.post('/api/undo', async (req, res) => {
    const result = await undoManager.undoLast(req.body.scope || 'GLOBAL', req.body.filter);
    res.json(result);
});

app.post('/api/explain', async (req, res) => {
    try {
        const query = req.body.query || '';
        const explanation = await explanationService.explainDecision(query);
        const lastDecision = explanationService.getLastDecision();
        res.json({ ok: true, explanation, decision: lastDecision });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/explain/last', (req, res) => {
    const decision = explanationService.getLastDecision(req.query.tool);
    if (!decision) return res.status(404).json({ ok: false, message: 'No hay decisiones registradas' });
    res.json({ ok: true, decision, explanation: decision.userExplanation });
});

app.get('/api/explain/recent', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 20;
    const decisions = explanationService.listDecisions(limit);
    res.json({ ok: true, count: decisions.length, decisions });
});

app.get('/api/goals', (req, res) => res.json(goalManagerService.listGoals(req.query.status)));
app.post('/api/goals', (req, res) => res.json(goalManagerService.createGoal(req.body)));
app.post('/api/goals/plan', (req, res) => {
    try {
        const goal = goalManagerService.planGoalFromInstruction(req.body.instruction, req.body);
        res.json({ ok: true, goal });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
app.post('/api/goals/:id/step', async (req, res) => {
    try {
        const result = await goalManagerService.stepGoal(req.params.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
app.post('/api/goals/:id/execute', async (req, res) => {
    try {
        const maxSteps = req.body.maxSteps ? Number(req.body.maxSteps) : 20;
        const result = await goalManagerService.executeGoalStepByStep(req.params.id, { maxSteps });
        res.json(result);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
app.get('/api/goals/:id/progress', (req, res) => {
    const progress = goalManagerService.getGoalProgress(req.params.id);
    if (!progress) return res.status(404).json({ ok: false, error: 'Objetivo no encontrado' });
    res.json({ ok: true, progress });
});
app.post('/api/goals/:id/pause', (req, res) => res.json(goalManagerService.pauseGoal(req.params.id)));
app.post('/api/goals/:id/resume', (req, res) => res.json(goalManagerService.resumeGoal(req.params.id)));

app.get('/api/agenda', (req, res) => res.json(agendaService.listReminders(req.query.status)));
app.post('/api/agenda', (req, res) => res.json(agendaService.addReminder(req.body)));
app.delete('/api/agenda/:id', (req, res) => res.json(agendaService.deleteReminder(req.params.id)));

app.get('/api/trash', (req, res) => res.json(trashService.listTrash()));
app.post('/api/trash/restore', (req, res) => res.json(trashService.restoreFromTrash(req.body.identifier, req.body.conflictResolution)));

// --- HOME ASSISTANT ENDPOINTS (Ítem 29) ---
app.get('/api/homeassistant/status', (req, res) => {
    res.json(homeAssistantService.getPublicStatus());
});
app.get('/api/homeassistant/devices', (req, res) => {
    res.json(homeAssistantService.listDevices(req.query.domain));
});
app.post('/api/homeassistant/command', async (req, res) => {
    try {
        const result = await homeAssistantService.executeCommand(req.body.text || '');
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/homeassistant/service', async (req, res) => {
    try {
        const { domain, service, data } = req.body;
        const result = await homeAssistantService.callService(domain, service, data);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'data', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, ''));
    }
});
const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No se subió ningún archivo." });
    }
    const absolutePath = req.file.path;
    console.log(`[Servidor] 💾 Archivo recibido y guardado en: ${absolutePath}`);
    res.json({ filepath: absolutePath });
});

// --- SPOTIFY WEB API ROUTES ---
const spotifyService = require('./services/spotifyService');

app.get('/api/spotify/login', (req, res) => {
    const authUrl = spotifyService.getAuthURL();
    res.redirect(authUrl);
});

app.get('/api/spotify/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) {
        return res.send(`<h1>Error de Spotify</h1><p>${error}</p>`);
    }
    try {
        await spotifyService.exchangeCodeForTokens(code);
        res.send(`
            <html>
            <body style="background:#121212;color:#1DB954;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column;">
                <h1 style="font-size:3rem;">✅ Spotify Conectado</h1>
                <p style="color:#fff;font-size:1.2rem;">Jarvis ahora puede controlar tu música. Puedes cerrar esta ventana.</p>
            </body>
            </html>
        `);
    } catch (e) {
        res.status(500).send(`<h1>Error</h1><p>${e.message}</p>`);
    }
});

// Verificar si Spotify está conectado
app.get('/api/spotify/status', (req, res) => {
    res.json({ connected: spotifyService.isAuthenticated() });
});
// ----------------------------------------------

// API Rest para Modos (usado por el cliente cuando quiere crear nuevos modos usando la interfaz)
app.get('/api/modes', (req, res) => {
    res.json(modeService.getAllModes());
});

app.get('/api/capabilities', async (req, res) => {
    res.json(await jarvisActionService.describe({}));
});

app.get('/api/actions', async (req, res) => res.json(await jarvisActionService.describe({})));
app.post('/api/actions/execute', async (req, res) => {
    const result = await jarvisActionService.execute(req.body.id, req.body.params || {}, actionContext());
    res.status(result.ok || result.status === 'awaiting_confirmation' ? 200 : 400).json(result);
});
app.post('/api/actions/confirm', async (req, res) => res.json(await jarvisActionService.confirm(req.body.token, actionContext())));
app.post('/api/actions/cancel', (req, res) => res.json({ ok: jarvisActionService.cancelConfirmation(req.body.token) }));

app.get('/api/memory', (req, res) => res.json(memoryService.snapshot()));
app.post('/api/memory/preferences', (req, res) => {
    try { res.json(memoryService.addPreference(req.body.key, req.body.value, 'panel')); }
    catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/memory/corrections', (req, res) => {
    try { memoryService.addCorrection(req.body.from, req.body.to); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error.message }); }
});
app.patch('/api/memory/:collection/:id', (req, res) => {
    try { res.json(memoryService.updateItem(req.params.collection, req.params.id, req.body)); }
    catch (error) { res.status(400).json({ error: error.message }); }
});
app.delete('/api/memory/:collection/:id', (req, res) => {
    try { res.json({ ok: memoryService.removeItem(req.params.collection, req.params.id) }); }
    catch (error) { res.status(400).json({ error: error.message }); }
});

app.get('/api/voice/settings', (req, res) => res.json(voiceSettingsService.get()));
app.get('/api/voice/learning', (req, res) => res.json(voiceLearningService.snapshot()));
app.post('/api/voice/settings', (req, res) => {
    try { res.json(voiceSettingsService.save(req.body)); }
    catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/voice/local/status', (req, res) => res.json(localVoiceStatus));
app.post('/api/voice/local/status', (req, res) => {
    localVoiceStatus = { ...localVoiceStatus, ...req.body, lastSeenAt: new Date().toISOString() };
    io.emit('local_voice_status', localVoiceStatus);
    res.json({ ok: true });
});
function setVoiceState(state) {
    const newState = state === 'awake' ? 'awake' : 'dormant';
    if (newState === 'dormant') ttsService.stop();
    const statePath = path.join(__dirname, 'data', 'local_voice_state.json');
    try {
        fs.writeFileSync(statePath, JSON.stringify({ state: newState, updatedAt: Date.now() }, null, 2));
    } catch (e) {
        console.warn('[VoiceState] Error escribiendo statePath:', e.message);
    }
    localVoiceStatus = { ...localVoiceStatus, state: newState, lastSeenAt: new Date().toISOString() };
    io.emit('local_voice_status', localVoiceStatus);
    io.emit('voice_state_changed', { state: newState });
    return newState;
}

app.post('/api/voice/local/state', (req, res) => {
    const state = setVoiceState(req.body.state);
    res.json({ ok: true, state });
});

app.get('/api/tv/status', (req, res) => {
    res.json(tvService.getPublicStatus());
});

app.post('/api/tv/settings', (req, res) => {
    try {
        res.json(tvService.saveSettings(req.body));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/tv/discover', async (req, res) => {
    try {
        res.json(await tvService.discover());
    } catch (error) {
        res.status(503).json({ error: error.message });
    }
});

app.post('/api/tv/learn', async (req, res) => {
    try {
        res.json(await tvService.learnButton(String(req.body.button || '').toLowerCase()));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/tv/test', async (req, res) => {
    try {
        const button = String(req.body.button || '').toLowerCase();
        await tvService.sendButtons([button], 300);
        res.json({ ok: true, button });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/tv/netflix', async (req, res) => {
    try {
        const result = await tvService.playNetflix(req.body, progress => io.emit('tv_progress', progress));
        res.json({ ok: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/tv/cancel', (req, res) => {
    res.json({ ok: tvService.cancel() });
});

app.post('/api/tts/speak', async (req, res) => {
    try {
        await ttsService.speak(req.body.text, req.body.voice);
        res.json({ ok: true });
    } catch (error) {
        res.status(503).json({ error: error.message });
    }
});

app.post('/api/tts/stop', (req, res) => {
    res.json({ ok: true, stopped: ttsService.stop() });
});

app.post('/api/tts/barge-in', (req, res) => {
    const { reason, metadata } = req.body || {};
    const result = bargeInService.interrupt(reason, metadata);
    res.json({ ok: true, ...result });
});

app.get('/api/tts/barge-in/status', (req, res) => {
    res.json(bargeInService.getStatus());
});

app.get('/api/tts/barge-in/metrics', (req, res) => {
    res.json(bargeInService.getMetrics());
});

// --- TASK MANAGER ENDPOINTS (Ítem 25) ---
const taskManager = require('./services/core/taskManagerService');

app.get('/api/tasks', (req, res) => {
    res.json({ ok: true, tasks: taskManager.listTasks(req.query) });
});

app.get('/api/tasks/active', (req, res) => {
    res.json({ ok: true, activeTasks: taskManager.getActiveTasks() });
});

app.post('/api/tasks/:id/cancel', (req, res) => {
    const result = taskManager.cancel(req.params.id, req.body.reason);
    res.json(result);
});

app.post('/api/tasks/:id/pause', (req, res) => {
    const result = taskManager.pause(req.params.id);
    res.json(result);
});

app.post('/api/tasks/:id/resume', (req, res) => {
    const result = taskManager.resume(req.params.id);
    res.json(result);
});

app.post('/api/tasks/cancel-all', (req, res) => {
    const result = taskManager.cancelAll(req.body.reason);
    res.json(result);
});

// --- EVENT BUS & PROACTIVE MONITOR ENDPOINTS (Ítem 26) ---
app.get('/api/events/history', (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json({ ok: true, events: eventBus.getHistory(limit, req.query.filter) });
});

app.post('/api/events/check-now', async (req, res) => {
    const result = await proactiveMonitorService.checkNow();
    res.json({ ok: true, result });
});

app.post('/api/modes', (req, res) => {
    const { name, description } = req.body;
    if (!name || !description) {
        return res.status(400).json({ error: "El nombre y descripción son requeridos." });
    }
    const newMode = modeService.addMode({ name, description });
    // Al notificar a todos los clientes actualizamos su lista
    io.emit('modes_updated', modeService.getAllModes());
    res.json(newMode);
});

// Endpoint para que servicios externos (Ej: Python Background Tasks) activen la voz nativa
app.post('/api/speak', (req, res) => {
    const { text } = req.body;
    if (text && io) {
        const formatted = responseFormatterService.format(text);
        io.emit('response', { text: formatted.screen, voiceText: formatted.voice, action: "REMOTE_SPEAK", actionPayload: null });
        console.log(`[Jarvis Comunicación Externa]: ${formatted.voice}`);
        res.json({ status: "success", voice: formatted.voice, screen: formatted.screen });
    } else {
        res.status(400).json({ error: "Text missing" });
    }
});

// Endpoint principal para el cliente de Audio Python (Fondo)
app.post('/api/process_speech_local', async (req, res) => {
    const selectedVoice = voiceInputService.chooseTranscript(req.body);
    const duplicateKey = voiceInputService.normalizeVoiceTranscript(selectedVoice.text).toLowerCase();
    if (duplicateKey && duplicateKey === lastLocalSpeech.text && Date.now() - lastLocalSpeech.at < 1500) {
        return res.json({ response: '', result: { ok: true, status: 'ignored_duplicate', verified: true } });
    }
    lastLocalSpeech = { text: duplicateKey, at: Date.now() };
    if (selectedVoice.text) {
        io.emit('action_status', { phase: 'heard', message: `Escuché: “${selectedVoice.text}”. Verificando…`, text: selectedVoice.text });
    }
    const understoodVoice = await voiceUnderstandingService.understand({
        text: selectedVoice.text,
        alternatives: selectedVoice.alternatives,
        tvContext: tvVoiceService.getSessionContext(),
        allowLocal: voiceSettingsService.get().localContextEnabled,
        confidence: selectedVoice.confidence,
        provider: 'local-whisper'
    });
    const text = voiceInputService.normalizeVoiceTranscript(understoodVoice.text);
    if (!text) return res.status(400).json({ error: "Text missing" });
    if (selectedVoice.uncertain && !req.body.confirmed) {
        return res.status(409).json({ status: 'voice_confirmation_required', ...selectedVoice, text, provider: understoodVoice.provider });
    }
    voiceInputService.recordTranscript({
        source: 'local-audio',
        understood: text,
        confidence: selectedVoice.confidence,
        alternatives: selectedVoice.alternatives,
        original: selectedVoice.text,
        provider: understoodVoice.provider,
        refined: understoodVoice.refined
    });
    
    console.log(`[Jarvis Audio Python]: ${text}`);
    const ACK_PHRASES = [
        'Enseguida, señor.',
        'Entendido, ya me encargo.',
        'De acuerdo, procesando la tarea.',
        'Claro, enseguida lo hago.',
        'Entendido, en proceso.'
    ];
    const ackText = ACK_PHRASES[Math.floor(Math.random() * ACK_PHRASES.length)];
    io.emit('action_status', { phase: 'accepted', message: ackText, text, speakAck: false });

    const result = await jarvisActionService.process(text, actionContext(progress => io.emit('tv_progress', progress)));
    if (result.actionId === 'voice.sleep') {
        setVoiceState('dormant');
    } else if (result.actionId === 'voice.wake') {
        setVoiceState('awake');
    }
    const formatted = responseFormatterService.format(result.message, { actionId: result.actionId, data: result.data });
    
    // Sincronizar la respuesta con cualquier UI web abierta
    io.emit('response', {
        text: formatted.screen,
        voiceText: formatted.voice,
        action: result.actionId,
        actionPayload: result.data || null,
        suppressTts: true,
        verified: result.verified,
        status: result.status
    });
    
    // Responder a Python para que lo hable por TTS usando el canal de voz optimizado
    res.json({ response: formatted.voice, screenText: formatted.screen, result });
});

function actionContext(onTvProgress) {
    return { executeTvIntent, onTvProgress, inpaintingMask: null };
}

async function resolveTvIntent(text) {
    const directIntent = tvVoiceService.parseTvIntent(text);
    if (directIntent) return directIntent;
    if (!tvVoiceService.isSessionActive() || tvVoiceService.switchesAwayFromTv(text)) return null;
    // En contexto TV, una frase no reconocida nunca debe convertirse por IA en
    // movimientos físicos. Pedimos reformular y preservamos el estado actual.
    return { action: 'clarify' };
}

async function executeTvIntent(intent, onProgress) {
    if (intent.action === 'cancel') {
        tvVoiceService.deactivateSession();
        return tvService.cancel() ? 'Cancelé la automatización de la televisión.' : 'Cerré el modo de control de TV.';
    }
    if (intent.action === 'navigate') {
        tvVoiceService.activateSession();
        await tvService.navigate(intent.button, intent.count);
        tvVoiceService.rememberIntent(intent);
        return intent.count > 1
            ? `Moví ${intent.label} ${intent.count} veces.`
            : `Listo, ${intent.label}.`;
    }
    if (intent.action === 'select') {
        tvVoiceService.activateSession();
        const offset = Math.max(0, intent.index - 1);
        await tvService.sendButtons([...Array(offset).fill('right'), 'ok'], 350);
        tvVoiceService.rememberIntent(intent);
        return `Seleccioné la opción ${intent.index}.`;
    }
    if (intent.action === 'clarify') {
        return 'Sigo en Netflix, pero no entendí qué querés hacer. Podés decirme el título, una dirección o cuál opción elegís.';
    }
    if (intent.action === 'choose_device') {
        if (!await tvService.isAvailable()) {
            tvVoiceService.clearDestinationPrompt();
            await systemService.openApp('netflix', modeService.getActiveMode().id);
            return 'El control de la TV no está disponible, así que abrí Netflix en la computadora.';
        }
        return '¿Querés abrir Netflix en la tele o en la computadora?';
    }
    if (intent.action === 'open_pc') {
        tvVoiceService.clearDestinationPrompt();
        tvVoiceService.deactivateSession();
        await systemService.openApp('netflix', modeService.getActiveMode().id);
        return 'Abriendo Netflix en la computadora.';
    }
    if (intent.action === 'continue_watching') {
        const result = await tvService.playNetflix({
            powerOn: intent.powerOn,
            continueWatching: true
        }, onProgress);
        tvVoiceService.rememberIntent(intent);
        return result.message;
    }
    if (intent.action === 'enter_netflix' || intent.action === 'select_profile') {
        tvVoiceService.activateSession();
        const result = await tvService.enterNetflixProfile(onProgress);
        tvVoiceService.rememberIntent(intent);
        return result.message;
    }
    if (intent.action === 'open_search') {
        tvVoiceService.activateSession();
        const result = await tvService.openNetflixSearch(onProgress);
        tvVoiceService.rememberIntent(intent);
        return result.message;
    }
    if (intent.action === 'search') {
        const result = await tvService.searchNetflix(intent.title, { playFirst: intent.playFirst }, onProgress);
        tvVoiceService.rememberIntent(intent);
        return result.message;
    }
    const result = await tvService.playNetflix(intent, onProgress);
    tvVoiceService.rememberIntent(intent);
    return result.message;
}

// Real-time voice processing y Eventos del Socket
io.on('connection', (socket) => {
    console.log('[+] Interfaz conectada a Jarvis (Socket ID: ' + socket.id + ')');

    // Inicializar data en frontend
    socket.emit('init_data', {
        modes: modeService.getAllModes(),
        activeModeId: modeService.getActiveMode().id
    });

    // Evento de procesamiento de voz (cuando Jarvis escucha al usuario)
    socket.on('process_speech', async (data) => {
        const selectedVoice = voiceInputService.chooseTranscript(data);
        socket.emit('voice_status', {
            engine: 'Navegador · reconocimiento general',
            confidence: selectedVoice.confidence,
            agreement: selectedVoice.agreement,
            audioLevel: selectedVoice.audioLevel,
            uncertain: selectedVoice.uncertain
        });
        if (data.source === 'voice' && selectedVoice.uncertain && !data.confirmed) {
            socket.emit('voice_confirmation_required', {
                text: selectedVoice.text,
                alternatives: selectedVoice.alternatives,
                reason: selectedVoice.uncertaintyReason,
                confidence: selectedVoice.confidence,
                agreement: selectedVoice.agreement
            });
            return;
        }
        const understoodVoice = data.source === 'voice'
            ? await voiceUnderstandingService.understand({
                text: selectedVoice.text,
                alternatives: selectedVoice.alternatives,
                tvContext: tvVoiceService.getSessionContext(),
                allowLocal: voiceSettingsService.get().localContextEnabled,
                confidence: selectedVoice.confidence,
                provider: 'browser'
            })
            : { text: selectedVoice.text, provider: 'direct', refined: false };
        socket.emit('voice_status', {
            engine: understoodVoice.provider === 'ollama-local' ? 'Ollama · comprensión local' : 'Navegador · reconocimiento general',
            confidence: selectedVoice.confidence,
            agreement: selectedVoice.agreement,
            audioLevel: selectedVoice.audioLevel,
            uncertain: false,
            refined: understoodVoice.refined === true
        });
        let text = voiceInputService.normalizeVoiceTranscript(understoodVoice.text);
        if (!text) return;
        voiceInputService.recordTranscript({
            source: data.source || 'web',
            understood: text,
            confidence: selectedVoice.confidence,
            alternatives: selectedVoice.alternatives,
            original: selectedVoice.text,
            provider: understoodVoice.provider,
            refined: understoodVoice.refined
        });
        console.log(`[Usuario dice]: ${text}`);
        const ACK_PHRASES = [
            'Enseguida, señor.',
            'Entendido, ya me encargo.',
            'De acuerdo, procesando la tarea.',
            'Claro, enseguida lo hago.',
            'Entendido, en proceso.'
        ];
        const ackText = ACK_PHRASES[Math.floor(Math.random() * ACK_PHRASES.length)];
        socket.emit('action_status', { phase: 'accepted', message: ackText, text, speakAck: true });

        // Toda solicitud entra por el mismo registro. El bloque antiguo que queda
        // debajo se conserva temporalmente para compatibilidad, pero ya no recibe
        // comandos nuevos.
        try {
            const result = await jarvisActionService.process(text, {
                ...actionContext(progress => socket.emit('tv_progress', progress)),
                inpaintingMask: data.inpaintingMask
            });
            if (result.actionId === 'voice.sleep') {
                setVoiceState('dormant');
            } else if (result.actionId === 'voice.wake') {
                setVoiceState('awake');
            }
            const formatted = responseFormatterService.format(result.message, { actionId: result.actionId, data: result.data });
            socket.emit('action_result', result);
            socket.emit('response', {
                text: formatted.screen,
                voiceText: formatted.voice,
                action: result.actionId,
                actionPayload: result.data || null,
                verified: result.verified,
                status: result.status,
                confirmationToken: result.confirmationToken
            });
            return;
        } catch (error) {
            console.error('[Núcleo de acciones]', error);
            socket.emit('response', { text: `No pude completar la acción: ${error.message}`, action: null });
            return;
        }

        const lowerText = text.toLowerCase();

        let responseText = "";
        let action = null;
        let actionPayload = null;

        try {
            const tvIntent = await resolveTvIntent(text);
            if (tvIntent) {
                if (tvIntent.action === 'netflix') {
                    const targetText = tvIntent.useDefaultSeries
                        ? 'tu serie configurada'
                        : (tvIntent.title || 'Netflix');
                    socket.emit('response', {
                        text: tvIntent.powerOn
                            ? `Encendiendo la televisión. En aproximadamente un minuto pondré ${targetText}.`
                            : `Controlando la televisión para poner ${targetText}.`,
                        action: null,
                        actionPayload: null
                    });
                }

                responseText = await executeTvIntent(tvIntent, progress => socket.emit('tv_progress', progress));
                socket.emit('response', { text: responseText, action: null, actionPayload: null });
                return;
            }

            // --- CATCH DESCARGAS STREMIO (links locales 127.0.0.1:11470) ---
            const stremioMatch = text.match(/(http:\/\/127\.0\.0\.1:11470\/[^\s]+)/i);
            if (stremioMatch) {
                const stremioUrl = stremioMatch[1];
                console.log(`[Jarvis Streaming] Descargando desde Stremio: ${stremioUrl}`);
                
                socket.emit('response', { 
                    text: `Iniciando descarga desde Stremio. Esto puede tardar dependiendo del tamaño. Te aviso cuando termine.`, 
                    action: null 
                });

                const http = require('http');
                const fs = require('fs');
                const path = require('path');
                const downloadDir = path.join(require('os').homedir(), 'Downloads', 'Jarvis_Pelis');
                if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

                const filename = `stremio_${Date.now()}.mp4`;
                const filepath = path.join(downloadDir, filename);
                const file = fs.createWriteStream(filepath);

                http.get(stremioUrl, (res) => {
                    const totalBytes = parseInt(res.headers['content-length'] || '0');
                    let downloadedBytes = 0;
                    let lastReportMB = 0;

                    console.log(`[Jarvis Streaming] Conexion OK. Content-Length: ${totalBytes || 'desconocido'}. Descargando...`);

                    res.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        const mbDown = Math.floor(downloadedBytes / 1048576);
                        
                        // Reportar cada 50MB descargados
                        if (mbDown >= lastReportMB + 50) {
                            lastReportMB = mbDown;
                            if (totalBytes > 0) {
                                const mbTotal = (totalBytes / 1048576).toFixed(0);
                                const percent = Math.floor((downloadedBytes / totalBytes) * 100);
                                console.log(`[Jarvis Streaming] Progreso: ${percent}% (${mbDown}MB / ${mbTotal}MB)`);
                                socket.emit('response', { 
                                    text: `Descargando... ${percent}% (${mbDown}MB / ${mbTotal}MB)`, 
                                    action: null 
                                });
                            } else {
                                console.log(`[Jarvis Streaming] Progreso: ${mbDown}MB descargados...`);
                                socket.emit('response', { 
                                    text: `Descargando... ${mbDown}MB descargados`, 
                                    action: null 
                                });
                            }
                        }
                    });

                    res.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        const sizeMB = (downloadedBytes / 1048576).toFixed(1);
                        console.log(`[Jarvis Streaming] Descarga completa: ${filepath} (${sizeMB}MB)`);
                        socket.emit('response', { 
                            text: `Descarga completa! ${sizeMB}MB guardados en Jarvis_Pelis.`, 
                            action: 'DOWNLOAD_COMPLETE' 
                        });
                        require('child_process').exec(`explorer "${downloadDir}"`);
                    });
                }).on('error', (err) => {
                    fs.unlink(filepath, () => {});
                    console.error('[Jarvis Streaming] Error descargando:', err.message);
                    socket.emit('response', { 
                        text: `Error al descargar: ${err.message}. Asegurate de que Stremio este abierto.`, 
                        action: null 
                    });
                });

                return;
            }

            // --- CATCH DESCARGAS MULTIMEDIA (yt-dlp) ---
            const downloadKeywords = ['descarga', 'descargar', 'baja', 'bajar', 'guarda', 'guardar'];
            const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
            
            const isJustUrl = urlMatch && text.trim() === urlMatch[1];
            
            if (urlMatch && (downloadKeywords.some(w => lowerText.includes(w)) || isJustUrl)) {
                const url = urlMatch[1];
                const isAudio = /(musica|música|audio|cancion|canción|mp3)/i.test(lowerText);
                
                // Avisamos rápido que empezó
                socket.emit('response', { 
                    text: `Iniciando la descarga del ${isAudio ? 'audio' : 'video'}. Te avisaré en cuanto termine.`, 
                    action: null 
                });

                // Lo mandamos al background
                const downloadService = require('./services/downloadService');
                downloadService.downloadMedia(url, isAudio)
                    .then((dir) => {
                        socket.emit('response', { 
                            text: `He terminado de descargar el archivo. Lo guardé en tu carpeta de Descargas de Jarvis.`, 
                            action: 'DOWNLOAD_COMPLETE'
                        });
                        // Abrir la carpeta
                        require('child_process').exec(`explorer "${dir}"`);
                    })
                    .catch((err) => {
                        socket.emit('response', { 
                            text: `Hubo un error al intentar descargar el enlace. Asegurate de que sea un link válido.`, 
                            action: null 
                        });
                    });
                
                return; // Cortar acá para no seguir procesando como IA
            }
            // -------------------------------------------

            // --- CATCH STREAMING: "busca en pelis [titulo]" ---
            const streamingMatch = lowerText.match(/busca(?:me)? en pelis?\s+(.+)/i);
            if (streamingMatch) {
                const title = streamingMatch[1].trim();
                console.log(`[Jarvis Streaming] Buscando: "${title}"`);
                
                const searchUrl = `stremio:///search?search=${encodeURIComponent(title)}`;
                require('child_process').exec(`start "" "${searchUrl}"`);
                
                socket.emit('response', { 
                    text: `Buscando "${title}" en Stremio. Selecciona el que quieras ver.`, 
                    action: null 
                });
                return;
            }
            // -------------------------------------------

            // 0. Toggle de Observador/Estudio Activo
            const turnOnWords = ['activar observador', 'activa observador', 'activa el observador', 'modo observador', 'modo observación', 'modo observacion', 'estudio activo', 'inicia observador', 'enciende el observador'];
            const turnOffWords = ['desactivar observador', 'desactiva observador', 'apaga observador', 'apaga el observador', 'apaga observacion', 'apaga observación', 'desactiva estudio activo'];

            if (turnOnWords.some(w => lowerText.includes(w))) {
                observerService.toggleObserver(true);
                responseText = "Modo Estudio Activo habilitado. He activado mi red de escaneo neuromotriz; a partir de ahora analizaré tus ventanas para brindarte ayuda contextual.";
                action = "OBSERVER_ON";
            } 
            else if (turnOffWords.some(w => lowerText.includes(w))) {
                observerService.toggleObserver(false);
                responseText = "Modo Estudio Activo deshabilitado. Mis ojos locales sobre el sistema operativo han sido apagados.";
                action = "OBSERVER_OFF";
            }
            // 1. Detección de comandos específicos
            else if (lowerText.includes('abrir menú de carga de modos') || lowerText.includes('crear modo') || lowerText.includes('nuevo modo')) {
                responseText = "Abriendo el panel de creación de modalidades.";
                action = "OPEN_MODE_MENU";
            } 
            else if (lowerText.includes('mostrar modos')) {
                responseText = "Mostrando los modos disponibles de mi sistema.";
                action = "SHOW_MODES";
            }
            else if (lowerText.includes('entrenar seguridad') || lowerText.includes('configurar seguridad') || lowerText.includes('entrenar biometría')) {
                const { spawn } = require('child_process');
                // Buscamos un PIN dictado, o usamos 0000 por defecto
                let pinMatches = lowerText.match(/\d{4}/);
                let selectedPin = pinMatches ? pinMatches[0] : "0000";
                
                const pythonExe = require('path').join(__dirname, '..', 'python_engine', 'venv', 'Scripts', 'python.exe');
                const lockScript = require('path').join(__dirname, '..', 'python_engine', 'register_face.py');
                spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', pythonExe, lockScript, selectedPin], { detached: true });
                
                // Forzamos la activacion en el JSON
                const fs = require('fs');
                const secPath = require('path').join(__dirname, 'data', 'security.json');
                let sec = {"pin": selectedPin, "enabled": true};
                fs.writeFileSync(secPath, JSON.stringify(sec, null, 4));
                powerService.setSecurityEnabled(true);

                responseText = `Iniciando proceso de entrenamiento biométrico en una ventana externa. Tu PIN temporal de respaldo es ${selectedPin}. Por favor, sigue las instrucciones en pantalla. El escudo quedará activado al finalizar.`;
            }
            else if (/(apagar|desactivar|quitar|remover|apaga|desactiva|quita)( el| la)? (seguridad|escudo|biometría|bloqueo)/.test(lowerText)) {
                const fs = require('fs');
                const secPath = require('path').join(__dirname, 'data', 'security.json');
                if (fs.existsSync(secPath)) {
                    let sec = JSON.parse(fs.readFileSync(secPath));
                    sec.enabled = false;
                    fs.writeFileSync(secPath, JSON.stringify(sec, null, 4));
                }
                powerService.setSecurityEnabled(false);
                responseText = "Escudo biométrico de Windows desactivado. Tu computadora no será bloqueada al entrar en suspensión.";
                action = "SECURITY_DISABLED";
            }
            else if (/(encender|activar|poner|habilitar|prender|enciende|activa|pon|prende)( el| la)? (seguridad|escudo|biometría|bloqueo)/.test(lowerText)) {
                const fs = require('fs');
                const secPath = require('path').join(__dirname, 'data', 'security.json');
                let sec = {"pin": "0000", "enabled": true};
                if (fs.existsSync(secPath)) {
                    sec = JSON.parse(fs.readFileSync(secPath));
                    sec.enabled = true;
                }
                fs.writeFileSync(secPath, JSON.stringify(sec, null, 4));
                powerService.setSecurityEnabled(true);
                responseText = "Escudo Biométrico encendido y armado. Defenderé tu sistema en cuanto lo ordenes.";
                action = "SECURITY_ENABLED";
            }
            else if (lowerText.includes('activar modo')) {
                const modeNameMatch = lowerText.replace('activar modo', '').replace('el', '').trim();
                const modes = modeService.getAllModes();
                
                // Encontrar el modo que coincida
                const targetMode = modes.find(m => m.name.toLowerCase() === modeNameMatch || m.id === modeNameMatch);
                
                if (targetMode) {
                    modeService.setActiveMode(targetMode.id);
                    responseText = `He cambiado mi configuración cerebral al modo ${targetMode.name}.`;
                    action = "MODE_CHANGED";
                    actionPayload = targetMode.id;
                    io.emit('modes_updated', modeService.getAllModes());
                } else {
                    responseText = `No pude encontrar en mi base de datos un modo llamado ${modeNameMatch}.`;
                }
            }
            else {
                const lowerText = text.toLowerCase();
                const activeMode = modeService.getActiveMode();

                // === MODO FUTBOL (toggle, igual que Programador) ===
                if (activeMode && activeMode.id === 'futbol') {
                    console.log(`[Jarvis Server] ⚽ MODO FUTBOL activo: buscando con Puppeteer.`);
                    try {
                        const { searchSports } = require('./services/aiService');
                        const respuesta = await searchSports(text);
                        responseText = respuesta || "No reconoci el equipo. Escribi el nombre completo (ej: 'Boca Juniors', 'Real Madrid').";
                    } catch (e) {
                        console.error("[Futbol] Error:", e.message);
                        responseText = "Hubo un problema buscando el partido. Intenta de nuevo.";
                    }
                }

                // === MODO PROGRAMADOR AHORA MANEJADO POR AI SERVICE ===
                // El chequeo y ruteo a Python fue desactivado ya que la herramienta nativa build_software en aiService maneja el código.

                // 2. Comandos de sistema (Abrir apps y Entrenamientos)
                const sysCommand = systemService.handleSystemCommand(text);
                
                if (sysCommand.isTraining) {
                    systemService.saveCustomCommand(sysCommand.trigger, sysCommand.appName);
                    responseText = `Entendido. A partir de ahora, cuando me digas "${sysCommand.trigger}", abriré ${sysCommand.appName}.`;
                    action = "TRAINING_SAVED";
                }
                else if (sysCommand.isSystemCommand) {
                    responseText = sysCommand.isLearned
                        ? `Comando aprendido detectado. Ejecutando ${sysCommand.appName}, señor.`
                        : `Abriendo ${sysCommand.appName}.`;

                    const activeMode = modeService.getActiveMode();
                    const success = await systemService.openApp(sysCommand.appName, activeMode.id);
                    if (!success) {
                        responseText = `Hubo un inconveniente al intentar abrir la aplicación ${sysCommand.appName}.`;
                    }
                }
                // 3. Respuesta de IA (Cerebro Híbrido) - Delega todo lo demás a Ollama
                else {
                    const activeMode = modeService.getActiveMode();
                    const screenContext = observerService.getScreenContext();
                    responseText = await aiService.getAIResponse(text, activeMode, screenContext, data.inpaintingMask);
                }
            }

        } catch (error) {
            console.error(error);
            responseText = "Lo siento, mi sistema interceptó una excepción no controlada.";
        }

        console.log(`[Jarvis Responde]: ${responseText}`);
        socket.emit('response', { text: responseText, action, actionPayload });
    });

    // Evento manual para cambiar de modo desde la UI
    socket.on('set_mode', (modeId) => {
        if(modeService.setActiveMode(modeId)) {
            io.emit('modes_updated', modeService.getAllModes());
        }
    });

    socket.on('disconnect', () => {
        console.log('[-] Interfaz desconectada (' + socket.id + ')');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n===========================================`);
    console.log(`  JARVIS VIRTUAL ASSISTANT - BACKEND ACTIVE`);
    console.log(`  => Server running on http://localhost:${PORT}`);
    console.log(`===========================================\n`);
    
    // Iniciar el indexador de accesos directos
    appDiscoveryService.triggerBackgroundScan();
    // Iniciar modulo Cronos para tareas y recordatorios
    reminderService.startScheduler(io);
    // Iniciar escucha de eventos de energia OS (Para Lockscreen)
    powerService.initPowerListener();
});
