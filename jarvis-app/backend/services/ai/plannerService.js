const crypto = require('crypto');
const path = require('path');
const planValidatorService = require('./planValidatorService');

class PlannerService {
    /**
     * Crea un plan estructurado a partir de una lista explícita de pasos.
     */
    createPlanFromSteps(goal, steps = []) {
        const planId = `plan-${crypto.randomUUID().slice(0, 8)}`;
        return {
            id: planId,
            goal: String(goal || 'Tarea multietapa'),
            planVersion: 1,
            lastCompletedStepId: null,
            status: 'PENDING',
            steps: steps.map((s, index) => ({
                id: s.id || `step-${index + 1}`,
                description: s.description || s.actionId || s.tool || `Paso ${index + 1}`,
                actionId: s.actionId || s.tool,
                params: s.params || {},
                dependsOn: s.dependsOn || (index > 0 ? [`step-${index}`] : []),
                verification: s.verification || null,
                maxRetries: s.maxRetries !== undefined ? s.maxRetries : 1,
                status: 'PENDING'
            }))
        };
    }

    /**
     * Analiza el objetivo del usuario y genera un plan estructurado con criterios de verificación.
     */
    createPlanForGoal({ goal, utterance }) {
        const planId = `plan-${crypto.randomUUID().slice(0, 8)}`;
        const clean = String(utterance || goal || '').toLowerCase();

        // 1. Patrón: "Creá una carpeta X y adentro un archivo Y sobre Z"
        const folderDocMatch = clean.match(/(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer)\s+(?:una\s+)?carpeta\s*(?:llamada|con\s+nombre|de\s+)?\s*([a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]+?)\s+(?:y\s+)?(?:cre[aá]|creame|crear|hac[eé]|haceme|hacer|pon[eé]|poner|met[eé]|meter|redact[aá]|redactar)?\s*(?:dentro|adentro|en\s+ella)?\s*(?:un\s+|una\s+)?(word|documento|docx|txt|nota)\s*(?:llamad[oa]|con\s+nombre\s+(?:de\s+)?)?\s*([^\s:]+)?\s*(?:que\s+diga|con\s+contenido|sobre|:)?\s*([\s\S]*)/i);
        if (folderDocMatch) {
            const folderName = folderDocMatch[1].trim();
            const format = /word|docx|documento/i.test(folderDocMatch[2]) ? 'docx' : 'txt';
            let fileName = (folderDocMatch[3] || '').trim();
            if (!fileName || /^(?:que|con|sobre|de)$/i.test(fileName)) {
                fileName = format === 'docx' ? 'Documento_Principal.docx' : 'Nota_Principal.txt';
            }
            if (!fileName.endsWith(`.${format}`)) fileName += `.${format}`;
            const content = (folderDocMatch[4] || '').trim();

            const desktop = process.env.JARVIS_DESKTOP_DIR || path.join(require('os').homedir(), 'Desktop');
            const targetFolder = path.join(desktop, folderName);
            const targetFile = path.join(targetFolder, fileName);

            return {
                id: planId,
                goal: goal || utterance,
                planVersion: 1,
                lastCompletedStepId: null,
                status: 'PENDING',
                steps: [
                    {
                        id: 'step-1',
                        description: `Crear la carpeta "${folderName}" en el Escritorio`,
                        actionId: 'folder.create',
                        params: { folderName },
                        dependsOn: [],
                        verification: { type: 'folder_exists', target: targetFolder, timeoutMs: 3000 },
                        maxRetries: 1,
                        status: 'PENDING'
                    },
                    {
                        id: 'step-2',
                        description: `Crear el documento "${fileName}" dentro de "${folderName}"`,
                        actionId: 'file.create',
                        params: { folderName, fileName, format, content, topic: content },
                        dependsOn: ['step-1'],
                        verification: { type: 'file_exists', target: targetFile, timeoutMs: 3000, minSize: 1 },
                        maxRetries: 1,
                        status: 'PENDING'
                    }
                ]
            };
        }

        // 2. Plantilla Heurística Rápida: "Buscá X, haceme copia y mandáselo a Y"
        if (clean.includes('busca') && clean.includes('copia') && (clean.includes('manda') || clean.includes('envia'))) {
            const plan = {
                id: planId,
                goal: goal || 'Buscar archivo, duplicar y enviar',
                planVersion: 1,
                lastCompletedStepId: null,
                status: 'PENDING',
                steps: [
                    { id: 'step-1', actionId: 'file.search', description: 'Buscar documento', params: { query: 'documento' }, dependsOn: [] },
                    { id: 'step-2', actionId: 'file.copy', description: 'Duplicar documento', params: { source: '', destination: '' }, dependsOn: ['step-1'] },
                    { id: 'step-3', actionId: 'communication.send-email', description: 'Enviar documento', params: { recipient: '', subject: 'Envío de documento', body: '' }, dependsOn: ['step-2'] }
                ]
            };

            const validated = planValidatorService.validatePlanSchema(plan);
            if (validated.valid) {
                return planValidatorService.insertHumanCheckpoints(plan);
            }
        }

        // 3. Plan genérico de paso simple
        return {
            id: planId,
            goal: goal || utterance,
            planVersion: 1,
            lastCompletedStepId: null,
            status: 'PENDING',
            steps: [
                { id: 'step-1', actionId: 'file.search', description: `Buscar "${clean}"`, params: { query: clean }, dependsOn: [] }
            ]
        };
    }
}

const plannerService = new PlannerService();
module.exports = plannerService;
