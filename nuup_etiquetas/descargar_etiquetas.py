#!/usr/bin/env python3
"""Descarga de NUUP (Veeva Vault) las etiquetas comerciales más recientes de cada producto.

Reglas:
  - Solo documentos "NUUP › Commercial Labels › BASF Labels", en estado Approved,
    subidos por Fernanda Camarillo, Andrés Basilio Illescas o Rosa-Ines Gonzalez.
  - El nombre del documento trae producto, paquete y número:
    CL-00160DAVANTOR-1149 → paquete 00160, producto DAVANTOR, número 1149.
    (Así PLURESTO no se confunde con PLURESTO EXTRA.)
  - "Lo más reciente" = el paquete de la etiqueta válida con número más alto; se
    bajan TODAS las etiquetas válidas de ese paquete (1 L, 10x1 L, caja, reverso...).

Funciona con tu sesión de Edge (inicio de sesión con tu cuenta de Windows): las
búsquedas y descargas se hacen desde la propia página de NUUP.

Uso:
    py descargar_etiquetas.py --recon          (DAVANTOR, CONVEY y CABRIO C)
    py descargar_etiquetas.py                  (toda la lista de productos.txt)
    py descargar_etiquetas.py --solo "HEAT" "STORM (PELLETS)"
"""
import argparse
import base64
import csv
import json
import random
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlencode

VAULT = "https://basf-pelican.veevavault.com"
PESTANA_QUIETA = f"{VAULT}/api/v24.1/"  # responde JSON y no redirige: base estable para fetch()
CATEGORIA = "nUUP:commercialLabels:bASFLabels"
AUTORES = ["Fernanda Camarillo", "Andrés Basilio Illescas", "Rosa-Ines Gonzalez"]
ESTADO_OK = "approved"
PRODUCTOS_RECON = ["DAVANTOR", "CONVEY", "CABRIO C"]

COLUMNAS = ["producto", "estado", "paquete", "documento", "titulo", "numero", "version",
            "estado_nuup", "subido_por", "fecha", "archivo", "notas"]

_JS_FETCH = """async ([metodo, url, cuerpo, cabeceras]) => {
  const r = await fetch(url, {method: metodo, headers: cabeceras, body: cuerpo, credentials: 'include'});
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  return {status: r.status, headers, b64: btoa(bin)};
}"""


class ErrorNuup(Exception):
    pass


# --------------------------------------------------------------------------
# Lógica pura
# --------------------------------------------------------------------------

def sin_acentos(texto):
    return "".join(c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c))


def normalizar(texto):
    return re.sub(r"\s+", " ", sin_acentos(str(texto or "")).upper()).strip()


def nombre_archivo(producto, numero=None, extension=".pdf"):
    base = re.sub(r"[^A-Za-z0-9.\-]+", "_", sin_acentos(producto))
    base = re.sub(r"_+", "_", base).strip("._-")
    sufijo = f"_{int(numero):04d}" if numero is not None else ""
    return f"{base}_ETIQUETA{sufijo}{extension}"


_NOMBRE_CL = re.compile(r"^[A-Z]+-(\d{5})(.+)-(\d+)$")


def desarmar_nombre(nombre_doc):
    """'CL-00161PLURESTO EXTRA-1308' -> ('00161', 'PLURESTO EXTRA', 1308)."""
    m = _NOMBRE_CL.match(str(nombre_doc or "").strip())
    if not m:
        return None, None, None
    return m.group(1), normalizar(m.group(2)), int(m.group(3))


_MARCAS = re.compile(r"!@~|~@!")  # NUUP resalta así el término buscado


def limpiar(texto):
    return _MARCAS.sub("", str(texto or "")).strip()


def campo(doc, nombre):
    f = (doc.get("returnFieldMap") or {}).get(nombre) or {}
    return limpiar(f.get("displayValueWithHL"))


def resumir(solr):
    paquete, prod, num = desarmar_nombre(campo(solr, "name"))
    try:
        numero = int(campo(solr, "DocumentNumber") or num or 0)
    except ValueError:
        numero = num or 0
    return {
        "id": solr.get("documentId"), "major": solr.get("majorVersion"),
        "minor": solr.get("minorVersion"), "categoria": solr.get("categoryKey"),
        "archivo_origen": limpiar(solr.get("contentFileName")),
        "nombre": campo(solr, "name"), "producto": prod, "numero": numero, "paquete": paquete,
        "titulo": campo(solr, "title"), "estado": campo(solr, "status"),
        "creado_por": campo(solr, "DocCreatedBy"),
        "modificado_por": campo(solr, "VersionLastModifiedBy"),
        "fecha": campo(solr, "VersionCreatedDate") or campo(solr, "DocCreatedDate"),
    }


