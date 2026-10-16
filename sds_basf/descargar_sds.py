#!/usr/bin/env python3
"""Descarga las SDS de BASF México (español, variante MX) desde https://sds.basf.com/.

El portal exige iniciar sesión (Microsoft Entra ID de BASF). El script abre una
ventana de navegador con un perfil propio; inicias sesión a mano una sola vez y
el script toma de ahí el token que la propia página manda a su API. Con ese token
consulta la API REST del portal directamente (requests):

    POST https://api.sds.basf.com:9446/api/search
    GET  https://api.sds.basf.com:9446/api/download?bi=...&salesOrg=D016&sbgv=...

Uso:
    python descargar_sds.py --recon          # solo VOLLEY, CABRIO C y P.I; guarda recon/
    python descargar_sds.py                  # toda la lista de productos.txt
    python descargar_sds.py --solo "HEAT" "OPUS"
"""
import argparse
import copy
import csv
import json
import random
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

PORTAL = "https://sds.basf.com/"
API = "https://api.sds.basf.com:9446/api"
SEARCH_URL = f"{API}/search"
DOWNLOAD_URL = f"{API}/download"
SALES_ORG_URL = f"{API}/salesOrg"

ORG_VENTA = "D016"  # BASF Agricultural Solutions Mexico SA de CV
IDIOMA_UI = "es"
# Lo que manda el portal con el dropdown "Material" e interfaz en español.
CAMPOS_BUSQUEDA = [f"{IDIOMA_UI}_materialName", "en_materialName", "materialNumber"]
RESULTADOS_POR_PAGINA = 20
MAX_PAGINAS = 5
PRODUCTOS_RECON = ["VOLLEY", "CABRIO C", "P.I"]

DESCARGADO = "descargado"
NO_ENCONTRADO = "no encontrado"
VARIAS = "varias coincidencias"
ERROR = "error"

COLUMNAS = [
    "producto", "termino_buscado", "estado", "nombre_documento", "variante",
    "idioma", "version", "fecha", "material", "bi_number", "org_venta",
    "coincidencia_nombre", "archivo", "notas",
]


class ErrorPortal(Exception):
    pass


# --------------------------------------------------------------------------
# Lógica pura (sin red): nombres, filtros y selección del documento
# --------------------------------------------------------------------------

def sin_acentos(texto):
    return "".join(c for c in unicodedata.normalize("NFKD", texto)
                   if not unicodedata.combining(c))


def tokens(texto):
    return re.findall(r"[A-Z0-9]+", sin_acentos(str(texto or "")).upper())


def nombre_archivo(producto):
    base = re.sub(r"[^A-Za-z0-9.\-]+", "_", sin_acentos(producto))
    base = re.sub(r"_+", "_", base).strip("._-")
    return f"{base}_SDS_MX.pdf"


def es_espanol(idioma):
    texto = sin_acentos(str(idioma or "")).strip().lower().replace("_", "-")
    palabras = re.findall(r"[a-z]+", texto)
    return (texto in {"es", "s", "sp", "spa", "spanish", "espanol"}
            or texto.startswith("es-")
            or "spanish" in palabras or "espanol" in palabras)


def es_variante_mx(gen_var):
    return "MX" in str(gen_var or "").upper()


_TAMANO = re.compile(r"^\d+(L|LT|LTS|ML|KG|KGS|G|GR|GRS|GAL|CC|TON|K)$|^\d+X\d+\w*$")


def _token_relevante(tok):
    return tok != "MX" and not _TAMANO.match(tok)


def rango_nombre(producto, nombre_material):
    """None si el material no corresponde al producto; si corresponde, cuántas
    palabras extra (sin contar MX ni presentaciones como 20L) trae el nombre.
    0 = coincidencia exacta."""
    buscado = tokens(producto)
    tiene = tokens(nombre_material)
    if not buscado or not tiene:
        return None
    compacto = "".join(buscado)
    # Tramo contiguo que, unido, sea el producto (cubre "SL14" vs "SL 14").
    for i in range(len(tiene)):
        unido = ""
        for j in range(i, len(tiene)):
            unido += tiene[j]
            if unido == compacto:
                resto = tiene[:i] + tiene[j + 1:]
                return sum(1 for t in resto if _token_relevante(t))
            if len(unido) >= len(compacto):
                break
    if all(t in tiene for t in buscado):
        resto = list(tiene)
        for t in buscado:
            resto.remove(t)
        return sum(1 for t in resto if _token_relevante(t))
    return None


