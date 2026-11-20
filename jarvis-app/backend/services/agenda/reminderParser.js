function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parse(text, now = new Date()) {
    const clean = String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (/^(?:(?:que|cuales)\s+)?(?:recordatorios|tareas)(?:\s+(?:tengo|hay|pendientes))?[?¿]*$/.test(clean)
        || /^(?:mostrame|lista|listar|ver|revisa)\s+(?:mis\s+|los\s+)?recordatorios$/.test(clean)
        || clean === 'mis recordatorios' || clean === 'mis tareas') return { id: 'agenda.list', params: {} };
    if (!/^(?:recorda(?:r|me)|recuerdame|avisame|agendame)\b/.test(clean)) return null;
    let title = String(text).replace(/^(?:record[aá](?:r|me)|recu[eé]rdame|avisame|agendame)\s*/i, '');
    const words = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30 };
    const relative = clean.match(/\b(?:dentro de|en)\s+(\d+|un[oa]?|dos|tres|cuatro|cinco|diez|quince|veinte|treinta)\s+(minutos?|horas?)\b/);
    const clock = clean.match(/\ba las?\s+(\d{1,2})(?::(\d{2}))?(?:\s+(?:de la|por la)\s+(manana|tarde|noche))?\b/);
    const date = new Date(now);
    const recurrence = /\b(?:todos los dias|cada dia|diariamente)\b/.test(clean) ? 'daily' : 'none';
    if (relative) {
        const count = Number(relative[1]) || words[relative[1]];
        if (!(count > 0 && count <= 10080) || recurrence === 'daily') return { id: 'agenda.clarify', params: {} };
        date.setTime(now.getTime() + count * (relative[2].startsWith('hora') ? 3600000 : 60000));
        // Agenda stores minutes; round up so a relative reminder never fires early.
        if (date.getSeconds() || date.getMilliseconds()) date.setMinutes(date.getMinutes() + 1, 0, 0);
        title = title.replace(/\b(?:dentro de|en)\s+(\d+|un[oa]?|dos|tres|cuatro|cinco|diez|quince|veinte|treinta)\s+(minutos?|horas?)\b/i, '');
    } else if (clock) {
        let hour = Number(clock[1]);
        const minute = Number(clock[2] || 0);
        if (hour > 23 || minute > 59) return { id: 'agenda.clarify', params: {} };
        if (['tarde', 'noche'].includes(clock[3]) && hour < 12) hour += 12;
        date.setHours(hour, minute, 0, 0);
        if (/\bmanana\b/.test(clean.replace(clock[0], ''))) date.setDate(date.getDate() + 1);
        else if (date <= now && !/\bhoy\b/.test(clean)) date.setDate(date.getDate() + 1);
        else if (date <= now) return { id: 'agenda.clarify', params: {} };
        title = title.replace(/\ba las?\s+\d{1,2}(?::\d{2})?(?:\s+(?:de la|por la)\s+(?:ma[ñn]ana|tarde|noche))?\b/i, '');
    } else return { id: 'agenda.clarify', params: {} };
    title = title.replace(/\b(?:hoy|ma[ñn]ana|todos los d[ií]as|cada d[ií]a|diariamente)\b/gi, '').replace(/^\s*(?:que|de)\s+/i, '').replace(/\s+/g, ' ').replace(/^[ ,]+|[ ,.!?]+$/g, '').trim();
    if (!title) return { id: 'agenda.clarify', params: {} };
    return { id: 'agenda.add', params: { title, targetDate: localDate(date), targetTime: date.toTimeString().slice(0, 5), recurrence } };
}
module.exports = { parse, localDate };
