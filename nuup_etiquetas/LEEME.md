# Etiquetas comerciales de NUUP (Veeva Vault)

Descarga, para cada producto de `productos.txt`, **todas** las etiquetas comerciales de la
versión más reciente: categoría **NUUP › Commercial Labels › BASF Labels**, estado
**Approved**, de cualquier autor. Si el producto no tiene ninguna, baja las **Non Commercial
Labels** aprobadas (`<PRODUCTO>_ETIQUETA_NC_<número>.pdf`).

El nombre del documento trae paquete y número (`CL-00160DAVANTOR-1149` → paquete 00160,
número 1149). La versión más reciente es el paquete de la etiqueta válida con número más alto;
se bajan todas las etiquetas válidas de ese paquete (1 L, 10x1 L, caja, reverso…).

Usa tu sesión de Edge (inicio de sesión con tu cuenta de Windows). No pide contraseña.

    py -m pip install playwright
    py descargar_etiquetas.py --recon     (DAVANTOR, CONVEY y CABRIO C)
    py descargar_etiquetas.py             (toda la lista)

- Archivos: `etiquetas/<PRODUCTO>_ETIQUETA_<número>.pdf`. Reporte: `reporte_etiquetas.csv` (una fila por etiqueta).
- Si se interrumpe, vuelve a correrlo: no baja de nuevo lo que ya existe (`--forzar` para rebajar).
- Si cambia la versión elegida de un producto, sus PDF anteriores se mueven a `etiquetas/_anteriores/`.
- `nuup_recon.py` es el reconocimiento inicial del portal.
- **No compartas la carpeta `.perfil_nuup/`**: contiene tu sesión de NUUP.
