# Televisión, escritura y aprendizaje de YouTube

Se corrigió el aprendizaje de Home: antes se guardaba bajo Power y podía sustituir la señal de encendido. Hay que volver a enseñar ambas teclas si se usó ese aprendizaje anterior. No se modificaron las señales guardadas por el usuario.

El encendido ya no se infiere simplemente al abrir Netflix. «Prendé la tele» envía una señal de Power; abrir una aplicación no alterna el encendido por su cuenta. Un control infrarrojo no permite leer el estado real de la TV.

Los títulos de Netflix dejaron de recortarse a diez caracteres y la escritura respeta el intervalo configurado para el teclado. La distribución antigua sigue siendo una suposición del teclado; elimina espacios y símbolos. Para escribir espacios y una distribución diferente se incorpora el teclado configurable de Aprendizaje TV, también disponible para Netflix. Los caracteres ausentes se reportan antes de comenzar la secuencia.

## Nueva pestaña

En Configurar TV → Aprendizaje TV se puede:

1. Aprender el botón físico de YouTube, si el control lo tiene. También se puede abrir navegando desde Home con flechas.
2. Grabar por separado la apertura desde Home, la entrada al buscador con campo vacío y la salida hacia resultados.
3. Añadir esperas para la carga de la aplicación.
4. Copiar las filas del teclado, indicar la tecla inicialmente seleccionada y representar la tecla espacio con `_`.
5. Guardar y probar apertura o escritura. Cancelar detiene la secuencia.

La navegación presupone un teclado en cuadrícula, sin salto circular, y el foco inicial enseñado. La TV no devuelve a Jarvis lo que muestra su pantalla: las pruebas físicas deben observarse en ella. La etapa de búsqueda debe vaciar la consulta anterior; de lo contrario, la TV concatena ambos textos.

## Validación

- Broadlink respondió en la red local durante esta revisión.
- Están aprendidas flechas, OK, Volver, Netflix, Power y volumen. No están aprendidos Home ni YouTube.
- Pruebas aisladas aprobadas: `test_tv_learning`, `test_browser_tv_learning`, `test_daily_commands`, `core.test`, `test_full_command_pipeline`.
- El test de Chrome comprobó la nueva pestaña, grabación de Home y guardado de filas del teclado con un servidor simulado.
- El test del controlador comprobó títulos completos con espacios, caracteres ausentes, secuencias, selección de TV/navegador y encendido explícito. No envió IR de prueba a la TV.

Pendiente: capturar Home/YouTube y enseñar las secuencias y el teclado reales de la televisión. No se afirma haber verificado una reproducción ni una escritura física sin ese aprendizaje. El modelo/marca de TV y el estado de su pantalla se solicitaron al usuario durante esta revisión.
