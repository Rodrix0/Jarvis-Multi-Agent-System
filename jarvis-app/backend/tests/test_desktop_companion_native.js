// Integration test: uses synthetic states, never sends an action to Jarvis.
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
 let polls=0;
 const server=http.createServer((req,res)=>{
  assert.equal(req.headers['x-jarvis-companion'],'native-test');
  const state=polls<3?'working':polls<6?'completed':'waiting';
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({enabled:polls<9,visible:true,animations:polls<3||polls>=6,speaking:polls>=6,state,revision:Math.floor(polls/3),at:Date.now(),title:'Prueba de animación',text:'Prueba local: '+state})); polls++;
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const child=spawn('powershell.exe',['-NoProfile','-STA','-File',path.resolve(__dirname,'../scripts/desktopCompanion.ps1'),'-Port',String(server.address().port),'-Token','native-test'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 let error=''; child.stderr.on('data',d=>error+=d);
 const timeout=setTimeout(()=>child.kill(),20000);
 try {
  const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
  assert.equal(code,0,error);assert.ok(polls>=10,'native dispatcher polls and closes on disable');
  console.log('PASS: native WPF dispatcher, authenticated polling, work/completion/question states, clean shutdown.');
 } finally {clearTimeout(timeout);server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
