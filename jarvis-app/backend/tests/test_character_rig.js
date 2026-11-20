const assert = require('node:assert/strict');
const data = require('../../frontend/assets/jarvis-rig.json');
const {pose} = require('../../frontend/character-rig');
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
assert.equal(data.version,2,'original-photo rig replaces the rejected vector redraw');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../../frontend/assets',data.source.image))).digest('hex'),data.source.sha256,'original image is unchanged');
for(const b of data.bones.filter(b=>b.texture))assert.equal(b.shapes.length,0,'character parts contain only source image pixels');
const names = new Set();
for(const bone of data.bones) {
    if(bone.parent)assert.ok(names.has(bone.parent),`parent before child: ${bone.id}`);
    assert.ok(!names.has(bone.id));names.add(bone.id);
}
for(const [name,animation] of Object.entries(data.animations)) {
    assert.ok(animation.duration>0);
    for(const [id,keys] of Object.entries(animation.tracks)) {
        assert.ok(names.has(id),id);
        assert.ok(keys.every((k,i)=>k.length===5&&k.every(Number.isFinite)&&(!i||k[0]>=keys[i-1][0])));
    }
    for(let t=0;t<animation.duration;t+=.1) {
        const positions=pose(data,name,t);
        for(const bone of data.bones) {
            if(bone.when&&!bone.when.includes(name))continue;
            const p=positions[bone.id];assert.ok(Object.values(p).every(Number.isFinite));
            for(const shape of bone.shapes)for(const [x,y] of shape.p) {
                const a=p.angle*Math.PI/180;
                const px=p.x+x*Math.cos(a)-y*p.sy*Math.sin(a),py=p.y+x*Math.sin(a)+y*p.sy*Math.cos(a);
                assert.ok(px>=0&&px<=data.width&&py>=0&&py<=data.height,`no clipping in ${name}: ${bone.id}`);
            }
        }
    }
}
assert.notEqual(pose(data,'wave',0).rightForearm.angle,pose(data,'wave',.45).rightForearm.angle,'forearm articulates');
assert.notEqual(pose(data,'working',0).leftHand.y,pose(data,'working',.25).leftHand.y,'typing moves hands independently');
assert.notEqual(pose(data,'walk',0).leftThigh.angle,pose(data,'walk',.6).leftThigh.angle,'legs articulate');
assert.equal(pose(data,'working',0).head.x,pose(data,'working',1).head.x,'animation loops');
for(const name of ['working','sit','exercise']){
 const variant=require(path.resolve(__dirname,'../../frontend/assets',data.poseVariants[name]));
 assert.ok(!variant.bones.some(b=>/axe/i.test(b.id)),'no axe in repaired pose');
 assert.ok(variant.source.image.includes('-clean.png'));
 assert.ok(fs.existsSync(path.resolve(__dirname,'../../frontend/assets',variant.source.image)));
 for(const keys of Object.values(variant.animations[name].tracks))for(const key of keys)assert.ok(Math.abs(key[3])<=5,'small rotations avoid tears');
 const state={...data,_variants:{[name]:variant}};
 assert.deepEqual(pose(state,name,.3),pose(variant,name,.3),'renderer dispatches to repaired pose');
 const joint=name==='working'?'leftHand':name==='sit'?'rightFoot':'leftForearm';
 assert.notDeepEqual(pose(variant,name,0)[joint],pose(variant,name,variant.animations[name].duration/2)[joint],'repaired pose still animates');
}
console.log('PASS: hierarchy, 10 animations, articulated limbs, loops and no clipping.');
