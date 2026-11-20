# Personaje de escritorio

En Ajustes y voz, activar «Personaje en el escritorio». La vista previa dura doce segundos. Aparece al minimizar u ocultar la pestaña de Jarvis; si alguna interfaz conectada sigue visible se oculta. Se puede arrastrar, ocultar con la cruz o abrir Jarvis con doble clic o con el botón de respuesta.

Seis poses del personaje de referencia, creadas con imagegen integrado: saludo, descanso con silla, ejercicio con pesas, escritura en computadora, celebración y espera de una respuesta. Atlas: `frontend/assets/jarvis-poses.png`. Consigna: conservar identidad y estilo del personaje, seis poses en una cuadrícula uniforme 3×2, fondo transparente.

En descanso alterna actividades cada doce segundos. Al recibir una orden usa la pose de escritura; al completar celebra; ante una pregunta, confirmación o error usa la pose de espera. Los movimientos son transformaciones de las poses, no una animación articulada cuadro a cuadro. Se pausan al ocultarse y respetan la preferencia de animaciones de Windows, con un máximo de doce cuadros por segundo.

El globo conserva el resultado hasta la siguiente actividad. El botón permite volver al chat para responder; no confirma acciones por sí mismo. Los avisos reflejan los eventos que emite el motor de Jarvis: una tarea silenciosa o bloqueada dentro del motor todavía depende de que ese motor informe su estado. No se inventan opciones ni se vuelve a ejecutar la orden.

El audio de una interfaz abierta sigue usando la voz habitual. Si todas se cierran, el servidor reproduce las respuestas que no tienen ya su propio dueño de audio (`suppressTts`). Las confirmaciones y preguntas no se anuncian como éxito.

Implementación nativa WPF, cargada por `backend/scripts/desktopCompanion.ps1`, observador pasivo en `backend/services/desktopCompanionService.js`. Sin registro de inicio de Windows ni tareas programadas. Preferencia local en `backend/data/desktop_companion.json`.

Pruebas: `node backend/tests/test_desktop_companion.js` y, en Windows, `node backend/tests/test_desktop_companion_native.js`. Esta última muestra estados simulados durante diez segundos sin ejecutar tareas reales y comprueba el cierre al desactivarlo. Registros nativos en `logs/desktop-companion-native.log`, sin texto de tareas ni credenciales.
