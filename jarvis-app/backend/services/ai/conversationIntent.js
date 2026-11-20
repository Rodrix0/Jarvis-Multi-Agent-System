// Sólo las consultas claramente conversacionales van al modelo sin herramientas.
// Ante una orden o una pregunta que requiere datos en vivo, conserva el router de acciones.
function isPureConversation(text) {
    const clean = String(text || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/^[¿¡\s]+/, '').trim();
    if (!clean) return false;
    if (/\b(?:clima|pronostico|temperatura|dolar|cotizacion|precio|noticias|resultado(?:s)?|partido|ahora mismo|en vivo)\b/.test(clean)) return false;
    if (/\b(?:abri|abrir|abre|abrime|abreme|busca|buscame|buscar|investiga|investigame|investigar|descarga|descargame|crea|creame|crear|borra|elimina|envia|mandale|prende|apaga|reproduce|pone|poneme|recordame|agenda|navega|hace clic)\b/.test(clean)) return false;
    return /^(?:que opinas|que te parece|cual es tu opinion|como estas|estas listo|estas lista|te sentis listo|te sentis lista|charlemos|hablemos|conversemos|contame|explicame|explica|que es|quien es|como funciona|por que|cual es|cuales son|ayudame a pensar|podemos hablar)\b/.test(clean);
}

module.exports = { isPureConversation };
