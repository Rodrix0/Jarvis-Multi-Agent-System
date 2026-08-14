# Jarvis OS - Asistente Virtual Inteligente

Sistema de asistente virtual controlado por voz inspirado en "Jarvis", equipado con integración de Inteligencia Artificial (OpenAI), reconocimiento y síntesis de voz, sistema de modos dinámicos y control del sistema operativo.

## ❤️ Características Principales
- **Reconocimiento de Voz (Web Speech API)**: Escucha pasiva y activación por voz ("Hola Jarvis").
- **Síntesis de Voz (Browser TTS)**: Jarvis habla sus respuestas con voz natural.
- **Sistema Multimodo**: Comportamiento adaptativo según el modo ("Estudio", "Juego", "Productividad", o modos personalizados).
- **Control de la PC**: Abre aplicaciones locales de tu sistema ("Abrir Chrome", "Abrir Calculadora").
- **Interfaz UI Futurista**: Diseño moderno Glassmorphism. Animaciones fluídas con HUD.

## 🛠️ Requisitos Previos
1. **Node.js**: Instalado en tu computadora (v16.0.0 o superior).
2. **Navegador**: Google Chrome o Edge son necesarios (Safari/Firefox tienen soporte limitado para Web Speech API continuo).
3. **OpenAI API Key**: Necesitas una clave API de OpenAI para que el cerebro de Jarvis responda preguntas inteligentemente.

---

## 🚀 Instalación Paso a Paso

### 1. Preparar las dependencias
Abre tu terminal, PowerShell o CMD y navega al directorio del backend:
```bash
cd c:\Users\Rodrigo\Desktop\IA\jarvis-app\backend
```

Ejecuta el siguiente comando para instalar todo lo necesario (express, socket.io, openai, cors, dotenv):
```bash
npm install
```

### 2. Configurar Inteligencia Artificial
En la misma carpeta `backend`, abre el archivo `.env`. Verás algo como:
```env
OPENAI_API_KEY=tu_api_key_aqui
PORT=3000
```
Reemplaza `tu_api_key_aqui` por tu clave secreta obtenida en `platform.openai.com`.

### 3. Ejecutar Sistema Jarvis

En la consola, ejecuta:
```bash
npm start
```

Deberías ver visualmente en consola que el servidor se activó. El escudo
biométrico solo mantiene procesos residentes mientras está habilitado.

### 4. Abrir la Interfaz de Usuario
Jarvis está diseñado para correr tanto en web como de interfaz. Simplemente dirígete a:
**http://localhost:3000** 

Verás la grandiosa interfaz de Jarvis.
Jarvis arranca en modo descanso. El navegador puede solicitar permiso de micrófono
la primera vez: ACÉPTALO. Di **"Jarvis, prendete"** para comenzar a darle órdenes y
**"Jarvis, apagate"** para volver al descanso. También puedes usar el botón o escribir.

---

## 🎤 Cómo hablar con Jarvis

Una vez encendido:
- **Activación por voz:** Di "Hola Jarvis" para llamar su atención, seguido del comando o pregunta.
- **Creación de modos verbal:** Di *"Crear nuevo modo"*, e instantáneamente abrirá el panel mágico.
- **Intercambio verbal de modos:** Di *"Activar modo Juego"* y su cerebro transicionará automáticamente.
- **Control de tu Windows:** Di *"Abrir Chrome"* o *"Abrir Calculadora"* para pedirle a tu Node.js local que ejecute un proceso hijo y abra el software.

Disfruta desarrollando y escalando este increíble asistente interactivo.

## Panel de funciones

La columna **Funciones y comandos** muestra el catálogo actualizado de capacidades.
Puedes buscar una función y hacer click en ella para preparar el comando; reemplaza
los valores entre corchetes y presiona Enter. El catálogo también está disponible en
`GET /api/capabilities`.

---

## 🛡️ Configuración del Escudo Biométrico (Seguridad OS)

JARVIS OS incluye un sistema de seguridad avanzado del sistema operativo mediante Inteligencia Artificial facial local (LBPH OpenCV). Si activas el Escudo Biométrico, JARVIS custodiará tu computadora cuando la suspendas o la bloquees.

### Paso 1: Configurar Windows
Para que JARVIS pueda sobreponerse sin problemas a la aburrida pantalla de Windows:
1. Ve a **Configuración de Windows > Cuentas > Opciones de inicio de sesión**.
2. En la opción *"Requerir inicio de sesión al activarse desde la suspensión"*, selecciona **"Nunca"**.

### Paso 2: Entrenar a JARVIS
Usa tu voz en el panel principal para crear tu clave y rostro de seguridad:
- 🎙️ Di: **"Jarvis, entrenar seguridad [Tu_PIN]"** (Ej: *"Jarvis, entrenar seguridad 0000"*).
- Aparecerá una ventana para escanear tu rostro (se toman 50 fotos instantáneas locales para privacidad pura).

### Paso 3: Activación y Desactivación
El escudo actúa al instante (en 0ms y bloqueando incluso los puertos USB). Tienes control total por voz:
- 🟢 **Encender**: *"Jarvis, activar seguridad"* o *"Prende el escudo"*
- 🔴 **Apagar**: *"Jarvis, desactivar seguridad"* o *"Apaga la biometría"*

> **Nota:** Si es la primera vez que clonas este proyecto en otra PC, recuerda instalar los requisitos internos de Python (`pip install opencv-contrib-python customtkinter numpy Pillow`).
