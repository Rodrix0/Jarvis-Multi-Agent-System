/**
 * confidenceEngine.js
 * 
 * Ítem 37: Control de Confianza (Confidence Scoring & Adaptive Execution)
 * 
 * Calcula un índice de confianza numérico normalizado de 0.0 a 1.0 combinando:
 * 1. Similitud Léxica / Semántica (40%)
 * 2. Claridad Acústica ASR / Whisper (30%)
 * 3. Completitud de Parámetros Requeridos (20%)
 * 4. Familiaridad / Frecuencia Histórica (10%)
 * 
 * Política adaptativa de decisión:
 * - score > 0.8: EXECUTE (ejecución limpia e inmediata)
 * - 0.5 <= score <= 0.8: EXECUTE_WITH_CONTEXT (ejecutar pero pedir o asumir contexto complementario)
 * - score < 0.5: CLARIFY (freno preventivo, preguntar: "¿Querías decir X?")
 */

class ConfidenceEngine {
    constructor() {
        this.weights = {
            lexical: 0.40,
            acoustic: 0.30,
            params: 0.20,
            history: 0.10
        };
    }

    /**
     * Calcula la distancia de Levenshtein normalizada entre dos cadenas (0.0 a 1.0)
     */
    stringSimilarity(str1 = '', str2 = '') {
        const s1 = String(str1).toLowerCase().trim();
        const s2 = String(str2).toLowerCase().trim();

        if (s1 === s2) return 1.0;
        if (!s1 || !s2) return 0.0;
        if (s1.includes(s2) || s2.includes(s1)) return 0.85;

        const track = Array(s2.length + 1).fill(null).map(() =>
            Array(s1.length + 1).fill(null)
        );

        for (let i = 0; i <= s1.length; i += 1) track[0][i] = i;
        for (let j = 0; j <= s2.length; j += 1) track[j][0] = j;

        for (let j = 1; j <= s2.length; j += 1) {
            for (let i = 1; i <= s1.length; i += 1) {
                const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
                track[j][i] = Math.min(
                    track[j][i - 1] + 1, // deletion
                    track[j - 1][i] + 1, // insertion
                    track[j - 1][i - 1] + indicator // substitution
                );
            }
        }

        const distance = track[s2.length][s1.length];
        const maxLength = Math.max(s1.length, s2.length);
        return Math.max(0.0, parseFloat((1.0 - distance / maxLength).toFixed(2)));
    }

    /**
     * Evalúa la completitud de parámetros requeridos para la acción
     */
    evaluateParametersCompleteness(candidateIntent = {}) {
        const requiredParams = candidateIntent.requiredParams || [];
        const params = candidateIntent.params || {};

        if (requiredParams.length === 0) {
            return 1.0; // No requiere parámetros
        }

        let presentCount = 0;
        for (const req of requiredParams) {
            const val = params[req];
            if (val !== undefined && val !== null && String(val).trim().length > 0) {
                presentCount++;
            }
        }

        return parseFloat((presentCount / requiredParams.length).toFixed(2));
    }

    /**
     * Evalúa la confianza global para un candidato frente a la entrada del usuario
     */
    evaluate(candidateIntent = {}, text = '', context = {}) {
        const rawText = String(text || '').trim();

        // 1. Similitud Léxica
        let lexicalScore = 0.5;
        if (candidateIntent.similarity !== undefined) {
            lexicalScore = Number(candidateIntent.similarity);
        } else if (candidateIntent.triggers && Array.isArray(candidateIntent.triggers)) {
            let maxSim = 0.0;
            for (const trigger of candidateIntent.triggers) {
                const sim = this.stringSimilarity(rawText, trigger);
                if (sim > maxSim) maxSim = sim;
            }
            lexicalScore = maxSim;
        } else if (candidateIntent.name || candidateIntent.label) {
            lexicalScore = this.stringSimilarity(rawText, candidateIntent.name || candidateIntent.label);
        }

        // 2. Confianza Acústica ASR (de Whisper o contexto)
        let acousticScore = 1.0;
        if (context.confidence !== undefined) {
            acousticScore = Number(context.confidence);
        } else if (context.asrConfidence !== undefined) {
            acousticScore = Number(context.asrConfidence);
        } else if (context.isVoice) {
            acousticScore = 0.85; // Default razonable para voz
        }

        // 3. Completitud de Parámetros (escalado si la coincidencia léxica es nula)
        let paramsScore = this.evaluateParametersCompleteness(candidateIntent);
        if (lexicalScore < 0.3) {
            paramsScore = paramsScore * (lexicalScore / 0.3);
        }

        // 4. Historial / Familiaridad (base conservadora 0.3)
        let historyScore = 0.3;
        if (candidateIntent.historyFrequency !== undefined) {
            historyScore = Math.min(1.0, candidateIntent.historyFrequency / 10);
        }

        // FÓRMULA PONDERADA CANÓNICA
        let weightedScore = (
            (lexicalScore * this.weights.lexical) +
            (acousticScore * this.weights.acoustic) +
            (paramsScore * this.weights.params) +
            (historyScore * this.weights.history)
        );

        // Atenuador de seguridad acústico: Si el audio es ruidoso/ininteligible (ASR < 0.5),
        // atenúa el score global para evitar falsos positivos peligrosos
        if (acousticScore < 0.5) {
            const acousticDampener = Math.max(0.4, 0.5 + acousticScore);
            weightedScore *= acousticDampener;
        }

        const score = parseFloat(Math.max(0.0, Math.min(1.0, weightedScore)).toFixed(2));


        // DECISIÓN TRIPARTITA SEGÚN REQUERIMIENTOS:
        // - Si > 0.8: ejecutar
        // - Si 0.5 - 0.8: ejecutar pero pedir contexto
        // - Si < 0.5: preguntar: “¿Querías decir X?”
        let decision = 'EXECUTE';
        let askContext = false;
        let requiresClarification = false;
        let suggestion = candidateIntent.name || candidateIntent.label || candidateIntent.action || 'esta acción';

        if (score > 0.8) {
            decision = 'EXECUTE';
            askContext = false;
            requiresClarification = false;
        } else if (score >= 0.5 && score <= 0.8) {
            decision = 'EXECUTE_WITH_CONTEXT';
            askContext = true;
            requiresClarification = false;
        } else {
            decision = 'CLARIFY';
            askContext = false;
            requiresClarification = true;
        }

        const evaluation = {
            score,
            decision,
            askContext,
            requiresClarification,
            factors: {
                lexical: lexicalScore,
                acoustic: acousticScore,
                parameters: paramsScore,
                history: historyScore
            },
            clarifyPrompt: requiresClarification ? `¿Querías decir "${suggestion}"?` : null,
            contextPrompt: askContext ? `Ejecutando, pero ¿podrías especificar más detalles o confirmar el contexto para "${suggestion}"?` : null,
            suggestedIntent: suggestion
        };

        // Auditoría estructurada
        try {
            const structuredLogger = require('../diagnostics/structuredLoggerService');
            structuredLogger.log({
                level: score < 0.5 ? 'WARN' : 'INFO',
                module: 'confidenceEngine',
                action: 'confidence_evaluated',
                result: score >= 0.5 ? 'success' : 'clarification_required',
                duration: 0,
                metadata: {
                    text: rawText,
                    score,
                    decision,
                    intent: suggestion
                }
            });
        } catch (e) {}

        return evaluation;
    }
}

const confidenceEngine = new ConfidenceEngine();
module.exports = {
    ConfidenceEngine,
    confidenceEngine
};