def aplanar(reports):
    salida = []
    for r in reports or []:
        salida.append(r)
        salida.extend(r.get("mcsReports") or [])
    return salida


def parse_fecha(valor):
    if valor in (None, ""):
        return None
    if isinstance(valor, (int, float)):
        segundos = valor / 1000 if valor > 1e11 else valor
        return datetime.fromtimestamp(segundos, tz=timezone.utc).date()
    texto = str(valor).strip()
    if re.fullmatch(r"\d{9,}", texto):
        return parse_fecha(int(texto))
    m = re.match(r"(\d{4})-?(\d{2})-?(\d{2})", texto)
    if m:
        return date(int(m[1]), int(m[2]), int(m[3]))
    m = re.match(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})", texto)
    if m:
        return date(int(m[3]), int(m[2]), int(m[1]))
    return None


def _num(valor):
    m = re.search(r"\d+", str(valor if valor is not None else ""))
    return int(m.group()) if m else 0


def clave_reciente(r):
    return (parse_fecha(r.get("releaseDate")) or date.min,
            _num(r.get("version")), _num(r.get("subVersion")))


def texto_version(r):
    v, sv = r.get("version"), r.get("subVersion")
    if v in (None, ""):
        return ""
    return f"{v}.{sv}" if sv not in (None, "") else str(v)


def texto_fecha(r):
    f = parse_fecha(r.get("releaseDate"))
    return f.isoformat() if f else str(r.get("releaseDate") or "")


def describir(r):
    return (f"{r.get('materialName')} | {r.get('genVar')} | {r.get('language')} | "
            f"v{texto_version(r)} | {texto_fecha(r)} | mat {r.get('materialNumber')} | "
            f"bi {r.get('biNumber')}")


def seleccionar(producto, reports):
    """Filtra los resultados (nombre del producto + español + variante con MX)
    y elige el documento más reciente. Devuelve un dict con:
    elegido, varias (bool), alternativas, rango, notas."""
    todos = aplanar(reports)
    por_nombre = []
    for r in todos:
        rango = rango_nombre(producto, r.get("materialName"))
        if rango is not None:
            por_nombre.append((rango, r))
    validos = [(k, r) for k, r in por_nombre
               if es_espanol(r.get("language")) and es_variante_mx(r.get("genVar"))]

    if not validos:
        if por_nombre:
            vistos = sorted({f"{r.get('language')}/{r.get('genVar')}" for _, r in por_nombre})
            nota = (f"{len(por_nombre)} resultado(s) con el nombre, ninguno en español "
                    f"con variante MX (idioma/variante: {', '.join(vistos)[:300]})")
        else:
            nota = f"{len(todos)} resultado(s), ninguno con el nombre del producto"
        return {"elegido": None, "varias": False, "alternativas": [], "rango": None,
                "notas": nota}

    mejor = min(k for k, _ in validos)
    finalistas = [r for k, r in validos if k == mejor]

    # Un mismo documento puede venir en varios materiales (presentaciones):
    # se agrupa por BI + variante + idioma y se queda la versión más nueva.
    documentos = {}
    for r in finalistas:
        clave = (str(r.get("biNumber") or r.get("materialName")),
                 str(r.get("genVar")).upper(), str(r.get("language")).lower())
        if clave not in documentos or clave_reciente(r) > clave_reciente(documentos[clave]):
            documentos[clave] = r
    ordenados = sorted(documentos.values(), key=clave_reciente, reverse=True)
    elegido = ordenados[0]
    notas = []
    if mejor > 0:
        notas.append(f"nombre no exacto en el portal: '{elegido.get('materialName')}'")
    return {"elegido": elegido, "varias": len(ordenados) > 1,
            "alternativas": ordenados[1:], "rango": mejor, "notas": "; ".join(notas)}


