# Pendientes

Orden de trabajo: primero lo de arriba.

## 1. NUUP: Commercial Labels (en curso)

- [x] Reconocimiento (SSO; la API oficial no acepta la sesión del navegador → se usan las consultas internas de la UI).
- [x] Reglas: Commercial Labels › BASF Labels, Approved, cualquier autor; todas las etiquetas del paquete más reciente; si no hay, Non Commercial Labels.
- [x] Reconocimiento con 3 productos (corregidas las marcas de resaltado `!@~ ~@!`).
- [x] Primera corrida: 84 productos con etiqueta (242 PDF), 58 sin etiqueta.
- [ ] Segunda corrida con las reglas nuevas y lista final de faltantes.

## 2. SDS BASF: cierre (en curso)

Corrida completa: 71 descargados, 9 con varias coincidencias, 62 no encontrados.
El detalle por producto está en `sds_pendientes.csv` (lo tiene el usuario).

- [ ] **5 descargados incorrectos**: borrar y bajar a mano → STORM (bajó "Storm Blue", pintura), STRATUS (recubrimiento BMW), INTEGRITY (resina), PLURESTO (bajó PLURESTO EXTRA), SIEGE (bajó SIEGE PRO).
- [ ] **35 sin versión en español para México** en el portal: decidir si sirve otra variante en español (p. ej. SDS_CPA_00) o pedirlas a BASF.
- [ ] **27 que no aparecen con ese nombre**: buscar por número de material o nombre alterno.
- [ ] **11 por revisar** (nombre parecido o dos documentos MX): ACROBAT MZ, VIVANDO, BELANTY, TENOPA, AGNIQUE MMF, FORUM 500, QL AGRI 35, OPERA, OPUS, PHANTOM, PONCHO.
- [x] Mejorar `descargar_sds.py`: fuente válida para D016, no tomar productos de otro renglón de la lista, producto al inicio del nombre, búsqueda solo-español y aproximada, `--reintentar`, `--alternativa-es`.
- [ ] Correr `--reintentar reporte.csv` y armar la lista final para bajar a mano.

## 3. Repositorio

- [ ] Pull request de `claude/beautiful-sagan-0yl2h2` a la rama principal (quita Blur).
- [ ] Renombrar la rama principal a `main` y el repo (Settings → General), al final.
