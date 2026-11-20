(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; };
    const sidebar = document.querySelector('.modes-panel');
    const center = document.querySelector('.center-panel');
    const header = document.querySelector('.hud-header');
    const controls = document.querySelector('.controls-wrapper');
    const live = document.querySelector('.transcript-box');
    const toolsPanel = document.querySelector('.capabilities-panel');
    const input = $('manual-text-input');
    const avatar = 'assets/jarvis-companion.png';
    const storageKey = 'jarvis.workspace.conversations.v1';
    let conversations = [], selectedId = null, liveId = null, lastUser = '', lastUserAt = 0;
    let busy = false, connected = socket.connected, returnFocus = null;
    let taskState = '', waitingForAnswer = false, localStage = '', voiceKnown = false, browserError = '';
    try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (Array.isArray(stored)) conversations = stored.filter(c => c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages)).slice(0, 30).map(c => ({ ...c, messages: c.messages.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string').slice(-80) }));
    } catch (_) { /* A corrupt browser cache must never block Jarvis. */ }

    const brand = make('div', 'sidebar-brand');
    brand.innerHTML = `<img src="${avatar}" alt="" width="36" height="36"><div>JARVIS<small>ASISTENTE PERSONAL</small></div>`;
    const newButton = make('button', 'new-conversation'); newButton.type = 'button';
    newButton.innerHTML = '<span aria-hidden="true">＋</span> Nueva conversación <span aria-hidden="true">↗</span>';
    const nav = make('nav', 'workspace-nav'); nav.setAttribute('aria-label', 'Espacios de Jarvis');
    const navButton = (symbol, label, fn, active = false) => {
        const b = make('button', active ? 'active' : ''); b.type = 'button';
        const i = make('span', 'nav-symbol', symbol); i.setAttribute('aria-hidden', 'true'); b.append(i, document.createTextNode(label)); b.onclick = fn; nav.append(b); return b;
    };
    const recentLabel = make('div', 'sidebar-section-label', 'Conversaciones');
    const list = make('div', 'conversation-list'); list.setAttribute('aria-label', 'Historial local');
    const historyNote = make('div', 'history-note', 'Guardadas en este navegador');
    sidebar.prepend(brand, newButton, nav, recentLabel, list, historyNote);
    const modeHeading = sidebar.querySelector('h3'); if (modeHeading) modeHeading.textContent = 'MODOS';
    $('btn-open-mode-modal').textContent = '+ Crear un modo';
    const footer = make('div', 'sidebar-footer'); sidebar.append(footer);
    const profile = make('div', 'sidebar-profile');
    profile.innerHTML = '<span class="profile-monogram">R</span><div>Rodrigo<small>Tu espacio personal</small></div>';

    const settings = document.createElement('dialog'); settings.className = 'workspace-settings'; settings.setAttribute('aria-labelledby', 'settings-title');
    settings.innerHTML = '<div class="drawer-heading"><h2 id="settings-title">Ajustes de Jarvis</h2><button type="button" class="icon-button" aria-label="Cerrar ajustes">×</button></div><p class="settings-caption">Voz, memoria y estado de tu asistente. Las herramientas avanzadas siguen disponibles acá.</p><div class="settings-controls"></div>';
    document.body.append(settings);
    settings.querySelector('button').onclick = () => settings.close();
    settings.addEventListener('click', e => { if (e.target === settings) { const r = settings.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) settings.close(); } });
    const oldHeaderControls = header.querySelector(':scope > div:last-child');
    const settingsControls = settings.querySelector('.settings-controls');
    for (const el of [...oldHeaderControls.children]) settingsControls.append(el);
    oldHeaderControls.remove();
    ['btn-open-brain-modal', 'btn-open-dashboard'].forEach(id => $(id)?.addEventListener('click', () => settings.close()));
    const settingsButton = make('button', '', '⚙  Ajustes y voz'); settingsButton.onclick = () => settings.showModal(); footer.append(settingsButton, profile);
    const headerActions = make('div', 'header-actions');
    const connection = make('span', 'connection-chip', 'Conectando…'); connection.setAttribute('role', 'status');
    const toolsButton = make('button', 'icon-button', '⊞'); toolsButton.setAttribute('aria-label', 'Abrir herramientas');
    const emergency = $('btn-emergency-stop'); emergency.textContent = 'Detener todo'; emergency.title = 'Detener todas las acciones · Ctrl+Alt+J'; emergency.style.fontSize = '11px';
    headerActions.append(connection, emergency, toolsButton); header.append(headerActions);
    const menu = make('button', 'icon-button mobile-menu', '☰'); menu.setAttribute('aria-label', 'Abrir menú lateral'); menu.setAttribute('aria-expanded', 'false'); header.prepend(menu);
    const scrim = make('button', 'sidebar-scrim'); scrim.setAttribute('aria-label', 'Cerrar menú lateral'); document.body.append(scrim);
    const closeSidebar = () => { document.body.classList.remove('sidebar-open'); menu.setAttribute('aria-expanded', 'false'); };
    menu.onclick = () => { const open = document.body.classList.toggle('sidebar-open'); menu.setAttribute('aria-expanded', String(open)); };
    scrim.onclick = closeSidebar;
    const subtitle = make('small', 'header-subtitle', 'Tu espacio para hacer más'); header.querySelector('.logo').append(subtitle);
    const backdrop = make('button', 'drawer-backdrop'); backdrop.hidden = true; backdrop.setAttribute('aria-label', 'Cerrar herramientas'); document.body.append(backdrop);
    const drawerHead = make('div', 'drawer-heading'); drawerHead.innerHTML = '<h2>Herramientas</h2><button type="button" class="icon-button" aria-label="Cerrar herramientas">×</button>'; toolsPanel.prepend(drawerHead);
    const closeTools = () => { const wasOpen = toolsPanel.classList.contains('is-open'); toolsPanel.classList.remove('is-open'); toolsPanel.inert = true; backdrop.hidden = true; if (wasOpen) returnFocus?.focus(); };
    const openTools = () => { closeSidebar(); returnFocus = document.activeElement; toolsPanel.inert = false; toolsPanel.classList.add('is-open'); backdrop.hidden = false; $('capability-search').focus(); };
    toolsPanel.inert = true; toolsButton.onclick = openTools; backdrop.onclick = closeTools; drawerHead.querySelector('button').onclick = closeTools;
    toolsPanel.addEventListener('click', e => { if (e.target.closest('.capability-card')) { closeTools(); input.focus(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeTools(); closeSidebar(); } });
    navButton('◌', 'Conversación', () => { closeTools(); closeSidebar(); input.focus(); }, true);
    navButton('⊞', 'Herramientas', openTools);
    navButton('◷', 'Mis recordatorios', () => prepare('¿Qué recordatorios tengo pendientes?'));
    navButton('▧', 'Mi escritorio', () => prepare('Mostrame los archivos de mi escritorio'));

    const scroller = make('div', 'conversation-scroll');
    const welcome = make('section', 'welcome');
    welcome.append($('visualizer-container'));
    const greeting = make('div');
    greeting.innerHTML = '<div class="welcome-eyebrow">TU ASISTENTE, A TU LADO</div><h1>Hola, Rodrigo.<br><span>¿Qué hacemos hoy?</span></h1><p>Una idea, una tarea o algo que querés resolver.<br>Decímelo y nos ponemos en marcha.</p>';
    welcome.append(greeting);
    const suggestions = make('div', 'suggestions');
    [
        ['▤', 'Creá algo nuevo', 'Documentos, notas y planillas', 'Creame un documento sobre '],
        ['⌕', 'Encontrá una respuesta', 'Investigá y guardá lo importante', 'Buscá información sobre '],
        ['◷', 'Organizá tu día', 'Tareas y recordatorios', 'Recordame '],
        ['▷', 'Un momento para vos', 'Películas, series y música', 'Buscá en Stremio ']
    ].forEach(([icon, title, sub, prompt]) => {
        const b = make('button', 'suggestion'); b.type = 'button';
        b.append(make('span', 'suggestion-icon', icon), make('strong', '', title), make('small', '', sub)); b.onclick = () => prepare(prompt); suggestions.append(b);
    });
    welcome.append(suggestions, make('p', 'welcome-footnote', 'Elegí una idea para empezar o escribí a tu manera.'));
    const feed = make('div', 'conversation-history'); feed.setAttribute('aria-label', 'Mensajes de la conversación');
    const identity = make('div', 'reply-identity'); identity.innerHTML = `<img src="${avatar}" alt="" width="30" height="30"><span>Jarvis</span><small>Tu asistente</small>`;
    const liveAvatar = make('span', 'live-avatar');
    liveAvatar.innerHTML = `<span class="avatar-halo"></span><img class="jarvis-avatar" src="${avatar}" alt="" width="30" height="30"><span class="avatar-wave" aria-hidden="true"><i></i><i></i><i></i></span>`;
    identity.querySelector('img').replaceWith(liveAvatar);
    liveAvatar.dataset.state = neuralVisualizer.state;
    window.addEventListener('jarvis-avatar-state', e => { liveAvatar.dataset.state = e.detail; });
    live.insertBefore(identity, $('jarvis-response')); live.hidden = true;
    window.JarvisRig?.mount(liveAvatar);
    scroller.append(welcome, feed, live); center.prepend(scroller);
    const activity = make('div', 'workspace-activity', 'Conectando con Jarvis…'); activity.setAttribute('role', 'status'); controls.prepend(activity);
    const presence = make('section', 'assistant-presence'); presence.setAttribute('aria-label', 'Estado de Jarvis');
    const presenceInfo = make('div', 'presence-info'); presenceInfo.setAttribute('role', 'status'); presenceInfo.setAttribute('aria-live', 'polite'); presenceInfo.setAttribute('aria-atomic', 'true');
    const presenceLabel = make('span', 'presence-label', 'JARVIS');
    const presenceTitle = make('strong', 'presence-title', 'Comprobando voz…'); presenceTitle.id = 'main-assistant-status';
    const presenceHint = make('span', 'presence-hint', 'Esperando el estado del micrófono');
    const voiceState = make('span', 'presence-voice'); voiceState.id = 'main-voice-status';
    const presenceToggle = make('button', 'presence-toggle', 'Activar voz'); presenceToggle.type = 'button';
    presenceToggle.onclick = () => $('btn-toggle-mic').click();
    presenceInfo.append(presenceLabel, presenceTitle, presenceHint, voiceState); presence.append(presenceInfo, presenceToggle); controls.prepend(presence);
    // Keep transient task notices above the fixed status/composer area on any screen.
    const controlsSize = new ResizeObserver(() => document.documentElement.style.setProperty('--workspace-controls-height', Math.ceil(controls.getBoundingClientRect().height) + 'px'));
    controlsSize.observe(controls);
    function renderPresence() {
        const listening = localVoiceOnline || browserListening;
        let voice = !voiceKnown && !listening ? 'Comprobando voz' : listening ? (isDormant ? 'Voz en reposo' : 'Voz escuchando') : 'Voz desactivada';
        if (browserError === 'not-allowed' && !localVoiceOnline) voice = 'Micrófono sin permiso';
        if (localVoiceOnline && localStage === 'loading-whisper' && !isDormant) voice = 'Procesando voz';
        if (localVoiceOnline && ['error','fatal'].includes(localStage)) voice = 'Error de voz';
        let state = 'dormant', title = 'En reposo', hint = 'Decí «Jarvis, prendete» para activarlo';
        if (!connected) { state = 'offline'; title = 'Sin conexión'; hint = 'Esperando conexión con Jarvis'; voice = 'Estado de voz sin confirmar'; }
        else if (waitingForAnswer) { state = 'waiting'; title = 'Esperando tu respuesta'; hint = 'Revisá la pregunta o confirmación pendiente'; }
        else if (taskState) { state = 'working'; title = taskState === 'pending' ? 'Pedido pendiente' : 'Trabajando'; hint = taskState === 'pending' ? 'Preparando tu pedido' : 'Estoy resolviendo tu pedido'; }
        else if (isJarvisSpeaking) { state = 'speaking'; title = 'Hablando'; hint = 'Jarvis te está respondiendo'; }
        else if (!voiceKnown && !listening) { state = 'pending'; title = 'Comprobando voz…'; hint = 'Esperando el estado del micrófono'; }
        else if (localVoiceOnline && ['error','fatal'].includes(localStage)) { state = 'offline'; title = 'Problema con la voz'; hint = 'Revisá el micrófono en Ajustes o seguí escribiendo'; }
        else if (browserError === 'not-allowed' && !localVoiceOnline) { state = 'offline'; title = 'Micrófono sin permiso'; hint = 'Permití el micrófono o seguí escribiendo'; }
        else if (!listening) { state = 'inactive'; title = 'Voz desactivada'; hint = 'Podés seguir escribiendo o activar la voz'; }
        else if (isDormant) { state = 'dormant'; }
        else if (['loading-whisper', 'transcribing', 'understood'].includes(localStage) && localVoiceOnline) { state = 'pending'; title = 'Procesando tu voz'; hint = 'Estoy interpretando lo que dijiste'; }
        else { state = 'listening'; title = 'Escuchando'; hint = localStage === 'recording' ? 'Estoy recibiendo tu voz' : 'Decime qué necesitás'; }
        presence.dataset.state = state;
        if (presenceTitle.textContent !== title) presenceTitle.textContent = title;
        if (presenceHint.textContent !== hint) presenceHint.textContent = hint;
        if (voiceState.textContent !== voice) voiceState.textContent = voice;
        presenceToggle.disabled = !connected;
        presenceToggle.textContent = !isDormant && listening ? 'Poner en reposo' : 'Activar voz';
        presenceToggle.setAttribute('aria-label', presenceToggle.textContent + ' de Jarvis');
        presenceToggle.setAttribute('aria-pressed', String(!isDormant && listening));
    }
    window.addEventListener('jarvis-voice-availability', event => {
        voiceKnown = true;
        if (event.detail?.local) localStage = event.detail.local.stage || '';
        if (event.detail?.browserError) browserError = event.detail.browserError;
        else if (browserListening || localVoiceOnline) browserError = '';
        renderPresence();
    });
    window.addEventListener('jarvis-avatar-state', renderPresence);
    socket.on('voice_confirmation_required', () => { waitingForAnswer = true; renderPresence(); });
    socket.on('voice_state_changed', renderPresence);
    renderPresence();
    const composer = document.querySelector('.context-input-container');
    const composerTools = make('div', 'composer-tools');
    const attach = make('button', '', '＋ Adjuntar'); attach.type = 'button'; attach.setAttribute('aria-expanded', 'false');
    const link = make('button', '', '↗ Enlace'); link.type = 'button'; link.setAttribute('aria-expanded', 'false');
    const model = make('span', 'composer-model', 'Asistente personal');
    const urlGroup = $('context-url').closest('.context-group'); const dropzone = $('dropzone'); urlGroup.hidden = true; dropzone.hidden = true;
    attach.onclick = () => { dropzone.hidden = !dropzone.hidden; attach.setAttribute('aria-expanded', String(!dropzone.hidden)); };
    link.onclick = () => { urlGroup.hidden = !urlGroup.hidden; link.setAttribute('aria-expanded', String(!urlGroup.hidden)); if (!urlGroup.hidden) $('context-url').focus(); };
    $('context-url').placeholder = 'Pegá un enlace para añadir contexto'; $('context-url').setAttribute('aria-label', 'Enlace de contexto');
    $('dropzone-text').textContent = 'Elegí o arrastrá archivos · PDF, Word, texto e imágenes';
    composerTools.append(attach, link, model, document.querySelector('.controls')); composer.append(composerTools);
    controls.append(make('div', 'composer-note', 'Enter para enviar · Shift + Enter para otra línea · Revisá los datos importantes'));
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 150) + 'px'; });
    $('btn-send-text').addEventListener('click', () => { if (!input.value) input.style.height = 'auto'; });

    function prepare(text) { closeSidebar(); input.value = text; input.dispatchEvent(new Event('input')); input.focus(); input.setSelectionRange(text.length, text.length); }
    function save() {
        try { localStorage.setItem(storageKey, JSON.stringify(conversations.slice(0, 30))); }
        catch (_) { historyNote.textContent = 'No se pudo guardar: almacenamiento lleno'; }
        renderList();
    }
    function renderList() {
        list.replaceChildren();
        if (!conversations.length) list.append(make('p', 'history-empty', 'Tus conversaciones aparecerán acá.'));
        conversations.forEach(c => {
            const b = make('button', 'conversation-row' + (selectedId === c.id ? ' active' : ''), c.title); b.title = c.title; b.type = 'button';
            b.onclick = () => { if (busy) { activity.textContent = 'Jarvis sigue trabajando. El historial estará disponible cuando termine.'; return; } selectedId = c.id; liveId = null; live.hidden = true; welcome.hidden = true; renderMessages(c.messages); renderList(); closeSidebar(); activity.textContent = 'Historial local · abrirlo no vuelve a ejecutar las acciones'; };
            list.append(b);
        });
    }
    function renderMessages(messages) {
        feed.replaceChildren();
        messages.forEach(m => {
            const el = make('article', 'history-message ' + m.role);
            if (m.role === 'assistant') {
                const id = identity.cloneNode(true), thumb = id.querySelector('.live-avatar');
                thumb.dataset.state = 'idle';
                // History keeps a cheap static thumbnail; cloned canvases have no pixels.
                thumb.innerHTML = `<img class="jarvis-avatar" src="${avatar}" alt="" width="30" height="30">`;
                el.append(id);
            }
            el.append(make('div', 'message-text', m.text));
            if (m.at && !Number.isNaN(Date.parse(m.at))) el.append(make('time', 'message-time', new Date(m.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })));
            feed.append(el);
        });
    }
    function newConversation() {
        if (busy) { activity.textContent = 'Jarvis sigue trabajando. Podés abrir una conversación nueva cuando termine.'; return; }
        selectedId = null; liveId = null; lastUser = ''; feed.replaceChildren(); live.hidden = true; welcome.hidden = false; renderList(); closeSidebar();
        waitingForAnswer = false; renderPresence();
        activity.textContent = connected ? 'Nueva conversación · la memoria de Jarvis se conserva' : 'Sin conexión con Jarvis'; input.focus();
    }
    newButton.onclick = newConversation;
    function onUser(text) {
        text = String(text || '').trim(); if (!text) return;
        if (text === lastUser && (busy || Date.now() - lastUserAt < 3000)) return;
        lastUser = text; lastUserAt = Date.now();
        let chat = conversations.find(c => c.id === selectedId);
        if (!chat) { chat = { id: crypto.randomUUID(), title: text.slice(0, 55), messages: [] }; conversations.unshift(chat); conversations = conversations.slice(0, 30); selectedId = chat.id; }
        renderMessages(chat.messages);
        chat.messages.push({ role: 'user', text: text.slice(0, 20000), at: new Date().toISOString() }); chat.messages = chat.messages.slice(-80);
        liveId = chat.id; welcome.hidden = true; live.hidden = false; $('user-transcript').textContent = text; $('jarvis-response').textContent = 'Me pongo a trabajar…';
        busy = true; taskState = 'pending'; waitingForAnswer = false; neuralVisualizer.setState('working'); renderPresence(); save(); scroller.scrollTop = scroller.scrollHeight;
    }
    socket.onAnyOutgoing((event, data) => { if (event === 'process_speech') onUser(data?.text); });
    socket.on('action_status', data => {
        if (['heard', 'accepted'].includes(data.phase)) { if (data.text) onUser(data.text); busy = true; neuralVisualizer.setState('working'); }
        activity.textContent = data.message || 'Trabajando…';
        if (['heard', 'accepted', 'working'].includes(data.phase)) { taskState = data.phase === 'working' ? 'working' : 'pending'; waitingForAnswer = false; }
        renderPresence();
    });
    socket.on('response', data => {
        busy = false;
        taskState = ['working', 'running', 'queued', 'pending'].includes(data.status) ? (data.status === 'queued' || data.status === 'pending' ? 'pending' : 'working') : '';
        waitingForAnswer = Boolean(data.confirmationToken || data.status === 'needs_input' || (!taskState && data.status !== 'failed' && /\?\s*$/.test(String(data.voiceText || data.text || '').trim())));
        const chat = conversations.find(c => c.id === liveId);
        if (chat && data.text) { chat.messages.push({ role: 'assistant', text: String(data.text).slice(0, 30000), at: new Date().toISOString() }); chat.messages = chat.messages.slice(-80); save(); }
        activity.textContent = data.status === 'failed' ? 'No se pudo completar · mirá la respuesta' : data.confirmationToken ? 'Esperando tu confirmación' : 'Listo · podés seguir conversando';
        if (!chat) { live.hidden = false; welcome.hidden = true; }
        if (liveId === selectedId) { live.hidden = false; scroller.scrollTop = scroller.scrollHeight; }
        if (neuralVisualizer.state === 'working') neuralVisualizer.setState('idle');
        renderPresence();
    });
    function connectionState(online) {
        connected = online; connection.className = 'connection-chip ' + (online ? 'online' : 'offline'); connection.textContent = online ? 'Conectado' : 'Sin conexión';
        if (!busy) activity.textContent = online ? 'Listo para ayudarte · escribí o activá la voz' : 'Jarvis está desconectado. Esperando reconexión…';
        renderPresence();
    }
    socket.on('connect', () => connectionState(true)); socket.on('disconnect', () => connectionState(false)); connectionState(connected);
    $('btn-send-text').addEventListener('click', e => { if (!connected) { e.stopImmediatePropagation(); activity.textContent = 'No se envió: esperá a que Jarvis vuelva a conectarse.'; } }, true);
    socket.on('local_voice_status', data => { if (!busy && !isJarvisSpeaking && data.state === 'dormant') neuralVisualizer.setState('dormant'); });
    renderList();
})();
