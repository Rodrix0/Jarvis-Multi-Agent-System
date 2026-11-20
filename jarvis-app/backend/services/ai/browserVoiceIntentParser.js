const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function parse(text,{active=false,tv=false,platform=null}={}){
 const raw=String(text).trim();const clean=norm(raw).replace(/^(?:mira[, ]+)?(?:quiero\s+)?/,'');
 if(/\b(?:tele|television|tv)\b/.test(clean) || (tv&&!/\b(?:navegador|computadora|pc)\b/.test(clean)))return null;
 const result=params=>{
  if(params.command==='search'&&(params.site==='youtube'||(!params.site&&platform==='youtube'))){const channel=String(params.query||'').match(/^(?:el\s+|un\s+)?canal\s+(?:de\s+)?(.+)$/i);if(channel){params.query=channel[1].trim();params.resultType='channel';}}
  return {id:'browser.voice',params};
 };let m;
 if((m=raw.match(/^(?:entr[aá](?:r)?|ingres[aá](?:r)?|and[aá]|abr[ií](?:r|me)?|abre)\s+(?:a\s+)?(?:la\s+)?(?:p[aá]gina\s+de\s+)?(youtube|google|https?:\/\/\S+)(?:\s+y\s+busc[aá](?:me)?\s+(.+))?$/i))){
  return result({command:m[2]?'search':'open',site:m[1].toLowerCase()==='youtube'?'youtube':m[1].toLowerCase()==='google'?'google':m[1],query:m[2]});
 }
 if(/^(?:activa|abrir|abri|inicia)\s+(?:el\s+)?navegador\s+por\s+voz$/.test(clean))return result({command:'open',site:'google'});
 if((m=raw.match(/^busc[aá](?:me)?\s+(.+)$/i)) && !/\b(?:informaci[oó]n|datos|info|archivo|carpeta|documento|netflix|spotify|descarga)\b/i.test(m[1]) && !/\s+y\s+(?:hac|cre|guard|gener)/i.test(m[1])){
  return result({command:'search',query:m[1].replace(/\s+en\s+(?:youtube|google)$/i,''),site:/\ben\s+youtube$/i.test(m[1])?'youtube':/\ben\s+google$/i.test(m[1])?'google':undefined});
 }
 if((m=clean.match(/^(?:(?:entra|ingresa|abri|abre|elegi|selecciona|pone|poneme|reproduci)\s+)?(?:(?:a|al|en)\s+)?(?:el\s+)?(?:link\s+|video\s+|resultado\s+)?(primer|primero|segundo|tercero|cuarto|quinto|sexto|\d+(?:ro|do|to|º|°)?)(?:\s+(?:link|video|resultado))?$/))){const names={primer:1,primero:1,segundo:2,tercero:3,cuarto:4,quinto:5,sexto:6};return result({command:'select',index:names[m[1]]||parseInt(m[1])});}
 if(!active)return null;
 if(/^(?:segui\s+)?(?:baja|bajando|baja los videos|baja mas|mas abajo|desplazate hacia abajo)$/.test(clean))return result({command:'scroll',direction:'down'});
 if(/^(?:subi|sube|subiendo|mas arriba|subi los videos)$/.test(clean))return result({command:'scroll',direction:'up'});
 if(/^(?:volve|atras|volver|pagina anterior)$/.test(clean))return result({command:'back'});
 if(/^(?:que ves|que hay en pantalla|mostrame las opciones|lista los resultados)$/.test(clean))return result({command:'inspect'});
 if(/^(?:termina|sali|desactiva)\s+(?:la\s+)?navegacion(?:\s+por voz)?$/.test(clean))return result({command:'stop'});
 if((m=raw.match(/^(?:hac[eé]\s+clic\s+en|clic\s+en|entr[aá]\s+(?:a|en))\s+(.+)$/i)))return result({command:'click',label:m[1]});
 if(/^(?:ingresa|ingresar|entra)$/.test(clean))return result({command:'click',label:'Ingresar'});
 return null;
}
module.exports={parse};
