// Shared local 2D rig; the static image remains a fallback if an asset cannot load.
let neuralVisualizer = {
    state: 'idle',
    setState(state) {
        this.state = state;
        const root = document.getElementById('visualizer-container');
        if (root) root.dataset.state = state;
        window.dispatchEvent(new CustomEvent('jarvis-avatar-state', { detail: state }));
    }
};
const avatarHost = document.getElementById('visualizer-container');
if (avatarHost) {
    avatarHost.dataset.state = 'idle';
    avatarHost.innerHTML = '<div class="avatar-halo"></div><img class="jarvis-avatar" src="assets/jarvis-companion.png" alt="Personaje de Jarvis: guerrero pixel art con hacha, pelo rojizo y ropa verde" width="144" height="144"><div class="avatar-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>';
    window.JarvisRig?.mount(avatarHost);
}
document.addEventListener('visibilitychange', () => document.body.classList.toggle('page-hidden', document.hidden));
