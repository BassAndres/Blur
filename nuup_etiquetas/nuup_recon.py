#!/usr/bin/env python3
"""Reconocimiento de NUUP (Veeva Vault) para descargar Commercial Labels.

No descarga nada todavía: averigua cómo están guardados los productos y sus
etiquetas comerciales y guarda lo que encuentra en ./recon_nuup/ para revisarlo.

1) Modo navegador (recomendado si entras a NUUP con tu cuenta de Windows/SSO):
   abre Edge, inicias sesión como siempre y el script registra qué consultas hace
   la página al abrir DAVANTOR y si esa sesión sirve para la API oficial.
2) Modo API: pide usuario y contraseña propios de Vault (no sirve con SSO).

Uso:
    py nuup_recon.py --navegador     (recomendado)
    py nuup_recon.py                 (modo API; si falla, pasa a navegador)
"""
import argparse
import getpass
import json
import sys
from pathlib import Path

try:  # certificados de Windows (red corporativa con inspección HTTPS)
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

import requests

VAULT = "https://basf-pelican.veevavault.com"
API = f"{VAULT}/api/v24.1"
PRODUCTO_EJEMPLO = "DAVANTOR"
ID_EJEMPLO = "V7T00000000Q001"  # el registro nuup_product__c del enlace
URL_EJEMPLO = (f"{VAULT}/ui/#t/0TB00000001H002/V7T/{ID_EJEMPLO}"
               "?expanded=details__c%2Cdocuments__c&_layout=nuup_product_detail_page_layout__c")
SALIDA = Path("recon_nuup")


def guardar(nombre, datos):
    SALIDA.mkdir(exist_ok=True)
    (SALIDA / nombre).write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


# --------------------------------------------------------------------------
# Modo API
# --------------------------------------------------------------------------

def modo_api():
    usuario = input("Usuario de NUUP (correo): ").strip()
    clave = getpass.getpass("Contraseña de NUUP (no se ve al escribir): ")
    s = requests.Session()
    s.headers["Accept"] = "application/json"
    r = s.post(f"{API}/auth", data={"username": usuario, "password": clave}, timeout=60)
    clave = None
    try:
        datos = r.json()
    except ValueError:
        print(f"La API respondió algo inesperado (HTTP {r.status_code}).")
        return False
    if datos.get("responseStatus") != "SUCCESS":
        guardar("auth_error.json", datos)
        print("No se pudo entrar por API:", datos.get("errors") or datos.get("responseMessage"))
        return False
    s.headers["Authorization"] = datos["sessionId"]
    print("Sesión de API iniciada.\n")
    resumen = {}

    def get(nombre, ruta, **kw):
        r = s.get(f"{API}{ruta}", timeout=120, **kw)
        try:
            d = r.json()
        except ValueError:
            d = {"http": r.status_code, "texto": r.text[:2000]}
        guardar(nombre, d)
        ok = isinstance(d, dict) and d.get("responseStatus") == "SUCCESS"
        print(f"  {'OK ' if ok else 'ERR'} {ruta[:90]}")
        return d if ok else None

    def vql(nombre, q):
        r = s.post(f"{API}/query", data={"q": q}, timeout=120)
        try:
            d = r.json()
        except ValueError:
            d = {"http": r.status_code, "texto": r.text[:2000]}
        d["_consulta"] = q
        guardar(nombre, d)
        ok = d.get("responseStatus") == "SUCCESS"
        print(f"  {'OK ' if ok else 'ERR'} VQL {q[:100]}")
        return d.get("data") if ok else None

    try:
        print("Metadatos:")
        tipos = get("tipos_documento.json", "/metadata/objects/documents/types")
        props = get("propiedades_documento.json", "/metadata/objects/documents/properties")
        get("objeto_nuup_product.json", "/metadata/vobjects/nuup_product__c")
        get(f"registro_{ID_EJEMPLO}.json", f"/vobjects/nuup_product__c/{ID_EJEMPLO}")

        if tipos:
            etiquetas = [t for t in tipos.get("types", [])
                         if "label" in json.dumps(t).lower() or "etiqueta" in json.dumps(t).lower()]
            resumen["tipos_con_label"] = etiquetas
            for t in etiquetas:
                get(f"tipo_{t.get('name')}.json", f"/metadata/objects/documents/types/{t.get('name')}")

        campos_producto = []
        if props:
            for p in props.get("properties", []):
                texto = json.dumps(p).lower()
                if "nuup_product" in texto or "product" in p.get("name", "").lower():
                    campos_producto.append({k: p.get(k) for k in
                                            ("name", "label", "type", "objectType", "repeating", "relationshipName")})
        resumen["campos_documento_producto"] = campos_producto

        print("\nConsultas de ejemplo con DAVANTOR:")
        campos = ("id, name__v, document_number__v, type__v, subtype__v, classification__v, "
                  "status__v, major_version_number__v, minor_version_number__v, "
                  "version_modified_date__v, document_creation_date__v, created_by__v")
        vql("vql_producto.json",
            f"SELECT id, name__v FROM nuup_product__c WHERE name__v = '{PRODUCTO_EJEMPLO}'")
        docs = vql("vql_documentos_find.json",
                   f"SELECT {campos} FROM documents FIND ('{PRODUCTO_EJEMPLO.lower()}')")
        for c in campos_producto:
            nombre = c["name"]
            vql(f"vql_documentos_por_{nombre}.json",
                f"SELECT {campos} FROM documents WHERE {nombre} = '{ID_EJEMPLO}'")
            vql(f"vql_documentos_por_{nombre}_contains.json",
                f"SELECT {campos} FROM documents WHERE {nombre} CONTAINS ('{ID_EJEMPLO}')")

        if docs:
            resumen["documentos_find"] = [
                {k: d.get(k) for k in ("id", "name__v", "type__v", "subtype__v", "classification__v",
                                       "status__v", "major_version_number__v",
                                       "minor_version_number__v", "version_modified_date__v")}
                for d in docs]
            # Detalle completo de los primeros documentos que parezcan etiqueta
            muestra = [d for d in docs if "etiqueta" in str(d.get("name__v", "")).lower()
                       or "label" in json.dumps(d).lower()][:3] or docs[:3]
            for d in muestra:
                get(f"documento_{d['id']}.json", f"/objects/documents/{d['id']}")
                get(f"documento_{d['id']}_versiones.json", f"/objects/documents/{d['id']}/versions")
                get(f"documento_{d['id']}_renditions.json", f"/objects/documents/{d['id']}/renditions")

        guardar("resumen.json", resumen)
        print("\nResumen:")
        print(json.dumps(resumen, ensure_ascii=False, indent=2)[:6000])
    finally:
        try:
            s.delete(f"{API}/session", timeout=30)
        except Exception:
            pass
    return True


