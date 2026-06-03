class JarvisHologram {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.state = 'idle'; // idle, listening, speaking
        this.time = 0;
        
        // Colores base (Azul JARVIS)
        this.colors = {
            idle: { core: 'rgba(0, 229, 255, 0.1)', ring: 'rgba(0, 180, 255, 0.5)', glow: '#00E5FF' },
            listening: { core: 'rgba(0, 255, 255, 0.2)', ring: 'rgba(0, 255, 255, 0.8)', glow: '#00FFFF' },
            speaking: { core: 'rgba(124, 58, 237, 0.2)', ring: 'rgba(140, 80, 255, 0.8)', glow: '#A855F7' }
        };

        // Generar una estructura muy densa de arcos concéntricos
        this.arcs = [];
        const numArcs = 80;
        for (let i = 0; i < numArcs; i++) {
            this.arcs.push({
                radius: 40 + Math.random() * 100, // Radio contenido (max 140)
                startAngle: Math.random() * Math.PI * 2,
                endAngle: Math.random() * Math.PI * 2,
                width: Math.random() * 3 + 0.5,
                speed: (Math.random() - 0.5) * 0.005, // MUY lento
                opacity: Math.random() * 0.5 + 0.1,
                dash: Math.random() > 0.5 ? [Math.random() * 20 + 5, Math.random() * 10 + 5] : []
            });
        }

        // Rayos interiores (Spokes)
        this.spokes = [];
        for (let i = 0; i < 30; i++) {
            this.spokes.push({
                angle: Math.random() * Math.PI * 2,
                length: 20 + Math.random() * 100,
                speed: (Math.random() - 0.5) * 0.002,
                opacity: Math.random() * 0.3
            });
        }

        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.animate();
    }

    resize() {
        const parent = this.canvas.parentElement;
        this.width = parent.clientWidth || 400;
        this.height = parent.clientHeight || 400;
        
        this.canvas.width = this.width * window.devicePixelRatio;
        this.canvas.height = this.height * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    setState(newState) {
        this.state = newState;
    }

    animate() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        const cx = this.width / 2;
        const cy = this.height / 2 - 20; // Un poco más arriba para no pisar el texto
        this.time += 1;

        let speedMult = 1;
        let pulse = 0;
        
        if (this.state === 'listening') {
            speedMult = 2.0;
            pulse = Math.sin(this.time * 0.05) * 5;
        } else if (this.state === 'speaking') {
            speedMult = 1.5;
            // Palpita fuertemente al hablar
            pulse = Math.sin(this.time * 0.15) * 15;
        }

        const color = this.colors[this.state];

        this.ctx.save();
        this.ctx.translate(cx, cy);
        
        // Efecto de fusión de luz para que parezca un holograma denso
        this.ctx.globalCompositeOperation = 'lighter';

        // 1. NÚCLEO CENTRAL (GLOW INTENSO)
        const coreGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 60 + pulse);
        coreGradient.addColorStop(0, color.glow);
        coreGradient.addColorStop(0.2, color.core);
        coreGradient.addColorStop(1, 'transparent');
        
        this.ctx.fillStyle = coreGradient;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 100 + pulse, 0, Math.PI * 2);
        this.ctx.fill();

        // 2. DIBUJAR RAYOS (SPOKES)
        this.ctx.lineWidth = 1;
        this.spokes.forEach(spoke => {
            spoke.angle += spoke.speed * speedMult;
            this.ctx.strokeStyle = color.glow;
            this.ctx.globalAlpha = spoke.opacity;
            this.ctx.beginPath();
            this.ctx.moveTo(Math.cos(spoke.angle) * 20, Math.sin(spoke.angle) * 20);
            this.ctx.lineTo(Math.cos(spoke.angle) * (spoke.length + pulse), Math.sin(spoke.angle) * (spoke.length + pulse));
            this.ctx.stroke();
        });

        // 3. DIBUJAR ARCOS DENSOS (ESTRUCTURA PRINCIPAL)
        // Aplicamos una ligera compresión en Y para dar falso 3D
        this.ctx.scale(1, 0.85);

        this.arcs.forEach(arc => {
            arc.startAngle += arc.speed * speedMult;
            arc.endAngle += arc.speed * speedMult;
            
            this.ctx.globalAlpha = arc.opacity;
            this.ctx.lineWidth = arc.width;
            this.ctx.strokeStyle = color.ring;
            
            if (arc.dash.length > 0) {
                this.ctx.setLineDash(arc.dash);
            } else {
                this.ctx.setLineDash([]);
            }

            this.ctx.beginPath();
            this.ctx.arc(0, 0, arc.radius + (pulse * (arc.radius/100)), arc.startAngle, arc.endAngle);
            this.ctx.stroke();
        });

        this.ctx.restore();

        requestAnimationFrame(() => this.animate());
    }
}

let neuralVisualizer;
window.addEventListener('load', () => {
    neuralVisualizer = new JarvisHologram('neural-canvas');
});
