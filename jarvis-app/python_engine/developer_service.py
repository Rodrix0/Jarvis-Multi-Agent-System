# -*- coding: utf-8 -*-
import os, json, subprocess, httpx, re, threading, http.server, socketserver, webbrowser, time

# ── MODELOS ──────────────────────────────────────────────────────────────────
CODER_MODEL = "qwen2.5-coder:7b"   # especialista en codigo
GENERAL_MODEL = "llama3.1:latest"  # chat general
from agency import run_agency

WORKSPACE = os.path.join(os.path.expanduser("~"), "Desktop", "Jarvis_Projects")
if not os.path.exists(WORKSPACE):
    os.makedirs(WORKSPACE)

SESSION_FILE = os.path.join(WORKSPACE, ".jarvis_session.json")

# ── DESIGN.md (design.md directory) ──────────────────────────────────────────
DESIGNS_CATALOG = {
    # Oscuros / Técnicos
    "terminal":        "terminal",
    "obsidian":        "obsidian",
    "graphite":        "graphite",
    "tokyo midnight":  "tokyo-midnight",
    "neon arcade":     "neon-arcade",
    "cyberpunk":       "cyberpunk-city",
    "cyber matrix":    "cyber-matrix",
    "zed":             "zed-dev",
    # Café / Restaurante
    "cafe":            "linen",
    "cafeteria":       "linen",
    "restaurant":      "wine-country",
    "bistro":          "old-money",
    # Corporativo / Finanzas
    "stripe":          "stripe-gradient",
    "finanzas":        "wealth-noir",
    "banco":           "neobank-mint",
    "corporativo":     "swiss-grid",
    "cobalt":          "cobalt-product",
    # Editorial / Revista
    "magazine":        "magazine-rouge",
    "periodico":       "broadsheet-01",
    "editorial":       "sunset-magazine",
    "typewriter":      "typewriter",
    # Minimal / Limpio
    "minimal":         "paper-white",
    "notion":          "notion-beige",
    "vercel":          "vercel-ink",
    "arctic":          "arctic",
    # Playful / Bold
    "bauhaus":         "bauhaus",
    "y2k":             "y2k-chrome",
    "candy":           "candy-shop",
    "pastel":          "pastel-candy",
    # Naturaleza / Organico
    "matcha":          "matcha",
    "botanico":        "botanical",
    "forest":          "forest-floor",
    # Deportes / Gaming
    "sports":          "sports-hud",
    "arcade":          "arcade-neon-pop",
    "pixel":           "pixel-quest",
    "dungeon":         "dungeon-crawl",
    # Moda / Arte
    "moda":            "atelier-noir",
    "galeria":         "gallery-white",
    "streetwear":      "streetwear-block",
    # Musica
    "musica":          "record-sleeve",
    "rave":            "rave-poster",
    # Salud
    "clinica":         "clinic-sage",
    "wellness":        "wellness-coral",
    # IA / Dev
    "ai":              "ai-labs",
    "devops":          "devops-graphite",
}


def start_local_server(project_path, port=8080):
  """Start a local HTTP server in a background thread. Handles port-in-use gracefully."""
  class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
      return

  def serve():
    try:
      os.chdir(project_path)
      socketserver.TCPServer.allow_reuse_address = True
      with socketserver.TCPServer(("", port), QuietHandler) as httpd:
        print(f"[Jarvis Server] Hosting at http://localhost:{port}")
        httpd.serve_forever()
    except OSError:
      print(f"[Jarvis Server] Puerto {port} ya en uso — refrescando navegador.")

  thread = threading.Thread(target=serve, daemon=True)
  thread.start()
  time.sleep(0.5)
  webbrowser.open(f"http://localhost:{port}")


def install_design(design_id: str, project_path: str) -> str:
    """Instala un DESIGN.md en la carpeta del proyecto via npx designdotmd add."""
    try:
        # Crear carpeta si no existe (necesario para que npx pueda escribir ahi)
        if not os.path.exists(project_path):
            os.makedirs(project_path)

        # shell=True es obligatorio en Windows para encontrar npx en el PATH
        cmd = f'npx -y designdotmd add {design_id}'
        print(f"[Design.md] Ejecutando: {cmd} en {project_path}")
        result = subprocess.run(
            cmd,
            cwd=project_path,
            capture_output=True, text=True, timeout=90,
            shell=True
        )
        print(f"[Design.md] stdout: {result.stdout[:300]}")
        if result.stderr:
            print(f"[Design.md] stderr: {result.stderr[:300]}")

        design_path = os.path.join(project_path, "DESIGN.md")
        if os.path.exists(design_path):
            print(f"[Design.md] Instalado correctamente: {design_id}")
            return f"Diseno '{design_id}' instalado correctamente."
        return f"No se genero DESIGN.md. Respuesta: {result.stdout or result.stderr}"
    except Exception as e:
        return f"Error ejecutando designdotmd: {e}"

def read_design_md(project_path: str) -> str:
    """Lee el DESIGN.md del proyecto si existe. Devuelve el contenido como contexto."""
    design_path = os.path.join(project_path, "DESIGN.md")
    if not os.path.exists(design_path):
        return ""
    try:
        with open(design_path, "r", encoding="utf-8") as f:
            content = f.read()
        # Limitamos a 6000 chars para no saturar el contexto del LLM
        return content[:6000]
    except Exception:
        return ""

def resolve_design_id(prompt_text: str) -> str:
    """Intenta detectar el id del diseno mencionado en el prompt."""
    low = prompt_text.lower()
    for keyword, design_id in DESIGNS_CATALOG.items():
        if keyword in low:
            return design_id
    return ""

