const assert=require('assert/strict');const fs=require('fs');const path=require('path');
const learning=require('../services/tvLearningService');const tv=require('../services/tvService');const voice=require('../services/tvVoiceService');const jarvis=require('../services/jarvisActionService');
async function main(){
 const cfg={open:[{button:'home',waitMs:1000},{button:'youtube',waitMs:3000}],search:[{button:'left',waitMs:500}],submit:[],rows:'abcdef\nghijkl\nmnopqr\nstuvwx\nyz0123\n456789\n_',start:'a',keyDelayMs:800};
 learning.save('youtube',cfg);
 const steps=learning.typing('The Walking Dead',cfg);assert.equal(steps.filter(s=>s.button==='ok').length,16);
 assert.throws(()=>learning.typing('a!',cfg),/no incluye/);
 assert.throws(()=>learning.save('youtube',{...cfg,open:[{button:'power',waitMs:800}]}),/no permitido/);
 assert.ok(tv.buildNetflixSearchSequence('abcdefghijklmnop',false).filter(b=>b==='ok').length>=16);
 const old=tv.runProgram;const oldStatus=tv.getPublicStatus;let sent=[];tv.runProgram=async s=>{sent=s;return {ok:true};};
 tv.getPublicStatus=()=>({learnedButtons:['home','youtube','left','right','up','down','ok'],netflix:{bootWaitMs:1000}});
 try{await learning.execute({app:'youtube',title:'abc'});assert.equal(sent[0].button,'home');assert.equal(sent.filter(s=>s.button==='ok').length,3);}finally{tv.runProgram=old;tv.getPublicStatus=oldStatus;}
 voice.activateSession();
 assert.equal((await jarvis.resolve('Abrí YouTube en la tele')).id,'tv.learned-app');
 assert.equal((await jarvis.resolve('Buscá música en YouTube en la tele')).params.title,'música');
 assert.equal((await jarvis.resolve('Escribí The Walking Dead')).params.title,'The Walking Dead');
 assert.equal((await jarvis.resolve('Buscá videos de gatos')).id,'tv.learned-app');
 assert.equal((await jarvis.resolve('Prendé la tele')).id,'tv.power-signal');
 assert.equal(voice.parseTvIntent('Abrí Netflix en la tele').powerOn,false);
 voice.deactivateSession();
 assert.equal((await jarvis.resolve('Abrí YouTube en el navegador')).id,'system.open');
 const source=fs.readFileSync(path.join(__dirname,'../services/tvService.js'),'utf8');assert.ok(!source.includes("if (button === 'home') normalizedBtn = 'power'"));
 console.log('PASS: teclado completo, espacios, secuencias, encendido explícito y destinos de voz.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
