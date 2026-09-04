# <p align="center">🤖 JARVIS OS: Advanced Virtual Assistant</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/aqua.png" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Rodrix0/IA/main/assets/banner.png" alt="JARVIS OS Banner" width="800">
</p>

<p align="center">
  <a href="https://github.com/Rodrix0/IA">
    <img src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge&logo=github" alt="Status">
  </a>
  <img src="https://img.shields.io/badge/Python-3.10%2B-blue?style=for-the-badge&logo=python" alt="Python">
  <img src="https://img.shields.io/badge/Node.js-18%2B-green?style=for-the-badge&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/AI-OpenAI%20%7C%20Llama%203-blueviolet?style=for-the-badge&logo=openai" alt="AI">
</p>

---

## 🌟 ¿Qué es JARVIS OS?

**JARVIS OS** es un asistente virtual de nueva generación diseñado para fusionar la automatización del sistema operativo con la inteligencia de los modelos de lenguaje más avanzados (OpenAI y Llama 3). No es solo un chatbot; es un **agente autónomo** capaz de operar tu computadora, gestionar tu productividad y aprender nuevas habilidades en tiempo real.

---

## 🛡️ Escudo Biométrico: Seguridad Avanzada
JARVIS OS no solo es un asistente, es el guardián de tu sistema.
*   **Reconocimiento Facial Local**: Utiliza algoritmos LBPH (OpenCV) para proteger tu PC. El sistema captura 50 fotos instantáneas locales para un entrenamiento privado y seguro.
*   **Protección en Tiempo Real**: Bloquea el acceso al sistema y puertos USB cuando la computadora está suspendida o bloqueada, permitiendo el acceso solo tras una validación biométrica exitosa.

## 🎭 Sistema de Modos Dinámicos
Jarvis adapta su comportamiento y prioridad de respuesta según tu contexto actual.
*   **Modos Adaptativos**: "Estudio", "Juego", "Productividad", o modos personalizados creados por ti.
*   **Interacción Dual**: Jarvis responde siempre con **voz natural (TTS)** y **texto enriquecido**, asegurando que nunca pierdas información importante.
*   **Cambio Verbal**: Simplemente di *"Activar modo Juego"* y Jarvis transicionará instantáneamente su configuración.

---

## 🚀 Capacidades Core

### 🖥️ Automatización de Escritorio & Web
*   **Control Total**: Abre aplicaciones instaladas (Chrome, VS Code, Spotify, etc.) con comandos de voz naturales.
*   **Navegación Inteligente**: Solicita abrir cualquier pestaña de Google o sitio web específico para agilizar tu flujo de trabajo.

### 🧠 Inteligencia & RAG (Retrieval-Augmented Generation)
*   **Búsqueda en Tiempo Real**: Infiltra la web (Bing/DuckDuckGo) para traer información actualizada sobre noticias, eventos deportivos o cualquier dato en vivo.
*   **Resumen Maestro de PDFs**: Motor de análisis con un rango de exactitud del **8.0 al 9.2**, capaz de sintetizar documentos técnicos complejos en segundos.

### 📝 Productividad Extrema
*   **Creador de Documentos**: Genera archivos `.docx`, `.pdf`, `.xlsx` y `.pptx` altamente detallados sobre cualquier tema.
*   **Gestión de Tareas**: Agenda recordatorios y tareas locales o en la nube (Sincronización con Supabase).
*   **Comunicación Fluida**: Envía mensajes por WhatsApp y correos electrónicos de forma autónoma.

### 💹 Finanzas al Momento
*   **Monitor de Activos**: Consulta el precio actualizado del **Dólar** y las principales **Criptomonedas** instantáneamente.

### 🛠️ Developer Agent (Modo Programador)
*   **Coding Autónomo**: Jarvis puede programar, revisar código existente y realizar cambios directamente en tus archivos de proyecto.
*   **Auto-Aprendizaje (Code-Act)**: Capacidad para desarrollar "skills" de Python internas para resolver problemas nuevos.

### 🎨 Creatividad Visual
*   **Generador de Arte**: Integración con DALL-E para crear imágenes espectaculares a partir de descripciones textuales.

---

## 📸 Visual Showcase

<p align="center">
  <table>
    <tr>
      <td><img src="https://via.placeholder.com/400x250?text=JARVIS+HUD+INTERFACE" alt="UI Dashboard"></td>
      <td><img src="https://via.placeholder.com/400x250?text=DOCUMENT+GENERATION+DEMO" alt="Doc Gen"></td>
    </tr>
    <tr>
      <td align="center"><b>Futuristic HUD Interface</b></td>
      <td align="center"><b>Autonomous Document Creation</b></td>
    </tr>
  </table>
</p>

---

## 🛠️ Stack Tecnológico

*   **Backend**: Node.js, Express, Socket.io (Control de OS en tiempo real).
*   **IA Engine**: Python (FastAPI), LlamaIndex, OpenAI API.
*   **Scraping**: Puppeteer Stealth & Cheerio para infiltración de datos.
*   **Seguridad**: OpenCV (Reconocimiento facial LBPH).
*   **UI/UX**: HTML5/CSS3 con estética Glassmorphism & Cyberpunk.

---

## 🔮 Roadmap: El Futuro de Jarvis

Estamos trabajando para que Jarvis sea aún más omnipotente:

1.  **🔗 Ecosistema IoT**: Enlace directo con dispositivos físicos (domótica, sensores y hardware externo).
2.  **⚙️ Self-Programming**: Capacidad de auto-modificación del núcleo para optimizar sus propios algoritmos de respuesta.
3.  **📄 PDF Ultra-Summary**: Evolución del motor RAG para alcanzar una exactitud superior en documentos extensos.
4.  **👁️ Visión Perceptiva**: Análisis de pantalla en tiempo real para interactuar con interfaces gráficas sin necesidad de API.

---

## ⚙️ Instalación Rápida

1.  Clona el repositorio: `git clone https://github.com/Rodrix0/IA.git`
2.  Configura tu `.env` con tu `OPENAI_API_KEY`.
3.  Instala dependencias de Node: `cd backend && npm install`
4.  Instala requisitos de Python: `cd python_engine && pip install -r requirements.txt`
5.  Inicia el sistema: `npm start`

## 📖 Documentación Adicional
Para obtener detalles técnicos profundos, guías de configuración avanzada de los agentes y más información sobre cómo usar las herramientas internas, consulta el [README de Python Engine](file:///c:/Users/Rodrigo/Desktop/IA/jarvis-app/python_engine/README.md).

---

<p align="center">
  Desarrollado con ❤️ por <b>Rodrigo</b>
</p>