def parse_design_md_colors(design_content: str) -> dict:
    """Extrae colores y tipografia del DESIGN.md para sobrescribir la paleta."""
    import re as _re
    colors = {}
    fonts  = {}

    # Extraer bloque de colores YAML-style
    color_block = _re.search(r'colors:\s*\n(.*?)(?:\n\w|\Z)', design_content, _re.DOTALL)
    if color_block:
        for line in color_block.group(1).splitlines():
            m = _re.match(r'\s+(\w[\w-]*):\s*["\']?(#[0-9a-fA-F]{3,8})["\']?', line)
            if m:
                colors[m.group(1)] = m.group(2)

    # Extraer tipografia
    font_block = _re.search(r'typography:.*?fontFamily:\s*(.+?)[\n,]', design_content, _re.DOTALL)
    if font_block:
        fonts['display'] = font_block.group(1).strip().strip('"\'')

    if not colors:
        return {}

    # Mapear colores del DESIGN.md a las variables de paleta de Jarvis
    # design.md usa: primary, secondary, tertiary, neutral, surface, on-primary
    c = colors
    return {
        "accent":       c.get("tertiary",   c.get("primary",   "#C9A96E")),
        "accent_light": c.get("primary",    c.get("secondary", "#E8C98A")),
        "accent_dark":  c.get("secondary",  c.get("tertiary",  "#A07840")),
        "bg":           c.get("neutral",    c.get("surface",   "#0D0D0D")),
        "bg2":          c.get("surface",    "#1A1A1A"),
        "bg3":          c.get("on-surface", "#252525"),
        "text":         c.get("on-primary", c.get("primary",   "#F0EDE8")),
        "text_muted":   c.get("secondary",  "#9A9087"),
        "font_title":   fonts.get("display", "Inter"),
        "font_body":    fonts.get("display", "Inter"),
        "nombre":       "DESIGN.md",
    }
# ─────────────────────────────────────────────────────────────────────────────

# ── SESION ────────────────────────────────────────────────────────────────────
def _save_session(project_name: str):
    with open(SESSION_FILE, "w", encoding="utf-8") as f:
        json.dump({"active_project": project_name}, f)

