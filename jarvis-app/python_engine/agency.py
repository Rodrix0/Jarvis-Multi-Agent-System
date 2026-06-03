# -*- coding: utf-8 -*-
"""
agency.py -- Multi-agent web builder for Jarvis (v5.0 STABLE)
=============================================================
Pipeline de 5 agentes:
  1. Architect    -> Analiza dominio, define productos y contrato de IDs (JSON)
  2. Stylist      -> Genera CSS tokens coherentes con el dominio
  3. Photographer -> Genera imagenes con Forge/SD o fallback Unsplash
  4. Coder        -> Construye HTML+CSS usando contrato + imagenes reales
  5. Scripter     -> Programa JS usando el mismo contrato + HTML real

El ensamblaje final lo hace Python (deterministico, no un LLM).
"""

import base64
import json
import os
import re
import time
from typing import Dict, List

import httpx

# ─── Configuracion ───────────────────────────────────────────────────────────

CODER_MODEL = "qwen2.5-coder:7b"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
FORGE_URL = "http://127.0.0.1:7860/sdapi/v1/txt2img"

UNSPLASH_FALLBACKS = [
    "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=900&h=900&fit=crop",
    "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=900&h=900&fit=crop",
    "https://images.unsplash.com/photo-1514432324607-a09d9b4aefda?w=900&h=900&fit=crop",
    "https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=900&h=900&fit=crop",
    "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=900&h=900&fit=crop",
    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=900&h=900&fit=crop",
]

DEFAULT_PLAN = {
    "domain": "General",
    "title": "Premium Store",
    "sections": ["navbar", "hero", "products", "cart-sidebar", "footer"],
    "ui_contract": {
        "ids": {
            "cart_count": "cart-count",
            "cart_sidebar": "cart-sidebar",
            "cart_items": "cart-items-container",
            "cart_total": "total-price",
            "product_grid": "product-grid",
        },
        "classes": {"add_to_cart": "btn-add", "open_cart": "btn-open-cart"},
        "data_attrs": ["data-id", "data-name", "data-price"],
    },
    "products": [
        {"id": 1, "name": "Product A", "desc": "Premium quality", "price": 29.99},
        {"id": 2, "name": "Product B", "desc": "Best seller", "price": 39.99},
        {"id": 3, "name": "Product C", "desc": "New arrival", "price": 24.99},
        {"id": 4, "name": "Product D", "desc": "Limited edition", "price": 49.99},
    ],
}


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def _call_llm(prompt: str, model: str = CODER_MODEL,
                    max_tokens: int = 3000, temperature: float = 0.3) -> str:
    try:
        async with httpx.AsyncClient(timeout=240) as client:
            res = await client.post(OLLAMA_URL, json={
                "model": model, "prompt": prompt, "stream": False,
                "options": {"temperature": temperature, "num_predict": max_tokens},
            })
            return res.json().get("response", "").strip()
    except Exception as e:
        print(f"[Agency] LLM error: {e}")
        return ""


def _clean_code(raw: str, lang: str = "html") -> str:
    if not raw:
        return ""

    # 1. Try markdown fences with language tag
    if lang:
        pattern = rf"```(?:{lang})?\s*(.*?)\s*```"
        match = re.search(pattern, raw, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1).strip()

    # 2. Try any markdown fences
    match = re.search(r"```(?:\w+)?\s*(.*?)\s*```", raw, re.DOTALL)
    if match:
        return match.group(1).strip()

    # 3. For HTML: look for doctype/html tags
    if lang == "html":
        low = raw.lower()
        start = low.find("<!doctype html>")
        if start == -1:
            start = low.find("<html")
        if start != -1:
            end = low.rfind("</html>")
            return raw[start:end + 7].strip() if end != -1 else raw[start:].strip()

    # 4. For JS/TS: strip LLM preamble (e.g. "Here is the corrected code:")
    if lang in ("javascript", "typescript"):
        lines = raw.split("\n")
        # Find first line that looks like actual JS
        start_idx = 0
        for i, line in enumerate(lines):
            stripped = line.strip()
            if (stripped.startswith(("const ", "let ", "var ", "function ", "class ",
                                     "import ", "export ", "//", "/*", "'use ",
                                     '"use ', "document.", "window.", "addEventListener"))
                or stripped == ""):
                start_idx = i
                break
        return "\n".join(lines[start_idx:]).strip()

    # 5. For CSS: find first selector or :root
    if lang == "css":
        lines = raw.split("\n")
        for i, line in enumerate(lines):
            stripped = line.strip()
            if (stripped.startswith((":", "@", "*", ".", "#", "body", "html", "/*"))
                or re.match(r'^[a-zA-Z][\w-]*\s*[\{,]', stripped)):
                return "\n".join(lines[i:]).strip()

    # 6. For Python: find first import/def/class
    if lang == "python":
        lines = raw.split("\n")
        for i, line in enumerate(lines):
            stripped = line.strip()
            if (stripped.startswith(("import ", "from ", "def ", "class ", "#", '"""', "'''"))
                or stripped == ""):
                return "\n".join(lines[i:]).strip()

    return raw.strip()


