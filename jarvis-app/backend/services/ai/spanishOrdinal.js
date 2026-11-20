// Compose Spanish ordinal place values instead of trusting a model's arithmetic.
const parts={primero:1,primer:1,segundo:2,tercero:3,tercer:3,cuarto:4,quinto:5,sexto:6,septimo:7,octavo:8,noveno:9,decimo:10,undecimo:11,duodecimo:12,vigesimo:20,trigesimo:30,cuadragesimo:40,quincuagesimo:50,sexagesimo:60,septuagesimo:70,octogesimo:80,nonagesimo:90,centesimo:100,ducentesimo:200,tricentesimo:300,cuadringentesimo:400,quingentesimo:500,sexcentesimo:600,septingentesimo:700,octingentesimo:800,noningentesimo:900,milesimo:1000,dosmilesimo:2000};
const keys=Object.keys(parts).sort((a,b)=>b.length-a.length);
function parseOrdinal(input){
 const text=String(input).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(/^\d+(?:ro|do|to|º|°|ª)?$/.test(text)){const n=parseInt(text);return n>=1&&n<=2000?n:null;}
 let rest=text.replace(/[\s-]+/g,'');let total=0,previous=Infinity;
 while(rest){
  const key=keys.find(k=>rest.startsWith(k));if(!key)return null;
  const value=parts[key];if(value>=previous)return null;
  total+=value;previous=10**Math.floor(Math.log10(value));rest=rest.slice(key.length);
 }
 return total>=1&&total<=2000?total:null;
}
function ordinalInRequest(text){
 const words=String(text).split(/\s+/);const found=[];
 for(let i=0;i<words.length;i++){
  let best=null,end=i;
  for(let j=i;j<Math.min(words.length,i+4);j++){
   const n=parseOrdinal(words.slice(i,j+1).join(' ').replace(/[,.!?;:]+$/,''));
   if(n!==null){best=n;end=j;}
  }
  if(best!==null){found.push(best);i=end;}
 }
 return found.length===1?found[0]:null;
}
module.exports={parseOrdinal,ordinalInRequest};
