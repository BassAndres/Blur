# Etiquetas comerciales de NUUP (Veeva Vault)

Descarga, para cada producto de `productos.txt`, la etiqueta comercial más reciente:
categoría **NUUP › Commercial Labels › BASF Labels**, estado **Approved**, subida por
**Fernanda Camarillo**; si hay varias, la de número de documento más alto
(`CL-00160DAVANTOR-1149` → 1149).

Usa tu sesión de Edge (inicio de sesión con tu cuenta de Windows). No pide contraseña.

    py -m pip install playwright
    py descargar_etiquetas.py --recon     (DAVANTOR, CONVEY y CABRIO C)
    py descargar_etiquetas.py             (toda la lista)

- Archivos: `etiquetas/<PRODUCTO>_ETIQUETA.pdf`. Reporte: `reporte_etiquetas.csv`.
- Si se interrumpe, vuelve a correrlo: no baja de nuevo lo que ya existe (`--forzar` para rebajar).
- `nuup_recon.py` es el reconocimiento inicial del portal.
- **No compartas la carpeta `.perfil_nuup/`**: contiene tu sesión de NUUP.
