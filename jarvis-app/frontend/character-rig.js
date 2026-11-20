(function(root) {
    'use strict';
    function sample(keys, t) {
        if (!keys || !keys.length) return [0,0,0,0,1];
        let a=keys[0], b=a;
        for (const key of keys) { if (key[0]<=t) a=key; if(key[0]>=t){b=key;break;} b=key; }
        const u=b[0]===a[0]?0:Math.max(0,Math.min(1,(t-a[0])/(b[0]-a[0])));
        const eased=u*u*(3-2*u);
        return a.map((value,i)=>i===0?t:value+(b[i]-value)*eased);
    }
    function pose(data, name, seconds) {
        if(data._variants?.[name])return pose(data._variants[name],name,seconds);
        const animation=data.animations[name]||data.animations.idle;
        const t=((seconds%animation.duration)+animation.duration)%animation.duration;
        const result={};
        for(const bone of data.bones) {
            const k=sample(animation.tracks[bone.id],t), parent=result[bone.parent];
            const angle=parent?parent.angle:0, radians=angle*Math.PI/180;
            const x=bone.x+k[1], y=bone.y+k[2];
            result[bone.id]={x:(parent?parent.x:0)+x*Math.cos(radians)-y*Math.sin(radians),
                y:(parent?parent.y:0)+x*Math.sin(radians)+y*Math.cos(radians),angle:angle+k[3],sy:k[4]};
        }
        return result;
    }
    function draw(ctx,data,name,seconds) {
        if(data._variants?.[name]){draw(ctx,data._variants[name],name,seconds);return;}
        const positions=pose(data,name,seconds);
        ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
        ctx.save(); ctx.scale(ctx.canvas.width/data.width,ctx.canvas.height/data.height);
        const shadow=data.shadow||[64,139,25,2];
        ctx.fillStyle='#101c2440';ctx.beginPath();ctx.ellipse(...shadow,0,0,Math.PI*2);ctx.fill();
        for(const bone of [...data.bones].sort((a,b)=>a.z-b.z)) {
            if(bone.when&&!bone.when.includes(name)) continue;
            const p=positions[bone.id];ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle*Math.PI/180);ctx.scale(1,p.sy);
            if(bone.cap&&data._image&&Math.abs(sample((data.animations[name]||data.animations.idle).tracks[bone.id],seconds%(data.animations[name]||data.animations.idle).duration)[3])>2) {
                const r=bone.cap.radius;ctx.fillStyle='#1a191b';ctx.beginPath();ctx.ellipse(0,0,r+.25,r+.25,0,0,Math.PI*2);ctx.fill();
                ctx.save();ctx.beginPath();ctx.ellipse(0,0,r,r,0,0,Math.PI*2);ctx.clip();ctx.drawImage(data._image,...bone.cap.source,-r,-r,2*r,2*r);ctx.restore();
            }
            if(bone.texture&&data._image) {
                const trace=polygon=>{polygon.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();};
                ctx.save();ctx.beginPath();trace(bone.texture.clip);ctx.clip();
                for(const mask of bone.texture.exclude){ctx.beginPath();ctx.rect(-1000,-1000,2000,2000);trace(mask);ctx.clip('evenodd');}
                ctx.drawImage(data._image,...bone.texture.rect);ctx.restore();
            }
            for(const shape of bone.shapes) {
                ctx.fillStyle=shape.c;ctx.beginPath();shape.p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();
            }
            ctx.restore();
        }
        ctx.restore();
    }
    if(typeof module==='object'&&module.exports) module.exports={sample,pose,draw};
    if(!root.document) return;
    const instances=new WeakMap(); let dataPromise, motionOverride=null;
    root.addEventListener('jarvis-companion-motion',event=>{if(typeof event.detail?.enabled==='boolean'||event.detail?.enabled===null)motionOverride=event.detail.enabled;});
    async function loadData(file){
        const response=await fetch('assets/'+file+'?v=clean-poses-1');if(!response.ok)throw new Error('Rig no disponible');
        const data=await response.json();
        if(data.source)data._image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('No se pudo cargar el personaje'));img.src='assets/'+data.source.image;});
        if(data.poseVariants){data._variants={};await Promise.all(Object.entries(data.poseVariants).map(async([name,path])=>{data._variants[name]=await loadData(path);}));}
        return data;
    }
    const load=()=>dataPromise||(dataPromise=loadData('jarvis-rig.json').catch(error=>{dataPromise=null;throw error;}));
    class Character {
        constructor(host,data) {
            this.host=host;this.data=data;this.state=host.dataset.state||'idle';this.mode='idle';this.started=performance.now();
            this.visible=false;this.timer=null;this.frame=null;
            this.canvas=document.createElement('canvas');this.canvas.className='jarvis-avatar jarvis-rig';this.canvas.width=data.width*2;this.canvas.height=data.height*2;
            this.canvas.setAttribute('role','img');this.canvas.setAttribute('aria-label','Jarvis, personaje articulado de pelo rojizo y ropa verde');
            const image=host.querySelector('img.jarvis-avatar');if(image)image.replaceWith(this.canvas);else host.append(this.canvas);
            this.ctx=this.canvas.getContext('2d');
            this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
            this.onVisibility=()=>this.schedule();document.addEventListener('visibilitychange',this.onVisibility);
            this.onMotion=()=>{this.render();this.schedule();};this.reduced.addEventListener('change',this.onMotion);
            this.onPreference=event=>{motionOverride=event.detail.enabled;this.render();this.schedule();};root.addEventListener('jarvis-companion-motion',this.onPreference);
            this.attributes=new MutationObserver(()=>this.setState(host.dataset.state||'idle'));this.attributes.observe(host,{attributes:true,attributeFilter:['data-state']});
            this.observer=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;this.schedule();});this.observer.observe(host);
            this.setState(this.state);this.render();
        }
        setState(state) {
            if(this.state!==state)this.started=performance.now();
            this.state=state;this.manual=null;
            this.render();this.schedule();
        }
        setAnimation(name) {
            if(!this.data.animations[name])return;
            this.manual=name;this.started=performance.now();this.render();this.schedule();
        }
        animation(seconds) {
            if(this.manual)return this.manual;
            const modes={working:'working',speaking:'speaking',listening:'listening',waiting:'question',failed:'question',dormant:'sit',completed:'celebrate',notice:'wave'};
            if(modes[this.state])return modes[this.state];
            return ['idle','wave','walk','sit','exercise'][Math.floor(seconds/12)%5];
        }
        render() {
            const seconds=(performance.now()-this.started)/1000;
            this.mode=this.animation(seconds);draw(this.ctx,this.data,this.mode,this.motionAllowed()?seconds:0);
        }
        motionAllowed(){return motionOverride===null?!this.reduced.matches:motionOverride;}
        schedule() {
            clearTimeout(this.timer);cancelAnimationFrame(this.frame);this.timer=null;this.frame=null;
            if(!this.host.isConnected){this.destroy();return;}
            if(document.hidden||!this.visible||!this.motionAllowed()){this.render();return;}
            const fps=this.data._variants?.[this.mode]?.fps||this.data.fps;
            this.timer=setTimeout(()=>{this.frame=requestAnimationFrame(()=>{this.render();this.schedule();});},1000/fps);
        }
        destroy() {
            clearTimeout(this.timer);cancelAnimationFrame(this.frame);this.attributes.disconnect();this.observer.disconnect();
            document.removeEventListener('visibilitychange',this.onVisibility);this.reduced.removeEventListener('change',this.onMotion);instances.delete(this.host);
            root.removeEventListener('jarvis-companion-motion',this.onPreference);
        }
    }
    root.JarvisRig={pose,draw,async mount(host){if(!host)return null;if(instances.has(host))return instances.get(host);try{const data=await load();if(instances.has(host))return instances.get(host);const instance=new Character(host,data);instances.set(host,instance);return instance;}catch(error){console.warn('[Personaje]',error.message);return null;}}};
})(typeof window==='undefined'?globalThis:window);
