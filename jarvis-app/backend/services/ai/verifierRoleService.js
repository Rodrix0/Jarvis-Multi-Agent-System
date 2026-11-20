/**
 * Role: VERIFIER
 * Responsable de comprobar empíricamente si la acción ejecutada por el Executor
 * realmente produjo el efecto deseado en el sistema operativo antes de avanzar.
 */

const verificationService = require('../core/verificationService');
const executorService = require('./executorService');

class VerifierRoleService {
    /**
     * Verifica el resultado de un paso ejecutado.
     */
    async verifyStep(step, executionResult, context = {}) {
        console.log(`[Verifier] 🔍 Verificando paso [${step.id}]: ${step.description || step.actionId}...`);

        // Si la ejecución en sí falló a nivel de ActionKernel, no es correcto
        if (!executionResult || executionResult.ok === false) {
            return {
                correct: false,
                stepId: step.id,
                reason: executionResult?.error || 'La acción devolvió un estado de fallo.',
                evidence: executionResult?.output?.evidence || null
            };
        }

        // Si el paso no define un criterio explícito de verificación, se toma la verificación interna de la acción
        const vCriteria = step.verification;
        if (!vCriteria) {
            const isVerified = executionResult.output?.verified !== false;
            return {
                correct: isVerified,
                stepId: step.id,
                reason: isVerified ? null : 'La verificación interna de la acción no se cumplió.',
                evidence: executionResult.output?.evidence || null
            };
        }

        // Si define un criterio explícito, lo evaluamos con verificationService
        try {
            // Resolver variables en los parámetros del criterio de verificación
            const resolvedTarget = typeof vCriteria.target === 'string'
                ? executorService.resolveParams({ t: vCriteria.target }, context).t
                : vCriteria.target;

            switch (vCriteria.type) {
                case 'file_exists': {
                    const res = await verificationService.verifyFileCreated(resolvedTarget, {
                        timeoutMs: vCriteria.timeoutMs || 3000,
                        minSize: vCriteria.minSize || 0
                    });
                    return {
                        correct: res.verified,
                        stepId: step.id,
                        reason: res.verified ? null : res.error,
                        evidence: res.result || null
                    };
                }

                case 'folder_exists': {
                    const res = await verificationService.verifyFolderCreated(resolvedTarget, {
                        timeoutMs: vCriteria.timeoutMs || 3000
                    });
                    return {
                        correct: res.verified,
                        stepId: step.id,
                        reason: res.verified ? null : res.error,
                        evidence: res.result || null
                    };
                }

                case 'deleted': {
                    const res = await verificationService.verifyDeleted(resolvedTarget, {
                        timeoutMs: vCriteria.timeoutMs || 3000
                    });
                    return {
                        correct: res.verified,
                        stepId: step.id,
                        reason: res.verified ? null : res.error,
                        evidence: null
                    };
                }

                case 'window_open': {
                    const res = await verificationService.verifyAppOpened(resolvedTarget, {
                        timeoutMs: vCriteria.timeoutMs || 4000
                    });
                    return {
                        correct: res.verified,
                        stepId: step.id,
                        reason: res.verified ? null : res.error,
                        evidence: res.evidence || null
                    };
                }

                case 'window_closed': {
                    const res = await verificationService.verifyWindowClosed(resolvedTarget, {
                        timeoutMs: vCriteria.timeoutMs || 3000
                    });
                    return {
                        correct: res.verified,
                        stepId: step.id,
                        reason: res.verified ? null : res.error,
                        evidence: null
                    };
                }

                case 'download_completed': {
                    const res = await verificationService.verifyDownloadCompleted(resolvedTarget, {
                        timeoutMs: vCriteria.timeoutMs || 10000,
                        initialFiles: vCriteria.initialFiles
                    });
                    return {
                        correct: res.verified,
                        stepId: step.id,
                        reason: res.verified ? null : res.error,
                        evidence: res.file ? { file: res.file, size: res.size } : null
                    };
                }

                case 'element_appeared': {
                    const res = await verificationService.verifyElementAppeared(vCriteria.window, resolvedTarget, {
                        timeoutMs: vCriteria.timeoutMs || 4000
                    });
                    return {
                        correct: res.verified,
                        stepId: step.id,
                        reason: res.verified ? null : res.error,
                        evidence: res.element || null
                    };
                }

                case 'custom': {
                    if (typeof vCriteria.check === 'function') {
                        const checkRes = await vCriteria.check(executionResult, context);
                        const isCorrect = typeof checkRes === 'object' ? checkRes.correct !== false : Boolean(checkRes);
                        return {
                            correct: isCorrect,
                            stepId: step.id,
                            reason: isCorrect ? null : (checkRes?.reason || 'Comprobación personalizada fallida.'),
                            evidence: checkRes?.evidence || null
                        };
                    }
                    return { correct: true, stepId: step.id, evidence: null };
                }

                default:
                    return {
                        correct: executionResult.ok,
                        stepId: step.id,
                        reason: null,
                        evidence: executionResult.output?.evidence || null
                    };
            }
        } catch (verErr) {
            return {
                correct: false,
                stepId: step.id,
                reason: `Error en verificación: ${verErr.message}`,
                evidence: null
            };
        }
    }
}

const verifierRoleService = new VerifierRoleService();
module.exports = verifierRoleService;
