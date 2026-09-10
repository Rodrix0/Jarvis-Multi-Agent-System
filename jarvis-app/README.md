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

Para iniciar absolutamente todo con una sola orden desde la carpeta del proyecto,
usa `jarvis` en CMD o `.\jarvis.cmd` en PowerShell:

```cmd
jarvis
```

También podés hacer doble clic en `start_jarvis.bat`. El
lanzador inicia Ollama, el motor Python, Node, la voz local y abre el panel. Si algún
componente ya está activo no lo duplica y comprueba que todos respondan antes de
mostrar que Jarvis está listo. Los registros quedan dentro de `logs/`.

Para apagar completamente todos los procesos de Jarvis desde CMD o PowerShell:

```powershell
.\apagar_jarvis.cmd
```

Cerrar el navegador o Visual Studio Code no apaga los procesos ocultos. La orden de
voz `Jarvis, apagate` deja un detector mínimo para poder escuchar `Jarvis, prendete`;
el comando anterior realiza el cierre total. Ollama solo se detiene si Jarvis fue
quien lo inició, para no interrumpir otras aplicaciones locales.

Deberías ver visualmente en consola que el servidor se activó. El escudo
biométrico solo mantiene procesos residentes mientras está habilitado.

### 4. Abrir la Interfaz de Usuario
Jarvis está diseñado para correr tanto en web como de interfaz. Simplemente dirígete a:
**http://localhost:3000** 

Verás la grandiosa interfaz de Jarvis.
Jarvis arranca en modo descanso. El navegador puede solicitar permiso de micrófono
la primera vez: ACÉPTALO. Di **"Jarvis, prendete"** para comenzar a darle órdenes y
**"Jarvis, apagate"** para volver al descanso. También puedes usar el botón o escribir.
El nombre `Jarvis` es obligatorio en esas dos frases para impedir activaciones por
ruido, televisión o conversaciones cercanas. Las órdenes normales no necesitan
repetir el nombre mientras el asistente está despierto.

---

## 🎤 Cómo hablar con Jarvis

Una vez encendido:
- **Activación por voz:** Di "Hola Jarvis" para llamar su atención, seguido del comando o pregunta.
- **Creación de modos verbal:** Di *"Crear nuevo modo"*, e instantáneamente abrirá el panel mágico.
- **Intercambio verbal de modos:** Di *"Activar modo Juego"* y su cerebro transicionará automáticamente.
- **Control de tu Windows:** Di *"Abrir Chrome"* o *"Abrir Calculadora"* para pedirle a tu Node.js local que ejecute un proceso hijo y abra el software.

Disfruta desarrollando y escalando este increíble asistente interactivo.

## Panel de funciones

La columna **Funciones y comandos** se genera desde el registro central de acciones.
Puedes buscar una función y hacer click en ella para preparar el comando; reemplaza
los valores necesarios y presiona Enter. Cada tarjeta muestra disponibilidad,
permiso y si requiere confirmación. El catálogo también está disponible en
`GET /api/actions` y `GET /api/capabilities`.

Cada ejecución devuelve estado, evidencia, duración y el campo `verified`. Las
acciones no se anuncian como completadas si falta una dependencia. Las operaciones
delicadas usan una confirmación con vencimiento y la auditoría local queda en
`backend/data/action_audit.jsonl`.

## Reconocimiento de voz

La escucha usa español de Argentina y un motor de dictado local general. No hay una
lista fija de títulos. Whisper devuelve una confianza y Jarvis pide revisar la frase
cuando el resultado es inseguro, especialmente para órdenes físicas.

Las transcripciones dudosas pasan por una capa local que reconstruye la frase usando
el contexto reciente y el estado actual del asistente. No depende de una lista
cerrada de títulos o comandos.
La corrección contextual funciona con Ollama local y solo se usa cuando una frase
es dudosa o contiene referencias como “eso” y “lo anterior”. El audio y el texto
permanecen dentro de la notebook.

El panel **Voz y memoria** permite seleccionar el micrófono local, revisar el motor
usado y enseñar correcciones con `No dije X, dije Y`. Vosk escucha la activación,
WebRTC VAD delimita cada frase y faster-whisper Small realiza la transcripción
general en español. El reconocimiento del navegador queda solamente como respaldo
si el proceso local no está iniciado.