def _load_session() -> str:
    try:
        with open(SESSION_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("active_project", "")
    except Exception:
        return ""

# ── PALETAS ───────────────────────────────────────────────────────────────────
PALETAS = {
    "cafe_dorado": {
        "nombre": "Cafe Dorado", "accent": "#C9A96E", "accent_light": "#E8C98A",
        "accent_dark": "#A07840", "bg": "#0D0D0D", "bg2": "#1A1A1A", "bg3": "#252525",
        "text": "#F0EDE8", "text_muted": "#9A9087",
        "font_title": "Playfair Display", "font_body": "Inter",
    },
    "neon_tech": {
        "nombre": "Neon Tech", "accent": "#00F5FF", "accent_light": "#80FAFF",
        "accent_dark": "#00B8C0", "bg": "#070B14", "bg2": "#0D1520", "bg3": "#14202E",
        "text": "#E8F4FF", "text_muted": "#6A8FAF",
        "font_title": "Orbitron", "font_body": "Rajdhani",
    },
    "verde_naturaleza": {
        "nombre": "Verde Naturaleza", "accent": "#4CAF50", "accent_light": "#81C784",
        "accent_dark": "#2E7D32", "bg": "#0A1A0A", "bg2": "#122012", "bg3": "#1A2E1A",
        "text": "#E8F5E9", "text_muted": "#6A9E6A",
        "font_title": "Lora", "font_body": "Inter",
    },
    "violeta_creativo": {
        "nombre": "Violeta Creativo", "accent": "#9C27B0", "accent_light": "#CE93D8",
        "accent_dark": "#6A0080", "bg": "#0D0514", "bg2": "#150A20", "bg3": "#1E102D",
        "text": "#F3E5F5", "text_muted": "#8A6A9A",
        "font_title": "Playfair Display", "font_body": "Inter",
    },
    "rojo_impacto": {
        "nombre": "Rojo Impacto", "accent": "#F44336", "accent_light": "#EF9A9A",
        "accent_dark": "#B71C1C", "bg": "#0D0000", "bg2": "#1A0505", "bg3": "#250A0A",
        "text": "#FFEBEE", "text_muted": "#9A6060",
        "font_title": "Bebas Neue", "font_body": "Inter",
    },
    "azul_corporativo": {
        "nombre": "Azul Corporativo", "accent": "#1976D2", "accent_light": "#64B5F6",
        "accent_dark": "#0D47A1", "bg": "#030912", "bg2": "#071220", "bg3": "#0D1C30",
        "text": "#E3F2FD", "text_muted": "#5A80A0",
        "font_title": "Roboto Slab", "font_body": "Roboto",
    },
    "blanco_minimalista": {
        "nombre": "Blanco Minimalista", "accent": "#212121", "accent_light": "#616161",
        "accent_dark": "#000000", "bg": "#FAFAFA", "bg2": "#F5F5F5", "bg3": "#EEEEEE",
        "text": "#212121", "text_muted": "#757575",
        "font_title": "Playfair Display", "font_body": "Inter",
    },
    "naranja_energia": {
        "nombre": "Naranja Energia", "accent": "#FF6F00", "accent_light": "#FFB74D",
        "accent_dark": "#E65100", "bg": "#0D0600", "bg2": "#1A0E00", "bg3": "#251500",
        "text": "#FFF8E1", "text_muted": "#9A7840",
        "font_title": "Montserrat", "font_body": "Inter",
    },
}

KEYWORDS_PALETA = {
    "cafe_dorado":       ["cafe", "cafeteria", "restaurant", "bar", "gourmet", "bistro", "brunch"],
    "neon_tech":         ["tech", "tecnolog", "software", "app", "startup", "digital", "ia", "robot", "sistema"],
    "verde_naturaleza":  ["eco", "gym", "salud", "fitness", "natural", "organico", "verde", "jardin", "planta"],
    "violeta_creativo":  ["arte", "diseno", "agencia", "musica", "moda", "creativ", "estudio", "galeria"],
    "rojo_impacto":      ["marketing", "venta", "oferta", "deporte", "futbol", "gym", "energia", "descuento"],
    "azul_corporativo":  ["empresa", "finanza", "banco", "legal", "corporat", "consul", "inmobiliar", "seguro"],
    "blanco_minimalista":["blog", "clinica", "medic", "portfolio", "doctor", "salud", "minimal", "limpio"],
    "naranja_energia":   ["construcc", "delivery", "logistic", "transport", "mudanza", "electrici", "obrero"],
}

def detect_palette(prompt: str, override: str = None) -> dict:
    """Detecta la paleta correcta segun el prompt o el override manual."""
    low = (override or prompt).lower()
    for palette_id, keywords in KEYWORDS_PALETA.items():
        if any(k in low for k in keywords):
            return PALETAS[palette_id]
    return PALETAS["cafe_dorado"]


PREMIUM_TEMPLATE = """<!DOCTYPE html>

<html lang="es">

<head>

<meta charset="UTF-8">

<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>{project_title}</title>

<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@300;400;600&family=Orbitron:wght@400;700&family=Rajdhani:wght@400;600&family=Lora:wght@400;700&family=Bebas+Neue&family=Montserrat:wght@400;700&family=Roboto+Slab:wght@400;700&family=Roboto:wght@300;400;600&display=swap" rel="stylesheet">

<style>

  :root {{

    --accent: {palette_accent};

    --accent-light: {palette_accent_light};

    --accent-dark: {palette_accent_dark};

    --dark: {palette_bg};

    --dark2: {palette_bg2};

    --dark3: {palette_bg3};

    --text: {palette_text};

    --text-muted: {palette_text_muted};

  }}

  * {{ margin: 0; padding: 0; box-sizing: border-box; }}

  html {{ scroll-behavior: smooth; }}

  body {{ font-family: '{palette_font_body}', sans-serif; background: var(--dark); color: var(--text); }}



  /* NAV */

  nav {{

    position: fixed; top: 0; width: 100%; z-index: 100;

    padding: 1.2rem 4rem;

    display: flex; justify-content: space-between; align-items: center;

    background: rgba(13,13,13,0.85); backdrop-filter: blur(12px);

    border-bottom: 1px solid rgba(201,169,110,0.2);

  }}

  .logo {{ font-family: '{palette_font_title}', serif; font-size: 1.6rem; color: var(--accent); letter-spacing: 2px; }}

  .nav-links a {{ color: var(--text-muted); text-decoration: none; margin-left: 2rem; font-size: 0.9rem; letter-spacing: 1px; text-transform: uppercase; transition: color .3s; }}

  .nav-links a:hover {{ color: var(--accent); }}



  /* HERO */

  .hero {{

    min-height: 100vh;

    display: flex; flex-direction: column; justify-content: center; align-items: center;

    text-align: center;

    background: linear-gradient(135deg, #0D0D0D 0%, #1C1209 50%, #0D0D0D 100%);

    position: relative; overflow: hidden; padding: 2rem;

  }}

  .hero::before {{

    content: ''; position: absolute; inset: 0;

    background: radial-gradient(ellipse at center, rgba(201,169,110,0.08) 0%, transparent 70%);

  }}

  .hero-badge {{

    font-size: 0.75rem; letter-spacing: 4px; text-transform: uppercase;

    color: var(--gold); border: 1px solid rgba(201,169,110,0.4);

    padding: .5rem 1.5rem; border-radius: 50px; margin-bottom: 2rem;

    animation: fadeDown .8s ease;

  }}

  .hero h1 {{

    font-family: 'Playfair Display', serif;

    font-size: clamp(3rem, 8vw, 6rem); font-weight: 700; line-height: 1.1;

    background: linear-gradient(135deg, var(--gold-light), var(--gold), #8B6914);

    -webkit-background-clip: text; -webkit-text-fill-color: transparent;

    animation: fadeDown .8s ease .1s both;

  }}

  .hero p {{

    max-width: 600px; font-size: 1.1rem; color: var(--text-muted);

    margin: 1.5rem auto 2.5rem; line-height: 1.8;

    animation: fadeDown .8s ease .2s both;

  }}

  .hero-btns {{ display: flex; gap: 1rem; animation: fadeDown .8s ease .3s both; }}

  .btn-primary {{

    background: linear-gradient(135deg, var(--gold), #8B6914);

    color: #0D0D0D; font-weight: 600; padding: .9rem 2.2rem;

    border: none; border-radius: 8px; cursor: pointer; font-size: 1rem;

    letter-spacing: 1px; transition: transform .2s, box-shadow .2s;

  }}

  .btn-primary:hover {{ transform: translateY(-2px); box-shadow: 0 8px 25px rgba(201,169,110,0.4); }}

  .btn-outline {{

    background: transparent; color: var(--gold);

    padding: .9rem 2.2rem; border: 1px solid var(--gold);

    border-radius: 8px; cursor: pointer; font-size: 1rem; transition: all .2s;

  }}

  .btn-outline:hover {{ background: rgba(201,169,110,0.1); }}



  /* STATS */

  .stats {{

    display: flex; justify-content: center; gap: 4rem;

    padding: 3rem 4rem; background: var(--dark2);

    border-top: 1px solid rgba(201,169,110,0.15);

    border-bottom: 1px solid rgba(201,169,110,0.15);

  }}

  .stat {{ text-align: center; }}

  .stat-num {{ font-family: 'Playfair Display', serif; font-size: 2.5rem; color: var(--gold); }}

  .stat-label {{ font-size: .8rem; color: var(--text-muted); letter-spacing: 2px; text-transform: uppercase; margin-top: .3rem; }}



  /* SECTIONS */

  section {{ padding: 6rem 4rem; }}

  section:nth-child(even) {{ background: var(--dark2); }}

  .section-tag {{ font-size: .75rem; letter-spacing: 4px; text-transform: uppercase; color: var(--gold); margin-bottom: 1rem; }}

  .section-title {{ font-family: 'Playfair Display', serif; font-size: 2.5rem; margin-bottom: 1rem; }}

  .section-sub {{ color: var(--text-muted); max-width: 600px; line-height: 1.8; margin-bottom: 3rem; }}



  /* MESAS MAP */

  .mapa-grid {{

    display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));

    gap: 1rem; max-width: 700px;

  }}

  .mesa {{

    aspect-ratio: 1; border-radius: 12px; display: flex; flex-direction: column;

    align-items: center; justify-content: center; cursor: pointer;

    border: 2px solid transparent; transition: all .3s; font-size: .85rem;

  }}

  .mesa.libre {{ background: rgba(201,169,110,0.1); border-color: rgba(201,169,110,0.4); color: var(--gold); }}

  .mesa.libre:hover {{ background: rgba(201,169,110,0.25); transform: scale(1.05); }}

  .mesa.ocupada {{ background: rgba(255,80,80,0.08); border-color: rgba(255,80,80,0.3); color: #ff6b6b; }}

  .mesa-icon {{ font-size: 1.5rem; margin-bottom: .3rem; }}



  /* MENU CARDS */

  .menu-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.5rem; }}

  .menu-card {{

    background: var(--dark3); border-radius: 16px; overflow: hidden;

    border: 1px solid rgba(201,169,110,0.1); transition: transform .3s, border-color .3s;

  }}

  .menu-card:hover {{ transform: translateY(-5px); border-color: rgba(201,169,110,0.4); }}

  .menu-card-img {{

    height: 160px; display: flex; align-items: center; justify-content: center;

    font-size: 4rem;

    background: linear-gradient(135deg, rgba(201,169,110,0.05), rgba(201,169,110,0.12));

  }}

  .menu-card-body {{ padding: 1.2rem; }}

  .menu-card-name {{ font-weight: 600; font-size: 1.05rem; margin-bottom: .3rem; }}

  .menu-card-desc {{ color: var(--text-muted); font-size: .85rem; line-height: 1.6; margin-bottom: 1rem; }}

  .menu-card-footer {{ display: flex; justify-content: space-between; align-items: center; }}

  .menu-price {{ color: var(--gold); font-size: 1.1rem; font-weight: 600; }}

  .btn-add {{

    background: var(--gold); color: #0D0D0D; border: none;

    width: 32px; height: 32px; border-radius: 8px; font-size: 1.2rem;

    cursor: pointer; transition: opacity .2s; font-weight: 700;

  }}

  .btn-add:hover {{ opacity: 0.8; }}



  /* TRACKING */

  .tracking-bar {{

    display: flex; align-items: center; gap: 0; max-width: 600px; margin: 2rem 0;

  }}

  .track-step {{

    flex: 1; text-align: center; position: relative;

  }}

  .track-step::after {{

    content: ''; position: absolute; top: 20px; left: 50%; width: 100%;

    height: 2px; background: rgba(201,169,110,0.2);

  }}

  .track-step:last-child::after {{ display: none; }}

  .track-circle {{

    width: 40px; height: 40px; border-radius: 50%;

    display: flex; align-items: center; justify-content: center;

    margin: 0 auto .8rem; font-size: 1rem; position: relative; z-index: 1;

    border: 2px solid rgba(201,169,110,0.3);

    background: var(--dark);

  }}

  .track-step.done .track-circle {{ background: var(--gold); border-color: var(--gold); color: #0D0D0D; }}

  .track-step.active .track-circle {{ border-color: var(--gold); color: var(--gold); box-shadow: 0 0 15px rgba(201,169,110,0.4); }}

  .track-label {{ font-size: .8rem; color: var(--text-muted); }}

  .track-step.done .track-label, .track-step.active .track-label {{ color: var(--gold); }}



  /* PAGO */

  .pago-card {{

    background: var(--dark3); border: 1px solid rgba(201,169,110,0.15);

    border-radius: 20px; padding: 2rem; max-width: 480px;

  }}

  .pago-total {{ font-size: 2rem; color: var(--gold); font-family: 'Playfair Display', serif; margin: 1rem 0; }}

  .pago-metodos {{ display: flex; gap: 1rem; margin: 1.5rem 0; }}

  .metodo {{

    flex: 1; padding: 1rem; border-radius: 12px; text-align: center;

    border: 2px solid rgba(201,169,110,0.2); cursor: pointer;

    font-size: .9rem; transition: all .2s;

  }}

  .metodo.selected {{ border-color: var(--gold); background: rgba(201,169,110,0.08); color: var(--gold); }}

  .metodo:hover {{ border-color: rgba(201,169,110,0.5); }}



  /* FOOTER */

  footer {{

    padding: 3rem 4rem; border-top: 1px solid rgba(201,169,110,0.15);

    display: flex; justify-content: space-between; align-items: center;

    background: var(--dark);

  }}

  .footer-logo {{ font-family: 'Playfair Display', serif; color: var(--gold); font-size: 1.4rem; }}

  .footer-text {{ color: var(--text-muted); font-size: .85rem; }}



  @keyframes fadeDown {{ from {{ opacity:0; transform:translateY(-20px); }} to {{ opacity:1; transform:translateY(0); }} }}



  @media (max-width: 768px) {{

    nav {{ padding: 1rem 1.5rem; }}

    section {{ padding: 4rem 1.5rem; }}

    .stats {{ gap: 2rem; padding: 2rem 1.5rem; flex-wrap: wrap; }}

    .hero-btns {{ flex-direction: column; align-items: center; }}

    footer {{ flex-direction: column; gap: 1rem; text-align: center; }}

  }}

</style>

</head>

<body>



<nav>

  <div class="logo">{project_title}</div>

  <div class="nav-links">

    <a href="#inicio">Inicio</a>

    <a href="#mesas">Reservas</a>

    <a href="#menu">MenÃÂÃÂº</a>

    <a href="#seguimiento">Mi Pedido</a>

    <a href="#pago">Pagar</a>

  </div>

</nav>



<!-- HERO -->

<section class="hero" id="inicio">

  <div class="hero-badge">&#9733; Experiencia Premium de Caf&#233;</div>

  <h1>{project_title}</h1>

  <p>{hero_description}</p>

  <div class="hero-btns">

    <button class="btn-primary" onclick="document.getElementById('mesas').scrollIntoView({{behavior:'smooth'}})">Reservar Mesa</button>

    <button class="btn-outline" onclick="document.getElementById('menu').scrollIntoView({{behavior:'smooth'}})">Ver Men&#250;</button>

  </div>

</section>



<!-- STATS -->

<div class="stats">

  <div class="stat"><div class="stat-num">48</div><div class="stat-label">Mesas</div></div>

  <div class="stat"><div class="stat-num">{menu_count}+</div><div class="stat-label">Especialidades</div></div>

  <div class="stat"><div class="stat-num">4.9&#9733;</div><div class="stat-label">Calificaci&#243;n</div></div>

  <div class="stat"><div class="stat-num">15m</div><div class="stat-label">Tiempo promedio</div></div>

</div>



<!-- MESAS -->

<section id="mesas">

  <div class="section-tag">Plano del local</div>

  <h2 class="section-title">ReservÃÂ¡ tu Mesa</h2>

  <p class="section-sub">SeleccionÃÂ¡ una mesa disponible. Las mesas en dorado estÃÂ¡n libres, las rojas ya tienen reserva.</p>

  <div class="mapa-grid" id="mesaGrid"></div>

  <br>

  <button class="btn-primary" onclick="confirmarReserva()" style="margin-top:1rem;">Confirmar Reserva</button>

</section>



<!-- MENU -->

<section id="menu">

  <div class="section-tag">Nuestras Especialidades</div>

  <h2 class="section-title">El MenÃÂÃÂº</h2>

  <p class="section-sub">SeleccionÃÂ¡ tus favoritos y los enviamos directo a tu mesa.</p>

  <div class="menu-grid" id="menuGrid"></div>

</section>



<!-- SEGUIMIENTO -->

<section id="seguimiento">

  <div class="section-tag">Estado en tiempo real</div>

  <h2 class="section-title">SeguÃÂÃÂ­ tu Pedido</h2>

  <p class="section-sub">MirÃÂ¡ en quÃÂÃÂ© etapa estÃÂ¡ tu pedido sin tener que preguntar.</p>

  <div class="tracking-bar">

    <div class="track-step done">

      <div class="track-circle">ÃÂ¢ÃÂ"</div>

      <div class="track-label">Confirmado</div>

    </div>

    <div class="track-step done">

      <div class="track-circle">ÃÂ¢ÃÂ"</div>

      <div class="track-label">En preparaciÃÂÃÂ³n</div>

    </div>

    <div class="track-step active">

      <div class="track-circle">ÃÂ¢ÃÂÃ¢ÂÂ¢</div>

      <div class="track-label">Casi listo</div>

    </div>

    <div class="track-step">

      <div class="track-circle">ÃÂ°ÃÂ¸Ã¡Ã¢ÂÂ¬</div>

      <div class="track-label">En camino</div>

    </div>

    <div class="track-step">

      <div class="track-circle">ÃÂ¢ÃÂÃ¢ÂÂ¦</div>

      <div class="track-label">Entregado</div>

    </div>

  </div>

  <p style="color: var(--text-muted); margin-top:1rem;">Tiempo estimado de espera: <span style="color:var(--gold); font-weight:600;">~12 minutos</span></p>

</section>



<!-- PAGO -->

<section id="pago">

  <div class="section-tag">Checkout rÃÂ¡pido</div>

  <h2 class="section-title">Pagar el Pedido</h2>

  <div class="pago-card">

    <p style="color:var(--text-muted);">Total a pagar</p>

    <div class="pago-total" id="totalDisplay">$0.00</div>

    <div style="border-top: 1px solid rgba(201,169,110,0.15); padding-top:1.5rem;">

      <p style="font-size:.9rem; color:var(--text-muted); margin-bottom:.8rem;">MÃÂÃÂ©todo de pago</p>

      <div class="pago-metodos">

        <div class="metodo selected" onclick="selectMetodo(this)">ÃÂ°ÃÂ¸'ÃÂ³ Tarjeta</div>

        <div class="metodo" onclick="selectMetodo(this)">ÃÂ°ÃÂ¸"ÃÂ± MercadoPago</div>

        <div class="metodo" onclick="selectMetodo(this)">ÃÂ°ÃÂ¸'ÃÂµ Efectivo</div>

      </div>

    </div>

    <button class="btn-primary" style="width:100%; margin-top:1rem;" onclick="procesarPago()">Pagar Ahora</button>

  </div>

</section>



<footer>

  <div class="footer-logo">{project_title}</div>

  <div class="footer-text">ÃÂÃÂ© 2026 ÃÂÃÂ· Todos los derechos reservados</div>

</footer>



<script>

const MENU_DATA = {menu_json};

const carrito = {{}};

let mesaSeleccionada = null;



// Generar mesas

const mesaGrid = document.getElementById('mesaGrid');

for (let i = 1; i <= 24; i++) {{

  const libre = Math.random() > 0.35;

  const el = document.createElement('div');

  el.className = `mesa ${{libre ? 'libre' : 'ocupada'}}`;

  el.innerHTML = `<span class="mesa-icon">${{libre ? 'ÃÂ°ÃÂ¸ÃÂªÃ¢ÂÂ' : 'ÃÂ°ÃÂ¸"ÃÂ´'}}</span>Mesa ${{i}}`;

  if (libre) el.onclick = () => {{ mesaSeleccionada = i; document.querySelectorAll('.mesa.libre').forEach(m=>m.style.outline=''); el.style.outline='2px solid var(--gold)'; }};

  mesaGrid.appendChild(el);

}}



// Generar menÃÂÃÂº

const menuGrid = document.getElementById('menuGrid');

MENU_DATA.forEach(item => {{

  carrito[item.nombre] = 0;

  menuGrid.innerHTML += `

    <div class="menu-card">

      <div class="menu-card-img">${{item.emoji}}</div>

      <div class="menu-card-body">

        <div class="menu-card-name">${{item.nombre}}</div>

        <div class="menu-card-desc">${{item.descripcion}}</div>

        <div class="menu-card-footer">

          <span class="menu-price">$${{item.precio}}</span>

          <button class="btn-add" onclick="agregarAlCarrito('${{item.nombre}}', ${{item.precio}})">+</button>

        </div>

      </div>

    </div>`;

}});



function agregarAlCarrito(nombre, precio) {{

  carrito[nombre] = (carrito[nombre] || 0) + 1;

  calcularTotal();

  const btn = event.target;

  btn.textContent = carrito[nombre];

  btn.style.background = '#C9A96E';

}}



function calcularTotal() {{

  let total = 0;

  MENU_DATA.forEach(i => {{ total += (carrito[i.nombre] || 0) * i.precio; }});

  document.getElementById('totalDisplay').textContent = '$' + total.toFixed(2);

}}



function confirmarReserva() {{

  if (!mesaSeleccionada) {{ alert('Por favor seleccionÃÂ¡ una mesa primero.'); return; }}

  alert(`ÃÂ¢ÃÂÃ¢ÂÂ¦ Reserva confirmada para Mesa ${{mesaSeleccionada}}. Tu cÃÂÃÂ³digo es: BH-${{Math.floor(Math.random()*9000)+1000}}`);

}}



function selectMetodo(el) {{

  document.querySelectorAll('.metodo').forEach(m => m.classList.remove('selected'));

  el.classList.add('selected');

}}



function procesarPago() {{

  const total = document.getElementById('totalDisplay').textContent;

  if (total === '$0.00') {{ alert('AgregÃÂ¡ al menos un item al carrito.'); return; }}

  alert(`ÃÂ¢ÃÂÃ¢ÂÂ¦ Pago procesado por ${{total}}. ÃÂ¡Gracias por elegir {project_title}!`);

}}

</script>

</body>

</html>"""





class JarvisDeveloper:

    def __init__(self):
        self.active_project = _load_session()
        if self.active_project:
            print(f"[Jarvis Developer] Session recuperada: '{self.active_project}'")

    async def edit_with_context(self, path: str, instruction: str) -> str:
        """
        Carga archivos de una ruta (carpeta o archivo), los pasa al Editor agent,
        guarda los cambios y abre en VS Code.
        """
        from agency import load_project_files, run_editor

        # Normalizar path
        path = path.strip().strip('"\'')
        if not os.path.exists(path):
            return f"Senor, no encontre la ruta: {path}"

        # Cargar archivos
        print(f"[Editor] Cargando archivos de: {path}")
        files_context = load_project_files(path)

        if not files_context:
            return f"No encontre archivos editables en: {path}"

        file_list = ", ".join(files_context.keys())
        print(f"[Editor] {len(files_context)} archivos cargados: {file_list[:200]}")

        # Ejecutar Editor agent
        edited = await run_editor(instruction, files_context, path)

        if not edited:
            return "El editor no pudo determinar que archivos modificar. Reformula el pedido."

        # Guardar archivos editados
        base_path = path if os.path.isdir(path) else os.path.dirname(path)
        saved = []
        for filename, content in edited.items():
            out_path = os.path.join(base_path, filename)
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(content)
            saved.append(filename)
            print(f"[Editor] Guardado: {filename} ({len(content)} chars)")

        # Abrir en VS Code
        try:
            subprocess.Popen(f'code "{base_path}"', shell=True)
        except Exception:
            pass

        # Si hay index.html, abrir en navegador
        index = os.path.join(base_path, "index.html")
        if os.path.exists(index):
            start_local_server(base_path, port=8080)

        archivos_str = ", ".join(saved)
        return (f"Senor, edite {len(saved)} archivo(s): {archivos_str}. "
                f"Cambios guardados en {base_path}.")

    async def execute_full_project(self, big_prompt: str):
        from agency import run_agency
        print("[Jarvis Architect] Iniciando pipeline multi-agente...")

        # ── 1. Auto-elegir DESIGN.md ──────────────────────────────────────
        design_id = resolve_design_id(big_prompt)
        if not design_id:
            catalog_sample = ", ".join(list(DESIGNS_CATALOG.keys())[:30])
            pick_prompt = (
                f"Project: {big_prompt[:300]}\n"
                f"Choose the MOST APPROPRIATE design id from: {catalog_sample}\n"
                f"Reply with ONLY the id. Example: matcha"
            )
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    r = await client.post("http://127.0.0.1:11434/api/generate",
                        json={"model": CODER_MODEL, "prompt": pick_prompt,
                              "stream": False, "options": {"temperature": 0.2, "num_predict": 20}})
                    candidate = r.json().get("response", "").strip().lower().split()[0]
                    design_id = candidate if candidate in DESIGNS_CATALOG.values() else (
                        resolve_design_id(candidate) or "matcha"
                    )
            except Exception:
                design_id = "matcha"
        print(f"[Jarvis Designer] Diseno elegido: {design_id}")

        # ── 2. Nombre del proyecto ────────────────────────────────────────
        p_name = "proyecto_web"
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post("http://127.0.0.1:11434/api/generate",
                    json={"model": CODER_MODEL,
                          "prompt": f"Project: {big_prompt[:200]}\nReply ONLY with a snake_case project name. Example: cafeteria_moderna",
                          "stream": False, "options": {"temperature": 0.1, "num_predict": 15}})
                raw_name = r.json().get("response", "").strip().lower()
                p_name = re.sub(r'[^a-z0-9_]', '_', raw_name.split()[0])[:30] or "proyecto_web"
        except Exception:
            pass

        # ── 3. Crear carpeta e instalar DESIGN.md ─────────────────────────
        self.active_project = p_name
        _save_session(p_name)
        p_path = os.path.join(WORKSPACE, p_name)
        os.makedirs(p_path, exist_ok=True)

        install_design(design_id, p_path)
        design_content = read_design_md(p_path)

        # ── 4. Pipeline multi-agente (Architect -> Stylist -> Photographer -> Coder -> TS Coder -> Scripter) ──
        result = await run_agency(big_prompt, p_path, design_content)

        # ── 5. Guardar archivos generados ─────────────────────────────────
        files = result.get("files", {})
        if not files or not files.get("index.html") or len(files.get("index.html", "")) < 300:
            print("[Jarvis] Pipeline sin HTML valido -- fallback minimo.")
            files = {"index.html": f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>{p_name.replace('_',' ').title()}</title>
<style>body{{background:#0d1117;color:#e6edf3;font-family:monospace;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}}
h1{{color:#3fb950;}}</style></head>
<body><h1>{p_name.replace('_',' ').title()}</h1><p>Jarvis -- pipeline fallback</p></body></html>"""}

        for fname, content in files.items():
            fpath = os.path.join(p_path, fname)
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"[Jarvis] Guardado: {fname} ({len(content)} chars)")

        # Guardar prompts de imagenes para futura generacion con Stable Diffusion
        image_prompts = result.get("image_prompts", [])
        if image_prompts:
            prompts_path = os.path.join(p_path, "image_prompts.json")
            with open(prompts_path, "w", encoding="utf-8") as f:
                json.dump(image_prompts, f, indent=2, ensure_ascii=False)
            print(f"[Jarvis] Guardado: image_prompts.json ({len(image_prompts)} conceptos)")

        # ── 6. Servir en navegador y abrir VS Code ───────────────────────
        start_local_server(p_path, port=8080)
        try:
            subprocess.Popen(f'code "{p_path}"', shell=True)
        except Exception:
            pass

        n_files = len(files)
        return (f"Senor, '{p_name.replace('_',' ').title()}' generado via pipeline "
                f"5-agentes con diseno '{design_id}'. {n_files} archivos creados. Navegador y VS Code abiertos.")

    def _deploy_to_windows(self, data, palette_override=None):
        p_name = data.get("project_name", "proyecto_web").replace(" ", "_")
        p_title = data.get("project_title", "Mi Proyecto")
        hero_desc = data.get("hero_description", "Bienvenido a nuestro sitio.")
        menu = data.get("menu", [])

        raw_prompt = data.get("_raw_prompt", p_title)
        paleta = detect_palette(raw_prompt, palette_override)
        print(f"[Jarvis Designer] Paleta seleccionada: {paleta['nombre']}")

        self.active_project = p_name
        _save_session(p_name)
        p_path = os.path.join(WORKSPACE, p_name)
        if not os.path.exists(p_path):
            os.makedirs(p_path)

        # ── Instalar DESIGN.md si fue pedido ────────────────────────────
        design_id = data.get("_design_id", "")
        if design_id:
            print(f"[Jarvis Designer] Instalando DESIGN.md: {design_id}")
            install_design(design_id, p_path)
        design_context = read_design_md(p_path)

        # Si hay DESIGN.md, sus colores sobrescriben la paleta por defecto
        if design_context:
            design_paleta = parse_design_md_colors(design_context)
            if design_paleta:
                paleta = design_paleta
                print(f"[Jarvis Designer] Colores del DESIGN.md aplicados: accent={paleta['accent']} bg={paleta['bg']}")
        # ────────────────────────────────────────────────────────────────

        html = PREMIUM_TEMPLATE.format(
            project_title=p_title,
            hero_description=hero_desc,
            menu_count=len(menu),
            menu_json=json.dumps(menu, ensure_ascii=False),
            palette_accent=paleta["accent"],
            palette_accent_light=paleta["accent_light"],
            palette_accent_dark=paleta["accent_dark"],
            palette_bg=paleta["bg"],
            palette_bg2=paleta["bg2"],
            palette_bg3=paleta["bg3"],
            palette_text=paleta["text"],
            palette_text_muted=paleta["text_muted"],
            palette_font_title=paleta["font_title"],
            palette_font_body=paleta["font_body"],
        )

        index_path = os.path.join(p_path, "index.html")
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(html)

        os.system(f'start "" "{index_path}"')
        try:
            subprocess.Popen(f'code "{p_path}"', shell=True)
        except Exception:
            pass

        design_msg = f" con diseno '{design_id}'" if design_id else ""
        return f"Senor, '{p_title}' desplegado{design_msg} y paleta '{paleta['nombre']}'. Navegador y VS Code abiertos."

    async def edit_project(self, instruccion: str):
        """Edicion quirurgica: elimina con regex, agrega snippets nuevos."""
        if not self.active_project:
            return "Senor, no hay proyecto activo. Carga uno primero."
        p_path = os.path.join(WORKSPACE, self.active_project)
        index_path = os.path.join(p_path, "index.html")
        if not os.path.exists(index_path):
            return f"No encontre index.html en '{self.active_project}'."

        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()

        # Leer DESIGN.md si existe (mejora la calidad de generacion)
        design_context = read_design_md(p_path)
        design_hint = f"\n\nDISEGNO ACTIVO (DESIGN.md):\n{design_context}" if design_context else ""

        low = instruccion.lower()
        acciones = []

        SECCIONES = {
            "mesa": r'<section[^>]*id=["\']mesas["\'][^>]*>.*?</section>',
            "reserva": r'<section[^>]*id=["\']mesas["\'][^>]*>.*?</section>',
            "seguimiento": r'<section[^>]*id=["\']seguimiento["\'][^>]*>.*?</section>',
            "pago": r'<section[^>]*id=["\']pago["\'][^>]*>.*?</section>',
            "menu": r'<section[^>]*id=["\']menu["\'][^>]*>.*?</section>',
            "stats": r'<div[^>]*class=["\']stats["\'][^>]*>.*?</div>',
            "footer": r'<footer[^>]*>.*?</footer>',
        }

        # 1. Eliminar secciones
        if any(p in low for p in ["elimina", "elimina", "elimines", "quita", "quita", "saca", "saca", "borra"]):
            for clave, patron in SECCIONES.items():
                if clave in low:
                    nuevo = re.sub(patron, '', html, flags=re.DOTALL | re.IGNORECASE)
                    if nuevo != html:
                        html = nuevo
                        acciones.append(f"elimine '{clave}'")

        # 2. Agregar snippet (Llama genera SOLO el bloque)
        if any(p in low for p in ["agrega", "agrega", "anade", "incluye", "pon ", "pone", "implementa"]):
            prompt = f"""Genera SOLO un bloque HTML (sin DOCTYPE ni html/head/body):
PEDIDO: {instruccion}
Usa variables CSS: --accent, --dark, --dark2, --dark3, --text, --text-muted.{design_hint}
Devuelve UNICAMENTE el HTML del bloque."""
            try:
                async with httpx.AsyncClient(timeout=90) as client:
                    res = await client.post("http://127.0.0.1:11434/api/generate",
                        json={"model": CODER_MODEL, "prompt": prompt,
                              "stream": False, "options": {"temperature": 0.2, "num_predict": 1500}})
                    snippet = res.json().get("response", "").strip()
                snippet = re.sub(r'^```(?:html)?\n?', '', snippet, flags=re.IGNORECASE)
                snippet = re.sub(r'\n?```$', '', snippet).strip()
                if len(snippet) > 50:
                    insert_before = "</footer>" if "</footer>" in html else "</body>"
                    html = html.replace(insert_before, f"\n{snippet}\n{insert_before}", 1)
                    acciones.append("agregue el nuevo bloque")
            except Exception as e:
                acciones.append(f"error: {e}")

        # 3. Separar en archivos individuales
        if any(p in low for p in ["separ", "divid", "extrae", "desglosa"]):
            p_path = os.path.join(WORKSPACE, self.active_project)
            secciones_generadas = []
            for id_sec in ["inicio", "mesas", "menu", "seguimiento", "pago"]:
                patron = rf'<section[^>]*id=["\'{id_sec}["\'][^>]*>.*?</section>'
                match = re.search(patron, html, flags=re.DOTALL | re.IGNORECASE)
                if match:
                    contenido = match.group(0)
                    wrapper = f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>{id_sec.capitalize()}</title>
<link rel="stylesheet" href="style.css"></head><body>{contenido}</body></html>"""
                    nombre_archivo = f"{id_sec}.html"
                    with open(os.path.join(p_path, nombre_archivo), "w", encoding="utf-8") as f:
                        f.write(wrapper)
                    secciones_generadas.append(nombre_archivo)
            if secciones_generadas:
                acciones.append(f"separe en archivos: {', '.join(secciones_generadas)}")
                os.system(f'start "" "{p_path}"')

        # 4. Fallback generico
        if not acciones:
            prompt = f"""Eres programador web. Tarea sobre un proyecto HTML existente:
INSTRUCCION: {instruccion}
Variables CSS disponibles: --accent, --dark, --dark2, --dark3, --text, --text-muted.
Genera SOLO el codigo HTML/CSS a insertar. Sin explicaciones."""
            try:
                async with httpx.AsyncClient(timeout=90) as client:
                    res = await client.post("http://127.0.0.1:11434/api/generate",
                        json={"model": CODER_MODEL, "prompt": prompt,
                              "stream": False, "options": {"temperature": 0.2, "num_predict": 1500}})
                    resultado = res.json().get("response", "").strip()
                resultado = re.sub(r'^```(?:html|css)?\n?', '', resultado, flags=re.IGNORECASE)
                resultado = re.sub(r'\n?```$', '', resultado).strip()
                if len(resultado) > 30:
                    insert_before = "</footer>" if "</footer>" in html else "</body>"
                    html = html.replace(insert_before, f"\n{resultado}\n{insert_before}", 1)
                    acciones.append("aplique el cambio solicitado")
                else:
                    return "Senor, el modelo no genero resultado valido. Reformula el pedido."
            except Exception as e:
                return f"Error en fallback: {e}"

        # Guardar cambios en el index
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(html)
        os.system(f'start "" "{index_path}"')
        sep = " | "
        return f"Listo, senor: {sep.join(acciones)}."

    async def create_new_file(self, instruccion: str) -> str:
        """Crea un archivo HTML nuevo dentro del proyecto activo sin tocar el index.html."""
        if not self.active_project:
            return "Senor, no hay proyecto activo. Carga uno primero."

        p_path = os.path.join(WORKSPACE, self.active_project)

        # Detectar nombre del archivo pedido
        nombre_match = re.search(
            r'(?:archivo|pagina|p[aá]gina|html)\s+(?:de\s+)?(?:la\s+|el\s+)?([a-zA-Z0-9_\-]+)',
            instruccion.lower()
        )
        nombre_archivo = nombre_match.group(1).strip() if nombre_match else "nueva_pagina"
        if not nombre_archivo.endswith(".html"):
            nombre_archivo += ".html"

        prompt = f"""Eres un desarrollador web experto. Genera un archivo HTML COMPLETO y standalone para:
PEDIDO: {instruccion}
Usa variables CSS de la pagina principal: --accent, --dark, --dark2, --dark3, --text, --text-muted.
Incluye DOCTYPE, html, head (con meta charset y titulo), body y styles inline.
Sin explicaciones. Solo el HTML."""

        try:
            async with httpx.AsyncClient(timeout=90) as client:
                res = await client.post("http://127.0.0.1:11434/api/generate",
                    json={"model": CODER_MODEL, "prompt": prompt,
                          "stream": False, "options": {"temperature": 0.2, "num_predict": 2000}})
                html_nuevo = res.json().get("response", "").strip()

            html_nuevo = re.sub(r'^```(?:html)?\n?', '', html_nuevo, flags=re.IGNORECASE)
            html_nuevo = re.sub(r'\n?```$', '', html_nuevo).strip()

            if len(html_nuevo) < 50:
                return "No pude generar el archivo. Reformula el pedido."

            out_path = os.path.join(p_path, nombre_archivo)
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(html_nuevo)

            os.system(f'start "" "{out_path}"')
            return f"Cree el archivo '{nombre_archivo}' en el proyecto '{self.active_project}'. Lo abre en el navegador."

        except Exception as e:
            return f"Error creando archivo: {e}"

    def load_project_by_name(self, nombre: str) -> str:
        """Carga un proyecto existente por nombre."""
        nombre_limpio = nombre.strip().strip('"\"').replace(" ", "_").lower()

        proyectos = []
        if os.path.exists(WORKSPACE):
            proyectos = [d for d in os.listdir(WORKSPACE)
                         if os.path.isdir(os.path.join(WORKSPACE, d)) and not d.startswith(".")]

        proyecto = None
        for p in proyectos:
            if nombre_limpio in p.lower() or p.lower() in nombre_limpio:
                proyecto = p
                break

        if not proyecto:
            lista = ", ".join(proyectos) if proyectos else "ninguno"
            return f"Senor, no encontre proyecto que coincida con '{nombre}'. Disponibles: {lista}."

        index_path = os.path.join(WORKSPACE, proyecto, "index.html")
        if not os.path.exists(index_path):
            return f"La carpeta '{proyecto}' no tiene index.html."

        self.active_project = proyecto
        _save_session(proyecto)
        print(f"[Jarvis Developer] Proyecto cargado: '{proyecto}'")
        os.system(f'start "" "{index_path}"')
        return f"Cargue el proyecto '{proyecto}'. Abriendo en el navegador."


dev_jarvis = JarvisDeveloper()