def autor_valido(doc):
    quien = normalizar(doc["creado_por"]) + " | " + normalizar(doc["modificado_por"])
    return any(normalizar(a) in quien for a in AUTORES)


def seleccionar(producto, docs):
    """Devuelve (etiquetas_a_bajar, nota). Se bajan todas las etiquetas válidas del
    paquete más reciente (el de la etiqueta válida con número más alto)."""
    buscado = normalizar(producto)
    etiquetas = [d for d in docs if d["categoria"] == CATEGORIA]
    del_producto = [d for d in etiquetas if d["producto"] == buscado]
    if not del_producto:
        vistos = sorted({d["producto"] for d in etiquetas if d["producto"]})
        nota = f"{len(etiquetas)} etiqueta(s) en la búsqueda, ninguna de este producto"
        if vistos:
            nota += f" (productos vistos: {', '.join(vistos)[:200]})"
        return [], nota
    aprobadas = [d for d in del_producto if d["estado"].lower() == ESTADO_OK]
    validas = [d for d in aprobadas if autor_valido(d)]
    if not validas:
        nota = (f"{len(del_producto)} etiqueta(s) del producto, {len(aprobadas)} aprobada(s), "
                f"ninguna aprobada de {', '.join(AUTORES)}")
        if aprobadas:
            nota += " (subidas por: " + ", ".join(sorted({d['creado_por'] for d in aprobadas})) + ")"
        return [], nota
    mas_alta = max(validas, key=lambda d: d["numero"])
    paquete = mas_alta["paquete"]
    elegidas = sorted([d for d in validas if d["paquete"] == paquete],
                      key=lambda d: d["numero"], reverse=True)
    nuevas = [d for d in del_producto if d["numero"] > mas_alta["numero"]]
    nota = ""
    if nuevas:
        nota = ("OJO: hay etiquetas más nuevas que no cumplen las reglas: " +
                " || ".join(f"{d['nombre']} ({d['estado']}, {d['creado_por']})" for d in nuevas[:5]))
    return elegidas, nota


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
# NUUP desde el navegador
# --------------------------------------------------------------------------