def cargar_productos(ruta):
    productos, vistos = [], set()
    for linea in Path(ruta).read_text(encoding="utf-8-sig").splitlines():
        p = linea.strip()
        if p and not p.startswith("#") and p not in vistos:
            productos.append(p)
            vistos.add(p)
    return productos


def escribir_reporte(ruta, filas):
    with open(ruta, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNAS)
        w.writeheader()
        for fila in filas:
            w.writerow({c: fila.get(c, "") for c in COLUMNAS})


# --------------------------------------------------------------------------
# Portal: navegador para la sesión + requests para la API
# --------------------------------------------------------------------------

class Portal:
    def __init__(self, navegador, perfil, pausa, headless=False):
        self.navegador = navegador
        self.headless = headless
        self.perfil = perfil
        self.pausa = pausa
        self.token = None
        self.cuerpo_spa = None
        self.plantilla = None
        self.orgs_validas = None  # fuentes (source) para las que D016 es válida

    # -- ciclo de vida --
    def __enter__(self):
        from playwright.sync_api import sync_playwright
        import requests

        self._pw = sync_playwright().start()
        opciones = dict(headless=self.headless, locale="es-MX", viewport={"width": 1280, "height": 900})
        if self.navegador != "chromium":
            opciones["channel"] = self.navegador
        self.ctx = self._pw.chromium.launch_persistent_context(str(self.perfil), **opciones)
        self.ctx.on("request", self._al_pedir)
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.page.goto(PORTAL, wait_until="domcontentloaded", timeout=120000)

        self.http = requests.Session()
        self.http.headers.update({
            "Accept": "application/json, text/plain, */*",
            "Origin": PORTAL.rstrip("/"),
            "Referer": PORTAL,
        })
        return self

    def __exit__(self, *exc):
        try:
            self.ctx.close()
        finally:
            self._pw.stop()

    # -- token --
    def _al_pedir(self, request):
        if not request.url.startswith(API.rsplit("/api", 1)[0]):
            return
        auth = request.headers.get("authorization")
        if not auth:
            try:
                auth = request.all_headers().get("authorization")
            except Exception:
                auth = None
        if auth and auth.lower().startswith("bearer "):
            self.token = auth
        if request.method == "POST" and request.url.split("?")[0] == SEARCH_URL:
            try:
                self.cuerpo_spa = json.loads(request.post_data or "null")
            except ValueError:
                pass

    def esperar_sesion(self, limite_s=900):
        print("\n>>> Inicia sesión en la ventana del navegador (con tu cuenta BASF).")
        print(">>> El script sigue solo en cuanto el portal cargue.\n")
        fin = time.time() + limite_s
        ultimo_reintento = time.time()
        while not self.token:
            if time.time() > fin:
                raise ErrorPortal("No se detectó la sesión (se agotó el tiempo de espera).")
            self.page.wait_for_timeout(1000)
            en_portal = self.page.url.startswith(PORTAL)
            if en_portal and time.time() - ultimo_reintento > 30:
                # Ya en el portal pero sin llamadas a la API: recargar la portada.
                ultimo_reintento = time.time()
                self.page.goto(PORTAL + "#/home", wait_until="domcontentloaded")
        self.http.headers["Authorization"] = self.token
        try:
            self.http.headers["User-Agent"] = self.page.evaluate("navigator.userAgent")
        except Exception:
            pass
        print("Sesión detectada.")

    def renovar_token(self):
        print("   (renovando sesión...)")
        self.token = None
        self.page.goto(PORTAL + "#/home", wait_until="domcontentloaded")
        self.page.reload(wait_until="domcontentloaded")
        self.esperar_sesion(limite_s=600)

    # -- HTTP con pausas, reintentos y renovación de token --
    def _dormir(self):
        time.sleep(self.pausa * random.uniform(0.7, 1.4))

    def _llamar(self, metodo, url, **kw):
        import requests

        renovado = False
        ultimo = None
        for intento in range(4):
            self._dormir()
            try:
                r = self.http.request(metodo, url, timeout=(20, 180), **kw)
            except requests.RequestException as e:
                ultimo = f"{type(e).__name__}: {e}"
                time.sleep(5 * (intento + 1))
                continue
            if r.status_code in (401, 403) and not renovado:
                renovado = True
                self.renovar_token()
                continue
            if r.status_code == 429 or r.status_code >= 500:
                ultimo = f"HTTP {r.status_code}"
                espera = r.headers.get("Retry-After")
                time.sleep(int(espera) if espera and espera.isdigit() else 10 * (intento + 1))
                continue
            return r
        raise ErrorPortal(f"{metodo} {url.split('?')[0]} falló: {ultimo}")

    # -- organizaciones de venta --
    def cargar_orgs(self):
        r = self._llamar("GET", f"{SALES_ORG_URL}/{IDIOMA_UI}")
        if r.status_code != 200:
            print(f"AVISO: no se pudo leer la lista de organizaciones (HTTP {r.status_code}).")
            return []
        orgs = r.json() or []
        d016 = [o for o in orgs if o.get("id") == ORG_VENTA]
        if d016:
            self.orgs_validas = {(o.get("source") or "") for o in d016}
            print(f"Org. de venta: {ORG_VENTA} - {d016[0].get('name', '')} "
                  f"(fuentes: {', '.join(sorted(self.orgs_validas)) or '-'})")
        else:
            print(f"AVISO: {ORG_VENTA} no aparece en la lista de organizaciones del portal.")
        return orgs

    def org_para(self, report):
        """Igual que el portal: D016 si es válida para la fuente del documento;
        si no, la organización por defecto del propio documento."""
        fuente = report.get("source") or ""
        if self.orgs_validas is None or fuente in self.orgs_validas:
            return ORG_VENTA, ""
        propia = report.get("defaultSalesOrg") or "D050"
        return propia, f"{ORG_VENTA} no es válida para la fuente '{fuente}'; se usó {propia}"

    # -- búsqueda --
    def capturar_plantilla(self, termino):
        """Hace que la propia página ejecute una búsqueda y copia el JSON que
        manda, para reproducirlo exactamente."""
        from urllib.parse import urlencode

        self.cuerpo_spa = None
        params = urlencode({"q": termino, "f": ",".join(CAMPOS_BUSQUEDA), "z": "0",
                            "p": "0", "defaultSalesOrg": ORG_VENTA})
        self.page.evaluate("h => { window.location.hash = h; }", f"#/search?{params}")
        for _ in range(45):
            if self.cuerpo_spa is not None:
                break
            self.page.wait_for_timeout(1000)
        if isinstance(self.cuerpo_spa, dict):
            self.plantilla = copy.deepcopy(self.cuerpo_spa)
            print("Plantilla de búsqueda copiada de la página.")
        else:
            print("AVISO: no se pudo copiar la búsqueda de la página; uso la reconstruida del código.")
            self.plantilla = None
        return self.cuerpo_spa

    def _cuerpo(self, termino, pagina):
        if self.plantilla:
            cuerpo = copy.deepcopy(self.plantilla)
        else:
            cuerpo = {
                "searchFields": list(CAMPOS_BUSQUEDA), "biNumbers": [], "casNumbers": [],
                "materialNumbers": [], "supplierNumbers": [], "ecProductNumbers": [],
                "basNumbers": [], "validityAreaFilters": [], "languageFilters": [],
                "genVarFilters": [], "supplierNameFilters": [], "supplierNumberFilters": [],
                "sourceFilters": [], "materialTypeFilters": [], "mksFilters": [],
                "releaseDateFilter": {}, "orders": [],
            }
        cuerpo.update({"searchString": termino, "searchFields": list(CAMPOS_BUSQUEDA),
                       "advancedSearch": False, "fuzzy": False, "page": pagina,
                       "itemsPerPage": RESULTADOS_POR_PAGINA})
        return cuerpo

    def buscar(self, termino, producto, crudo=None):
        reports = []
        for pagina in range(MAX_PAGINAS):
            r = self._llamar("POST", SEARCH_URL, json=self._cuerpo(termino, pagina))
            if r.status_code != 200:
                raise ErrorPortal(f"búsqueda '{termino}' HTTP {r.status_code}: {r.text[:200]}")
            datos = r.json() or {}
            if crudo is not None:
                crudo.append(datos)
            nuevos = datos.get("reports") or []
            reports.extend(nuevos)
            total_paginas = datos.get("totalPages") or 1
            if pagina + 1 >= total_paginas:
                break
            # Resultados por relevancia: si esta página ya no trae el producto, parar.
            if not any(rango_nombre(producto, x.get("materialName")) is not None
                       for x in aplanar(nuevos)):
                break
        return reports

    # -- descarga --
    def descargar(self, report, org):
        def v(clave):
            valor = report.get(clave)
            return "" if valor is None else str(valor)

        params = [("bi", v("biNumber")), ("material", v("materialNumber")),
                  ("mcs", v("parentId")), ("language", v("language")),
                  ("supplier", v("supplierNumber")), ("salesOrg", org),
                  ("sbgv", v("genVar")), ("source", v("source")),
                  ("version", v("version")), ("subversion", v("subVersion"))]
        r = self._llamar("GET", DOWNLOAD_URL, params=params)
        if r.status_code != 200:
            raise ErrorPortal(f"descarga HTTP {r.status_code}: {r.text[:200]}")
        if not r.content.startswith(b"%PDF"):
            raise ErrorPortal(f"la descarga no es PDF ({r.headers.get('content-type')}, "
                              f"{len(r.content)} bytes)")
        return r.content


