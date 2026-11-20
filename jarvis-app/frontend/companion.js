(() => {
    'use strict';
    const group = document.createElement('section');
    group.className = 'companion-settings';
    group.innerHTML = '<label><input id="companion-enabled" type="checkbox" checked> Personaje en el escritorio</label><p>Se muestra cuando minimizás Jarvis o cambiás de pestaña. Te acompaña mientras trabaja y muestra el resultado al terminar.</p><button type="button" id="companion-preview">Ver personaje · 12 segundos</button><small id="companion-status" role="status">Conectando el personaje…</small>';
    document.querySelector('.settings-controls')?.append(group);
    const checkbox = group.querySelector('input');
    const motionLabel=document.createElement('label');motionLabel.innerHTML='<input id="companion-motion" type="checkbox" checked> Animar personaje';
    checkbox.closest('label').after(motionLabel);const motion=motionLabel.querySelector('input');
    const preview = group.querySelector('button');
    const status = group.querySelector('small');
    let desktopVisible = true;
    const presence = () => { if (socket.connected) socket.emit('companion_presence', { visible: !document.hidden && desktopVisible }); };
    window.addEventListener('jarvis-desktop-visibility', event => { desktopVisible = event.detail?.visible !== false; presence(); });
    const save=()=>socket.emit('companion_config', { enabled: checkbox.checked, animations: motion.checked });
    checkbox.addEventListener('change', save);motion.addEventListener('change', save);
    preview.addEventListener('click', () => { socket.emit('companion_preview'); document.querySelector('.workspace-settings')?.close(); });
    socket.on('companion_status', data => {
        checkbox.checked = data.enabled !== false; preview.disabled = !checkbox.checked;
        motion.checked=data.animations!==false;
        window.dispatchEvent(new CustomEvent('jarvis-companion-motion',{detail:{enabled:motion.checked}}));
        status.textContent = data.error || (!data.enabled ? 'Personaje desactivado' : data.running ? 'Listo · arrastralo para moverlo; clic derecho para opciones' : 'Preparando el personaje…');
    });
    socket.on('connect', presence);
    socket.on('disconnect', () => { status.textContent = 'Esperando conexión con Jarvis…'; });
    document.addEventListener('visibilitychange', presence);
    window.addEventListener('pagehide', () => { if (socket.connected) socket.emit('companion_presence', { visible: false }); });
    // Low-frequency liveness also retries a failed native launch. No screen capture.
    setInterval(presence, 15000);
    presence();
})();