def _safe_json(raw: str) -> dict:
    if not raw:
        return {}
    cleaned = _clean_code(raw, "json")
    try:
        return json.loads(cleaned)
    except Exception:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                pass
    return {}


def _safe_json_list(raw: str) -> list:
    if not raw:
        return []
    cleaned = _clean_code(raw, "json")
    try:
        data = json.loads(cleaned)
        return data if isinstance(data, list) else []
    except Exception:
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
                return data if isinstance(data, list) else []
            except Exception:
                pass
    return []


def _format_contract(plan: dict) -> str:
    c = plan.get("ui_contract", {})
    lines = ["DOM IDs:"]
    for k, v in c.get("ids", {}).items():
        lines.append(f"  - {k}: '{v}'")
    lines.append("CSS Classes:")
    for k, v in c.get("classes", {}).items():
        lines.append(f"  - {k}: '{v}'")
    lines.append(f"Data attrs: {', '.join(c.get('data_attrs', []))}")
    return "\n".join(lines)


def _format_products(plan: dict) -> str:
    lines = []
    for p in plan.get("products", []):
        price = float(p.get("price", 0))
        desc = p.get("desc") or p.get("description", "")
        lines.append(f"- ID:{p.get('id')} | {p.get('name')} | {desc} | ${price:.2f}")
    return "\n".join(lines)


def _sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", name or "image.png").strip("._")
    if not cleaned:
        cleaned = "image.png"
    if not cleaned.lower().endswith(".png"):
        cleaned += ".png"
    return cleaned


# ─── Forge / Stable Diffusion ────────────────────────────────────────────────

async def generar_imagen_fisica(prompt: str, filename: str, project_path: str) -> str:
    assets_dir = os.path.join(project_path, "assets")
    os.makedirs(assets_dir, exist_ok=True)
    out_path = os.path.join(assets_dir, filename)
    
    realistic_suffix = ", photorealistic, 8k resolution, highly detailed photograph, cinematic lighting, ultra-realistic, RAW photo, masterpiece, best quality"
    negative_prompt = "cartoon, illustration, 3d render, low quality, bad anatomy, deformed, blurred, worst quality, text, watermark"
    final_prompt = prompt + realistic_suffix

    try:
        async with httpx.AsyncClient(timeout=None) as client:
            res = await client.post(FORGE_URL, json={
                "prompt": final_prompt, "negative_prompt": negative_prompt, "steps": 20, "width": 1024, "height": 1024,
            })
            if res.status_code == 200:
                img_data = res.json().get("images", [None])[0]
                if img_data:
                    with open(out_path, "wb") as f:
                        f.write(base64.b64decode(img_data))
                    print(f"[Agency] GPU image saved: assets/{filename}")
                    return f"assets/{filename}"
    except Exception as e:
        print(f"[Agency] Forge unavailable ({e}), using fallback.")

    idx = hash(filename) % len(UNSPLASH_FALLBACKS)
    return UNSPLASH_FALLBACKS[idx]


async def _liberar_vram_forge() -> None:
    try:
        base = FORGE_URL.rsplit("/", 1)[0]
        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(f"{base}/unload-checkpoint")
            print("[Agency] Forge VRAM checkpoint unloaded.")
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
# AGENTE 1: ARCHITECT  (Analiza dominio + define contrato de IDs)
# ═══════════════════════════════════════════════════════════════════════════════

ARCHITECT_PROMPT = """You are a Senior Software Architect.
Analyze this request: {user_prompt}

1. Identify the DOMAIN (e.g. Fashion, Gastronomy, Technology, Sports).
2. Define a project title.
3. Count how many products/items the user wants. Look for numbers in the request (e.g. "8 products", "con 6 zapatillas", "10 items"). If no number is specified, use 4. Maximum is 10.
4. List that many products/items for this domain with id, name, desc, price. Each product must be UNIQUE.
5. Define the ui_contract with DOM IDs and classes.

Output ONLY valid JSON (no markdown, no explanation):
{{
  "domain": "Gastronomy",
  "title": "Cafe Premium",
  "sections": ["navbar", "hero", "products", "cart-sidebar", "footer"],
  "ui_contract": {{
    "ids": {{
      "cart_count": "cart-count",
      "cart_sidebar": "cart-sidebar",
      "cart_items": "cart-items-container",
      "cart_total": "total-price",
      "product_grid": "product-grid"
    }},
    "classes": {{"add_to_cart": "btn-add", "open_cart": "btn-open-cart"}},
    "data_attrs": ["data-id", "data-name", "data-price"]
  }},
  "products": [
    {{"id": 1, "name": "Espresso", "desc": "Bold and rich", "price": 4.50}},
    {{"id": 2, "name": "Latte", "desc": "Smooth and creamy", "price": 5.50}},
    {{"id": 3, "name": "Croissant", "desc": "Buttery pastry", "price": 3.50}},
    {{"id": 4, "name": "Mocha", "desc": "Chocolate coffee", "price": 6.00}}
  ]
}}"""


