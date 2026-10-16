# Descarga de SDS BASF México

Descarga, desde https://sds.basf.com/, la SDS en español con variante MX (ej. `SDS_CPA_MX`)
de cada producto de `productos.txt`, usando la org. de venta **D016 - BASF Agricultural
Solutions Mexico SA de CV**.

El portal pide iniciar sesión con cuenta BASF. El script abre una ventana del navegador,
**tú inicias sesión a mano** (el script nunca ve tu contraseña) y luego usa directamente la
API del portal (`api.sds.basf.com:9446`) con la sesión abierta, con pausas de ~2 s entre peticiones.

## Instalación (una vez)

Necesitas Python 3.9 o superior. Dentro de esta carpeta:

    py -m pip install -r requirements.txt          (macOS/Linux: python3 -m pip ...)

No hace falta `playwright install chromium`: si no está, el script usa Microsoft Edge (o Chrome).
En redes corporativas con inspección HTTPS el script usa los certificados de Windows y, si
la conexión directa aun así falla, hace las peticiones desde el propio navegador.

## Paso 1: reconocimiento (3 productos)

    py descargar_sds.py --recon          (macOS/Linux: python3 descargar_sds.py --recon)

1. Se abre el navegador: inicia sesión con tu cuenta BASF. La sesión queda guardada en `.perfil_basf/`.
2. El script busca VOLLEY, CABRIO C y P.I, baja sus PDF a `sds/` y escribe `reporte_recon.csv`.
3. Mándame `recon/resumen.txt` y `recon/busqueda_de_la_pagina.json` (no contienen tu contraseña
   ni tu token) para validar los filtros antes de la corrida completa.

## Paso 2: corrida completa

    py descargar_sds.py

- PDFs: `sds/<PRODUCTO>_SDS_MX.pdf`. Reporte: `reporte.csv` (se guarda tras cada producto).
- Si se interrumpe, vuelve a correrlo: no vuelve a bajar los PDF que ya existen (usa `--forzar` para rebajarlos).
- Solo algunos productos: `py descargar_sds.py --solo "HEAT" "STORM (PELLETS)"`
- Más lento o más rápido: `--pausa 4`

## Reintentar lo pendiente

    py descargar_sds.py --reintentar reporte.csv
    py descargar_sds.py --reintentar reporte.csv --alternativa-es

- Reprocesa solo los productos no descargados o con coincidencia parcial. Los PDF anteriores
  de esos productos se mueven a `sds/_anteriores/` y el resultado se combina en `reporte.csv`
  (respaldo en `reporte_anterior.csv`).
- `--alternativa-es`: si no hay versión MX en español, baja la mejor versión en español
  (primero la global `*_00`, luego la más reciente) a `sds_alternativas/` con estado
  `alternativa (no MX)`.

Reglas extra: se descartan documentos cuya fuente no admite D016 (p. ej. recubrimientos),
nombres que corresponden mejor a otro producto de la lista (SIEGE PRO para SIEGE) y
coincidencias parciales donde el producto no va al inicio del nombre. Si nada aparece, se
intenta solo con filtro de español y, al final, una búsqueda aproximada (errores de captura
como FENDONDA/Fendona; los números deben coincidir), marcada como `aproximada` para revisar.

## Reporte

Columnas: producto, termino_buscado, estado, nombre_documento, variante, idioma, version,
fecha, material, bi_number, org_venta, coincidencia_nombre, archivo, notas.

- **descargado**: un único documento en español con variante MX.
- **varias coincidencias**: hubo más de un documento ES+MX; se bajó el más reciente y en `notas` vienen los demás (revísalo).
- **no encontrado**: ni con `<PRODUCTO> MX` ni solo con el nombre apareció un documento ES+MX; `notas` dice qué idiomas/variantes sí había.
- **error**: falló la búsqueda o la descarga; el detalle está en `notas`.
- `coincidencia_nombre = parcial`: el nombre en el portal trae palabras de más (ej. `FASTAC 100` buscando `FASTAC`); revísalo.

Reglas: busca `<PRODUCTO> MX` en el campo Material; si no hay un documento ES+MX, reintenta solo con
`<PRODUCTO>`. Se consideran válidos los resultados cuyo nombre contiene el producto, en español
y con variante que contenga "MX". Un mismo documento en varias presentaciones cuenta como uno.
