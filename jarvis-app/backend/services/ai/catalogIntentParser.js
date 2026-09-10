const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[¿?¡!.,]/g, '').trim();
function parse(text, catalog) {
    const clean = normalize(text);
    let m;
    if ((m = clean.match(/^(activar|activa|prende|encende|desactivar|desactiva|apaga)\s+(?:el\s+)?(?:modo\s+)?observador$/))) return { id: 'observer.set', params: { enabled: !/^(desact|apaga)/.test(m[1]) } };
    if (/^(?:borra|borrar|elimina)\s+(?:todas\s+)?(?:tus|las|mis)\s+correcciones$/.test(clean)) return { id: 'memory.clear', params: { collection: 'corrections' } };
    if ((m = clean.match(/^(pausa|pausar|desactiva|activa|activar)\s+(?:la\s+)?regla(?:\s+(?:de\s+)?automatizacion)?(?:\s+(.+))?$/))) return { id: 'automation.toggle-rule', params: { id: m[2], enabled: /^activa/.test(m[1]) } };
    if ((m = clean.match(/^(?:borra|borrar|elimina|eliminar)\s+(?:la\s+)?regla(?:\s+(?:de\s+)?automatizacion)?(?:\s+(.+))?$/))) return { id: 'automation.delete-rule', params: { id: m[1] } };
    if ((m = clean.match(/^(?:proba|probar)\s+(?:la\s+)?(?:regla|automatizacion)(?:\s+(.+))?$/))) return { id: 'automation.test-rule', params: { id: m[1] } };
    if (/^(?:recupera|recuperar|continua|continuar|reanuda)\s+(?:las\s+)?tareas\s+interrumpidas$/.test(clean)) return { id: 'task.recover', params: {} };
    if (/^(?:que podes hacer|que sabes hacer|tus funciones|todas las funciones|ayuda|listar capacidades)$/.test(clean)) return { id: 'assistant.capabilities', params: {} };
    if ((m = String(text).match(/^(?:hac[eé]\s+clic|clic|click|apret[aá])\s+(?:(?:en|el)\s+)*(?:bot[oó]n\s+)?(.+?)(?:\s+en\s+(?:el\s+)?(.+))?$/i))) return { id: 'ui.click', params: { element: m[1], ...(m[2] ? { window: m[2] } : {}) } };
    if ((m = clean.match(/^(?:cambia|cambiar|activa|activar)\s+(?:al?\s+|el\s+)?perfil\s+(.+)$/))) {
        const aliases = { normal: 'NORMAL', programacion: 'CODING', coding: 'CODING', juego: 'GAMING', gaming: 'GAMING', estudio: 'STUDY', study: 'STUDY', hogar: 'HOME', home: 'HOME' };
        return { id: 'profile.switch', params: { profileId: aliases[m[1]] || m[1].toUpperCase() } };
    }
    if ((m = clean.match(/^(?:prende|encende|apaga|activa|desactiva)\s+(?:el|la|los|las)\s+(?:enchufe|ventilador|luz|luces|aire acondicionado)\b/))) return { id: 'ha.command', params: { text } };
    // Parameterless actions and names with explicit required-input validation are fast routes.
    for (const action of catalog) {
        if (!/^(?:git\.|snapshot\.|document\.|profile\.|context\.|timeline\.|explain\.|task\.|automation\.|ha\.)/.test(action.id)) continue;
        if (normalize(action.name) === clean || (!Object.keys(action.parameters || {}).length && action.examples?.some(e => normalize(e) === clean))) return { id: action.id, params: {} };
    }
    return null;
}
module.exports = { parse };