async def run_architect(user_prompt: str) -> Dict:
    print("[1/5] Architect analizando dominio...")
    raw = await _call_llm(
        ARCHITECT_PROMPT.format(user_prompt=user_prompt[:500]),
        max_tokens=2000, temperature=0.4,
    )
    plan = _safe_json(raw)
    if plan.get("ui_contract") and plan.get("products"):
        # Limitar a 10 productos maximo
        plan["products"] = plan["products"][:10]
        print(f"[1/5] Architect OK -> dominio: {plan.get('domain')}, {len(plan['products'])} productos")
        return plan
    print("[1/5] Architect fallback -> plan default")
    return DEFAULT_PLAN


# ═══════════════════════════════════════════════════════════════════════════════
# AGENTE 2: STYLIST  (CSS tokens coherentes con el dominio)
# ═══════════════════════════════════════════════════════════════════════════════

STYLIST_PROMPT = """You are an elite UI Designer.
DOMAIN: {domain}
PROJECT: {user_prompt}
DESIGN SPEC: {design_md}

Create a CSS :root block with tokens for this domain.
Output ONLY the :root block, no markdown, no explanation.

Required variables:
  --color-bg, --color-surface, --color-surface-2,
  --color-accent, --color-accent-hover,
  --color-text, --color-text-muted, --color-border,
  --font-display, --font-body,
  --radius-sm, --radius-md, --radius-lg,
  --shadow-sm, --shadow-md, --shadow-lg,
  --transition, --spacing-unit"""

FALLBACK_CSS = """:root {
  --color-bg: #0a0a0a; --color-surface: #141414; --color-surface-2: #1f1f1f;
  --color-accent: #c9a96e; --color-accent-hover: #e8c98a;
  --color-text: #f0ede8; --color-text-muted: #9a9087; --color-border: #2a2a2a;
  --font-display: 'Playfair Display', serif; --font-body: 'Inter', sans-serif;
  --radius-sm: 8px; --radius-md: 16px; --radius-lg: 32px;
  --shadow-sm: 0 4px 6px rgba(0,0,0,0.3); --shadow-md: 0 10px 25px rgba(0,0,0,0.5);
  --shadow-lg: 0 25px 50px rgba(0,0,0,0.7); --transition: 0.3s ease;
  --spacing-unit: 1rem;
}"""


async def run_stylist(user_prompt: str, domain: str, design_md: str) -> str:
    print(f"[2/5] Stylist generando tokens para: {domain}")
    raw = await _call_llm(
        STYLIST_PROMPT.format(
            domain=domain, user_prompt=user_prompt[:400],
            design_md=design_md[:3000] if design_md else "(Invent a stunning palette for this domain.)",
        ),
        max_tokens=600, temperature=0.5,
    )
    match = re.search(r":root\s*\{.*?\}", raw, re.DOTALL)
    if match:
        css = match.group(0)
        print(f"[2/5] Stylist OK -> {css.count('--')} variables")
        return css
    print("[2/5] Stylist fallback -> tokens default")
    return FALLBACK_CSS


# ═══════════════════════════════════════════════════════════════════════════════
# AGENTE 3: PHOTOGRAPHER  (Imagenes con Forge o Unsplash)
# ═══════════════════════════════════════════════════════════════════════════════

PHOTOGRAPHER_PROMPT = """You are a Prompt Engineer for Stable Diffusion.
DOMAIN: {domain}
PRODUCTS: {products}

RULE: Images must match the domain. If it's Coffee, NO sushi. If it's Fashion, NO food.
Generate 1 hero + 1 per product.
Output ONLY JSON list:
[{{"name": "hero.png", "prompt": "..."}}, {{"name": "product_1.png", "prompt": "..."}}, ...]"""


