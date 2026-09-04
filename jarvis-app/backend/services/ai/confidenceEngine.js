class ConfidenceEngine {
    constructor() {
        this.toolWeights = {
            'communication.send-email': { intentWeight: 0.2, entityWeight: 0.5, contextWeight: 0.2, toolWeight: 0.1 },
            'communication.send-whatsapp': { intentWeight: 0.2, entityWeight: 0.5, contextWeight: 0.2, toolWeight: 0.1 },
            'file.delete': { intentWeight: 0.3, entityWeight: 0.4, contextWeight: 0.2, toolWeight: 0.1 },
            'audio.set-volume': { intentWeight: 0.7, entityWeight: 0.1, contextWeight: 0.1, toolWeight: 0.1 },
            'default': { intentWeight: 0.35, entityWeight: 0.30, contextWeight: 0.20, toolWeight: 0.15 }
        };
    }

    calculateGlobalConfidence({
        action = 'default',
        intentConfidence = 1.0,
        entityConfidence = 1.0,
        contextConfidence = 1.0,
        toolMatchConfidence = 1.0,
        riskLevel = 'L1'
    }) {
        const weights = this.toolWeights[action] || this.toolWeights.default;

        let score = (intentConfidence * weights.intentWeight) +
                    (entityConfidence * weights.entityWeight) +
                    (contextConfidence * weights.contextWeight) +
                    (toolMatchConfidence * weights.toolWeight);

        // Penalización por riesgo
        if (riskLevel === 'L3') score -= 0.10;
        else if (riskLevel === 'L2') score -= 0.05;

        score = Math.max(0, Math.min(1.0, score));

        let recommendation = 'EXECUTE'; // 'EXECUTE', 'CONFIRM', 'ASK_INFO'
        if (score >= 0.90 && (riskLevel === 'L0' || riskLevel === 'L1')) {
            recommendation = 'EXECUTE';
        } else if (score >= 0.65) {
            recommendation = 'CONFIRM';
        } else {
            recommendation = 'ASK_INFO';
        }

        return {
            score: Math.round(score * 100) / 100,
            recommendation,
            breakdown: { intentConfidence, entityConfidence, contextConfidence, toolMatchConfidence, riskLevel }
        };
    }
}

const confidenceEngine = new ConfidenceEngine();
module.exports = confidenceEngine;
