#!/usr/bin/env python3
"""
Genera 'horario.csv' listo para importarse en Google Calendar.

Horario del semestre 2027-1, Facultad de Ingeniería, UNAM.
Los nombres de los profesores se tomaron de:
https://www.ssa.ingenieria.unam.mx/horarios.html

Google Calendar no soporta reglas de recurrencia en su formato CSV, por lo que
el script expande cada clase en una fila por sesión, omitiendo los días inhábiles.
"""

import csv
from datetime import date, timedelta

# --- Calendario del semestre -------------------------------------------------

INICIO = date(2026, 8, 10)
FIN = date(2026, 11, 27)

DIAS_INHABILES = {
    date(2026, 9, 15),
    date(2026, 9, 16),
    date(2026, 11, 1),
    date(2026, 11, 2),
    date(2026, 11, 17),
}

# Se agrega al campo Location de cada evento. Dejar en "" para usar solo el salón.
SUFIJO_UBICACION = ", Facultad de Ingeniería, UNAM"

ARCHIVO_SALIDA = "horario.csv"

# Lunes = 0 ... Domingo = 6
LUN, MAR, MIE, JUE, VIE = 0, 1, 2, 3, 4

# --- Materias ----------------------------------------------------------------
# Cada bloque = un conjunto de días que comparten horario y salón.

MATERIAS = [
    {
        "clave": "1644",
        "nombre": "Bases de Datos",
        "grupo": "1",
        "profesor": "Ing. Fernando Arreola Franco",
        "tipo": "Teoría",
        "color": "Pavo real",
        "bloques": [
            {"dias": [LUN, MIE, VIE], "inicio": "07:00", "fin": "09:00", "salon": "B404"},
        ],
    },
    {
        "clave": "6644",
        "nombre": "Lab. Bases de Datos",
        "grupo": "6",
        "profesor": "Ing. Jorge Alberto Rodríguez Campos",
        "tipo": "Laboratorio",
        "color": "Salvia",
        "bloques": [
            {"dias": [VIE], "inicio": "09:00", "fin": "11:00", "salon": "T101"},
        ],
    },
    {
        "clave": "1590",
        "nombre": "Computación Gráfica e Interacción Humano-Computadora",
        "grupo": "4",
        "profesor": "Ing. José Ramón Pérez Athie",
        "tipo": "Teoría",
        "color": "Uva",
        "bloques": [
            {"dias": [MAR, JUE], "inicio": "09:00", "fin": "11:00", "salon": "B204"},
        ],
    },
    {
        "clave": "6590",
        "nombre": "Lab. Computación Gráfica e Interacción Humano-Computadora",
        "grupo": "6",
        "profesor": "Dr. Sergio Teodoro Vite",
        "tipo": "Laboratorio",
        "color": "Lavanda",
        "bloques": [
            {"dias": [MAR], "inicio": "17:00", "fin": "19:00", "salon": "Q219"},
        ],
    },
    {
        "clave": "1535",
        "nombre": "Diseño Digital VLSI",
        "grupo": "3",
        "profesor": "Ing. Karol Joshua Martínez Rosete",
        "tipo": "Teoría",
        "color": "Flamenco",
        "bloques": [
            {"dias": [LUN, MIE], "inicio": "15:00", "fin": "16:30", "salon": "A107"},
            {"dias": [VIE], "inicio": "15:00", "fin": "17:00", "salon": "T101",
             "tipo": "Laboratorio"},
        ],
    },
    {
        "clave": "434",
        "nombre": "Compiladores",
        "grupo": "2",
        "profesor": "M.I. Manuel Enrique Castañeda Castañeda",
        "tipo": "Teoría",
        "color": "Mandarina",
        "bloques": [
            {"dias": [LUN, MIE], "inicio": "19:00", "fin": "21:00", "salon": "A201"},
        ],
    },
    {
        "clave": "1789",
        "nombre": "Ciencia, Tecnología y Sociedad",
        "grupo": "12",
        "profesor": "Mtro. Rodolfo Carlos Prieto Mendoza",
        "tipo": "Teoría",
        "color": "Plátano",
        "bloques": [
            {"dias": [MIE], "inicio": "17:00", "fin": "19:00", "salon": "A104"},
        ],
    },
]

CABECERAS = [
    "Subject", "Start Date", "Start Time", "End Date", "End Time",
    "Description", "Location", "Private",
]


def dias_habiles():
    """Todos los días del semestre, sin fines de semana ni días inhábiles."""
    dia = INICIO
    while dia <= FIN:
        if dia.weekday() < 5 and dia not in DIAS_INHABILES:
            yield dia
        dia += timedelta(days=1)


def formato_fecha(dia):
    return dia.strftime("%m/%d/%Y")


def formato_hora(hhmm):
    """'07:00' -> '07:00 AM' (formato de 12 horas que espera Google Calendar)."""
    hora, minuto = (int(x) for x in hhmm.split(":"))
    sufijo = "AM" if hora < 12 else "PM"
    hora12 = hora % 12 or 12
    return f"{hora12:02d}:{minuto:02d} {sufijo}"


def generar_filas():
    filas = []
    for dia in dias_habiles():
        del_dia = []
        for materia in MATERIAS:
            for bloque in materia["bloques"]:
                if dia.weekday() not in bloque["dias"]:
                    continue
                tipo = bloque.get("tipo", materia["tipo"])
                del_dia.append({
                    "Subject": (f"{materia['nombre']} - Gpo {materia['grupo']} - "
                                f"{materia['profesor']}"),
                    "Start Date": formato_fecha(dia),
                    "Start Time": formato_hora(bloque["inicio"]),
                    "End Date": formato_fecha(dia),
                    "End Time": formato_hora(bloque["fin"]),
                    "Description": (f"Clave: {materia['clave']} | {tipo} | "
                                    f"Grupo {materia['grupo']} | "
                                    f"Profesor: {materia['profesor']} | "
                                    f"Color sugerido: {materia['color']}"),
                    "Location": bloque["salon"] + SUFIJO_UBICACION,
                    "Private": "False",
                    "_orden": bloque["inicio"],
                })
        del_dia.sort(key=lambda f: f["_orden"])
        for fila in del_dia:
            fila.pop("_orden")
        filas.extend(del_dia)
    return filas


def main():
    filas = generar_filas()
    with open(ARCHIVO_SALIDA, "w", newline="", encoding="utf-8") as f:
        escritor = csv.DictWriter(f, fieldnames=CABECERAS)
        escritor.writeheader()
        escritor.writerows(filas)
    print(f"Se generaron {len(filas)} eventos en '{ARCHIVO_SALIDA}'.")
    print(f"Periodo: {formato_fecha(INICIO)} - {formato_fecha(FIN)} "
          f"({len(DIAS_INHABILES)} días inhábiles omitidos).")


if __name__ == "__main__":
    main()
