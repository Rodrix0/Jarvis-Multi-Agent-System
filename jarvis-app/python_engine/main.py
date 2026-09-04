from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from bs4 import BeautifulSoup
import uvicorn
import datetime
import subprocess
import os
import ast
import json
import asyncio
import httpx
import requests
import urllib.request
import importlib.util
from rag_service import query_rag
from developer_service import dev_jarvis

app = FastAPI()

SKILLS_DIR = os.path.join(os.path.dirname(__file__), "skills")
if not os.path.exists(SKILLS_DIR):
    os.makedirs(SKILLS_DIR)

class ActionRequest(BaseModel):
    action: str
    target: str = None
    message: str = None
    parameters: dict = {}

class DevelopRequest(BaseModel):
    objective: str

class ExecuteSkillRequest(BaseModel):
    skill_name: str
    kwargs: dict = {}

async def call_ollama(prompt: str) -> str:
    url = "http://127.0.0.1:11434/api/generate"
    data = {
        "model": "llama3.1:latest",
        "prompt": prompt,
        "stream": False
    }
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            response = await client.post(url, json=data)
            response.raise_for_status()
            result = response.json()
            return result.get("response", "")
        except Exception as e:
            print(f"Error calling Ollama: {e}")
            return ""

async def generate_and_test_skill(objective: str):
    print(f"[Code-Act] Desarrollando nueva habilidad en las sombras: {objective}")
    
    prompt = f"""Escribe un script de Python puro que cumpla estrictamente este objetivo: "{objective}".
REGLAS:
1. El script DEBE tener una funcion llamada exactamente `execute(**kwargs)` que reciba argumentos (si aplican) y devuelva un string legible explicandolo.
2. NO uses dependencias externas raras que requieran `pip install`. Usa nativas: os, sys, datetime, urllib, json, subprocess, math, random.
3. Añade un docstring a `execute` que diga exactamente qué hace en 1 sola linea corta.
4. NUNCA escribas explicaciones ni texto fuera de los bloques de codigo.
5. Usa código seguro.

Formato esperado:
```python
def execute(**kwargs):
    \"\"\"Descripción corta de lo que hace (max 100 caracteres)\"\"\"
    # logica
    return "Resultado final"
```
"""
    
    code_response = await call_ollama(prompt)
    if not code_response:
        print("[Code-Act] ❌ Fallo al comunicarse con Ollama.")
        return
        
    code = ""
    if "```python" in code_response:
        code = code_response.split("```python")[1].split("```")[0].strip()
    elif "```" in code_response:
        code = code_response.split("```")[1].split("```")[0].strip()
    else:
        code = code_response.strip()

    if "def execute(" not in code:
        print("[Code-Act] ❌ El código generado no contiene def execute()")
        return

    name_prompt = f"Dado este objetivo: '{objective}', devuelve SOLAMENTE un nombre de archivo en snake_case corto (sin python ni extensiones). Ej: 'descargar_video'"
    name = await call_ollama(name_prompt).strip().replace(" ", "_").replace("'", "").replace('"', '').replace('.', '').replace(',', '').replace('`', '').lower()
    if not name or len(name) > 30:
        import time
        name = f"custom_{int(time.time())}"
        
    filename = f"skill_{name}.py"
    filepath = os.path.join(SKILLS_DIR, filename)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)
        
    print(f"[Code-Act] ✅ Código guardado en {filename}. Probando sintaxis...")
    
    try:
        ast.parse(code)
        spec = importlib.util.spec_from_file_location(f"skill_{name}", filepath)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if hasattr(module, 'execute'):
            print(f"[Code-Act] 🚀 Habilidad {filename} creada y validada sintácticamente con éxito.")
            try:
                alert_text = f"Señor, acabo de terminar de asimilar la nueva habilidad. Ya puede utilizarla cuando desee."
                req = urllib.request.Request("http://127.0.0.1:3000/api/speak", data=json.dumps({"text": alert_text}).encode('utf-8'), headers={'Content-Type': 'application/json'})
                urllib.request.urlopen(req)
            except Exception as e:
                pass
        else:
            print(f"[Code-Act] ❌ No se encontró 'execute' en {filename}.")
    except Exception as e:
        print(f"[Code-Act] ❌ Error de sintaxis en {filename}: {e}")
        os.remove(filepath)