class Nuup:
    def __init__(self, perfil, pausa):
        self.perfil = perfil
        self.pausa = pausa
        self.ww = None
        self.extra = {}
        self.plantilla_descarga = None  # se aprende con la primera descarga

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self.ctx = self._pw.chromium.launch_persistent_context(
            str(self.perfil), channel="msedge", headless=False, accept_downloads=True,
            viewport={"width": 1400, "height": 900})
        self.ctx.on("request", self._al_pedir)
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.page.goto(f"{VAULT}/ui/", wait_until="domcontentloaded", timeout=120000)
        return self

    def __exit__(self, *exc):
        try:
            self.ctx.close()
        finally:
            self._pw.stop()

    def _al_pedir(self, request):
        if not request.url.startswith(f"{VAULT}/ui/"):
            return
        h = request.headers
        if h.get("ww"):
            self.ww = h["ww"]
        for k in ("x-veeva-device-information",):
            if h.get(k):
                self.extra[k] = h[k]

    def esperar_sesion(self):
        input("\n>>> Inicia sesión en NUUP en la ventana de Edge (si te lo pide). Cuando veas"
              " la página de inicio YA CARGADA, presiona ENTER aquí... ")
        for _ in range(30):
            if self.ww:
                break
            self.page.wait_for_timeout(1000)
        if not self.ww:
            raise ErrorNuup("No detecté la sesión de NUUP. ¿Ya cargó la página de inicio?")
        self.quieta = self.ctx.new_page()
        self.quieta.goto(PESTANA_QUIETA, wait_until="domcontentloaded", timeout=60000)
        print("Sesión detectada.")

    def _dormir(self):
        time.sleep(self.pausa * random.uniform(0.7, 1.4))

    def _fetch(self, metodo, url, cuerpo=None, tipo=None):
        cab = {"Accept": "application/json, text/javascript, */*", "X-Requested-With": "XMLHttpRequest",
               "ww": self.ww, **self.extra}
        if tipo:
            cab["Content-Type"] = tipo
        ultimo = None
        for intento in range(3):
            self._dormir()
            try:
                res = self.quieta.evaluate(_JS_FETCH, [metodo, url, cuerpo, cab])
                return res["status"], res["headers"], base64.b64decode(res["b64"])
            except Exception as e:
                ultimo = str(e).splitlines()[0]
                self.quieta.wait_for_timeout(3000)
                try:
                    self.quieta.goto(PESTANA_QUIETA, wait_until="domcontentloaded", timeout=60000)
                except Exception:
                    pass
        raise ErrorNuup(f"{metodo} {url[:80]} falló: {ultimo}")

    def buscar(self, termino, con_filtro=True):
        docs, paginas = [], []
        for pagina in range(5):
            nuevos, datos = self._buscar_pagina(termino, con_filtro, pagina * 100)
            docs.extend(nuevos)
            paginas.append(datos)
            total = (datos.get("payload") or {}).get("totalCount") or 0
            if len(nuevos) < 100 or len(docs) >= total:
                break
        return docs, paginas

    def _buscar_pagina(self, termino, con_filtro, inicio):
        params = [("search", termino), ("count", "100"), ("sort", "name"), ("sortOrder", "desc"),
                  ("categories", ""), ("viewType", "REPORTING"), ("returnFacets", "false"),
                  ("returnDocAttrs", "false"), ("searchByUser", ""), ("advSearch", "false"),
                  ("runSmartFilter", "false"), ("startIndex", str(inicio)), ("sizeOfChunk", "100"),
                  ("start", str(inicio))]
        if con_filtro:
            params.append(("keyValueFilters[]", f"compoundType_b:{CATEGORIA}"))
        estado, _, cuerpo = self._fetch("POST", f"{VAULT}/ui/veevaDocuments/allLW", urlencode(params),
                                        "application/x-www-form-urlencoded; charset=UTF-8")
        if estado in (401, 403):
            raise ErrorNuup("La sesión de NUUP expiró; vuelve a correr el script.")
        try:
            datos = json.loads(cuerpo.decode("utf-8", "replace"))
        except ValueError:
            raise ErrorNuup(f"Respuesta inesperada de la búsqueda (HTTP {estado}).")
        if datos.get("status") != "SUCCESS":
            raise ErrorNuup(f"Búsqueda '{termino}': {str(datos.get('message'))[:200]}")
        items = ((datos.get("payload") or {}).get("itemsInChunk")) or []
        return [resumir(i["solrDoc"]) for i in items if i.get("solrDoc")], datos

    # -- descarga --
    def _descargar_por_url(self, doc):
        url = (self.plantilla_descarga.replace("{id}", str(doc["id"]))
               .replace("{major}", str(doc["major"])).replace("{minor}", str(doc["minor"])))
        estado, _, contenido = self._fetch("GET", url)
        if estado == 200 and len(contenido) > 1000 and not contenido.lstrip()[:15].lower().startswith(b"<"):
            return contenido
        return None

    def _descargar_con_clic(self, doc, destino):
        p = self.page
        p.goto(f"{VAULT}/ui/#doc_info/{doc['id']}/{doc['major']}/{doc['minor']}",
               wait_until="domcontentloaded", timeout=120000)
        p.wait_for_timeout(5000)
        intentos = [
            lambda: p.get_by_role("button", name=re.compile(r"^Source File$", re.I)).first.click(timeout=5000),
            lambda: p.locator('[title="Source File"]').first.click(timeout=5000),
            lambda: (p.locator('[title="Download options"]').first.click(timeout=5000),
                     p.get_by_text("Source File", exact=True).first.click(timeout=5000)),
        ]
        for accion in intentos:
            try:
                with p.expect_download(timeout=30000) as info:
                    accion()
                return self._guardar_descarga(info.value, doc, destino)
            except Exception:
                continue
        print("   No encontré el botón de descarga. En Edge haz clic en Download → Source File"
              " (tienes 2 minutos)...")
        with p.expect_download(timeout=120000) as info:
            pass
        return self._guardar_descarga(info.value, doc, destino)

    def _guardar_descarga(self, descarga, doc, destino):
        ext = Path(descarga.suggested_filename or doc["archivo_origen"] or "x.pdf").suffix or ".pdf"
        destino = destino.with_suffix(ext.lower())
        descarga.save_as(str(destino))
        url = descarga.url or ""
        if (not self.plantilla_descarga and url.startswith("http") and str(doc["id"]) in url):
            t = url.replace(str(doc["id"]), "{id}")
            t = t.replace(f"/{{id}}/{doc['major']}/{doc['minor']}", "/{id}/{major}/{minor}")
            t = re.sub(r"((?:major|majorVersion)=)\d+", r"\1{major}", t)
            t = re.sub(r"((?:minor|minorVersion)=)\d+", r"\1{minor}", t)
            if "{major}" in t and "{minor}" in t:  # solo si la versión quedó parametrizada
                self.plantilla_descarga = t
        return destino

    def descargar(self, doc, destino):
        if self.plantilla_descarga:
            try:
                contenido = self._descargar_por_url(doc)
            except ErrorNuup:
                contenido = None
            if contenido:
                ext = Path(doc["archivo_origen"] or "x.pdf").suffix.lower() or ".pdf"
                destino = destino.with_suffix(ext)
                destino.write_bytes(contenido)
                return destino
            self.plantilla_descarga = None  # no funcionó: volver al clic
        return self._descargar_con_clic(doc, destino)


