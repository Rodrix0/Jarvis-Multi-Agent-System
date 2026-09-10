// The action kernel is the source of truth for tools exposed to the language model.
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const families = [
    [/archivo|carpeta|escritorio|documento|leer|leeme|texto/, ['file.', 'folder.', 'directory.']],
    [/git|repositorio|commit|rama|codigo|program|bug|proyecto/, ['git.', 'code.', 'snapshot.']],
    [/plantilla|estilo|curriculum|monografia|informe|word/, ['document.']],
    [/perfil|contexto/, ['profile.', 'context.']],
    [/regla|automatiz|cuando|condicion/, ['automation.']],
    [/objetivo|meta|subobjetivo|progreso/, ['goal.']],
    [/tarea|interrump|reintent|reanuda|pendiente/, ['task.']],
    [/navegador|pagina|web|formulario|enlace/, ['browser.', 'research.']],
    [/pantalla|boton|clic|campo|ventana/, ['ui.', 'vision.']],
    [/memoria|recuerdo|recordas|olvida|correccion/, ['memory.', 'voice.correct']],
    [/portapapeles|copiado|pega/, ['clipboard.']],
    [/enchufe|luz|luces|domotica|sensor|temperatura|ventilador/, ['ha.']],
    [/historial|decision|hiciste|deshace/, ['timeline.', 'explain.']]
];
function select(text, catalog) {
    const query = normalize(text);
    const prefixes = families.filter(([pattern]) => pattern.test(query)).flatMap(([,ids]) => ids);
    const words = query.split(/\W+/).filter(w => w.length > 3);
    return catalog.filter(a => !a.id.startsWith('assistant.') && a.id !== 'actions.sequence').map(action => {
        const label = normalize(action.name + ' ' + action.description);
        const score = (prefixes.some(p => action.id.startsWith(p)) ? 20 : 0) + words.filter(w => label.includes(w)).length;
        return { action, score };
    }).filter(item => item.score > 0).sort((a,b) => b.score-a.score).slice(0,24).map(item => item.action);
}
function build(text) {
    const kernel = require('../actionKernelService');
    const selected = select(text, kernel.catalog());
    const byName = new Map();
    const tools = selected.map(action => {
        const name = 'jarvis_' + action.id.replace(/[.-]/g, '_');
        byName.set(name, action);
        const properties = Object.fromEntries(Object.entries(action.parameters || {}).map(([key, description]) => [key, { description: typeof description === 'string' ? description : JSON.stringify(description) }]));
        return { type: 'function', function: { name, description: action.description || action.name, parameters: { type: 'object', properties, additionalProperties: false, required: action.requiredParameters || [] } } };
    });
    return { tools, byName };
}
async function execute(call, byName, context = {}) {
    const action = byName.get(call.name);
    if (!action) throw new Error('La acción elegida no pertenece al catálogo disponible.');
    let params = call.arguments || {};
    if (typeof params === 'string') params = JSON.parse(params);
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Los parámetros de la acción no son válidos.');
    const unknown = Object.keys(params).filter(key => !(key in (action.parameters || {})));
    if (unknown.length) throw new Error(`Parámetros desconocidos para ${action.name}: ${unknown.join(', ')}.`);
    return require('../actionKernelService').execute(action.id, params, context);
}
module.exports = { build, execute, select };
