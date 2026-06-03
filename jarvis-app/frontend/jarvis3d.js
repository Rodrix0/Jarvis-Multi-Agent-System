class Jarvis3D {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.state = 'idle'; // idle, listening, speaking
        this.time = 0;

        // Scene setup
        this.scene = new THREE.Scene();
        
        // Camera setup
        this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.camera.position.z = 250; // Distance from the orb

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // Core Group (holds everything to rotate together)
        this.coreGroup = new THREE.Group();
        this.scene.add(this.coreGroup);

        this.colors = {
            idle: 0x00E5FF,
            listening: 0x00FFFF,
            speaking: 0xA855F7 // Purple
        };

        this.materials = [];
        this.buildJarvisCore();

        // Handle Resize
        window.addEventListener('resize', () => this.resize());

        // Start animation
        this.animate();
    }

    buildJarvisCore() {
        const baseColor = this.colors.idle;

        // 1. Inner Energy Core (Dense Point Cloud)
        const innerGeo = new THREE.SphereGeometry(25, 32, 32);
        const innerMat = new THREE.PointsMaterial({
            color: baseColor,
            size: 1.5,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.materials.push(innerMat);
        this.innerCore = new THREE.Points(innerGeo, innerMat);
        this.coreGroup.add(this.innerCore);

        // 2. Structured Wireframe Spheres (Holographic depth)
        this.wireframes = new THREE.Group();
        const sphereSizes = [45, 65, 85];
        sphereSizes.forEach((size, index) => {
            // Icosahedron for technical look
            const geo = new THREE.IcosahedronGeometry(size, 2);
            const mat = new THREE.LineBasicMaterial({
                color: baseColor,
                transparent: true,
                opacity: 0.15 - (index * 0.03), // Outer spheres are fainter
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            this.materials.push(mat);
            const wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(geo), mat);
            
            // Random initial rotation
            wireframe.rotation.set(Math.random(), Math.random(), Math.random());
            
            // Assign rotation speeds (very slow)
            wireframe.userData = {
                rx: (Math.random() - 0.5) * 0.002,
                ry: (Math.random() - 0.5) * 0.002,
                rz: (Math.random() - 0.5) * 0.002
            };
            this.wireframes.add(wireframe);
        });
        this.coreGroup.add(this.wireframes);

        // 3. Concentric Data Rings (Planetary style, not chaotic)
        this.outerRings = new THREE.Group();
        const numRings = 15;
        for (let i = 0; i < numRings; i++) {
            const radius = 90 + i * 8;
            // RingGeometry(innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength)
            const thetaLength = Math.PI * (0.5 + Math.random() * 1.5); // Partial rings
            const ringGeo = new THREE.RingGeometry(radius, radius + 1.5, 64, 1, Math.random() * Math.PI * 2, thetaLength);
            
            const ringMat = new THREE.MeshBasicMaterial({
                color: baseColor,
                transparent: true,
                opacity: 0.3 + Math.random() * 0.4,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            this.materials.push(ringMat);
            
            const ring = new THREE.Mesh(ringGeo, ringMat);
            
            // Orient them mostly flat (like planetary rings) but with slight tilts
            ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
            ring.rotation.y = (Math.random() - 0.5) * 0.4;
            
            // Slow rotation on the Z axis (which is the "flat" rotation after X rotation)
            ring.userData = {
                speedZ: (Math.random() > 0.5 ? 1 : -1) * (0.001 + Math.random() * 0.003)
            };

            this.outerRings.add(ring);
        }
        
        // Add a vertical set of rings
        for (let i = 0; i < 8; i++) {
            const radius = 100 + i * 10;
            const thetaLength = Math.PI * (0.8 + Math.random());
            const ringGeo = new THREE.RingGeometry(radius, radius + 1, 64, 1, Math.random() * Math.PI * 2, thetaLength);
            const ringMat = new THREE.MeshBasicMaterial({
                color: baseColor,
                transparent: true,
                opacity: 0.2,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            this.materials.push(ringMat);
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.2;
            ring.userData = { speedZ: (Math.random() - 0.5) * 0.005 };
            this.outerRings.add(ring);
        }

        this.coreGroup.add(this.outerRings);

        // 4. Floating Data Particles
        const partGeo = new THREE.BufferGeometry();
        const partCount = 500;
        const posArray = new Float32Array(partCount * 3);
        
        for(let i=0; i<partCount*3; i+=3) {
            const r = 20 + Math.random() * 110;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            
            posArray[i] = r * Math.sin(phi) * Math.cos(theta);
            posArray[i+1] = r * Math.sin(phi) * Math.sin(theta);
            posArray[i+2] = r * Math.cos(phi);
        }
        partGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        
        // Create a soft glowing texture for the particles
        const canvas = document.createElement('canvas');
        canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 16, 16);
        const particleTexture = new THREE.CanvasTexture(canvas);

        const partMat = new THREE.PointsMaterial({
            color: baseColor,
            size: 3.0,
            map: particleTexture,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.materials.push(partMat);
        this.particles = new THREE.Points(partGeo, partMat);
        this.coreGroup.add(this.particles);

        // 5. Center Glow Sprite (Optical Flare)
        const canvasGlow = document.createElement('canvas');
        canvasGlow.width = 128; canvasGlow.height = 128;
        const ctxGlow = canvasGlow.getContext('2d');
        const glowGrad = ctxGlow.createRadialGradient(64, 64, 0, 64, 64, 64);
        glowGrad.addColorStop(0, 'rgba(255,255,255,1)');
        glowGrad.addColorStop(0.1, 'rgba(0, 229, 255, 0.8)');
        glowGrad.addColorStop(0.4, 'rgba(0, 229, 255, 0.2)');
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctxGlow.fillStyle = glowGrad;
        ctxGlow.fillRect(0, 0, 128, 128);
        
        const glowTexture = new THREE.CanvasTexture(canvasGlow);
        const spriteMat = new THREE.SpriteMaterial({ 
            map: glowTexture, 
            color: 0xffffff, 
            transparent: true, 
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.glowSprite = new THREE.Sprite(spriteMat);
        this.glowSprite.scale.set(160, 160, 1);
        this.coreGroup.add(this.glowSprite);
    }

    resize() {
        if (!this.container) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    setState(newState) {
        this.state = newState;
        
        const targetColor = new THREE.Color(this.colors[this.state]);
        this.materials.forEach(mat => {
            mat.color.copy(targetColor);
        });
        
        if (this.state === 'speaking') {
            this.glowSprite.material.color.setHex(0xA855F7);
        } else {
            this.glowSprite.material.color.setHex(0xffffff);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.time += 0.01;

        let speedMult = 1;

        if (this.state === 'listening') {
            speedMult = 2;
        } else if (this.state === 'speaking') {
            speedMult = 1.5;
        }

        // Slow rotation of inner core
        this.innerCore.rotation.y += 0.002 * speedMult;
        this.innerCore.rotation.x += 0.001 * speedMult;

        // Rotate wireframe spheres individually
        this.wireframes.children.forEach(wf => {
            wf.rotation.x += wf.userData.rx * speedMult;
            wf.rotation.y += wf.userData.ry * speedMult;
            wf.rotation.z += wf.userData.rz * speedMult;
        });

        // Rotate particle field
        this.particles.rotation.y += 0.001 * speedMult;
        this.particles.rotation.z += 0.0005 * speedMult;

        // Rotate outer rings slowly
        this.outerRings.children.forEach(ring => {
            ring.rotation.z += ring.userData.speedZ * speedMult;
        });

        // Constant scale and glow
        this.coreGroup.scale.set(1, 1, 1);
        this.glowSprite.scale.set(160, 160, 1);

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }
}

// Global instance
let neuralVisualizer;
window.addEventListener('load', () => {
    // Small delay to ensure container has dimensions
    setTimeout(() => {
        neuralVisualizer = new Jarvis3D('visualizer-container');
    }, 100);
});
