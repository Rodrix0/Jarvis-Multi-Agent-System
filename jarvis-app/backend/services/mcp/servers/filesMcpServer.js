/**
 * Files MCP Server
 * Expone la gestión del sistema de archivos, notas y papelera segura bajo el protocolo MCP.
 */

const McpServerBase = require('../mcpServerBase');
const fileOperations = require('../../core/fileOperationsService');
const trashService = require('../../core/trashService');

class FilesMcpServer extends McpServerBase {
    constructor() {
        super('jarvis-files-mcp', '1.0.0');
        this._initTools();
    }

    _initTools() {
        // 1. createFile
        this.registerTool({
            name: 'files_create_file',
            description: 'Crea un archivo de texto o nota en el Escritorio o carpeta especificada.',
            inputSchema: {
                type: 'object',
                properties: {
                    fileName: { type: 'string', description: 'Nombre del archivo (ej: nota.txt)' },
                    content: { type: 'string', description: 'Contenido del archivo' },
                    folderName: { type: 'string', description: 'Carpeta opcional' }
                },
                required: ['fileName']
            },
            handler: async ({ fileName, content = '', folderName }) => {
                const res = await fileOperations.createFile({ fileName, content, folderName, format: 'txt' });
                return res.message || `Archivo ${fileName} creado.`;
            }
        });

        // 2. deleteFile (Papelera segura)
        this.registerTool({
            name: 'files_delete_file',
            description: 'Mueve un archivo a la papelera segura de Jarvis con opción de deshacer.',
            inputSchema: {
                type: 'object',
                properties: {
                    filePath: { type: 'string', description: 'Ruta completa o nombre del archivo' }
                },
                required: ['filePath']
            },
            handler: async ({ filePath }) => {
                const res = await trashService.moveToTrash(filePath);
                return res.message || `Archivo movido a papelera segura.`;
            }
        });

        // 3. createFolder
        this.registerTool({
            name: 'files_create_folder',
            description: 'Crea una carpeta en el Escritorio.',
            inputSchema: {
                type: 'object',
                properties: {
                    folderName: { type: 'string', description: 'Nombre de la carpeta' }
                },
                required: ['folderName']
            },
            handler: async ({ folderName }) => {
                const res = await fileOperations.createFolder({ folderName });
                return res.message || `Carpeta ${folderName} creada.`;
            }
        });

        // 4. deleteFolder
        this.registerTool({
            name: 'files_delete_folder',
            description: 'Mueve una carpeta a la papelera segura de Jarvis.',
            inputSchema: {
                type: 'object',
                properties: {
                    folderName: { type: 'string', description: 'Nombre de la carpeta' }
                },
                required: ['folderName']
            },
            handler: async ({ folderName }) => {
                const res = await fileOperations.deleteFolder(folderName);
                return res.message || `Carpeta eliminada.`;
            }
        });
    }
}

module.exports = new FilesMcpServer();
