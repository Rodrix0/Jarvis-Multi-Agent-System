# Búsqueda de información y documentos — 11 de septiembre de 2026

Se corrigió el recorrido que antes enviaba la creación informativa a un modelo local sin buscar fuentes ni conservar los resultados de una búsqueda previa.

## Comportamiento nuevo

- «Buscame información sobre Iguazú» y «Dame información sobre Iguazú» ejecutan una búsqueda web directa. Las preguntas explicativas generales conservan su ruta conversacional.
- «Buscá información sobre Iguazú y haceme un documento en la carpeta Viajes» busca, recupera contenido y guarda un Word con sus fuentes.
- «Haceme un documento con esa información» y «Guardá esa información en un PDF en el escritorio» reutilizan la última búsqueda exitosa. Se conserva hasta 24 horas entre reinicios; una búsqueda fallida invalida el resultado anterior para evitar guardar otro tema por error.
- Se respetan Escritorio, Documentos, Descargas, carpetas con nombre y rutas absolutas. Los nombres automáticos son únicos; un nombre explícito existente no se sobrescribe.
- La búsqueda común usa una consulta concurrente a dos buscadores, sin generar consultas ajenas al tema. Se decodifican enlaces de Bing, se excluyen anuncios de DuckDuckGo y se conserva la diferencia entre URLs con parámetros distintos.
- Se intenta leer las primeras tres páginas, con espera máxima de cuatro segundos por página. Cuando una página no es accesible, se identifica el contenido como extracto del buscador. El documento es una recopilación de extractos con fuentes; no se presenta como una monografía redactada ni como verificación independiente de cada afirmación.
- Guardar resultados no requiere volver a buscar ni esperar una generación del modelo local. Los archivos con contenido dictado siguen su ruta directa.

## Evidencia real

Desde `/api/process_speech_local`, la misma entrada que recibe la transcripción de voz:

| Pedido | Resultado |
|---|---|
| Buscar información del Parque Nacional Iguazú | 10 resultados; 1.414 ms |
| Crear Word con esa información en la carpeta indicada | Archivo generado y vuelto a leer; 404 ms |
| Guardar esa información en PDF en la carpeta indicada | PDF generado y vuelto a leer; 585 ms |

En una prueba directa adicional, buscar, leer tres páginas y generar Word llevó 2.068 ms. Son mediciones de esta computadora y estas consultas, sin incluir el dictado; otros sitios pueden tardar más o bloquear la lectura.

Pruebas aisladas aprobadas: `test_research_documents`, `test_research_service`, `test_full_command_pipeline`, `test_daily_commands`, `test_canonical_llm` y `core.test`. Cubren también resultados vacíos, conservación de fuentes, destino correcto, PDF válido, guardado posterior sin repetir búsqueda y regresiones de búsquedas en YouTube/Netflix.

Evidencia y documentos de prueba: [carpeta de diagnóstico](backend/data/diagnostics/research-2026-09-11), [prueba de la entrada de voz](backend/data/diagnostics/research-2026-09-11/live.json), [prueba directa](backend/data/diagnostics/research-2026-09-11/result.json).
