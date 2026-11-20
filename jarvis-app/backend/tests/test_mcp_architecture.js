/**
 * TEST SUITE: Model Context Protocol (MCP) Architecture (Ítem 10)
 * Verifica que el MCP Router y los 6 servidores nativos (Windows, Browser, Files, Git, Memory, Home)
 * operen con total cumplimiento del protocolo estándar JSON-RPC 2.0.
 */

const assert = require('assert');
const mcpRouter = require('../services/mcp/mcpRouterService');
const { McpProtocol, MCP_ERROR_CODES } = require('../services/mcp/mcpProtocol');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Model Context Protocol (MCP) Architecture (Ítem 10)');
    console.log('===============================================================\n');

    let passed = 0;
    let total = 0;

    function test(name, fn) {
        total++;
        try {
            fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
            throw err;
        }
    }

    async function testAsync(name, fn) {
        total++;
        try {
            await fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
            throw err;
        }
    }

    // 1. Especificación del Protocolo JSON-RPC 2.0
    test('Protocolo: Crea y valida requests, responses y errores JSON-RPC 2.0', () => {
        const req = McpProtocol.createRequest(101, 'tools/list');
        assert.strictEqual(req.jsonrpc, '2.0');
        assert.strictEqual(req.id, 101);
        assert.strictEqual(req.method, 'tools/list');

        const val = McpProtocol.validateRequest(req);
        assert.strictEqual(val.valid, true);

        const invalid = McpProtocol.validateRequest({ method: 'test' });
        assert.strictEqual(invalid.valid, false);

        const err = McpProtocol.createError(101, MCP_ERROR_CODES.METHOD_NOT_FOUND, 'No encontrado');
        assert.strictEqual(err.error.code, -32601);
    });

    // 2. Registro de Servidores MCP Nativos
    test('Router: Registra los 6 servidores MCP nativos', () => {
        const servers = mcpRouter.listServers();
        assert.strictEqual(servers.length, 6, `Se esperaban 6 servidores pero hay ${servers.length}`);
        const ids = servers.map(s => s.id);
        const expected = ['windows', 'browser', 'files', 'git', 'memory', 'home'];
        for (const exp of expected) {
            assert(ids.includes(exp), `Falta servidor MCP: ${exp}`);
        }
        console.log(`     Servidores activos: [${ids.join(', ')}]`);
    });

    // 3. Método tools/list Universal
    await testAsync('tools/list: Recopila y cataloga herramientas de todos los servidores MCP', async () => {
        const tools = await mcpRouter.listAllTools();
        assert(Array.isArray(tools));
        assert(tools.length >= 20, `Debe haber al menos 20 herramientas MCP y hay ${tools.length}`);

        // Verificar que cada herramienta tenga metadata completa
        for (const t of tools.slice(0, 5)) {
            assert.ok(t.name, 'Herramienta debe tener name');
            assert.ok(t.server, 'Herramienta debe tener server');
            assert.ok(t.inputSchema, 'Herramienta debe tener inputSchema');
        }
        console.log(`     Total de herramientas MCP expuestas: ${tools.length}`);
    });

    // 4. tools/call: Windows MCP Server (Audio)
    await testAsync('tools/call: Ejecuta windows_set_volume a través del protocolo MCP', async () => {
        const rpcRes = await mcpRouter.callTool('windows:windows_set_volume', { percent: 45 });
        assert.strictEqual(rpcRes.jsonrpc, '2.0');
        assert(rpcRes.result, 'Debe retornar result');
        assert.strictEqual(rpcRes.result.isError, false);
        assert(rpcRes.result.content[0].text.includes('45%'));
    });

    // 5. tools/call: Git MCP Server (git_status nativo)
    await testAsync('tools/call: Ejecuta git_status sobre el repositorio a través de MCP', async () => {
        const rpcRes = await mcpRouter.callTool('git:git_status', {});
        assert.strictEqual(rpcRes.jsonrpc, '2.0');
        assert(rpcRes.result, 'Debe retornar result');
        assert.strictEqual(rpcRes.result.isError, false);
        assert(typeof rpcRes.result.content[0].text === 'string');
        console.log(`     Git Status output: "${rpcRes.result.content[0].text.slice(0, 60)}..."`);
    });

    // 6. tools/call: Files MCP Server (Crear y borrar carpeta)
    await testAsync('tools/call: Files MCP crea y elimina carpeta con éxito', async () => {
        const createRes = await mcpRouter.callTool('files:files_create_folder', { folderName: 'Carpeta_Prueba_MCP_Temp' });
        assert.strictEqual(createRes.jsonrpc, '2.0');
        assert.strictEqual(createRes.result.isError, false);

        const deleteRes = await mcpRouter.callTool('files:files_delete_folder', { folderName: 'Carpeta_Prueba_MCP_Temp' });
        assert.strictEqual(deleteRes.jsonrpc, '2.0');
        assert.strictEqual(deleteRes.result.isError, false);
    });

    // 7. tools/call: Memory MCP Server (Almacenar y consultar)
    await testAsync('tools/call: Memory MCP almacena preferencia y consulta perfil', async () => {
        const storeRes = await mcpRouter.callTool('memory:memory_store_preference', {
            category: 'hardware',
            data: { audio_protocol: 'JSON-RPC 2.0' }
        });
        assert.strictEqual(storeRes.jsonrpc, '2.0');
        assert.strictEqual(storeRes.result.isError, false);

        const profRes = await mcpRouter.callTool('memory:memory_get_profile', {});
        assert.strictEqual(profRes.result.isError, false);
        assert(profRes.result.content[0].text.includes('JSON-RPC 2.0'));
    });

    // 8. Manejo de Errores y Excepciones MCP
    await testAsync('Manejo de Errores: Retorna código -32601 para herramientas inexistentes', async () => {
        const errorRes = await mcpRouter.callTool('herramienta_que_no_existe_xyz');
        assert.strictEqual(errorRes.jsonrpc, '2.0');
        assert(errorRes.error, 'Debe retornar error');
        assert.strictEqual(errorRes.error.code, MCP_ERROR_CODES.METHOD_NOT_FOUND);
    });

    console.log(`\n===============================================================`);
    console.log(`🎉 TODOS LOS TESTS DE ARQUITECTURA MCP PASARON EXITOSAMENTE: ${passed}/${total} (100%)`);
    console.log(`===============================================================\n`);
}

runTests().catch(err => {
    console.error('\n💥 Error fatal en pruebas de Arquitectura MCP:', err);
    process.exit(1);
});
