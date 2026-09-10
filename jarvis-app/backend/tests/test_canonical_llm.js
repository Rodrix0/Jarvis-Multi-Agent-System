const assert = require('assert/strict');
const jarvis = require('../services/jarvisActionService');
const kernel = require('../services/actionKernelService');
const ai = require('../services/aiService');
async function main() {
    let called = 0;
    kernel.register({ id:'profile.test-confirmation', name:'Prueba de perfil', parameters:{}, confirmation:true, execute:()=>{called++;return {ok:true,message:'Ejecutada'};} });
    const original = global.fetch;
    let selectedName = 'jarvis_profile_current';
    global.fetch = async (url, options = {}) => {
        if (String(url).includes('/api/chat')) {
            const body = JSON.parse(options.body);
            assert.ok(body.tools.some(t=>t.function.name === selectedName));
            return { ok:true, json:async()=>({message:{tool_calls:[{function:{name:selectedName,arguments:{}}}]}}) };
        }
        return { ok:true, json:async()=>String(url).includes('list_skills')?[]:{embedding:Array(768).fill(0),embeddings:[Array(768).fill(0)],models:[]} };
    };
    try {
        const result = await ai.getAIResponse('consultá mi perfil actual', {model:'mock'}, null, null, {structuredActions:true});
        assert.equal(result.ok,true,JSON.stringify(result));
        assert.equal(result.data.actions[0].actionId,'profile.current');
        selectedName = 'jarvis_profile_test_confirmation';
        const pending = await ai.getAIResponse('activá la prueba de perfil', {model:'mock'}, null, null, {structuredActions:true});
        assert.equal(pending.status,'awaiting_confirmation');
        assert.ok(pending.confirmationToken);
        assert.equal(called,0);
        assert.equal((await kernel.confirm(pending.confirmationToken)).ok,true);
        assert.equal(called,1);
        const voicePending = await jarvis.process('Prueba de perfil');
        assert.equal(voicePending.status,'awaiting_confirmation');
        assert.equal(called,1);
        assert.equal((await jarvis.process('sí confirmo')).ok,true);
        assert.equal(called,2);
        await jarvis.process('Prueba de perfil');
        assert.equal((await jarvis.process('cancelar')).ok,true);
        assert.equal(called,2);
        assert.equal((await jarvis.resolve('leeme el portapapeles')).id,'clipboard.read');
        assert.equal((await jarvis.resolve('leeme la captura')).id,'vision.analyze-screen');
        const compound = await jarvis.resolve('creame una carpeta llamada Mis notas y adentro un txt llamado mi archivo que diga Hola mundo.');
        assert.equal(compound.params.folderName,'Mis notas');
        assert.equal(compound.params.fileName,'mi archivo.txt');
        assert.equal(compound.params.content,'Hola mundo.');
        console.log('PASS: intérprete LLM conectado al catálogo, confirmaciones y comandos compuestos.');
    } finally { global.fetch = original; }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