### Motor completamente local

`start_jarvis.bat` inicia también `python_engine/voice_assistant.py`. La ruta local
usa estos componentes:

- Vosk español pequeño: solo escucha `Jarvis, prendete` mientras está en descanso.
- WebRTC VAD: conserva 450 ms anteriores al habla y espera 1.050 ms de silencio al
  final para no cortar palabras.
- faster-whisper Small INT8: transcribe órdenes libres en español usando CPU.
- Qwen 2.5 3B mediante Ollama: corrige localmente frases dudosas y referencias.
- TTS nativo de Windows: responde aunque la interfaz web no tenga el foco.

Los modelos se descargan una sola vez y quedan en `python_engine/models/`. El
entorno aislado está en `python_engine/voice_venv/`; ambos se mantienen fuera de Git.

Para verificar la instalación sin abrir el micrófono:

```powershell
python_engine\voice_venv\Scripts\python.exe python_engine\voice_assistant.py --diagnose
```

El panel informa **Motor local activo** cuando el proceso está conectado. En ese
caso desactiva automáticamente Web Speech para impedir que una misma frase se
ejecute dos veces. Si el proceso local falla, el navegador queda como respaldo.

Para poder diagnosticar errores reales, las transcripciones elegidas y sus
alternativas se registran localmente en `backend/data/voice_history.jsonl`. El
archivo se limita automáticamente a 1 MB. Whisper se precarga en segundo plano y queda disponible para la siguiente orden.
Mientras Jarvis está en descanso, solo Vosk procesa el micrófono.

## Memoria contextual

La memoria central separa automáticamente los temas, conserva el hilo para
referencias como “eso”, “la anterior” y “seguí con lo mismo”, y resume conversaciones
antiguas al crecer. Solo guarda preferencias permanentes cuando el usuario pide
explícitamente recordarlas. Conversaciones, preferencias, correcciones y resúmenes
se pueden inspeccionar y borrar desde **Voz y memoria**. El archivo local es
`backend/data/jarvis_memory.json`.

Las antiguas 3.627 variaciones automáticas se retiraron de ejecución y se archivaron
de forma recuperable en `backend/data/comandos.generated.archive.json`. El afinador
que las regeneraba fue eliminado para reducir falsos positivos, disco y trabajo en
segundo plano.

Las respuestas se reproducen primero con el sintetizador nativo de Windows
(Microsoft Helena, volumen 100) para no depender de los bloqueos de audio de Chrome.
El navegador queda como respaldo y divide los textos largos en fragmentos seguros.
El botón **Probar voz** permite verificar la salida y la selección queda guardada
por nombre, aunque Windows cambie el orden de sus voces.

Jarvis arranca en descanso, pero después solo cambia de estado mediante
`Jarvis, prendete`, `Jarvis, apagate` o el botón del micrófono. Perder el foco,
minimizar la ventana o terminar una respuesta no lo pone en descanso. El detector
revisa todas las alternativas de Chrome y tolera variantes como `prende te`,
`despertate` y errores frecuentes al reconocer el nombre Jarvis, sin confundir
`apagá la tele` con una orden para dormir al asistente.

## Control de TV con BroadLink y Netflix

Jarvis puede controlar una TV por infrarrojos con un BroadLink RM conectado a la
misma red Wi-Fi. La configuración se hace desde **Configurar TV / BroadLink**:
por seguridad, este panel solo se abre con el botón y no mediante una orden de voz.

1. Configura primero el BroadLink en su aplicación móvil y asegúrate de permitir
   el control local o desactivar el bloqueo del dispositivo.
2. Pulsa **Buscar BroadLink**.
   Si la búsqueda automática no lo encuentra, copia su IP desde la aplicación
   BroadLink o desde el panel del router, escríbela en **IP manual** y guarda.
