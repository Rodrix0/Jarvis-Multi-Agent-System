const databaseService = require('../persistence/databaseService');

class ExplanationService {
    async explainDecision(query) {
        const lower = String(query || '').toLowerCase();

        // 1. Explicaciones de seguridad L0-L4
        if (lower.includes('por que') || lower.includes('por qué') || lower.includes('explicame')) {
            if (lower.includes('preguntaste') || lower.includes('confirmacion') || lower.includes('confirmación') || lower.includes('permiso')) {
                return 'Te pedí confirmación porque la acción involucra comunicación externa o cambios sensibles en el sistema clasificados como Nivel L2/L3 en la política de seguridad.';
            }
            if (lower.includes('no apagaste') || lower.includes('no reiniciaste')) {
                return 'Para apagar o reiniciar la computadora se requiere un token de confirmación explícito con validez de 30 segundos, el cual expiró o no fue confirmado.';
            }
            if (lower.includes('no pudiste') || lower.includes('bloqueado')) {
                return 'La operación fue rechazada debido a que el recurso estaba protegido o en uso por otra tarea.';
            }
        }

        // 2. Historial de acciones recientes
        if (lower.includes('que hiciste') || lower.includes('qué hiciste') || lower.includes('ultimas acciones') || lower.includes('historial')) {
            try {
                const rows = databaseService.db.prepare(`
                    SELECT timestamp, action, level, status 
                    FROM audit_chain 
                    ORDER BY id DESC 
                    LIMIT 4
                `).all();

                if (!rows || rows.length === 0) {
                    return 'No tengo acciones registradas en el historial reciente.';
                }

                const summary = rows.map(r => {
                    const time = new Date(r.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                    return `• ${time} - ${r.action} (${r.status})`;
                }).join('\n');

                return `Mis últimas acciones fueron:\n${summary}`;
            } catch (e) {
                return 'No pude consultar el historial de auditoría.';
            }
        }

        return 'Como asistente de seguridad, evalúo cada orden según su nivel de riesgo (L0 a L4) y verifico que los permisos y tokens estén vigentes antes de ejecutarla.';
    }
}

const explanationService = new ExplanationService();
module.exports = explanationService;
