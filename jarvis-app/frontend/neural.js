class NeuralNetwork {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.numParticles = 120; // Increased for full screen
        this.state = 'idle'; // idle, listening, speaking
        
        // Colors from CSS variables
        this.colors = {
            idle: { node: 'rgba(0, 229, 255, 0.3)', line: 'rgba(0, 229, 255, 0.1)' },
            listening: { node: 'rgba(0, 229, 255, 0.8)', line: 'rgba(0, 229, 255, 0.4)' },
            speaking: { node: 'rgba(124, 58, 237, 0.8)', line: 'rgba(124, 58, 237, 0.4)' }
        };

        this.resize();
        this.initParticles();
        
        window.addEventListener('resize', () => this.resize());
        this.animate();
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width * window.devicePixelRatio;
        this.canvas.height = this.height * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    initParticles() {
        this.particles = [];
        for (let i = 0; i < this.numParticles; i++) {
            this.particles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                baseRadius: Math.random() * 2 + 1
            });
        }
    }

    setState(newState) {
        this.state = newState;
    }

    animate() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        let speedMultiplier = 1;
        let connectionDistance = 100;
        
        if (this.state === 'listening') {
            speedMultiplier = 3.5;
            connectionDistance = 140;
        } else if (this.state === 'speaking') {
            speedMultiplier = 2.0;
            connectionDistance = 120;
        }

        const currentColor = this.colors[this.state];

        // Update and draw particles
        for (let i = 0; i < this.particles.length; i++) {
            let p = this.particles[i];
            
            p.x += p.vx * speedMultiplier;
            p.y += p.vy * speedMultiplier;

            // Pulse effect when speaking
            if (this.state === 'speaking') {
                p.radius = p.baseRadius + Math.sin(Date.now() / 200 + i) * 1.5;
            } else {
                p.radius = p.baseRadius;
            }

            // Bounce off edges
            if (p.x < 0 || p.x > this.width) p.vx *= -1;
            if (p.y < 0 || p.y > this.height) p.vy *= -1;

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, Math.max(0.1, p.radius), 0, Math.PI * 2);
            this.ctx.fillStyle = currentColor.node;
            this.ctx.fill();
        }

        // Draw connections
        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                let p1 = this.particles[i];
                let p2 = this.particles[j];
                let dx = p1.x - p2.x;
                let dy = p1.y - p2.y;
                let dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < connectionDistance) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(p1.x, p1.y);
                    this.ctx.lineTo(p2.x, p2.y);
                    
                    let opacity = 1 - (dist / connectionDistance);
                    // Parse rgba string to inject opacity dynamically
                    let baseRgba = currentColor.line.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)/);
                    if (baseRgba) {
                        let maxOpacity = parseFloat(baseRgba[4]);
                        this.ctx.strokeStyle = `rgba(${baseRgba[1]}, ${baseRgba[2]}, ${baseRgba[3]}, ${opacity * maxOpacity})`;
                    } else {
                        this.ctx.strokeStyle = currentColor.line;
                    }
                    
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                }
            }
        }

        requestAnimationFrame(() => this.animate());
    }
}

// Global instance
let neuralVisualizer;

window.addEventListener('load', () => {
    neuralVisualizer = new NeuralNetwork('neural-canvas');
});