3. Enseña como mínimo las teclas `POWER`, `ARRIBA`, `ABAJO`, `IZQUIERDA`,
   `DERECHA` y `OK`, apuntando el control físico al BroadLink cuando el panel lo pida.
   Jarvis compara la firma NEC de cada señal y rechaza una tecla nueva si coincide
   con otra ya aprendida; esto evita que una dirección guardada accidentalmente
   como POWER apague y encienda la TV durante una búsqueda.
4. Deja el arranque en 45 segundos y el perfil en posición 0 para la disposición
   mostrada en la TV. La tecla `NETFLIX` es opcional si la TV ya inicia dentro de Netflix.
5. Calibra cuántas pulsaciones hacia abajo hacen falta para llegar a la fila
   **Continuar viendo**. En la pantalla mostrada, el valor inicial es 1.

Comandos disponibles:

- `Prendé la tele y poné Netflix`
- `Abrí Netflix en la tele` / `Abrí Netflix en la compu`
- `Abrí Netflix` (pregunta en qué dispositivo)
- `Prendé la tele y poné The Walking Dead en Netflix`
- `Poné The Walking Dead en Netflix` (si la TV ya está encendida)
- `Continuá viendo mi contenido` (primer elemento de la fila)
- `Continuá Haikyu` (búsqueda directa por título)
- `Buscá una película de acción` (deja los resultados visibles)
- `Dos a la derecha`, `Bajá`, `Subí`, `Volvé`
- `Reproducí eso`
- `Cancelá la automatización de la tele`
- `Buscá el canal de Kurzgesagt en YouTube` (abre resultados en la notebook)
- `Buscá The Walking Dead en Netflix desde mi computadora`
- `Dame información sobre computación cuántica` (crea un Word en el Escritorio)

El panel muestra inmediatamente un cartel con la frase entendida y luego confirma si
la acción terminó o falló. Las búsquedas de YouTube y Netflix en la computadora usan
una ruta directa y no esperan al modelo general. El modo de descanso solo cambia con
una orden completa como `Jarvis, apagate`; palabras parecidas dentro de otra frase no
pueden apagarlo.

Después de abrir Netflix en la TV, Jarvis mantiene durante 30 minutos el contexto de control
de TV. En ese período las órdenes cortas de navegación se envían al BroadLink. Una
orden con `buscá` deja los resultados visibles para elegir; `poné` o `reproducí`
buscan y ejecutan el primer resultado. Si no indicás el dispositivo al decir
`Abrí Netflix`, Jarvis pregunta si querés usar la TV o la computadora. Si el
BroadLink no responde, utiliza la computadora como alternativa.

El contexto de TV conserva la última acción, búsqueda y dirección. Por seguridad,
una frase ambigua o no reconocida nunca se convierte mediante IA en pulsaciones
físicas: Jarvis pide reformular y mantiene la pantalla actual. Frases directas como
`quiero ver John Wick 3` o `poné la tercera` siguen admitidas. Al mencionar Spotify,
YouTube, la computadora u otro tema explícito, el contexto de Netflix se descarta.
Si el BroadLink está desenchufado o no responde, abrir o buscar Netflix cambia
automáticamente a la notebook y no termina mostrando un error de dispositivo.

La secuencia de arranque enciende la TV, espera 45 segundos, pulsa NETFLIX, confirma
el perfil y luego permite buscar o navegar. Todos los tiempos relevantes pueden
calibrarse desde el panel.

La mayoría de controles usan una única señal `POWER` para encender y apagar; por eso
no debes usar la frase `Prendé la tele` si ya está encendida.
Internamente, Jarvis solo permite enviar POWER cuando la intención contiene
`powerOn === true`, generado exclusivamente por una orden explícita de encendido;
buscar, navegar, reproducir o continuar nunca asumen ese valor por defecto.

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


## Verificación de comandos cotidianos

La reparación y las pruebas del 8 de septiembre de 2026 están documentadas en [VERIFICACION_2026-09-08.md](VERIFICACION_2026-09-08.md), incluidos los límites de la comprobación física del Broadlink.

La revisión integral posterior, con 61 suites aprobadas, el catálogo de 132 acciones y las comprobaciones reales de Windows e integraciones, está en [VERIFICACION_2026-09-09.md](VERIFICACION_2026-09-09.md).