# --------------------------------------------------------------------------
# Proceso por producto
# --------------------------------------------------------------------------

def procesar(portal, producto, dir_sds, forzar, dir_recon=None):
    fila = {"producto": producto, "archivo": nombre_archivo(producto)}
    notas = []
    try:
        sel, termino = None, None
        for termino in (f"{producto} MX", producto):
            crudo = [] if dir_recon else None
            reports = portal.buscar(termino, producto, crudo)
            if dir_recon:
                guardar_recon(dir_recon, producto, termino, crudo, reports)
            sel = seleccionar(producto, reports)
            if sel["elegido"]:
                break
            notas.append(f"'{termino}': {sel['notas']}")
        fila["termino_buscado"] = termino

        elegido = sel["elegido"]
        if not elegido:
            fila.update(estado=NO_ENCONTRADO, archivo="")
            fila["notas"] = "; ".join(notas)
            return fila

        org, nota_org = portal.org_para(elegido)
        fila.update(
            nombre_documento=elegido.get("materialName") or "",
            variante=elegido.get("genVar") or "",
            idioma=elegido.get("language") or "",
            version=texto_version(elegido),
            fecha=texto_fecha(elegido),
            material=elegido.get("materialNumber") or "",
            bi_number=elegido.get("biNumber") or "",
            org_venta=org,
            coincidencia_nombre="exacta" if sel["rango"] == 0 else "parcial",
        )
        if termino == producto:
            notas.append(f"no apareció con '{producto} MX'; encontrado buscando solo el nombre")
        if sel["notas"]:
            notas.append(sel["notas"])
        if nota_org:
            notas.append(nota_org)
        if sel["varias"]:
            otras = " || ".join(describir(a) for a in sel["alternativas"][:5])
            notas.append(f"REVISAR: {len(sel['alternativas']) + 1} documentos ES+MX; "
                         f"se bajó el más reciente. Otros: {otras}")

        destino = dir_sds / fila["archivo"]
        if destino.exists() and not forzar:
            notas.append("ya existía, no se volvió a bajar")
        else:
            contenido = portal.descargar(elegido, org)
            destino.write_bytes(contenido)
        fila["estado"] = VARIAS if sel["varias"] else DESCARGADO
    except Exception as e:  # el lote sigue con el siguiente producto
        fila["estado"] = ERROR
        notas.append(f"{type(e).__name__}: {e}")
        if not (dir_sds / fila["archivo"]).exists():
            fila["archivo"] = ""
    fila["notas"] = "; ".join(notas)
    return fila


