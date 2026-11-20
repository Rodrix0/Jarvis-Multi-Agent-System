# Reparación de las tres poses

Se reemplazaron las poses de computadora (`working`), descanso sentado
(`sit`) y flexión de ambos brazos con pesas (`exercise`). Cada una parte de
una imagen anatómicamente completa, sin hacha ni restos del mango. La
animación usa desplazamientos pequeños y giros de hasta cinco grados.

Archivos del proyecto, relativos a `jarvis-app`:

- `frontend/assets/jarvis-working-clean.png` y `jarvis-working-clean.json`.
- `frontend/assets/jarvis-sit-clean.png` y `jarvis-sit-clean.json`.
- `frontend/assets/jarvis-exercise-clean.png` y `jarvis-exercise-clean.json`.
- `backend/scripts/buildCleanCharacterPoses.js`: regeneración de los rigs.

Los PNG tienen transparencia real y conservan la estética de cuentas de
plástico, pelo y barba rojizos, ojos azules, chaleco y pantalón verdes,
cinturón amarillo y zapatos rojos. La imagen original no se reemplaza.
Las otras animaciones siguen usando esa imagen.

El navegador y WPF seleccionan el rig corregido por estado. WPF carga las
variantes cuando se usan. Se conservan la pausa al ocultar, el control de
movimiento y los avisos de tareas. No hay un servicio generativo funcionando
en segundo plano. Las variantes se animan a 16 FPS como máximo.

## Procedencia y prompts

Modo: herramienta integrada `image_gen`, edición con referencia a
`frontend/assets/jarvis-companion.png`, `transparent_background=true`.
Se hizo una llamada independiente por pose. Los resultados se copiaron
al proyecto; los originales de generación no se borraron.

Prompt común exacto:

> Edit the supplied character reference, preserving its identity extremely faithfully: red/burgundy hair and beard, bright blue eyes, bare peach muscular chest, open green vest with small white trim, green cropped pants, yellow belt buckle, red shoes, black bead outlines. It is a real flat Hama/perler fuse-bead character: keep clearly visible small circular plastic beads in a regular pixel grid, material shading, color palette, and same recognizable face. NOT a smooth cartoon, NOT generic vector art, NOT a different character. Remove the axe COMPLETELY, including all gold/black handle loops, fragments, weapons above the head or beside the body. Repair all covered areas anatomically. Both arms and hands must be complete and cleanly connected at shoulders, elbows, wrists. No raised middle finger: normal hands appropriate to activity. Full figure including feet, no cropping. Transparent background, no text or layout borders. One character only. Keep front/three-quarter view facing slightly to the right like reference. Keep bead scale and facial detail consistent with reference.

Se agregó `POSE: ` seguido de uno de estos textos:

Computadora:

> Seated naturally on a simple dark wooden chair, typing on a laptop on a wooden desk. Entire desk, chair and feet visible. The forearms rest nearly horizontally on the desk, both hands on the keyboard, elbows relaxed and clearly connected. Laptop at viewer's right, showing its back/side. Keep BOTH complete arms and both hands visible and recognizable, no overlapping cut-off body fragments.

Descanso:

> Seated comfortably on a simple wooden chair, resting with hands relaxed naturally on his thighs, knees naturally bent, lower legs and red shoes fully visible. No desk, no laptop, no axe, no dumbbells. Both arms fully visible and cleanly attached. Calm friendly expression identical to reference.

Ejercicio:

> Standing straight, doing bicep curls with a small dark dumbbell in EACH hand. Both upper arms relaxed close to torso, elbows below chest, forearms bent forward about ninety degrees at waist/chest height. Two complete arms and hands gripping their weights correctly. No chair, no desk, no axe. Whole character and feet visible, friendly face same as reference.
