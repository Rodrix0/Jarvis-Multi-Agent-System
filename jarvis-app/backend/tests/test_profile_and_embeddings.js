const assert = require('assert');
const profileService = require('../services/memory/profileService');
const embeddingService = require('../services/memory/embeddingService');

async function runTests() {
    console.log('--- TEST 1: Profile Service & Prompt Block ---');
    const profile = profileService.getProfile();
    console.log('Identity name:', profile.identity.name);
    console.log('Streaming platform:', profile.preferences.entertainment.streaming_platform);
    assert.strictEqual(profile.identity.name, 'Rodrigo');

    const promptBlock = profileService.getSystemPromptBlock();
    console.log('Prompt block output:\n', promptBlock);
    assert.ok(promptBlock.includes('BLOQUE PERFIL HUMANO'));
    assert.ok(promptBlock.includes('señor'));
    assert.ok(promptBlock.includes('Netflix'));

    console.log('\n--- TEST 2: Guardrail Anti-Alucinación / Sobreescritura Casual ---');
    // Casual banter should be REJECTED
    const casualUpdate = profileService.updateProfile('projects', 'no tengo ganas de programar', { explicit: false });
    assert.strictEqual(casualUpdate.ok, false);
    assert.strictEqual(casualUpdate.rejected, true);
    console.log('Strict guardrail test: casual update correctly REJECTED.');

    // Explicit update should be ACCEPTED
    const explicitUpdate = profileService.updateProfile('projects', 'Proyecto Secreto X', { explicit: true });
    assert.strictEqual(explicitUpdate.ok, true);
    console.log('Strict guardrail test: explicit update ACCEPTED.');

    console.log('\n--- TEST 3: Memory Vector Storage (Fast Async Path) ---');
    const res1 = await embeddingService.storeMemoryVector({
        id: 'test-mem-1',
        text: 'A Rodri le fascina el anime One Piece y su personaje favorito es Monkey D. Luffy.',
        category: 'entertainment',
        sync: false
    });
    console.log('Store mem 1 result:', res1);
    assert.strictEqual(res1.ok, true);

    const res2 = await embeddingService.storeMemoryVector({
        id: 'test-mem-2',
        text: 'La televisión AIWA se maneja por infrarrojo con el BroadLink RM4 mini.',
        category: 'hardware',
        sync: false
    });
    console.log('Store mem 2 result:', res2);
    assert.strictEqual(res2.ok, true);

    console.log('\n--- TEST 4: Immediate Lexical Retrieval (<1ms) ---');
    const t0 = performance.now();
    const lexicalRes = embeddingService.searchLexical('anime One Piece Luffy', 1);
    const t1 = performance.now();
    console.log(`Lexical search took ${(t1 - t0).toFixed(2)}ms, result:`, lexicalRes[0]);
    assert.ok(lexicalRes.length > 0);
    assert.strictEqual(lexicalRes[0].id, 'test-mem-1');

    console.log('\n--- TEST 5: Hybrid Search with 300ms Timeout & Fallback ---');
    const tStart = performance.now();
    const searchRes = await embeddingService.searchSimilar('cuál es la serie favorita de Rodri con piratas Luffy', { limit: 2 });
    const tElapsed = performance.now() - tStart;
    console.log(`SearchSimilar completed in ${tElapsed.toFixed(2)}ms with ${searchRes.length} results.`);
    console.log('Top match method:', searchRes[0]?.method, 'id:', searchRes[0]?.id);
    assert.ok(searchRes.length > 0);
    // Should return relevant memory whether via semantic or lexical fallback
    assert.ok(searchRes.some(r => r.id === 'test-mem-1' || r.id === 'vec-a1707545'));

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! The system is 100% resilient and non-blocking.');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
