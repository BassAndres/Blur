# Pendientes

Orden de trabajo: primero lo de arriba.

## 1. NUUP: Commercial Labels (en curso)

- [ ] Reconocimiento con `nuup_etiquetas/nuup_recon.py --navegador` (inicio de sesión SSO con la cuenta de Windows).
- [ ] Definir reglas: ¿una etiqueta por presentación o solo la más reciente?, ¿solo "APROBADA"?, ¿filtrar por quien la sube?
- [ ] Descargador completo para los 142 productos de `sds_basf/productos.txt`.

## 2. SDS BASF: cierre (en pausa hasta terminar NUUP)

Corrida completa: 71 descargados, 9 con varias coincidencias, 62 no encontrados.
El detalle por producto está en `sds_pendientes.csv` (lo tiene el usuario).

- [ ] **5 descargados incorrectos**: borrar y bajar a mano → STORM (bajó "Storm Blue", pintura), STRATUS (recubrimiento BMW), INTEGRITY (resina), PLURESTO (bajó PLURESTO EXTRA), SIEGE (bajó SIEGE PRO).
- [ ] **35 sin versión en español para México** en el portal: decidir si sirve otra variante en español (p. ej. SDS_CPA_00) o pedirlas a BASF.
- [ ] **27 que no aparecen con ese nombre**: buscar por número de material o nombre alterno.
- [ ] **11 por revisar** (nombre parecido o dos documentos MX): ACROBAT MZ, VIVANDO, BELANTY, TENOPA, AGNIQUE MMF, FORUM 500, QL AGRI 35, OPERA, OPUS, PHANTOM, PONCHO.
- [ ] Mejorar `descargar_sds.py` con lo aprendido: no aceptar coincidencias de otras líneas de negocio (pinturas, resinas); preferir el nombre exacto cuando el producto de la lista es prefijo de otro (SIEGE vs SIEGE PRO).

## 3. Repositorio

- [ ] Pull request de `claude/beautiful-sagan-0yl2h2` a la rama principal (quita Blur).
- [ ] Renombrar la rama principal a `main` y el repo (Settings → General), al final.
