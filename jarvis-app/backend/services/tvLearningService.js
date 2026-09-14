const fs=require('fs');const path=require('path');
const file=path.join(__dirname,'../data/tv_learning.json');
const buttons=['home','youtube','netflix','up','down','left','right','ok','back'];
let activeApp='netflix';
function get(){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return {};}}
function validateSteps(steps){
 if(!Array.isArray(steps)||steps.length>200)throw new Error('La secuencia debe tener hasta 200 pasos.');
 return steps.map(s=>{if(s.button && !buttons.includes(s.button))throw new Error('Botón no permitido en secuencia.');const waitMs=Number(s.waitMs);if(!Number.isFinite(waitMs)||waitMs<100||waitMs>60000)throw new Error('La espera debe ser de 100 a 60000 ms.');return {button:s.button||null,waitMs};});
}
function save(app, value){
 if(!['youtube','netflix'].includes(app))throw new Error('Aplicación no permitida.');
 const config={open:validateSteps(value.open||[]),search:validateSteps(value.search||[]),submit:validateSteps(value.submit||[]),rows:String(value.rows||'').toLowerCase(),start:String(value.start||'a').toLowerCase(),keyDelayMs:Math.max(300,Math.min(2000,Number(value.keyDelayMs)||800))};
 if(config.rows.length>150)throw new Error('El teclado es demasiado grande.');
 const saved=get();saved[app]=config;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(saved,null,2));return saved;
}
function typing(text,config){
 const rows=config.rows.split(/\r?\n/).filter(Boolean).map(r=>r.replace(/_/g,' '));
 const locate=c=>{for(let r=0;r<rows.length;r++){let col=rows[r].indexOf(c);if(col>=0)return {r,col};}return null;};
 let cursor=locate(config.start==='_'?' ':config.start);
 if(!cursor)throw new Error('Configurá el teclado y la tecla inicial en Aprendizaje TV.');
 const normalized=String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 if(!normalized.trim()||normalized.length>120)throw new Error('Indicá un título de entre 1 y 120 caracteres.');
 const steps=[];const add=b=>steps.push({button:b,waitMs:config.keyDelayMs});
 for(const char of normalized){const target=locate(char);if(!target)throw new Error(`El teclado aprendido no incluye «${char===' '?'espacio':char}». Agregalo antes de escribir.`);
  // Move horizontally first only when the destination column exists in this row.
  if(target.col<cursor.col){for(let n=cursor.col;n>target.col;n--)add('left');cursor.col=target.col;}
  const direction=target.r>cursor.r?'down':'up';for(let r=cursor.r;r!==target.r;r+=target.r>cursor.r?1:-1){if(rows[r+(direction==='down'?1:-1)].length<=cursor.col)throw new Error('El teclado tiene filas incompatibles con esta ruta. Ajustá su distribución.');add(direction);}
  for(let n=cursor.col;n<target.col;n++)add('right');add('ok');cursor={...target};
 }
 return steps;
}
async function execute({app='youtube',title='',open=true,writeOnly=false,powerOn=false},progress){
 const config=get()[app];if(!config)throw new Error(`Primero enseñame ${app} desde la pestaña Aprendizaje TV.`);
 if(open && !config.open.length)throw new Error('Falta enseñar la apertura desde Home.');
 if(title && !writeOnly && !config.search.length)throw new Error('Falta enseñar la entrada al buscador con el campo vacío.');
 const tv=require('./tvService');
 const steps=[...(powerOn?[{button:'power',waitMs:tv.getPublicStatus().netflix.bootWaitMs}]:[]),...(open?config.open:[]),...(title?[...(!writeOnly?config.search:[]),...typing(title,config),...(!writeOnly?config.submit:[])]:[])];
 const known=tv.getPublicStatus().learnedButtons;
 const missing=[...new Set(steps.filter(s=>s.button&&!known.includes(s.button)).map(s=>s.button))];
 if(missing.length)throw new Error('Primero aprendé estas teclas del control: '+missing.join(', '));
 const result=await require('./tvService').runProgram(steps,progress);
 activeApp=app;
 return result;
}
module.exports={get,save,typing,execute,getActiveApp:()=>activeApp,setActiveApp:app=>{activeApp=app;}};
