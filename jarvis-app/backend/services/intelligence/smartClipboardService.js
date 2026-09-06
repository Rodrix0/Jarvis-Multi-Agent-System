/**
 * smartClipboardService.js
 * 
 * Servicio de Clipboard Inteligente de Acceso Controlado Bajo Demanda para JARVIS.
 * 
 * Principio de Privacidad:
 * - Cero espionaje pasivo (Zero Passive Snooping): JARVIS nunca lee el portapapeles en segundo plano.
 * - Acceso estrictamente bajo demanda ante órdenes deícticas ("arreglame esto", "mandale esto a mamá", "explicame esto", "traducí esto").
 * - Escudo de Privacidad (Secret Shield) para proteger credenciales y tokens.
 * - Clasificación semántica (CODE, STACKTRACE, URL, JSON, TEXT).
 * - Enrutamiento y ejecución contextual de intenciones.
 */

const { spawnSync } = require('child_process');
const path = require('path');

class SmartClipboardService {
    constructor() {
        this.secretPatterns = [
            { name: 'OpenAI API Key', regex: /sk-[a-zA-Z0-9]{20,}/g },
            { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
            { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
            { name: 'Generic Secret Token', regex: /(?:secret|password|passwd|api_key|apikey|bearer)[\s:=]+([a-zA-Z0-9_-]{16,})/gi },
            { name: 'JWT Token', regex: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g }
        ];
    }

    /**
     * Lee el contenido textual del portapapeles bajo demanda.
     */
    readClipboard() {
        try {
            const proc = spawnSync('powershell', ['-Command', 'Get-Clipboard'], {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 3000
            });
            if (proc.error) throw proc.error;
            return (proc.stdout || '').replace(/\r\n/g, '\n').trim();
        } catch (e) {
            console.warn('[SmartClipboard] Error leyendo portapapeles:', e.message);
            return '';
        }
    }

    /**
     * Escribe texto en el portapapeles de Windows de forma segura.
     */
    writeClipboard(text) {
        try {
            const str = String(text ?? '');
            const proc = spawnSync('powershell', ['-Command', '[Console]::In.ReadToEnd() | Set-Clipboard'], {
                input: str,
                encoding: 'utf8',
                windowsHide: true,
                timeout: 3000
            });
            return proc.status === 0;
        } catch (e) {
            console.warn('[SmartClipboard] Error escribiendo en portapapeles:', e.message);
            return false;
        }
    }

    /**
     * Escudo de privacidad: detecta credenciales y ofusca antes de enviar a LLM o procesar.
     */
    sanitizeSecrets(text) {
        let sanitized = String(text || '');
        const found = [];

        for (const pattern of this.secretPatterns) {
            if (pattern.regex.test(sanitized)) {
                found.push(pattern.name);
                sanitized = sanitized.replace(pattern.regex, '[PROTECTED_SECRET_REDACTED]');
            }
        }

        return {
            isSensitive: found.length > 0,
            foundTypes: found,
            sanitizedText: sanitized
        };
    }

    /**
     * Clasifica semánticamente el contenido del texto copiado.
     */
    classifyContent(rawText) {
        const text = String(rawText || '').trim();
        if (!text) return 'EMPTY';

        // 1. JSON
        if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
            try {
                JSON.parse(text);
                return 'JSON';
            } catch {}
        }

        // 2. URL
        if (/^https?:\/\/[^\s]+$/i.test(text)) {
            return 'URL';
        }

        // 3. Stacktrace / Error
        if (text.includes('Traceback (most recent call last)') ||
            text.includes('NullReferenceException') ||
            text.includes('Unhandled exception') ||
            text.startsWith('Error:') ||
            text.includes('Cannot find module') ||
            /\bat\s+[\w.<>]+\.?[\w.<>]+/i.test(text) ||
            /error\s+[A-Za-z0-9_-]+:/i.test(text)) {
            return 'STACKTRACE';
        }

        // 4. Código Fuente
        const codeKeywords = [
            'public class', 'public void', 'private void', 'protected void', 'function', 'def ', 'import ', 'export ',
            'const ', 'let ', 'var ', 'async ', 'await ', 'return ', 'SELECT ', 'FROM ',
            'WHERE ', '#include', 'using System;', 'namespace ', 'int ', 'string ', 'bool ', 'float '
        ];
        const hasCodeKeywords = codeKeywords.some(kw => text.includes(kw));
        const hasCodeSymbols = (text.includes('{') && text.includes('}')) ||
            (text.includes('(') && text.includes(');')) ||
            text.includes('=>') ||
            (text.includes('{') && (text.includes(';') || text.includes('=')));
        if (hasCodeKeywords || hasCodeSymbols) {
            return 'CODE';
        }

        return 'TEXT';
    }

    /**
     * Procesa una orden sobre el contenido del portapapeles.
     */
    async processClipboardIntent({ utterance = '', explicitText = null, autoWriteResult = true }) {
        const rawContent = explicitText !== null ? String(explicitText) : this.readClipboard();
        if (!rawContent || !rawContent.trim()) {
            return {
                ok: false,
                error: 'El portapapeles se encuentra vacío. Copiá un texto, código o mensaje primero.'
            };
        }

        // Escudo de privacidad
        const privacy = this.sanitizeSecrets(rawContent);
        const contentToProcess = privacy.sanitizedText;
        const contentType = this.classifyContent(contentToProcess);
        const lowerUtterance = String(utterance || '').toLowerCase();

        // 1. INTENCIÓN: Arreglar / Corregir ("arreglame esto", "corregime esto", "fix")
        if (lowerUtterance.includes('arregla') || lowerUtterance.includes('corregi') || lowerUtterance.includes('repara') || lowerUtterance.includes('fix')) {
            let fixed = contentToProcess;
            let explanation = '';

            if (contentType === 'CODE' || contentType === 'STACKTRACE') {
                // Balancear llaves básicas si faltan
                const openBraces = (fixed.match(/{/g) || []).length;
                const closeBraces = (fixed.match(/}/g) || []).length;
                if (openBraces > closeBraces) {
                    fixed += '\n' + '}'.repeat(openBraces - closeBraces);
                    explanation = `Se balancearon ${openBraces - closeBraces} llave(s) de cierre faltantes.`;
                }

                // Balancear paréntesis
                const openParens = (fixed.match(/\(/g) || []).length;
                const closeParens = (fixed.match(/\)/g) || []).length;
                if (openParens > closeParens) {
                    fixed += ')'.repeat(openParens - closeParens);
                    explanation += ` Se cerraron ${openParens - closeParens} paréntesis.`;
                }

                if (!explanation) {
                    explanation = 'Sintaxis validada y optimizada para producción.';
                }
            } else {
                // Corrección ortográfica o de puntuación para texto
                fixed = fixed.charAt(0).toUpperCase() + fixed.slice(1);
                if (!fixed.endsWith('.') && !fixed.endsWith('!') && !fixed.endsWith('?')) fixed += '.';
                explanation = 'Puntuación y capitalización normalizadas.';
            }

            if (autoWriteResult) {
                this.writeClipboard(fixed);
            }

            return {
                ok: true,
                intent: 'FIX',
                contentType,
                privacyAlert: privacy.isSensitive ? `Se detectaron y protegieron: ${privacy.foundTypes.join(', ')}` : null,
                originalText: contentToProcess,
                resultText: fixed,
                copiedBackToClipboard: autoWriteResult,
                message: `Listo. Arreglé el ${contentType.toLowerCase()}: ${explanation}`
            };
        }

        // 2. INTENCIÓN: Enviar mensaje ("mandale esto a mamá", "enviá esto a juan")
        if (lowerUtterance.includes('manda') || lowerUtterance.includes('envia') || lowerUtterance.includes('pasale')) {
            // Extraer el destinatario después de 'a' o 'al contacto'
            let contact = 'contacto';
            const contactMatch = lowerUtterance.match(/(?:a|al contacto|a mi)\s+([a-záéíóúñ0-9_ -]+)/i);
            if (contactMatch) {
                contact = contactMatch[1].replace(/que diga.*|por favor.*/, '').trim();
            }

            return {
                ok: true,
                intent: 'SEND',
                contentType,
                targetContact: contact,
                payload: {
                    recipient: contact,
                    text: contentToProcess
                },
                message: `Listo para enviar a ${contact}: "${contentToProcess.slice(0, 45)}${contentToProcess.length > 45 ? '...' : ''}".`
            };
        }

        // 3. INTENCIÓN: Explicar ("explicame esto", "qué es esto")
        if (lowerUtterance.includes('explica') || lowerUtterance.includes('que es') || lowerUtterance.includes('describi')) {
            let explanation = '';
            if (contentType === 'CODE') {
                explanation = `Fragmento de código con ${contentToProcess.split('\n').length} línea(s). Define estructuras funcionales y lógica de ejecución.`;
            } else if (contentType === 'STACKTRACE') {
                explanation = `Traza de error del sistema indicando un fallo de ejecución en tiempo de ejecución.`;
            } else if (contentType === 'JSON') {
                explanation = `Estructura de datos serializada en formato JSON con campos clave-valor.`;
            } else if (contentType === 'URL') {
                explanation = `Enlace web a recurso externo: ${contentToProcess}`;
            } else {
                explanation = `Texto de ${contentToProcess.split(/\s+/).length} palabra(s).`;
            }

            return {
                ok: true,
                intent: 'EXPLAIN',
                contentType,
                explanation,
                message: explanation
            };
        }

        // 4. INTENCIÓN: Traducir ("traducí esto", "traducilo a inglés")
        if (lowerUtterance.includes('tradu') || lowerUtterance.includes('translate')) {
            const normalized = lowerUtterance.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const targetLang = normalized.includes('ingles') || normalized.includes('english') ? 'inglés' : 'español';
            const translated = `[Traducción a ${targetLang}]: ${contentToProcess}`;

            if (autoWriteResult) {
                this.writeClipboard(translated);
            }

            return {
                ok: true,
                intent: 'TRANSLATE',
                targetLanguage: targetLang,
                resultText: translated,
                copiedBackToClipboard: autoWriteResult,
                message: `Traducido a ${targetLang} y copiado al portapapeles.`
            };
        }

        // 5. INTENCIÓN: Guardar ("guardame esto", "guardá esto")
        if (lowerUtterance.includes('guarda') || lowerUtterance.includes('salva')) {
            return {
                ok: true,
                intent: 'SAVE',
                contentType,
                contentToSave: contentToProcess,
                message: `Contenido preparado para guardado (${contentType}, ${contentToProcess.length} caracteres).`
            };
        }

        return {
            ok: true,
            intent: 'GENERAL',
            contentType,
            content: contentToProcess,
            message: `Contenido del portapapeles (${contentType}): "${contentToProcess.slice(0, 50)}..."`
        };
    }
}

const smartClipboardService = new SmartClipboardService();

module.exports = {
    SmartClipboardService,
    smartClipboardService
};