# --------------------------------------------------------------------------

def procesar(nuup, producto, dir_salida, forzar, dir_recon=None):
    """Devuelve una fila del reporte por etiqueta (o una sola si no hay ninguna)."""
    notas = []
    try:
        docs, crudo = nuup.buscar(producto, con_filtro=True)
        if not any(d["categoria"] == CATEGORIA for d in docs):
            docs, crudo = nuup.buscar(producto, con_filtro=False)
            notas.append("búsqueda sin filtro de categoría")
        if dir_recon:
            (dir_recon / f"{nombre_archivo(producto, extension='')}.json").write_text(
                json.dumps(crudo, ensure_ascii=False, indent=1), encoding="utf-8")
        elegidas, nota = seleccionar(producto, docs)
    except Exception as e:
        return [{"producto": producto, "estado": "error",
                 "notas": "; ".join(notas + [f"{type(e).__name__}: {str(e)[:300]}"])}]
    if nota:
        notas.append(nota)
    if not elegidas:
        return [{"producto": producto, "estado": "no encontrado", "notas": "; ".join(notas)}]

    filas = []
    for doc in elegidas:
        fila = {"producto": producto, "paquete": doc["paquete"], "documento": doc["nombre"],
                "titulo": doc["titulo"], "numero": doc["numero"],
                "version": f"{doc['major']}.{doc['minor']}", "estado_nuup": doc["estado"],
                "subido_por": doc["creado_por"] or doc["modificado_por"], "fecha": doc["fecha"]}
        notas_doc = list(notas)
        try:
            existentes = list(dir_salida.glob(nombre_archivo(producto, doc["numero"], ".*")))
            if existentes and not forzar:
                fila["archivo"] = existentes[0].name
                notas_doc.append("ya existía, no se volvió a bajar")
            else:
                destino = dir_salida / nombre_archivo(producto, doc["numero"])
                fila["archivo"] = nuup.descargar(doc, destino).name
            fila["estado"] = "descargado"
        except Exception as e:
            fila["estado"] = "error"
            notas_doc.append(f"{type(e).__name__}: {str(e)[:300]}")
        fila["notas"] = "; ".join(notas_doc)
        filas.append(fila)
    return filas


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--recon", action="store_true", help="solo DAVANTOR, CONVEY y CABRIO C")
    ap.add_argument("--solo", nargs="+", metavar="PRODUCTO")
    ap.add_argument("--productos", default="productos.txt")
    ap.add_argument("--salida", default="etiquetas")
    ap.add_argument("--pausa", type=float, default=1.5)
    ap.add_argument("--forzar", action="store_true", help="volver a bajar aunque ya exista")
    ap.add_argument("--perfil", default=".perfil_nuup")
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
    dir_salida = Path(args.salida)
    dir_salida.mkdir(parents=True, exist_ok=True)
    reporte = Path("reporte_etiquetas_recon.csv" if args.recon else "reporte_etiquetas.csv")
    dir_recon = None
    if args.recon:
        dir_recon = Path("recon_etiquetas")
        dir_recon.mkdir(exist_ok=True)

    print(f"{len(productos)} producto(s). Etiquetas en {dir_salida.resolve()}")
    filas = []
    try:
        with Nuup(Path(args.perfil).resolve(), args.pausa) as nuup:
            nuup.esperar_sesion()
            for i, producto in enumerate(productos, 1):
                nuevas = procesar(nuup, producto, dir_salida, args.forzar, dir_recon)
                filas.extend(nuevas)
                escribir_reporte(reporte, filas)
                if nuevas[0].get("documento"):
                    estados = sorted({f["estado"] for f in nuevas})
                    print(f"[{i}/{len(productos)}] {producto}: {len(nuevas)} etiqueta(s) del paquete "
                          f"{nuevas[0]['paquete']} ({', '.join(estados)})")
                    for f in nuevas:
                        print(f"      {f['documento']} — {f['titulo'][:70]} [{f['estado']}]")
                else:
                    print(f"[{i}/{len(productos)}] {producto}: {nuevas[0]['estado']} — "
                          f"{nuevas[0].get('notas', '')[:110]}")
    except ErrorNuup as e:
        print(f"\nERROR: {e}")
    conteo = {}
    for f in filas:
        conteo[f["estado"]] = conteo.get(f["estado"], 0) + 1
    con_etiqueta = len({f["producto"] for f in filas if f["estado"] == "descargado"})
    print(f"\nResumen: {con_etiqueta} producto(s) con etiqueta; archivos: " +
          ", ".join(f"{k}: {v}" for k, v in sorted(conteo.items())))
    print(f"Reporte: {reporte.resolve()}")


if __name__ == "__main__":
    sys.exit(main())
