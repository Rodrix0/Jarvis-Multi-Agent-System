// Rig the supplied photograph itself: no redrawing, recoloring or replacement character.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const folder=path.resolve(__dirname,'../../frontend/assets'),scale=.1,offset=[46,25];
const masks={
 leftHand:[[153,622],[328,622],[332,777],[153,793]],
 axe:[[0,0],[1074,0],[1074,323],[760,323],[760,350],[660,350],[660,323],[450,323],[440,550],[365,610],[330,670],[150,670],[150,860],[70,860],[70,540],[285,540],[340,470],[340,445],[200,445],[200,323],[0,323]],
 mouth:[[512,602],[643,602],[643,654],[512,654]],
 head:[[469,321],[708,321],[708,375],[735,399],[735,477],[692,493],[692,515],[670,531],[670,560],[690,575],[690,665],[650,700],[480,700],[480,687],[420,687],[420,574],[398,558],[398,527],[376,511],[376,492],[352,478],[352,426],[375,410],[375,384],[396,368],[420,348],[420,331],[469,331]],
 rightHand:[[790,463],[982,463],[982,729],[790,729]],
 leftForearm:[[145,771],[333,761],[354,859],[310,924],[176,924],[145,869]],
 rightForearm:[[778,716],[977,716],[977,912],[783,912],[767,859]],
 leftArm:[[335,659],[413,679],[413,804],[335,895],[256,895],[271,794],[304,712]],
 rightArm:[[674,677],[756,689],[811,739],[870,787],[870,896],[777,912],[716,857],[674,784]],
 leftFoot:[[269,1334],[511,1334],[511,1464],[269,1464]],
 rightFoot:[[607,1344],[818,1344],[818,1464],[607,1464]],
 leftShin:[[328,1215],[517,1215],[517,1381],[328,1381]],
 rightShin:[[558,1215],[756,1215],[756,1398],[558,1398]],
 leftThigh:[[297,973],[548,973],[548,1160],[500,1267],[316,1267],[287,1163]],
 rightThigh:[[548,973],[725,973],[763,1100],[753,1267],[558,1267],[538,1160]]
};
const locations={body:[540,960],head:[545,680],mouth:[575,630],leftArm:[378,720],leftForearm:[275,845],leftHand:[235,735],axe:[235,735],rightArm:[700,730],rightForearm:[823,839],rightHand:[839,701],leftThigh:[440,997],leftShin:[425,1225],leftFoot:[425,1360],rightThigh:[615,997],rightShin:[650,1225],rightFoot:[685,1370]};
const parents={head:'body',mouth:'head',leftArm:'body',leftForearm:'leftArm',leftHand:'leftForearm',axe:'leftHand',rightArm:'body',rightForearm:'rightArm',rightHand:'rightForearm',leftThigh:'body',leftShin:'leftThigh',leftFoot:'leftShin',rightThigh:'body',rightShin:'rightThigh',rightFoot:'rightShin'};
const order=['body','leftThigh','leftShin','leftFoot','rightThigh','rightShin','rightFoot','head','mouth','leftArm','leftForearm','leftHand','axe','rightArm','rightForearm','rightHand'],priorities=['leftHand','mouth','head','axe',...Object.keys(masks).filter(id=>!['leftHand','mouth','head','axe'].includes(id))];
const round=n=>Math.round(n*100)/100;
const local=(poly,anchor)=>poly.map(p=>p.map((v,i)=>round((v-anchor[i])*scale)));
const full=[[0,0],[1074,0],[1074,1464],[0,1464]];
const bones=order.map((id,index)=>{
 const anchor=locations[id],parent=parents[id],base=parent?locations[parent]:[0,0];
 const rank=priorities.indexOf(id),excluded=id==='body'?priorities:priorities.slice(0,rank);
 const z={body:20,head:30,mouth:31,axe:5,leftArm:40,leftForearm:41,leftHand:42,rightArm:40,rightForearm:41,rightHand:42}[id]??(10+index*.1);
 return {id,parent:parent||null,x:round((anchor[0]-base[0])*scale+(parent?0:offset[0])),y:round((anchor[1]-base[1])*scale+(parent?0:offset[1])),z,shapes:[],
 texture:{rect:[-anchor[0]*scale,-anchor[1]*scale,107.4,146.4],clip:local(masks[id]||full,anchor),exclude:excluded.map(name=>local(masks[name],anchor))}};
});
// Small overlapping joint caps sample the same photograph, only in bent poses.
for(const id of ['leftArm','rightArm','leftForearm','rightForearm','leftThigh','rightThigh','leftShin','rightShin']) {
 const leg=id.includes('Thigh')||id.includes('Shin');
 bones.find(b=>b.id===id).cap={radius:id.includes('Thigh')?5:id.includes('Arm')?3.3:3.6,source:leg?[360,1030,85,85]:[470,747,85,85]};
}
const originalAxe=bones.find(b=>b.id==='axe');
// Work/rest/exercise use dedicated repaired artwork, with no parked axe fragments.
const rect=(c,x,y,w,h)=>({c,p:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});
const prop=(id,parent,x,y,z,shapes,when)=>bones.push({id,parent,x,y,z,shapes,when});
prop('chair',null,0,0,1,[rect('#322c29',77,124,38,72),rect('#8a5c3c',80,127,7,66),rect('#ac7950',80,127,5,24),rect('#8a5c3c',80,166,38,6),rect('#4e3829',109,170,6,27)],['working','sit']);
prop('desk',null,0,0,45,[rect('#252e30',70,159,90,8),rect('#947658',72,160,86,4),rect('#c8a272',73,160,83,1),rect('#273336',76,167,6,30),rect('#273336',150,167,6,30),rect('#77888a',98,157,40,2)],['working']);
prop('laptop',null,0,0,50,[{c:'#1f2f35',p:[[125,133],[156,133],[150,160],[120,160]]},{c:'#8eaaaa',p:[[128,136],[153,136],[148,157],[124,157]]},rect('#203831',131,140,13,11),rect('#9bc0a6',133,143,9,1),rect('#9bc0a6',133,146,6,1)],['working']);
for(const side of ['left','right'])prop(side+'Weight',side+'Hand',0,0,60,[rect('#30404b',-9,-1,18,2),rect('#19242b',-11,-5,5,10),rect('#758895',-10,-4,2,7),rect('#19242b',6,-5,5,10),rect('#758895',7,-4,2,7)],['exercise']);
prop('questionMark',null,143,74,60,[rect('#59bde5',-3,-7,6,2),rect('#59bde5',2,-5,2,4),rect('#59bde5',-1,-1,4,2),rect('#59bde5',-1,1,2,2),rect('#f0d387',-1,6,2,2)],['question']);
const k=(t,x=0,y=0,r=0,sy=1)=>[t,x,y,r,sy],r=angle=>[k(0,0,0,angle)];
const animations={
 idle:{duration:4,tracks:{body:[k(0),k(2,0,-.7),k(4)],head:[k(0),k(2,0,0,1),k(4)]}},
 wave:{duration:2,tracks:{body:[k(0),k(1,0,-.7),k(2)],head:[k(0,0,0,-1),k(1,0,0,1),k(2,0,0,-1)],rightForearm:[k(0,0,0,-5),k(.5,0,0,10),k(1,0,0,-5),k(1.5,0,0,10),k(2,0,0,-5)]}},
 walk:{duration:1.6,tracks:{body:[k(0,-4),k(.4,0,-1),k(.8,4),k(1.2,0,-1),k(1.6,-4)],leftThigh:[k(0,0,0,8),k(.8,0,0,-8),k(1.6,0,0,8)],rightThigh:[k(0,0,0,-8),k(.8,0,0,8),k(1.6,0,0,-8)],leftShin:[k(0),k(.8,0,0,9),k(1.6)],rightShin:[k(0,0,0,9),k(.8),k(1.6,0,0,9)],rightArm:[k(0,0,0,3),k(.8,0,0,-3),k(1.6,0,0,3)]}},
 working:{duration:1.4,tracks:{body:[k(0,0,9)],head:[k(0,0,0,3),k(.7,0,.3,4),k(1.4,0,0,3)],leftArm:r(-25),leftForearm:[k(0,0,0,165),k(.35,0,0,158),k(.7,0,0,165),k(1.05,0,0,158),k(1.4,0,0,165)],leftHand:r(-10),rightArm:r(5),rightForearm:[k(0,0,0,160),k(.35,0,0,166),k(.7,0,0,160),k(1.05,0,0,166),k(1.4,0,0,160)],leftThigh:r(-55),rightThigh:r(-48),leftShin:r(55),rightShin:r(48)}},
 sit:{duration:4,tracks:{body:[k(0,-3,10,-4),k(2,-3,9.4,-4),k(4,-3,10,-4)],head:r(3),leftThigh:r(-48),rightThigh:r(-55),leftShin:r(48),rightShin:r(55),leftArm:r(-20),leftForearm:r(140),rightArm:r(15),rightForearm:r(80)}},
 exercise:{duration:2,tracks:{body:[k(0),k(1,0,-.5),k(2)],leftForearm:[k(0,0,0,75),k(1,0,0,5),k(2,0,0,75)],rightForearm:[k(0,0,0,-75),k(1,0,0,-5),k(2,0,0,-75)]}},
 celebrate:{duration:1.8,tracks:{body:[k(0),k(.3,0,1),k(.7,0,-4),k(1),k(1.3,0,-2),k(1.8)],leftArm:[k(0),k(.7,0,0,12),k(1.8)],rightArm:[k(0),k(.7,0,0,-12),k(1.8)],head:[k(0),k(.7,0,0,-2),k(1.8)]}},
 question:{duration:3,tracks:{head:[k(0,0,0,-3),k(1.5,0,0,2),k(3,0,0,-3)],rightForearm:[k(0,0,0,-12),k(1.5,0,0,-5),k(3,0,0,-12)]}},
 listening:{duration:3,tracks:{head:[k(0,0,0,2),k(1.5,0,0,4),k(3,0,0,2)],rightForearm:r(-15)}},
 speaking:{duration:1.6,tracks:{head:[k(0,0,0,-1),k(.8,0,.3,1),k(1.6,0,0,-1)],rightForearm:[k(0,0,0,4),k(.8,0,0,-5),k(1.6,0,0,4)],body:[k(0),k(.8,0,-.4),k(1.6)]}}
};
const data={version:2,width:200,height:210,fps:20,source:{image:'jarvis-companion.png',sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,'jarvis-companion.png'))).digest('hex'),scale,offset,width:1074,height:1464},shadow:[100,173,29,2],bones,animations};
data.poseVariants=require('./buildCleanCharacterPoses')(folder);
animations.speaking.tracks.mouth=[k(0,0,0,0,.96),k(.2,0,0,0,1.1),k(.4,0,0,0,.96),k(.6,0,0,0,1.08),k(.8,0,0,0,.96),k(1,0,0,0,1.1),k(1.6,0,0,0,.96)];
bones.find(b=>b.id==='axe').when=['idle','wave','walk','listening','speaking','celebrate','question'];
fs.writeFileSync(path.join(folder,'jarvis-rig.json'),JSON.stringify(data));
console.log('Original-image rig built; source photograph unchanged.');
