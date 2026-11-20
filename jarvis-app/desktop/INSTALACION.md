# Jarvis para Windows · 1.0.0

La aplicación abre una ventana propia, usa la interfaz negra y roja, la voz
local M3 y el personaje animado. Al minimizar, continúa en reposo o escucha
según tu elección y muestra el personaje. Para salir completamente, cerrar
la ventana o usar «Salir de Jarvis» en el icono de la bandeja.

## Instalar

Mantener `Jarvis-Setup-1.0.0.exe` y `Jarvis-1.0.0.zip` juntos. Ejecutar el
instalador. Se instala para el usuario actual, sin registro de arranque
automático, en `%LOCALAPPDATA%\Programs\Jarvis`.

El paquete incluye Node, tres entornos Python independientes, las
dependencias de Jarvis, el reconocimiento de voz instalado, Supertonic 3 y
las imágenes del personaje. Fuentes, iconos, Markdown y MathJax también se
incluyen localmente para que la interfaz no requiera CDN. No depende de que Codex o VoiceStudio sigan
instalados. Su tamaño en disco incluye modelos de voz; estos no se cargan
todos en RAM al abrir Jarvis.

El runtime de Microsoft WebView2 debe estar instalado. La PC de Rodrigo ya
lo tiene. Se usa la instalación compartida y actualizable de Windows.

Ollama y Stable Diffusion Forge conservan sus instalaciones y modelos
actuales para evitar duplicar decenas de GB. La ruta de Forge queda en
`%LOCALAPPDATA%\Jarvis\desktop.json`; si se mueve ese motor, actualizar
`forgeBat`. No borrar su carpeta original mientras se siga usando esa ruta.

`forge-local-config.patch` conserva el ajuste local del lanzador de Forge:
activa la API, xformers y cuda-malloc. El parche corresponde al repositorio
externo de Forge y no se aplica automáticamente durante la instalación.

## Datos personales

Memoria, recordatorios, configuraciones, perfiles y documentos quedan en
`%LOCALAPPDATA%\Jarvis`, separados del código. El instalador admite
`--migrate-from "ruta\jarvis-app"` para importar los datos locales anteriores.
No se incluyen memorias, cookies, PIN ni claves API en el ZIP distribuible.
Se conservan las rutas de documentos externos y aplicaciones del usuario.
El historial de conversación guardado exclusivamente en Chrome pertenece a
ese perfil del navegador; la ventana nueva tiene su propio almacenamiento.

La voz inicia en reposo en cada lanzamiento. No se reanuda automáticamente
una conversación anterior. No se registran tareas programadas ni servicios
de inicio de sesión.

## Desinstalar

Usar Configuración de Windows → Aplicaciones → Jarvis, o «Desinstalar
Jarvis» en Inicio. Se quita el programa y se conservan los datos personales.

## Diagnóstico

- `%LOCALAPPDATA%\Jarvis\logs\desktop.log`: inicio y cierre de motores.
- `Jarvis.exe --self-test`: comprueba la ventana, los motores y el inicio
  en reposo; guarda `logs\self-test.json` y `logs\installed-window.png` y sale.
- El cierre solo detiene los motores iniciados por esta ventana. Ollama se
  mantiene como servicio compartido; otras aplicaciones abiertas permanecen.

## Compilación

`Prepare-Payload.ps1` copia las dependencias y modelos existentes;
`Build.ps1` compila la ventana y el instalador y crea el ZIP verificable.
El SDK WebView2 viene del paquete oficial Microsoft.Web.WebView2 1.0.4314.35
y se verificó con el hash SHA-512 del catálogo NuGet. El instalador comprueba
el SHA-256 del paquete antes de extraerlo. Las licencias de los componentes
se conservan dentro de la instalación.