def guardar_recon(dir_recon, producto, termino, crudo, reports):
    base = nombre_archivo(producto).replace("_SDS_MX.pdf", "")
    sufijo = "MX" if termino.endswith(" MX") else "solo_nombre"
    ruta = dir_recon / f"{base}__{sufijo}.json"
    ruta.write_text(json.dumps(crudo, ensure_ascii=False, indent=2), encoding="utf-8")
    lineas = [f"\n=== {producto} — búsqueda '{termino}': {len(aplanar(reports))} resultado(s)"]
    for r in aplanar(reports):
        marca = []
        if rango_nombre(producto, r.get("materialName")) is not None:
            marca.append("nombre")
        if es_espanol(r.get("language")):
            marca.append("ES")
        if es_variante_mx(r.get("genVar")):
            marca.append("MX")
        lineas.append(f"  [{'+'.join(marca) or '-':>12}] {describir(r)} | "
                      f"src {r.get('source')} | área {r.get('validityArea')} | "
                      f"org {r.get('defaultSalesOrg')}")
    texto = "\n".join(lineas)
    print(texto)
    with open(dir_recon / "resumen.txt", "a", encoding="utf-8") as f:
        f.write(texto + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--recon", action="store_true",
                    help="solo VOLLEY, CABRIO C y P.I; guarda respuestas crudas en recon/")
    ap.add_argument("--solo", nargs="+", metavar="PRODUCTO", help="procesar solo estos productos")
    ap.add_argument("--productos", default="productos.txt")
    ap.add_argument("--salida", default="sds", help="carpeta de PDFs (por defecto ./sds)")
    ap.add_argument("--reporte", default=None, help="por defecto reporte.csv (reporte_recon.csv con --recon)")
    ap.add_argument("--pausa", type=float, default=2.0, help="segundos entre peticiones (aprox.)")
    ap.add_argument("--forzar", action="store_true", help="volver a bajar aunque el PDF ya exista")
    ap.add_argument("--navegador", choices=["chromium", "chrome", "msedge"], default="chromium",
                    help="chromium (requiere 'playwright install chromium'), o tu Chrome/Edge instalado")
    ap.add_argument("--perfil", default=".perfil_basf",
                    help="carpeta del perfil del navegador (guarda la sesión)")
    args = ap.parse_args()

    if args.recon:
        productos = list(PRODUCTOS_RECON)
    elif args.solo:
        productos = args.solo
    else:
        ruta = Path(args.productos)
        if not ruta.exists():
            ruta = Path(__file__).resolve().parent / args.productos
        productos = cargar_productos(ruta)
    reporte = Path(args.reporte or ("reporte_recon.csv" if args.recon else "reporte.csv"))
    dir_sds = Path(args.salida)
    dir_sds.mkdir(parents=True, exist_ok=True)
    dir_recon = None
    if args.recon:
        dir_recon = Path("recon")
        dir_recon.mkdir(exist_ok=True)
        (dir_recon / "resumen.txt").write_text("", encoding="utf-8")

    print(f"{len(productos)} producto(s). PDFs en {dir_sds.resolve()}  Reporte: {reporte.resolve()}")
    filas = []
    with Portal(args.navegador, Path(args.perfil).resolve(), args.pausa) as portal:
        portal.esperar_sesion()
        orgs = portal.cargar_orgs()
        cuerpo = portal.capturar_plantilla(f"{productos[0]} MX")
        if dir_recon:
            (dir_recon / "organizaciones.json").write_text(
                json.dumps(orgs, ensure_ascii=False, indent=2), encoding="utf-8")
            (dir_recon / "busqueda_de_la_pagina.json").write_text(
                json.dumps(cuerpo, ensure_ascii=False, indent=2), encoding="utf-8")

        for i, producto in enumerate(productos, 1):
            fila = procesar(portal, producto, dir_sds, args.forzar, dir_recon)
            filas.append(fila)
            escribir_reporte(reporte, filas)  # se va guardando por si se interrumpe
            detalle = fila.get("nombre_documento") or fila.get("notas", "")[:90]
            print(f"[{i}/{len(productos)}] {producto}: {fila['estado']} — {detalle}")

    conteo = {}
    for f in filas:
        conteo[f["estado"]] = conteo.get(f["estado"], 0) + 1
    print("\nResumen: " + ", ".join(f"{k}: {v}" for k, v in sorted(conteo.items())))
    print(f"Reporte: {reporte.resolve()}")
    if dir_recon:
        print(f"Recon: {dir_recon.resolve()}  (mándame recon/resumen.txt y "
              f"recon/busqueda_de_la_pagina.json)")


if __name__ == "__main__":
    sys.exit(main())
