const DOLLAR_API = 'https://dolarapi.com/v1/dolares';

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').trim();
}

function requestedDollarType(text) {
    const value = normalize(text);
    if (/\bblue\b/.test(value)) return 'blue';
    if (/\bmep\b|bolsa/.test(value)) return 'bolsa';
    if (/tarjeta|turista/.test(value)) return 'tarjeta';
    if (/mayorista/.test(value)) return 'mayorista';
    if (/cripto/.test(value)) return 'cripto';
    if (/oficial/.test(value)) return 'oficial';
    return '';
}

function money(value) {
    return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}

function formatDollarResponse(rows, requestedType = '') {
    if (!Array.isArray(rows) || !rows.length) throw new Error('No recibí cotizaciones del dólar.');
    const normalizedType = normalize(requestedType);
    const selected = normalizedType
        ? rows.filter(row => normalize(`${row.casa || ''} ${row.nombre || ''}`).includes(normalizedType))
        : rows.filter(row => ['oficial', 'blue'].some(type => normalize(`${row.casa || ''} ${row.nombre || ''}`).includes(type)));
    const visible = selected.length ? selected : rows.slice(0, 2);
    return visible.map(row => `Dólar ${row.nombre}: compra $${money(row.compra)} y venta $${money(row.venta)}`).join('. ');
}

async function getDollarQuote(type = '') {
    const response = await fetch(DOLLAR_API, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`La cotización respondió HTTP ${response.status}.`);
    const rows = await response.json();
    return { message: formatDollarResponse(rows, type), rows, type };
}

module.exports = { getDollarQuote, requestedDollarType, formatDollarResponse };
