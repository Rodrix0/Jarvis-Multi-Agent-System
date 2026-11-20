# Personaje articulado gratuito

El personaje anima directamente la imagen que aportó el usuario:
`frontend/assets/jarvis-companion.png`. El archivo no se modifica. La versión
anterior que redibujaba al personaje con polígonos fue rechazada y reemplazada.
El rig de `frontend/assets/jarvis-rig.json` contiene máscaras y articulaciones;
cada parte muestra los píxeles del original, sin recolorearlos. No necesita
PixelOver, licencias pagas, modelos de IA, WebGL ni servicios remotos.

Las poses de trabajo, descanso sentado y ejercicio fueron reconstruidas
con la herramienta integrada de generación de imágenes a pedido del usuario,
para reparar la anatomía y eliminar el hacha. Usan tres PNG locales
`jarvis-{working,sit,exercise}-clean.png` con sus propios rigs. La generación
solo se usó al preparar esos archivos; Jarvis no genera imágenes al animarse.
En esas poses ya no se giran ni reutilizan los recortes problemáticos del
original, ni se muestra un hacha apoyada. Ver `personaje-poses-corregidas.md`.

El navegador lo dibuja en Canvas; el personaje de escritorio usa WPF y el
mismo archivo. Las articulaciones se calculan respecto a sus padres;
los brazos, antebrazos, manos, piernas, cabeza y boca son independientes.
No es un GIF reproducido encima de una imagen estática.

## Comportamiento

- Reposo: respira, mira alrededor, saluda, camina, descansa sentado y se ejercita.
- Trabajo: aparece una mesa con portátil y las manos escriben.
- Finalización: salto y gesto de celebración.
- Pregunta o error: gesto de duda, con el texto real de Jarvis en la burbuja.
- Voz: movimiento de boca; es una animación de habla, sin sincronización fonética.
- Escucha: gesto de atención dentro de la interfaz.

La burbuja, los avisos, el arrastre y la aparición al minimizar siguen
funcionando mediante el servicio de escritorio existente. La animación
es pasiva: no ejecuta ni repite órdenes del asistente.

## Rendimiento y movimiento

El rig ocupa unos 20 KB y comparte una sola textura original de 1,2 MB en
disco. La textura decodificada también ocupa memoria mientras está visible;
no se cargan modelos de IA ni una hoja con todos los fotogramas. Se dibuja
a un máximo de 20 FPS, con máscaras precargadas en el personaje nativo.
Al ocultarse, ambos renderizadores
detienen su temporizador de animación. Las miniaturas del historial siguen
siendo estáticas para evitar un animador por mensaje.

«Animar personaje», en los ajustes de Jarvis, permite activar o pausar el
movimiento y guarda la elección. Está activado inicialmente porque el
usuario pidió animaciones aunque Windows tenga desactivadas las animaciones
de interfaz. No se cambia ninguna preferencia global de Windows. Antes de
recibir la preferencia de Jarvis, el navegador respeta movimiento reducido.

## Edición, vista previa y pruebas

- Editar `scripts/buildOriginalCharacterRig.js` y ejecutarlo con Node para regenerar el rig.
- Con Jarvis abierto, visitar `/character-preview.html` para probar las diez acciones.
- `npm run test:character`: jerarquía, articulaciones, límites, estados y preferencias.
- `node tests/test_character_browser.js`: comparación visual con el original,
  navegador aislado, pausa, movimiento reducido, control propio, poses y
  disposición móvil; no inicia Jarvis.
- `npm run test:character:native`: estados sintéticos WPF y cierre automático.
- `desktopCompanion.ps1 -RenderAnimation ruta.gif`: exporta una vista previa local.

La imagen original y la hoja anterior no se eliminan. La voz M3 y las
funciones que realizan tareas no se modifican con este cambio.
