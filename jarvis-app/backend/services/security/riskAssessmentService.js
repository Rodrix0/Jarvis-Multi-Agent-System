/**
 * riskAssessmentService.js
 * 
 * Ítem 38: Confirmaciones según Riesgo (Gobernanza de Seguridad en 4 Niveles)
 * 
 * Niveles formales:
 * - LOW: Operaciones inocuas/lectura (subir volumen, consultar clima, reproducir música)
 *   -> Protocolo: Ejecución directa sin confirmación.
 * - MEDIUM: Creación o alteración reversible (crear archivo, crear carpeta, agendar recordatorio)
 *   -> Protocolo: Confirmación suave (Soft Confirmation) con capacidad de Deshacer (Undo).
 * - HIGH: Destrucción de datos del usuario (borrar carpeta, borrar archivo, matar proceso)
 *   -> Protocolo: Confirmación explícita mediante token efímero de 60s.
 * - CRITICAL: Impacto sistémico o de hardware (apagar PC, reiniciar, resetear base de datos)
 *   -> Protocolo: Doble confirmación obligatoria + Validación criptográfica de PIN de seguridad.
 * 
 * Incluye protección contra fuerza bruta en la verificación de PIN (bloqueo tras 3 fallos).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class RiskAssessmentService {
    constructor() {
        this.pinSalt = 'jarvis_security_salt_v1';
        // PIN por defecto: "1234" (o configurado vía variable de entorno)
        const defaultPin = process.env.JARVIS_SECURITY_PIN || '1234';
        this.pinHash = this.hashPin(defaultPin);

        // Control contra fuerza bruta
        this.failedPinAttempts = 0;
        this.lockedUntil = 0;
        this.maxFailedAttempts = 3;
        this.lockoutDurationMs = 60000; // 60 segundos de bloqueo

        // Almacén de confirmaciones pendientes
        this.pendingCriticalTokens = new Map();
    }

    hashPin(pin) {
        return crypto.createHash('sha256').update(String(pin) + this.pinSalt).digest('hex');
    }

    /**
     * Valida el PIN de seguridad con protección contra fuerza bruta
     */
    verifyPin(inputPin) {
        const now = Date.now();
        if (now < this.lockedUntil) {
            const waitSec = Math.ceil((this.lockedUntil - now) / 1000);
            return {
                ok: false,
                locked: true,
                error: `Acceso bloqueado por seguridad. Intenta nuevamente en ${waitSec} segundos.`
            };
        }

        if (!inputPin) {
            return { ok: false, locked: false, error: 'PIN requerido.' };
        }

        const inputHash = this.hashPin(String(inputPin).trim());
        const isValid = inputHash === this.pinHash;

        if (isValid) {
            this.failedPinAttempts = 0;
            return { ok: true };
        } else {
            this.failedPinAttempts++;
            if (this.failedPinAttempts >= this.maxFailedAttempts) {
                this.lockedUntil = now + this.lockoutDurationMs;
                console.warn(`[RiskSecurity] 🛑 3 intentos fallidos de PIN. Bloqueando acceso por 60s.`);
                
                try {
                    const structuredLogger = require('../diagnostics/structuredLoggerService');
                    structuredLogger.error('riskAssessment', 'pin_brute_force_lockout', {
                        code: 'pin_lockout',
                        message: 'Bloqueo temporal por 3 intentos fallidos de PIN'
                    });
                } catch (e) {}

                return {
                    ok: false,
                    locked: true,
                    error: `Demasiados intentos incorrectos. Bloqueado temporalmente por 60 segundos.`
                };
            }
            return {
                ok: false,
                locked: false,
                error: `PIN incorrecto. Quedan ${this.maxFailedAttempts - this.failedPinAttempts} intento(s).`
            };
        }
    }

    setPin(newPin) {
        if (!newPin || String(newPin).trim().length < 4) {
            throw new Error('El PIN debe tener al menos 4 dígitos.');
        }
        this.pinHash = this.hashPin(String(newPin).trim());
        return true;
    }

    /**
     * Clasifica semánticamente el nivel de riesgo de una acción
     */
    classify(actionId = '', params = {}) {
        const id = String(actionId).toLowerCase();

        // 1. CRITICAL: Apagar PC, reiniciar, resetear base de datos
        if (
            id.includes('shutdown') ||
            id.includes('reboot') ||
            id.includes('apagar_pc') ||
            id.includes('reiniciar_pc') ||
            id.includes('reset_database') ||
            id.includes('database.reset') ||
            id.includes('wipe') ||
            id.includes('format')
        ) {
            return 'CRITICAL';
        }

        // 2. HIGH: Destrucción de archivos o carpetas, matar procesos
        if (
            id.includes('delete') ||
            id.includes('remove') ||
            id.includes('borrar') ||
            id.includes('eliminar') ||
            id.includes('empty_trash') ||
            id.includes('kill')
        ) {
            return 'HIGH';
        }

        // 3. MEDIUM: Creación de archivos, carpetas, recordatorios, tareas o mensajes salientes
        if (
            id.includes('create') ||
            id.includes('crear') ||
            id.includes('write') ||
            id.includes('reminder') ||
            id.includes('agenda') ||
            id.includes('whatsapp') ||
            id.includes('send')
        ) {
            return 'MEDIUM';
        }

        // 4. LOW: Volumen, multimedia, clima, hora, consultas, ventanas
        return 'LOW';
    }

    /**
     * Retorna las reglas de confirmación requeridas para un nivel de riesgo
     */
    getRequirements(riskLevel) {
        switch (riskLevel) {
            case 'CRITICAL':
                return {
                    riskLevel: 'CRITICAL',
                    requiresExplicitConfirmation: true,
                    requiresPin: true,
                    confirmationType: 'dual_with_pin',
                    prompt: 'Esta es una acción CRÍTICA. Requiere confirmación doble y PIN de seguridad.'
                };
            case 'HIGH':
                return {
                    riskLevel: 'HIGH',
                    requiresExplicitConfirmation: true,
                    requiresPin: false,
                    confirmationType: 'explicit_token',
                    prompt: 'Esta acción es de ALTO RIESGO. ¿Confirmás que deseas ejecutarla?'
                };
            case 'MEDIUM':
                return {
                    riskLevel: 'MEDIUM',
                    requiresExplicitConfirmation: false,
                    requiresPin: false,
                    confirmationType: 'soft_undoable',
                    prompt: 'Acción ejecutada con confirmación suave y soporte para deshacer.'
                };
            case 'LOW':
            default:
                return {
                    riskLevel: 'LOW',
                    requiresExplicitConfirmation: false,
                    requiresPin: false,
                    confirmationType: 'none',
                    prompt: 'Ejecución directa.'
                };
        }
    }
}

const riskAssessmentService = new RiskAssessmentService();
module.exports = {
    RiskAssessmentService,
    riskAssessmentService
};