async def run_photographer(user_prompt: str, domain: str, plan: dict,
                           project_path: str) -> Dict:
    products = plan.get("products", [])
    num_products = len(products)
    print(f"[3/5] Photographer: {domain} -> hero + {num_products} productos")

    raw = await _call_llm(
        PHOTOGRAPHER_PROMPT.format(domain=domain, products=_format_products(plan)),
        max_tokens=1200, temperature=0.4,
    )
    prompts = _safe_json_list(raw)

    # Normalizar: hero + 1 por cada producto del plan
    desired = ["hero.png"] + [f"product_{i+1}.png" for i in range(num_products)]
    fallback_texts = [f"{domain} store hero, cinematic lighting, 8k"]
    for p in products:
        name = p.get("name", "product")
        fallback_texts.append(f"{name}, {domain}, product photography, studio lighting, 8k")

    normalized = []
    for i, fname in enumerate(desired):
        txt = fallback_texts[i] if i < len(fallback_texts) else f"{domain} product, 8k"
        if i < len(prompts) and isinstance(prompts[i], dict):
            txt = prompts[i].get("prompt") or txt
        normalized.append({"name": fname, "prompt": txt})

    # Generar imagenes
    image_paths: List[str] = []
    if project_path:
        for item in normalized:
            path = await generar_imagen_fisica(
                item["prompt"], _sanitize_filename(item["name"]), project_path
            )
            image_paths.append(path)
        await _liberar_vram_forge()
    else:
        # Fallback: usar Unsplash con rotacion (sin repetir si hay suficientes)
        for i in range(len(normalized)):
            image_paths.append(UNSPLASH_FALLBACKS[i % len(UNSPLASH_FALLBACKS)])

    print(f"[3/5] Photographer OK -> {len(image_paths)} imagenes unicas")
    return {"prompts": normalized, "image_paths": image_paths}


# ═══════════════════════════════════════════════════════════════════════════════
# AGENTE 4: CODER  (HTML + CSS solamente, NO JavaScript)
# ═══════════════════════════════════════════════════════════════════════════════

CODER_PROMPT = """You are a SENIOR FRONTEND DEVELOPER building a {domain} website.

CSS TOKENS (put in a <style> tag in <head>):
{css_vars}

UI CONTRACT (use these EXACT IDs and classes):
{ui_contract}

PRODUCTS (hardcode these as cards):
{products}

IMAGE PATHS (use in <img src="...">):
{image_paths}

RULES:
1. Output ONLY raw HTML starting with <!DOCTYPE html>.
2. Include <script src="https://cdn.tailwindcss.com"></script> in head.
3. Include <link rel="stylesheet" href="style.css"> in head.
4. Build: Navbar with cart icon (id from contract), Hero section, Product Grid, Cart Sidebar, Footer.
5. The Cart Sidebar must be hidden by default (translate-x-full) with the contract ID.
6. Each product card must have an 'Add to Cart' button with the contract class AND data-id, data-name, data-price attributes.
7. Use glassmorphism, rounded corners, smooth design. Map CSS vars: bg-[var(--color-bg)] etc.
8. DO NOT use via.placeholder.com. Use the IMAGE PATHS above.
9. DO NOT write ANY <script> tags or JavaScript. Add <script src="script.js" defer></script> before </body>.
10. The product grid container must have id="{grid_id}".

OUTPUT: ONLY the HTML. No markdown fences. No JS logic."""


async def run_coder(user_prompt: str, plan: dict, css_vars: str,
                    image_paths: list) -> str:
    print("[4/5] Coder construyendo HTML...")
    domain = plan.get("domain", "General")
    grid_id = plan.get("ui_contract", {}).get("ids", {}).get("product_grid", "product-grid")
    paths_str = "\n".join(f"- Image {i+1}: {p}" for i, p in enumerate(image_paths))
    if not paths_str:
        paths_str = "Use Unsplash images for the domain."

    raw = await _call_llm(
        CODER_PROMPT.format(
            domain=domain,
            css_vars=css_vars[:800],
            ui_contract=_format_contract(plan),
            products=_format_products(plan),
            image_paths=paths_str,
            grid_id=grid_id,
        ),
        max_tokens=7000, temperature=0.3,
    )
    html = _clean_code(raw, "html")
    print(f"[4/5] Coder OK -> {len(html)} chars HTML")
    return html


# ═══════════════════════════════════════════════════════════════════════════════
# AGENTE 5: SCRIPTER  (Template JS deterministico — NO depende del LLM)
# ═══════════════════════════════════════════════════════════════════════════════
# El modelo de 7B no puede escribir JS complejo de forma confiable.
# Usamos un template probado e inyectamos los datos dinamicos con Python.