@app.post("/develop_skill")
def develop_skill(req: DevelopRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(generate_and_test_skill, req.objective)
    return {"status": "success", "message": f"Estoy diseñando la habilidad '{req.objective}' en mis subprocesos. Te avisaré si logro compilarla."}

@app.get("/list_skills")
def list_skills():
    skills = []
    if not os.path.exists(SKILLS_DIR):
        return skills
        
    for f in os.listdir(SKILLS_DIR):
        if f.startswith("skill_") and f.endswith(".py"):
            skill_name = f[:-3]
            filepath = os.path.join(SKILLS_DIR, f)
            desc = f"SCRIPT EJECUTABLE. Tarea: {skill_name.replace('skill_', '').replace('_', ' ')}. ÚSALA SOLO SI EL USUARIO LA PIDE."
            try:
                with open(filepath, 'r', encoding='utf-8') as file:
                    source = file.read()
                    parsed = ast.parse(source)
                    for node in parsed.body:
                        if isinstance(node, ast.FunctionDef) and node.name == 'execute':
                            doc = ast.get_docstring(node)
                            if doc:
                                desc = f"SCRIPT PROGRAMADO. {doc.strip().split('\\n')[0]}. Úsalo EXCLUSIVAMENTE si el usuario quiere ejecutar esta herramienta específica de nuevo."
            except:
                pass
                
            skills.append({
                "name": skill_name,
                "description": desc,
                "parameters": {
                    "type": "object", 
                    "properties": {
                        "kwargs_str": {
                            "type": "string",
                            "description": "Cualquier texto o parámetros extra que la habilidad pueda necesitar (opcional)"
                        }
                    }
                }
            })
            
    return skills

@app.post("/execute_skill")
def exec_skill(req: ExecuteSkillRequest):
    filepath = os.path.join(SKILLS_DIR, f"{req.skill_name}.py")
    if not os.path.exists(filepath):
        return {"status": "error", "message": f"No se encontró {req.skill_name}"}
        
    try:
        spec = importlib.util.spec_from_file_location(req.skill_name, filepath)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        if hasattr(module, 'execute'):
            result = module.execute(**req.kwargs)
            return {"status": "success", "result": str(result)}
        else:
            return {"status": "error", "message": "Script mal defindo"}
    except Exception as e:
        return {"status": "error", "message": f"Excepción en ejecución: {e}"}

@app.post("/execute")
def execute_action(req: ActionRequest):
    print(f"Ejecutando acción nativa: {req.action}")
    if req.action == "send_whatsapp":
        if req.target and req.message:
            try:
                result = subprocess.run([
                    "powershell", "-ExecutionPolicy", "Bypass", 
                    "-File", "../backend/scripts/sendWhatsAppByName.ps1", 
                    "-ContactName", req.target, 
                    "-MessageText", req.message
                ], capture_output=True, text=True)
                return {"status": "success", "message": "Mensaje enviado", "output": result.stdout}
            except Exception as e:
                return {"status": "error", "message": str(e)}
        return {"status": "error", "message": "Faltan parámetros"}
    elif req.action == "send_email":
        return {"status": "success", "message": f"Correo a {req.target}"}
    elif req.action == "search_web":
        return {"status": "success", "message": "Buscando web"}
    else:
        return {"status": "error", "message": "Acción no reconocida"}

import re
import datetime
import unicodedata
from duckduckgo_search import DDGS

# --- 1. MOTOR FINANCIERO (Mantiene tu 100% de éxito) ---
def get_financial_snapshot():
    snapshot = "--- REPORTE FINANCIERO ARGENTINA 2026 ---\n"
    try:
        r = requests.get("https://dolarapi.com/v1/dolares", timeout=8)
        if r.status_code == 200:
            for d in r.json():
                snapshot += f"Dólar {d['nombre']}: Compra ${d['compra']} | Venta ${d['venta']}\n"
    except: snapshot += "Error Dólares.\n"

    snapshot += "\n--- CRIPTO (USD) ---\n"
    coins = {'BTC': 'BTCUSDT', 'ETH': 'ETHUSDT', 'SOL': 'SOLUSDT', 'XRP': 'XRPUSDT', 'USDT': 'USDTUSDC', 'TRX': 'TRXUSDT'}
    for name, ticker in coins.items():
        try:
            res = requests.get(f"https://api.binance.com/api/v3/ticker/price?symbol={ticker}", timeout=5)
            if res.status_code == 200:
                p = float(res.json()['price'])
                snapshot += f"{name}: {p:,.2f} USD\n"
        except: continue
    return snapshot

# --- 2. MOTOR DEPORTIVO CON LÓGICA DE TIEMPO (Tu solución) ---
async def get_sports_universal(query: str):
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    ahora = datetime.datetime.now()
    hoy_str = ahora.strftime("%d/%m/%Y")
    
    # Limpiamos el nombre del equipo
    stopwords = ["cuándo", "cuando", "juega", "el", "la", "partido", "de", "del", "contra", "vs", "resultado"]
    team_name = " ".join([word for word in query.lower().split() if word not in stopwords]).strip()
    
    if not team_name: return "No detecté el nombre del equipo."

    async with httpx.AsyncClient(headers=headers, timeout=15) as client:
        try:
            # 1. Buscar el equipo en SofaScore
            search = await client.get(f"https://api.sofascore.com/api/v1/search/all?q={team_name}&page=0")
            team = next((i for i in search.json().get('results', []) if i.get('type') == 'team'), None)
            
            if team:
                t_id = team['entity']['id']
                t_name = team['entity']['name']
                
                # 2. Traer el ÚLTIMO y el PRÓXIMO para comparar
                last_res = await client.get(f"https://api.sofascore.com/api/v1/team/{t_id}/events/last/0")
                next_res = await client.get(f"https://api.sofascore.com/api/v1/team/{t_id}/events/next/0")
                
                historial = last_res.json().get('events', [])
                futuro = next_res.json().get('events', [])
                
                contexto_futbol = f"--- CALENDARIO REAL: {t_name.upper()} ---\n"
                contexto_futbol += f"REFERENCIA ACTUAL: {hoy_str}\n\n"

                # Lógica: Extraer el resultado más reciente
                if historial:
                    m = historial[0]
                    fecha_m = datetime.datetime.fromtimestamp(m['startTimestamp']).strftime('%d/%m/%Y')
                    res_h = f"{m['homeTeam']['name']} {m['homeScore'].get('current',0)} - {m['awayScore'].get('current',0)} {m['awayTeam']['name']}"
                    contexto_futbol += f"ÚLTIMO PARTIDO (YA PASÓ):\n- Fecha: {fecha_m}\n- Resultado: {res_h}\n\n"

                # Lógica: Extraer el partido más cercano en el futuro
                if futuro:
                    m = futuro[0]
                    fecha_f = datetime.datetime.fromtimestamp(m['startTimestamp']).strftime('%d/%m/%Y %H:%M')
                    rival = m['awayTeam']['name'] if m['homeTeam']['id'] == t_id else m['homeTeam']['name']
                    contexto_futbol += f"PRÓXIMO PARTIDO (EL QUE SIGUE):\n- Fecha: {fecha_f}\n- Rival: {rival}\n"
                else:
                    contexto_futbol += "No hay partidos futuros programados.\n"
                
                return contexto_futbol

            # Fallback a Web con el año forzado
            with DDGS() as ddgs:
                res = list(ddgs.text(f"próximo partido de {team_name} abril mayo 2026 fixture", max_results=3))
                return f"DATOS WEB (HOY ES {hoy_str}):\n" + "\n".join([r['body'] for r in res])
        except: return "Servicios deportivos fuera de línea."

# --- 3. ROUTER DE INTELIGENCIA ---
class UserQuery(BaseModel): query: str

@app.post("/api/v1/query")
async def process_query(req: UserQuery):
    user_text = req.query
    low = user_text.lower()
    ahora_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")
    # --- 0. CARGAR PROYECTO POR NOMBRE ---
    import re as _re
    _m = _re.search(r'(?:carg[aá] el proyecto|cargar proyecto|continu[aá] con|segu[ií] con)\s+(.+)', low)
    if _m:
        nombre_proyecto = _m.group(1).strip()
        result = dev_jarvis.load_project_by_name(nombre_proyecto)
        return {"status": "success", "data": {"action": "reply", "message": result}}

    # --- 0b. INSTALAR DESIGN.md (solo si NO hay intención de crear proyecto) ---
    from developer_service import install_design, resolve_design_id, DESIGNS_CATALOG
    _dm = _re.search(r'(?:instal[aá]|pon[eé]|us[aá]|aplic[aá])\s+(?:el\s+)?(?:dise[nñ]o|estilo|design|tema)\s+(.+)', low)
    _tiene_creacion = any(w in low for w in [
        "programa", "crea", "hazme", "haz ", "pagina", "página", "web",
        "proyecto", "nuevo", "sitio", "app", "landing", "usalo"
    ])
    if _dm and dev_jarvis.active_project and not _tiene_creacion:
        keyword = _dm.group(1).strip()
        import os as _os
        p_path = _os.path.join(dev_jarvis.WORKSPACE if hasattr(dev_jarvis, 'WORKSPACE') else
                               _os.path.join(_os.path.expanduser("~"), "Desktop", "Jarvis_Projects"),
                               dev_jarvis.active_project)
        design_id = DESIGNS_CATALOG.get(keyword) or resolve_design_id(keyword)
        if design_id:
            result = install_design(design_id, p_path)
        else:
            lista = ", ".join(sorted(DESIGNS_CATALOG.keys())[:20])
            result = f"No encontre el diseno '{keyword}'. Disponibles: {lista}..."
        return {"status": "success", "data": {"action": "reply", "message": result}}
    # Si _tiene_creacion → el design_id se detecta dentro de execute_full_project via resolve_design_id

    # --- 0.5 EDITOR CON RUTA (carpeta o archivo) ---
    # Detectar paths Windows (C:\...) o Unix (/home/...)
    import re as _re2
    _path_match = _re2.search(
        r'([A-Za-z]:\\[^\s,;]+|/(?:home|Users|var|opt|tmp)/[^\s,;]+)',
        user_text
    )
    if _path_match:
        detected_path = _path_match.group(1).strip().rstrip('.,;:')
        import os as _os2
        if _os2.path.exists(detected_path):
            # Extraer la instruccion (todo lo que NO es el path)
            instruction = user_text.replace(_path_match.group(0), "").strip()
            if not instruction:
                instruction = "Revisa el codigo y arregla cualquier error que encuentres."
            print(f"[Jarvis Logic] EDITOR CON RUTA: {detected_path}")
            print(f"[Jarvis Logic] Instruccion: {instruction[:100]}")
            result = await dev_jarvis.edit_with_context(detected_path, instruction)
            return {"status": "success", "data": {"action": "reply", "message": result}}

    # --- 1. NUEVO PROYECTO COMPLETO ---
    triggers_nuevo_proyecto = [
        # Formas directas
        "quiero que programes", "codeame", "programá esto",
        # Formas naturales (lo que el usuario realmente dice)
        "hazme una pagina", "hazme una página", "haceme una pagina", "haceme una página",
        "hazme un sitio", "hazme una web", "haceme una web", "haceme un sitio",
        "crea una pagina", "crea una página", "crea un sitio", "crea una web",
        "generame una pagina", "generame una página", "generame un sitio", "generame una web",
        "necesito una pagina", "necesito una página", "necesito un sitio", "necesito una web",
        "programa una pagina", "programa una página", "programa un sitio", "programa una web",
        "programa la pagina", "programa la página",
        "hace una pagina", "hace una página", "hace una web",
        "quiero una pagina", "quiero una página", "quiero un sitio", "quiero una web",
        "desarrolla", "desarrollame",
        # Con diseño explícito (tema + proyecto)
        "usa el tema", "usá el tema", "usa el diseño", "usá el diseño",
    ]
    es_pedido_codigo = any(t in low for t in triggers_nuevo_proyecto)

    if es_pedido_codigo:
        print(f"[Jarvis Logic] NUEVO PROYECTO: ejecutando motor de desarrollo.")
        result = await dev_jarvis.execute_full_project(user_text)
        return {"status": "success", "data": {"action": "reply", "message": result}}

    # --- 2. CREAR ARCHIVO NUEVO en el proyecto activo ---
    triggers_nuevo_archivo = [
        "crea un archivo", "creá un archivo", "crea el archivo",
        "nuevo archivo", "nueva pagina", "nueva página",
        "crear pagina", "crear página", "agregar pagina", "agregar página",
        "haceme un archivo", "generame un archivo"
    ]
    es_nuevo_archivo = dev_jarvis.active_project and any(w in low for w in triggers_nuevo_archivo)

    if es_nuevo_archivo:
        print(f"[Jarvis Logic] NUEVO ARCHIVO en proyecto '{dev_jarvis.active_project}'.")
        result = await dev_jarvis.create_new_file(user_text)
        return {"status": "success", "data": {"action": "reply", "message": result}}

    # --- 3. EDITAR el proyecto activo (solo triggers específicos de edición) ---
    triggers_edicion = [
        "modificá", "modifica", "cambiá", "cambia ", "agregá", "agrega ",
        "quitá", "quita ", "sacá", "saca ", "eliminá", "elimina", "elimines",
        "editá", "edita ", "mejorá", "mejora", "arreglá", "arregla",
        "reemplazá", "reemplaza", "borrá", "borra ", "añadí", "añade",
        "cambia el color", "cambiá el color", "separá", "separa ", "dividí",
        "actualizá", "actualiza", "seguí trabajando", "sigue trabajando",
    ]
    es_edicion = dev_jarvis.active_project and any(w in low for w in triggers_edicion)

    if es_edicion:
        print(f"[Jarvis Logic] EDICION: modificando '{dev_jarvis.active_project}'.")
        result = await dev_jarvis.edit_project(user_text)
        return {"status": "success", "data": {"action": "reply", "message": result}}

    # --- PRIORIDAD 0: DEPORTES Y FINANZAS (SIEMPRE ANTES QUE CUALQUIER MODO) ---
    es_dinero = any(w in low for w in [
        'dolar', 'blue', 'mep', 'tarjeta', 'bitcoin', 'btc', 'cripto',
        'eth', 'solana', 'xrp', 'tether', 'binance', 'cripto', 'precio usdt'
    ])
    es_futbol = any(w in low for w in [
        'juega', 'partido', 'fixture', 'vs ', ' vs', 'enfrenta', 'resultado',
        'salio', 'salió', 'como le fue', 'como quedó', 'como quedo',
        'goles', 'marcador', 'score', 'empate', 'ganó', 'gano', 'perdió', 'perdio',
        'boca', 'river', 'racing', 'independiente', 'san lorenzo', 'huracan',
        'belgrano', 'talleres', 'estudiantes', 'velez', 'lanus', 'arsenal',
        'champions', 'libertadores', 'sudamericana', 'liga profesional',
        'premier', 'laliga', 'serie a', 'bundesliga'
    ])

    if es_dinero:
        print("[Jarvis Logic]  FINANZAS detectadas, bypass total al motor financiero.")
        contexto = get_financial_snapshot()
        prompt_synthesis = f"""Eres Jarvis, asistente ejecutivo. AÑO: 2026. Fecha: {ahora_str}.
CONTEXTO FINANCIERO:\n{contexto}\nPREGUNTA: {req.query}\nResponde directo con los datos."""
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                res = await client.post("http://127.0.0.1:11434/api/generate",
                    json={"model": "llama3.1:latest", "prompt": prompt_synthesis, "stream": False,
                          "options": {"temperature": 0.3, "num_predict": 400}})
                return {"status": "success", "data": {"action": "reply",
                        "message": res.json().get("response", "Sin datos financieros.").strip()}}
        except Exception as e:
            return {"status": "success", "data": {"action": "reply", "message": f"Error financiero: {e}"}}

    if es_futbol:
        print("[Jarvis Logic]  DEPORTES detectados, bypass al motor deportivo.")
        contexto_deportivo = await get_sports_universal(low)
        prompt_synthesis = f"""Eres Jarvis, asistente ejecutivo de Rodrigo. AÑO: 2026. Fecha: {ahora_str}.
CONTEXTO DEPORTIVO (ÚNICA VERDAD):\n{contexto_deportivo}\n
PREGUNTA: {req.query}\n
INSTRUCCIONES:
1. Si pregunta "cómo salió" o "resultado", informá el marcador final del último partido.
2. Si pregunta "cuándo juega", informá la fecha del próximo partido.
3. Respondé directo, sin excusas. Estilo argentino."""
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                res = await client.post("http://127.0.0.1:11434/api/generate",
                    json={"model": "llama3.1:latest", "prompt": prompt_synthesis, "stream": False,
                          "options": {"temperature": 0.3, "num_predict": 400}})
                return {"status": "success", "data": {"action": "reply",
                        "message": res.json().get("response", "Sin datos deportivos.").strip()}}
        except Exception as e:
            return {"status": "success", "data": {"action": "reply", "message": f"Error deportivo: {e}"}}
    # ──────────────────────────────────────────────────────────────────────────

    es_dinero = False  # ya procesado arriba
    es_futbol = False  # ya procesado arriba

    if es_dinero:
        contexto = get_financial_snapshot()
    elif es_futbol:
        contexto = await get_sports_universal(low)
    else:
        with DDGS() as ddgs:
            try:
                res = list(ddgs.text(f"{req.query} argentina 2026", max_results=3, timelimit='w'))
                contexto = "\n".join([r['body'] for r in res])
            except: contexto = "Sin acceso a la red."

    # PROMPT DE ANCLAJE TEMPORAL
    prompt_synthesis = f"""
    Eres Jarvis, asistente ejecutivo de Rodrigo. 
    AÑO ACTUAL: 2026. FECHA DE HOY: {ahora_str}.
    
    CONTEXTO RECUPERADO (ÚNICA VERDAD):
    {contexto}

    PREGUNTA DEL JEFE: {req.query}

    INSTRUCCIONES:
    1. Compara la fecha de los partidos con la FECHA DE HOY. 
    2. Si Rodrigo pregunta "cuándo juega", prioriza el "PRÓXIMO PARTIDO".
    3. Si pregunta "cómo salió", prioriza el "ÚLTIMO PARTIDO".
    4. Responde de forma elegante, directa y con estilo argentino.
    5. No digas "no tengo acceso". Si el contexto tiene datos, TÚ tienes el acceso.
    """

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post("http://127.0.0.1:11434/api/generate", 
                json={
                    "model": "llama3.1:latest", 
                    "prompt": prompt_synthesis, 
                    "stream": False,
                    "options": {"temperature": 0}
                })
            return {"status": "success", "data": {"action": "reply", "message": res.json().get("response")}}
    except Exception as e: return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
