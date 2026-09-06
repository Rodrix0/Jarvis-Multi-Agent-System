/**
 * documentTemplateService.js
 * 
 * Motor de Plantillas de Documentos Profesionales y Estilos Guardados para JARVIS.
 * 
 * Plantillas soportadas:
 * 1. universidad (Trabajo universitario con portada formal, abstract y bibliografía APA)
 * 2. cv (Currículum Vitae estructurado de alto impacto)
 * 3. informe_tecnico (Informe técnico de ingeniería con tabla de specs y métricas)
 * 4. monografia (Monografía académica por capítulos con marco teórico)
 * 5. presentacion (Estructura de diapositivas slide-deck en docx)
 * 6. trabajo_practico (Carátula de TP, integrantes, consignas y resolución)
 * 
 * Sistema de Estilos Guardados:
 * - Paletas preconfiguradas: MODERN_CYBER, CLASSIC_ACADEMIC, ELEGANT_EXECUTIVE, CLEAN_MINIMAL
 * - Almacén persistente de estilos en data/documents/saved_styles.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle
} = require('docx');

const STYLES_FILE = path.join(__dirname, '..', '..', 'data', 'documents', 'saved_styles.json');

const BUILTIN_STYLES = {
    MODERN_CYBER: {
        name: 'MODERN_CYBER',
        font: 'Segoe UI',
        primaryColor: '004B87',
        secondaryColor: '00A3E0',
        textColor: '222222',
        accentColor: '008080',
        titleSize: 32,      // pt 16 (half-points: 32)
        subtitleSize: 24,   // pt 12
        bodySize: 22,       // pt 11
        spacing: { before: 180, after: 120 }
    },
    CLASSIC_ACADEMIC: {
        name: 'CLASSIC_ACADEMIC',
        font: 'Times New Roman',
        primaryColor: '1B365D',
        secondaryColor: '4A607A',
        textColor: '2B2B2B',
        accentColor: '8B0000',
        titleSize: 32,
        subtitleSize: 24,
        bodySize: 24,       // pt 12
        spacing: { before: 200, after: 140 }
    },
    ELEGANT_EXECUTIVE: {
        name: 'ELEGANT_EXECUTIVE',
        font: 'Georgia',
        primaryColor: '4A154B',
        secondaryColor: '611F69',
        textColor: '1D1C1D',
        accentColor: 'C5A059',
        titleSize: 34,
        subtitleSize: 26,
        bodySize: 22,
        spacing: { before: 240, after: 140 }
    },
    CLEAN_MINIMAL: {
        name: 'CLEAN_MINIMAL',
        font: 'Arial',
        primaryColor: '111827',
        secondaryColor: '4B5563',
        textColor: '1F2937',
        accentColor: '374151',
        titleSize: 30,
        subtitleSize: 22,
        bodySize: 20,       // pt 10
        spacing: { before: 160, after: 100 }
    }
};

class DocumentTemplateService {
    constructor() {
        this.stylesFile = STYLES_FILE;
        this._ensureDirectories();
    }

    _ensureDirectories() {
        try {
            fs.mkdirSync(path.dirname(this.stylesFile), { recursive: true });
            if (!fs.existsSync(this.stylesFile)) {
                fs.writeFileSync(this.stylesFile, JSON.stringify({}, null, 2), 'utf8');
            }
        } catch (e) {
            console.error('[DocumentTemplateService] Error inicializando directorios:', e.message);
        }
    }

    _loadCustomStyles() {
        try {
            if (!fs.existsSync(this.stylesFile)) return {};
            return JSON.parse(fs.readFileSync(this.stylesFile, 'utf8'));
        } catch {
            return {};
        }
    }

    /**
     * Obtiene la configuración de un estilo por nombre (incorporado o personalizado).
     */
    getStyle(styleName = 'CLASSIC_ACADEMIC') {
        const normalized = String(styleName || 'CLASSIC_ACADEMIC').trim().toUpperCase();
        if (BUILTIN_STYLES[normalized]) return BUILTIN_STYLES[normalized];
        const custom = this._loadCustomStyles();
        if (custom[normalized]) return custom[normalized];
        return BUILTIN_STYLES.CLASSIC_ACADEMIC;
    }

    /**
     * Guarda un estilo personalizado persistente.
     */
    saveStyle(name, styleConfig) {
        const cleanName = String(name || '').trim().toUpperCase();
        if (!cleanName) throw new Error('El estilo requiere un nombre válido.');

        const custom = this._loadCustomStyles();
        const fullConfig = {
            name: cleanName,
            font: styleConfig.font || 'Calibri',
            primaryColor: (styleConfig.primaryColor || '000000').replace('#', ''),
            secondaryColor: (styleConfig.secondaryColor || '555555').replace('#', ''),
            textColor: (styleConfig.textColor || '222222').replace('#', ''),
            accentColor: (styleConfig.accentColor || '004B87').replace('#', ''),
            titleSize: styleConfig.titleSize || 32,
            subtitleSize: styleConfig.subtitleSize || 24,
            bodySize: styleConfig.bodySize || 22,
            spacing: styleConfig.spacing || { before: 180, after: 120 }
        };

        custom[cleanName] = fullConfig;
        fs.writeFileSync(this.stylesFile, JSON.stringify(custom, null, 2), 'utf8');
        return fullConfig;
    }

    /**
     * Lista todos los estilos disponibles.
     */
    listStyles() {
        const custom = this._loadCustomStyles();
        const builtins = Object.values(BUILTIN_STYLES).map(s => ({ ...s, type: 'builtin' }));
        const customs = Object.values(custom).map(s => ({ ...s, type: 'custom' }));
        return [...builtins, ...customs];
    }

    /**
     * Lista el catálogo de plantillas soportadas y sus campos esperados.
     */
    listTemplates() {
        return [
            {
                id: 'universidad',
                name: 'Trabajo Universitario',
                description: 'Monografía o entrega académica con portada institucional, abstract, desarrollo y formato APA.',
                requiredFields: ['institution', 'career', 'subject', 'title', 'author'],
                optionalFields: ['abstract', 'content', 'conclusions', 'bibliography']
            },
            {
                id: 'cv',
                name: 'Currículum Vitae',
                description: 'CV profesional moderno con perfil, experiencia laboral, educación y habilidades.',
                requiredFields: ['fullName', 'profession', 'email'],
                optionalFields: ['phone', 'location', 'summary', 'experience', 'education', 'skills']
            },
            {
                id: 'informe_tecnico',
                name: 'Informe Técnico',
                description: 'Informe de ingeniería con especificaciones, métricas de rendimiento y recomendaciones.',
                requiredFields: ['title', 'author', 'summary'],
                optionalFields: ['specifications', 'architecture', 'metrics', 'recommendations']
            },
            {
                id: 'monografia',
                name: 'Monografía',
                description: 'Documento de investigación estructurado en capítulos con marco teórico y conclusiones.',
                requiredFields: ['title', 'author', 'problemStatement'],
                optionalFields: ['objectives', 'chapters', 'conclusions', 'sources']
            },
            {
                id: 'presentacion',
                name: 'Presentación (Deck en Docx)',
                description: 'Estructura de diapositivas tipo deck con portada, agenda y takeaways por slide.',
                requiredFields: ['title', 'presenter'],
                optionalFields: ['agenda', 'slides', 'closing']
            },
            {
                id: 'trabajo_practico',
                name: 'Trabajo Práctico (TP)',
                description: 'Carátula formal de TP, materia, integrantes, consignas y resolución.',
                requiredFields: ['subject', 'tpNumber', 'title', 'members'],
                optionalFields: ['professor', 'commission', 'guidelines', 'solutions']
            }
        ];
    }

    /**
     * Construye un documento Word completo a partir de un template y datos estructurados.
     */
    async renderDocument({ template = 'informe_tecnico', style = 'CLASSIC_ACADEMIC', data = {}, title = null, outputPath = null }) {
        const styleConfig = this.getStyle(style);
        const docTitle = title || data.title || 'Documento JARVIS';
        const paragraphs = [];

        switch (template.toLowerCase()) {
            case 'universidad':
                this._buildUniversityTemplate(paragraphs, data, docTitle, styleConfig);
                break;
            case 'cv':
                this._buildCvTemplate(paragraphs, data, docTitle, styleConfig);
                break;
            case 'informe_tecnico':
                this._buildTechnicalReportTemplate(paragraphs, data, docTitle, styleConfig);
                break;
            case 'monografia':
                this._buildMonographyTemplate(paragraphs, data, docTitle, styleConfig);
                break;
            case 'presentacion':
                this._buildPresentationTemplate(paragraphs, data, docTitle, styleConfig);
                break;
            case 'trabajo_practico':
            case 'tp':
                this._buildPracticalWorkTemplate(paragraphs, data, docTitle, styleConfig);
                break;
            default:
                this._buildGenericTemplate(paragraphs, data, docTitle, styleConfig);
                break;
        }

        const doc = new Document({
            sections: [{
                properties: {
                    page: {
                        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } // 1 pulgada (1440 twips)
                    }
                },
                children: paragraphs
            }]
        });

        const buffer = await Packer.toBuffer(doc);

        let finalPath = outputPath;
        if (!finalPath) {
            const desktop = process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
            fs.mkdirSync(desktop, { recursive: true });
            const cleanName = docTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 35) || 'documento';
            finalPath = path.join(desktop, `${cleanName}_${Date.now()}.docx`);
        }

        fs.writeFileSync(finalPath, buffer);

        return {
            ok: true,
            filePath: finalPath,
            filename: path.basename(finalPath),
            template,
            style: styleConfig.name,
            sizeBytes: buffer.length
        };
    }

    // ==========================================
    // BUILDERS DE CADA PLANTILLA
    // ==========================================

    _buildUniversityTemplate(paragraphs, d, title, s) {
        // Portada
        paragraphs.push(new Paragraph({
            text: (d.institution || 'UNIVERSIDAD NACIONAL').toUpperCase(),
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 100 }
        }));
        paragraphs.push(new Paragraph({
            text: (d.career || 'Facultad de Ingeniería y Ciencias Exactas').toUpperCase(),
            alignment: AlignmentType.CENTER,
            spacing: { after: 800 }
        }));

        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: s.titleSize, color: s.primaryColor, font: s.font })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 600, after: 300 }
        }));

        if (d.subject) {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: `Asignatura: ${d.subject}`, italics: true, size: s.subtitleSize, font: s.font })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 1200 }
            }));
        }

        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: `Autor: ${d.author || 'Estudiante'}`, bold: true, font: s.font })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 600, after: 100 }
        }));
        paragraphs.push(new Paragraph({
            text: `Fecha: ${new Date().toLocaleDateString('es-AR')}`,
            alignment: AlignmentType.CENTER,
            spacing: { after: 1200 }
        }));

        // Resumen
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'RESUMEN', bold: true, size: s.subtitleSize, color: s.primaryColor, font: s.font })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 600, after: 200 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.abstract || 'Este documento presenta una investigación estructurada sobre la temática seleccionada.', font: s.font })],
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 400 }
        }));

        // Desarrollo
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'DESARROLLO', bold: true, size: s.subtitleSize, color: s.primaryColor, font: s.font })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.content || 'Contenido principal y fundamentación teórica desarrollada.', font: s.font })],
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 400 }
        }));

        // Conclusiones y Bibliografía
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'CONCLUSIONES', bold: true, size: s.subtitleSize, color: s.primaryColor, font: s.font })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.conclusions || 'Se concluye que los objetivos planteados fueron alcanzados satisfactoriamente.', font: s.font })],
            spacing: { after: 400 }
        }));

        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'BIBLIOGRAFÍA (FORMATO APA)', bold: true, size: s.subtitleSize, color: s.primaryColor, font: s.font })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.bibliography || '1. Smith, J. (2024). Software Engineering Principles. Academic Press.', font: s.font })],
            spacing: { after: 200 }
        }));
    }

    _buildCvTemplate(paragraphs, d, title, s) {
        // Cabecera con Nombre y Profesión
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.fullName || title, bold: true, size: 36, color: s.primaryColor, font: s.font })],
            spacing: { before: 100, after: 80 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: (d.profession || 'Ingeniero de Software / Desarrollador').toUpperCase(), bold: true, size: 24, color: s.secondaryColor, font: s.font })],
            spacing: { after: 200 }
        }));

        // Contacto en barra
        const contactParts = [d.email || 'contacto@email.com', d.phone || '+54 9 11 0000-0000', d.location || 'Buenos Aires, Argentina'];
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: contactParts.join('  |  '), size: 20, color: s.accentColor, font: s.font })],
            spacing: { after: 400 }
        }));

        // Perfil Profesional
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'PERFIL PROFESIONAL', bold: true, size: 24, color: s.primaryColor, font: s.font })],
            spacing: { before: 200, after: 120 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.summary || 'Profesional orientado a resultados con experiencia en desarrollo de software, automatización e inteligencia artificial.', font: s.font })],
            spacing: { after: 300 }
        }));

        // Experiencia
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'EXPERIENCIA LABORAL', bold: true, size: 24, color: s.primaryColor, font: s.font })],
            spacing: { before: 200, after: 120 }
        }));
        const experiences = Array.isArray(d.experience) ? d.experience : [
            { role: 'Desarrollador Senior', company: 'Tech Solutions Inc.', period: '2022 - Presente', tasks: ['Liderazgo técnico en arquitectura de microservicios.', 'Automatización de despliegues y testing CI/CD.'] }
        ];
        for (const exp of experiences) {
            paragraphs.push(new Paragraph({
                children: [
                    new TextRun({ text: `${exp.role} - `, bold: true, font: s.font }),
                    new TextRun({ text: exp.company, italics: true, font: s.font }),
                    new TextRun({ text: ` (${exp.period})`, size: 20, color: s.secondaryColor, font: s.font })
                ],
                spacing: { before: 100, after: 80 }
            }));
            for (const task of exp.tasks || []) {
                paragraphs.push(new Paragraph({
                    children: [new TextRun({ text: `• ${task}`, font: s.font })],
                    spacing: { after: 60 }
                }));
            }
        }

        // Habilidades
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'COMPETENCIAS Y HABILIDADES TÉCNICAS', bold: true, size: 24, color: s.primaryColor, font: s.font })],
            spacing: { before: 300, after: 120 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.skills || 'JavaScript, Node.js, Python, Git, Docker, Arquitectura de Sistemas, Testing.', font: s.font })],
            spacing: { after: 200 }
        }));
    }

    _buildTechnicalReportTemplate(paragraphs, d, title, s) {
        // Encabezado técnico
        paragraphs.push(new Paragraph({
            children: [
                new TextRun({ text: 'INFORME TÉCNICO DE INGENIERÍA', bold: true, size: 20, color: s.secondaryColor, font: s.font }),
                new TextRun({ text: `  |  ID: INF-${Date.now().toString().slice(-6)}`, size: 20, color: s.accentColor, font: s.font })
            ],
            spacing: { before: 100, after: 100 }
        }));

        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: s.titleSize, color: s.primaryColor, font: s.font })],
            spacing: { after: 300 }
        }));

        // Ficha técnica en Tabla
        const table = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
                new TableRow({
                    children: [
                        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Parámetro', bold: true, font: s.font })] })] }),
                        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Detalle', bold: true, font: s.font })] })] })
                    ]
                }),
                new TableRow({
                    children: [
                        new TableCell({ children: [new Paragraph({ text: 'Autor / Responsable' })] }),
                        new TableCell({ children: [new Paragraph({ text: d.author || 'Jarvis Autonomous Core' })] })
                    ]
                }),
                new TableRow({
                    children: [
                        new TableCell({ children: [new Paragraph({ text: 'Estado del Sistema' })] }),
                        new TableCell({ children: [new Paragraph({ text: d.systemStatus || 'Operativo / Verificado' })] })
                    ]
                }),
                new TableRow({
                    children: [
                        new TableCell({ children: [new Paragraph({ text: 'Fecha de Emisión' })] }),
                        new TableCell({ children: [new Paragraph({ text: new Date().toLocaleDateString('es-AR') })] })
                    ]
                })
            ]
        });
        paragraphs.push(table);
        paragraphs.push(new Paragraph({ text: '', spacing: { after: 300 } }));

        // Resumen Ejecutivo
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: '1. Resumen Ejecutivo', bold: true, size: s.subtitleSize, color: s.primaryColor, font: s.font })],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.summary || 'El presente informe documenta el estado técnico, análisis de métricas y evaluación de desempeño.', font: s.font })],
            spacing: { after: 200 }
        }));

        // Métricas
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: '2. Métricas y Rendimiento', bold: true, size: s.subtitleSize, color: s.primaryColor, font: s.font })],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.metrics || 'Latencia: 42ms | Éxito: 100% | Consumo de Memoria: Óptimo.', font: s.font })],
            spacing: { after: 200 }
        }));

        // Recomendaciones
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: '3. Recomendaciones', bold: true, size: s.subtitleSize, color: s.primaryColor, font: s.font })],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.recommendations || 'Mantener monitoreo continuo y aplicar políticas de snapshot preventivo.', font: s.font })],
            spacing: { after: 200 }
        }));
    }

    _buildMonographyTemplate(paragraphs, d, title, s) {
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'MONOGRAFÍA DE INVESTIGACIÓN', bold: true, size: 24, color: s.secondaryColor, font: s.font })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 400, after: 200 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: s.titleSize, color: s.primaryColor, font: s.font })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 600 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: `Autor: ${d.author || 'Investigador'}`, font: s.font })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 800 }
        }));

        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'Planteamiento del Problema', bold: true, size: s.subtitleSize, color: s.primaryColor, font: s.font })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 300, after: 150 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.problemStatement || 'Descripción del problema objeto de investigación.', font: s.font })],
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 300 }
        }));

        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'Marco Teórico y Estado del Arte', bold: true, size: s.subtitleSize, color: s.primaryColor, font: s.font })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 300, after: 150 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.content || 'Fundamentos conceptuales y antecedentes bibliográficos.', font: s.font })],
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 300 }
        }));
    }

    _buildPresentationTemplate(paragraphs, d, title, s) {
        // Slide 1: Portada
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: `[ DIAPOSITIVA 1 - PORTADA ]`, size: 18, color: s.secondaryColor, font: s.font })],
            spacing: { before: 200, after: 100 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 36, color: s.primaryColor, font: s.font })],
            spacing: { after: 150 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: `Presentador: ${d.presenter || 'Jarvis OS'}  |  Fecha: ${new Date().toLocaleDateString('es-AR')}`, font: s.font })],
            spacing: { after: 600 }
        }));

        // Slide 2: Agenda
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: `[ DIAPOSITIVA 2 - AGENDA ]`, size: 18, color: s.secondaryColor, font: s.font })],
            spacing: { before: 200, after: 100 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'Agenda de la Sesión', bold: true, size: 28, color: s.primaryColor, font: s.font })],
            spacing: { after: 150 }
        }));
        const agenda = d.agenda || ['1. Introducción y Contexto', '2. Demostración y Métricas', '3. Próximos Pasos'];
        for (const item of agenda) {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: `• ${item}`, font: s.font })],
                spacing: { after: 100 }
            }));
        }
    }

    _buildPracticalWorkTemplate(paragraphs, d, title, s) {
        // Carátula de TP
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: (d.institution || 'INSTITUCIÓN EDUCATIVA').toUpperCase(), bold: true, font: s.font })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 80 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: `Materia: ${d.subject || 'Informática'}  |  Comisión: ${d.commission || 'A'}`, font: s.font })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: `TRABAJO PRÁCTICO Nº ${d.tpNumber || '1'}`, bold: true, size: 30, color: s.primaryColor, font: s.font })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 150 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 24, color: s.secondaryColor, font: s.font })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
        }));

        // Integrantes
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'INTEGRANTES DEL GRUPO', bold: true, size: 22, color: s.primaryColor, font: s.font })],
            spacing: { before: 200, after: 100 }
        }));
        const members = Array.isArray(d.members) ? d.members : ['Estudiante 1', 'Estudiante 2'];
        for (const m of members) {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: `• ${m}`, font: s.font })],
                spacing: { after: 60 }
            }));
        }

        // Consignas y Solución
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: 'DESARROLLO DE CONSIGNAS', bold: true, size: 24, color: s.primaryColor, font: s.font })],
            spacing: { before: 400, after: 150 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.content || 'Resolución completa de los ejercicios y consignas asignadas.', font: s.font })],
            spacing: { after: 200 }
        }));
    }

    _buildGenericTemplate(paragraphs, d, title, s) {
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: s.titleSize, color: s.primaryColor, font: s.font })],
            spacing: { before: 200, after: 200 }
        }));
        paragraphs.push(new Paragraph({
            children: [new TextRun({ text: d.content || 'Documento generado automáticamente por Jarvis OS.', font: s.font })],
            spacing: { after: 200 }
        }));
    }
}

const documentTemplateService = new DocumentTemplateService();

module.exports = {
    DocumentTemplateService,
    documentTemplateService,
    BUILTIN_STYLES
};