def _build_script_js(plan: dict, image_paths: list) -> str:
    """Genera un script.js 100% funcional a partir del plan del Architect."""
    ids = plan.get("ui_contract", {}).get("ids", {})
    classes = plan.get("ui_contract", {}).get("classes", {})
    products = plan.get("products", [])

    # IDs del contrato
    grid_id = ids.get("product_grid", "product-grid")
    sidebar_id = ids.get("cart_sidebar", "cart-sidebar")
    items_id = ids.get("cart_items", "cart-items-container")
    total_id = ids.get("cart_total", "total-price")
    count_id = ids.get("cart_count", "cart-count")
    add_class = classes.get("add_to_cart", "btn-add")
    open_class = classes.get("open_cart", "btn-open-cart")

    # Construir array de productos JS
    js_products = []
    for i, p in enumerate(products):
        price = float(p.get("price", 0))
        desc = p.get("desc") or p.get("description", "")
        img = image_paths[i + 1] if (i + 1) < len(image_paths) else (image_paths[0] if image_paths else "")
        js_products.append(
            f'  {{ id: {p.get("id", i+1)}, name: "{p.get("name", "Product")}", '
            f'desc: "{desc}", price: {price}, image: "{img}" }}'
        )
    products_str = ",\n".join(js_products)

    return f'''// === Auto-generated by Jarvis Agency ===
const PRODUCTS = [
{products_str}
];

let cart = JSON.parse(localStorage.getItem("jarvis_cart") || "[]");

document.addEventListener("DOMContentLoaded", () => {{
  renderProducts();
  updateCartUI();

  // Event delegation for add-to-cart
  document.addEventListener("click", (e) => {{
    const addBtn = e.target.closest(".{add_class}");
    if (addBtn) {{
      const id = parseInt(addBtn.dataset.id);
      const product = PRODUCTS.find(p => p.id === id);
      if (product) {{
        cart.push({{ ...product }});
        localStorage.setItem("jarvis_cart", JSON.stringify(cart));
        updateCartUI();
        // Visual feedback
        addBtn.textContent = "Added!";
        addBtn.style.transform = "scale(1.1)";
        setTimeout(() => {{
          addBtn.textContent = "Add to Cart";
          addBtn.style.transform = "scale(1)";
        }}, 600);
      }}
      return;
    }}

    // Open cart
    if (e.target.closest(".{open_class}")) {{
      toggleCart();
      return;
    }}

    // Remove from cart
    const removeBtn = e.target.closest(".cart-remove-btn");
    if (removeBtn) {{
      const idx = parseInt(removeBtn.dataset.index);
      cart.splice(idx, 1);
      localStorage.setItem("jarvis_cart", JSON.stringify(cart));
      updateCartUI();
      return;
    }}

    // Close cart
    if (e.target.closest(".cart-close-btn")) {{
      toggleCart();
      return;
    }}
  }});
}});

function renderProducts() {{
  const grid = document.getElementById("{grid_id}");
  if (!grid) return;
  grid.innerHTML = "";
  PRODUCTS.forEach(p => {{
    const card = document.createElement("div");
    card.className = "rounded-2xl overflow-hidden shadow-lg";
    card.style.background = "var(--color-surface, #1a1a1a)";
    card.innerHTML = `
      <img src="${{p.image}}" alt="${{p.name}}" class="w-full h-56 object-cover">
      <div class="p-5">
        <h3 class="text-lg font-bold mb-1">${{p.name}}</h3>
        <p class="text-sm opacity-70 mb-3">${{p.desc}}</p>
        <div class="flex items-center justify-between">
          <span class="text-xl font-bold" style="color:var(--color-accent,#c9a96e)">$${{p.price.toFixed(2)}}</span>
          <button class="{add_class} px-4 py-2 rounded-xl text-white font-semibold text-sm"
                  style="background:var(--color-accent,#c9a96e)"
                  data-id="${{p.id}}" data-name="${{p.name}}" data-price="${{p.price}}">
            Add to Cart
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }});
}}

function updateCartUI() {{
  // Update count badge
  const countEl = document.getElementById("{count_id}");
  if (countEl) countEl.textContent = cart.length;

  // Update cart items list
  const itemsEl = document.getElementById("{items_id}");
  if (itemsEl) {{
    itemsEl.innerHTML = "";
    if (cart.length === 0) {{
      itemsEl.innerHTML = '<p class="text-center opacity-50 py-8">Cart is empty</p>';
    }} else {{
      cart.forEach((item, idx) => {{
        const row = document.createElement("div");
        row.className = "flex items-center justify-between py-3 border-b";
        row.style.borderColor = "var(--color-border, #333)";
        row.innerHTML = `
          <div class="flex-1">
            <p class="font-semibold text-sm">${{item.name}}</p>
            <p class="text-xs opacity-60">$${{item.price.toFixed(2)}}</p>
          </div>
          <button class="cart-remove-btn text-red-400 hover:text-red-300 text-lg px-2" data-index="${{idx}}">&times;</button>
        `;
        itemsEl.appendChild(row);
      }});
    }}
  }}

  // Update total
  const totalEl = document.getElementById("{total_id}");
  if (totalEl) {{
    const total = cart.reduce((sum, item) => sum + item.price, 0);
    totalEl.textContent = total.toFixed(2);
  }}
}}

function toggleCart() {{
  const sidebar = document.getElementById("{sidebar_id}");
  if (!sidebar) return;
  const isOpen = sidebar.classList.contains("open") || sidebar.classList.contains("is-open");
  if (isOpen) {{
    sidebar.classList.remove("open", "is-open");
    sidebar.style.transform = "translateX(110%)";
  }} else {{
    sidebar.classList.add("open", "is-open");
    sidebar.style.transform = "translateX(0)";
  }}
}}
'''


