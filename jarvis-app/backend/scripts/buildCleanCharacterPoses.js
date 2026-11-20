// Repaired artwork already contains complete anatomy; only small local motions are needed.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
module.exports=function(folder){
 const key=(t,x=0,y=0,r=0)=>[t,x,y,r,1];
 const definitions={
  working:{scale:.083,offset:[55,49],duration:1.4,parts:[
   {id:'leftHand',anchor:[540,770],clip:[[510,720],[609,716],[650,735],[688,780],[687,829],[608,829],[549,808],[510,808]],keys:[key(0),key(.35,0,-.45,-1),key(.7),key(1.05,0,-.45,-1),key(1.4)]},
   {id:'rightHand',anchor:[704,729],clip:[[674,674],[752,675],[775,707],[770,779],[709,796],[677,762]],keys:[key(0,0,-.35,1),key(.35),key(.7,0,-.35,1),key(1.05),key(1.4,0,-.35,1)]}
  ]},
  sit:{scale:.083,offset:[55,51],duration:4,parts:[
   {id:'rightFoot',anchor:[851,1298],clip:[[780,1273],[963,1273],[1074,1363],[1074,1463],[775,1463]],keys:[key(0,0,0,-1),key(2,0,0,1),key(4,0,0,-1)]}
  ]},
  exercise:{scale:.09,offset:[51.5,43],duration:2,parts:[
   {id:'leftForearm',anchor:[324,817],clip:[[90,624],[447,624],[447,812],[365,825],[354,875],[246,875],[220,833],[90,833]],cap:[460,550,75,75],keys:[key(0,0,0,-2),key(1,0,0,5),key(2,0,0,-2)]},
   {id:'rightForearm',anchor:[785,823],clip:[[733,624],[1010,624],[1010,840],[866,840],[845,880],[750,878],[727,830]],cap:[460,550,75,75],keys:[key(0,0,0,2),key(1,0,0,-5),key(2,0,0,2)]}
  ]}
 };
 const variants={};
 for(const [name,spec]of Object.entries(definitions)){
  const image=`jarvis-${name}-clean.png`,s=spec.scale,offset=spec.offset;
  const full=[[0,0],[1075,0],[1075,1464],[0,1464]],local=(p,a)=>p.map(v=>v.map((n,i)=>Math.round((n-a[i])*s*1000)/1000));
  const bones=[{id:'body',parent:null,x:offset[0],y:offset[1],z:1,shapes:[],texture:{rect:[0,0,1075*s,1464*s],clip:local(full,[0,0]),exclude:spec.parts.map(p=>local(p.clip,[0,0]))}}];
  const tracks={body:[key(0),key(spec.duration/2,0,-.35),key(spec.duration)]};
  for(const part of spec.parts){
   bones.push({id:part.id,parent:'body',x:part.anchor[0]*s,y:part.anchor[1]*s,z:2,shapes:[],texture:{rect:[-part.anchor[0]*s,-part.anchor[1]*s,1075*s,1464*s],clip:local(part.clip,part.anchor),exclude:[]},...(part.cap?{cap:{radius:1.65,source:part.cap}}:{})});
   tracks[part.id]=part.keys;
  }
  const data={version:2,width:200,height:210,fps:16,source:{image,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,image))).digest('hex'),scale:s,offset,width:1075,height:1464},shadow:[100,173,27,2],bones,animations:{[name]:{duration:spec.duration,tracks},idle:{duration:spec.duration,tracks}}};
  const file=`jarvis-${name}-clean.json`;fs.writeFileSync(path.join(folder,file),JSON.stringify(data));variants[name]=file;
 }
 return variants;
};