# --------------------------------------------------------------------------
# Modo navegador
# --------------------------------------------------------------------------

_JS_PROBAR = """async ([url, auth]) => {
  const h = {'Accept': 'application/json'};
  if (auth) h['Authorization'] = auth;
  try {
    const r = await fetch(url, {headers: h, credentials: 'include'});
    const t = await r.text();
    let estado = null;
    try { estado = JSON.parse(t).responseStatus; } catch (e) {}
    return {http: r.status, responseStatus: estado, inicio: t.slice(0, 300)};
  } catch (e) { return {error: String(e)}; }
}"""


def probar_api_con_sesion(ctx, page):
    """¿Sirve la sesión del navegador (SSO) para la API oficial? Prueba con la
    cookie de sesión y con cada cookie como encabezado Authorization. Solo se
    guardan los NOMBRES de las cookies y el resultado, nunca sus valores."""
    url = f"{API}/metadata/objects/documents/types"
    resultados = [{"prueba": "solo cookies", **page.evaluate(_JS_PROBAR, [url, None])}]
    for c in ctx.cookies():
        if "veevavault.com" not in c.get("domain", ""):
            continue
        r = page.evaluate(_JS_PROBAR, [url, c["value"]])
        if r.get("responseStatus") != "SUCCESS":
            r.pop("inicio", None)
        resultados.append({"prueba": f"Authorization = cookie {c['name']}", **r})
    for r in resultados:
        print(f"  {r['prueba']}: HTTP {r.get('http')} {r.get('responseStatus') or r.get('error') or ''}")
    return resultados


def modo_navegador():
    from playwright.sync_api import sync_playwright

    registros = []

    def al_responder(resp):
        req = resp.request
        if req.resource_type not in ("xhr", "fetch") or "veevavault.com" not in req.url:
            return
        try:
            cuerpo = resp.text()[:20000]
        except Exception:
            cuerpo = None
        registros.append({
            "metodo": req.method, "url": req.url, "estado": resp.status,
            "tipo": resp.headers.get("content-type"),
            "cabeceras_peticion": sorted(req.headers.keys()),  # solo nombres, sin valores
            "cuerpo_peticion": (req.post_data or "")[:3000],
            "respuesta": cuerpo,
        })

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(Path(".perfil_nuup").resolve()), channel="msedge", headless=False,
            viewport={"width": 1400, "height": 900})
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(VAULT, wait_until="domcontentloaded", timeout=120000)
        input("\n>>> Inicia sesión en NUUP en la ventana de Edge. Cuando veas la página de inicio,"
              " vuelve aquí y presiona ENTER... ")
        guardar("pruebas_api_con_sesion.json", probar_api_con_sesion(ctx, page))
        ctx.on("response", al_responder)
        page.goto(URL_EJEMPLO, wait_until="domcontentloaded", timeout=120000)
        page.wait_for_timeout(8000)
        input(">>> En Edge abre la sección de Documentos de DAVANTOR y haz clic en una etiqueta"
              " comercial (sin descargarla). Luego presiona ENTER aquí... ")
        page.wait_for_timeout(3000)
        SALIDA.mkdir(exist_ok=True)
        page.screenshot(path=str(SALIDA / "pantalla.png"), full_page=True)
        ctx.close()
    guardar("red_navegador.json", registros)
    print(f"Se registraron {len(registros)} consultas de la página en {SALIDA / 'red_navegador.json'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--navegador", action="store_true", help="saltar el modo API")
    args = ap.parse_args()
    ok = False
    if not args.navegador:
        try:
            ok = modo_api()
        except requests.RequestException as e:
            print(f"No se pudo conectar a la API: {type(e).__name__}: {e}")
    if not ok:
        print("\nPaso al modo navegador.")
        modo_navegador()
    print(f"\nListo. Mándame la carpeta {SALIDA.resolve()} comprimida en .zip.")


if __name__ == "__main__":
    sys.exit(main())