# ═══════════════════════════════════════════════════════════════════════════════
# AGENTE EDITOR  (Lee codigo existente + instruccion → devuelve codigo editado)
# ═══════════════════════════════════════════════════════════════════════════════

# Extensiones que el editor puede leer
EDITABLE_EXTENSIONS = {
    ".html", ".htm", ".css", ".js", ".ts", ".jsx", ".tsx",
    ".json", ".py", ".md", ".txt", ".xml", ".svg", ".php",
    ".vue", ".svelte", ".astro", ".yaml", ".yml", ".toml",
    ".env", ".sh", ".bat", ".ps1", ".sql", ".rb", ".go",
}
MAX_FILES = 30
MAX_CHARS_PER_FILE = 15000


def load_project_files(path: str) -> Dict[str, str]:
    """
    Carga archivos editables de una carpeta o archivo individual.
    Retorna dict {filename_relativo: contenido}.
    Limite: 30 archivos, 15000 chars c/u.
    """
    files = {}

    if os.path.isfile(path):
        ext = os.path.splitext(path)[1].lower()
        if ext in EDITABLE_EXTENSIONS:
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    files[os.path.basename(path)] = f.read()[:MAX_CHARS_PER_FILE]
            except Exception as e:
                print(f"[Editor] Error leyendo {path}: {e}")
        return files

    if not os.path.isdir(path):
        return files

    count = 0
    for root, dirs, filenames in os.walk(path):
        # Ignorar carpetas comunes
        dirs[:] = [d for d in dirs if d not in {
            "node_modules", ".git", "__pycache__", "venv", ".venv",
            "dist", "build", ".next", ".nuxt", "vendor",
        }]
        for fname in sorted(filenames):
            if count >= MAX_FILES:
                break
            ext = os.path.splitext(fname)[1].lower()
            if ext not in EDITABLE_EXTENSIONS:
                continue
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, path).replace("\\", "/")
            try:
                with open(full, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()[:MAX_CHARS_PER_FILE]
                files[rel] = content
                count += 1
            except Exception:
                pass
        if count >= MAX_FILES:
            break

    print(f"[Editor] Cargados {len(files)} archivos de: {path}")
    return files


def _detect_target_files(instruction: str, available_files: list) -> list:
    """Detecta qué archivos necesita editar basándose en la instrucción."""
    low = instruction.lower()
    targets = []

    # Mapeo de keywords a extensiones/nombres
    rules = [
        (["js", "javascript", "script", "carrito", "cart", "boton", "botón",
          "click", "evento", "funcion", "función", "logica", "lógica"], [".js", ".ts", ".jsx", ".tsx"]),
        (["css", "estilo", "color", "diseño", "fuente", "font", "margin",
          "padding", "borde", "sombra", "animacion", "animación"], [".css"]),
        (["html", "estructura", "seccion", "sección", "navbar", "footer",
          "header", "hero", "sidebar", "formulario", "form"], [".html", ".htm"]),
        (["python", "backend", "api", "server", "endpoint"], [".py"]),
        (["json", "config", "package", "datos"], [".json"]),
    ]

    matched_exts = set()
    for keywords, exts in rules:
        if any(k in low for k in keywords):
            matched_exts.update(exts)

    # Si el usuario menciona un archivo específico
    for f in available_files:
        if f.lower() in low or os.path.basename(f).lower() in low:
            targets.append(f)

    # Filtrar por extensiones detectadas
    if matched_exts:
        for f in available_files:
            ext = os.path.splitext(f)[1].lower()
            if ext in matched_exts and f not in targets:
                targets.append(f)

    # Si nada matcheó, editar los principales
    if not targets:
        priority = ["index.html", "script.js", "style.css", "main.js", "app.js"]
        for p in priority:
            for f in available_files:
                if f.endswith(p) and f not in targets:
                    targets.append(f)

    return targets[:5]  # Máximo 5 archivos a editar por vez


EDITOR_PROMPT_JS = """You are a JavaScript expert. EDIT this file.

TASK: {instruction}

CURRENT {filename}:
```javascript
{file_content}
```

{other_files_context}

Apply the changes the user requested. You MUST modify the code.
Output the COMPLETE updated JavaScript file wrapped in ```javascript fences.
Do NOT explain. Do NOT skip any existing code. Output ALL the code with your changes applied."""

EDITOR_PROMPT_HTML = """You are an HTML/CSS expert. EDIT this file.

TASK: {instruction}

CURRENT {filename}:
```html
{file_content}
```

{other_files_context}

Apply the changes the user requested. You MUST modify the code.
Output the COMPLETE updated HTML file wrapped in ```html fences.
Do NOT explain. Do NOT skip any existing code. Output ALL the code with your changes applied."""

EDITOR_PROMPT_CSS = """You are a CSS expert. EDIT this file.

TASK: {instruction}

CURRENT {filename}:
```css
{file_content}
```

{other_files_context}

Apply the changes the user requested. You MUST modify the code.
Output the COMPLETE updated CSS file wrapped in ```css fences.
Do NOT explain. Do NOT skip any existing code. Output ALL the code with your changes applied."""

EDITOR_PROMPT_GENERIC = """You are a code editor. EDIT this file.

TASK: {instruction}

CURRENT {filename}:
```
{file_content}
```

{other_files_context}

Apply the changes the user requested. You MUST modify the code.
Output the COMPLETE updated file wrapped in ``` fences.
Do NOT explain. Do NOT skip any existing code. Output ALL the code with your changes applied."""


def _get_editor_prompt(lang: str) -> str:
    if lang == "javascript" or lang == "typescript":
        return EDITOR_PROMPT_JS
    if lang == "html":
        return EDITOR_PROMPT_HTML
    if lang == "css":
        return EDITOR_PROMPT_CSS
    return EDITOR_PROMPT_GENERIC


async def run_editor(instruction: str, files_context: Dict[str, str],
                     target_path: str) -> Dict[str, str]:
    """
    Agente Editor: lee archivos existentes + instrucción → genera versiones editadas.
    Retorna dict {filename: nuevo_contenido}.
    """
    available = list(files_context.keys())
    targets = _detect_target_files(instruction, available)

    if not targets:
        print("[Editor] No se detectaron archivos para editar.")
        return {}

    print(f"[Editor] Archivos a editar: {targets}")
    edited_files = {}

    for filename in targets:
        content = files_context.get(filename, "")
        if not content:
            continue

        # Contexto de otros archivos (resumido)
        other_context = ""
        other_files = [f for f in available if f != filename][:5]
        if other_files:
            snippets = []
            for of in other_files:
                snippet = files_context[of][:2000]
                snippets.append(f"--- {of} (first 2000 chars) ---\n{snippet}")
            other_context = "OTHER FILES FOR REFERENCE:\n" + "\n\n".join(snippets)

        # Detectar lenguaje
        ext = os.path.splitext(filename)[1].lower()
        lang_map = {".html": "html", ".htm": "html", ".css": "css",
                    ".js": "javascript", ".ts": "typescript", ".py": "python",
                    ".json": "json", ".jsx": "javascript", ".tsx": "typescript"}
        lang = lang_map.get(ext, "")

        prompt_template = _get_editor_prompt(lang)
        raw = await _call_llm(
            prompt_template.format(
                instruction=instruction[:500],
                filename=filename,
                file_content=content[:12000],
                other_files_context=other_context[:4000],
            ),
            max_tokens=8000, temperature=0.3,
        )

        edited = _clean_code(raw, lang) if lang else raw.strip()

        # Validación: el resultado debe tener contenido razonable
        if len(edited) > 50:
            edited_files[filename] = edited
            changed = "SIN CAMBIOS" if edited.strip() == content.strip() else "MODIFICADO"
            print(f"[Editor] {filename}: {len(content)} -> {len(edited)} chars [{changed}]")
        else:
            print(f"[Editor] {filename} - resultado muy corto, manteniendo original")
            edited_files[filename] = content

    return edited_files


# ═══════════════════════════════════════════════════════════════════════════════
# ENSAMBLAJE FINAL (Python deterministico, NO un agente LLM)
# ═══════════════════════════════════════════════════════════════════════════════

def _build_stylesheet(css_vars: str) -> str:
    base = """
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@300;400;600&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--font-body, 'Inter', sans-serif);
    background: var(--color-bg, #0a0a0a);
    color: var(--color-text, #f0ede8);
}
img { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }

#cart-sidebar {
    transform: translateX(110%);
    transition: transform var(--transition, 0.3s ease);
}
#cart-sidebar.open,
#cart-sidebar.is-open { transform: translateX(0); }

.btn-add {
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.btn-add:active { transform: scale(0.95); }
"""
    return f"{css_vars.strip()}\n\n{base.strip()}\n"


def _ensure_links(html: str) -> str:
    """Garantiza que style.css y script.js esten linkeados."""
    if not html:
        return html
    if "style.css" not in html:
        html = html.replace("</head>", '  <link rel="stylesheet" href="style.css">\n</head>')
    if "script.js" not in html:
        html = html.replace("</body>", '  <script src="script.js" defer></script>\n</body>')
    return html


def _fix_placeholder_images(html: str) -> str:
    """Reemplaza cualquier placeholder URL que el LLM haya colado."""
    idx = [0]
    def _next(match):
        url = UNSPLASH_FALLBACKS[idx[0] % len(UNSPLASH_FALLBACKS)]
        idx[0] += 1
        return url
    return re.sub(r'https?://via\.placeholder\.com/[^"\')\s]*', _next, html)


def _patch_missing_ids(html: str, plan: dict) -> str:
    """Inyecta IDs del contrato que falten en el HTML."""
    ids = plan.get("ui_contract", {}).get("ids", {})

    def _has(dom_id):
        return f'id="{dom_id}"' in html or f"id='{dom_id}'" in html

    patches = []

    sidebar_id = ids.get("cart_sidebar", "cart-sidebar")
    items_id = ids.get("cart_items", "cart-items-container")
    total_id = ids.get("cart_total", "total-price")
    if not _has(sidebar_id):
        patches.append(f'''<aside id="{sidebar_id}" class="fixed right-0 top-0 h-full w-80 shadow-2xl p-6 z-50" style="background:var(--color-surface,#141414);color:var(--color-text,#fff);">
  <div class="flex justify-between items-center mb-6">
    <h2 class="text-2xl font-bold">Cart</h2>
    <button onclick="toggleCart()" class="text-2xl">&times;</button>
  </div>
  <div id="{items_id}" class="space-y-4 overflow-y-auto" style="max-height:60vh;"></div>
  <div class="border-t mt-6 pt-4 text-xl font-bold">Total: $<span id="{total_id}">0.00</span></div>
</aside>''')

    count_id = ids.get("cart_count", "cart-count")
    if not _has(count_id):
        # Try to inject into nav
        if "</nav>" in html:
            btn = f'<button class="btn-open-cart relative p-2 text-xl">🛒<span id="{count_id}" class="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">0</span></button>'
            html = html.replace("</nav>", f"{btn}</nav>")
        else:
            patches.append(f'<span id="{count_id}" style="display:none;">0</span>')

    grid_id = ids.get("product_grid", "product-grid")
    if not _has(grid_id):
        patches.append(f'<div id="{grid_id}" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto px-6 py-12"></div>')

    if patches:
        combined = "\n".join(patches)
        if "</body>" in html:
            html = html.replace("</body>", f"{combined}\n</body>")
        else:
            html += combined

    return html


# ═══════════════════════════════════════════════════════════════════════════════
# ORQUESTADOR PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

async def run_agency(user_prompt: str, project_path: str, design_md: str = "") -> Dict:
    """
    Pipeline: Architect -> Stylist -> Photographer -> Coder -> Scripter -> Assembly
    Signature matches developer_service.py call.
    """
    print("\n" + "=" * 60)
    print(f"[PIPELINE] Iniciando para: {user_prompt[:60]}")
    print("=" * 60)

    # 1. Architect
    plan = await run_architect(user_prompt)
    domain = plan.get("domain", "General")

    # 2. Stylist
    css_vars = await run_stylist(user_prompt, domain, design_md)

    # 3. Photographer
    photo_result = await run_photographer(user_prompt, domain, plan, project_path)
    image_paths = photo_result.get("image_paths", [])

    # 4. Coder (HTML)
    html = await run_coder(user_prompt, plan, css_vars, image_paths)

    # 5. Scripter (JS deterministico — template Python, no LLM)
    print("[5/5] Generando script.js desde template...")
    js = _build_script_js(plan, image_paths)
    print(f"[5/5] Script OK -> {len(js)} chars JS")

    # ── Ensamblaje deterministico (Python, no LLM) ────────────────────
    html = _fix_placeholder_images(html)
    html = _patch_missing_ids(html, plan)
    html = _ensure_links(html)
    stylesheet = _build_stylesheet(css_vars)

    files = {
        "index.html": html,
        "style.css": stylesheet,
        "script.js": js,
    }

    print("\n" + "=" * 60)
    print(f"[PIPELINE] Completo: {domain} | {len(files)} archivos")
    for fname, content in files.items():
        print(f"  -> {fname}: {len(content)} chars")
    print("=" * 60)

    return {
        "files": files,
        "image_paths": image_paths,
        "image_prompts": photo_result.get("prompts", []),
        "plan": plan,
    }
