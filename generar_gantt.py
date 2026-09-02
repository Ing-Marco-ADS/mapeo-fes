import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from datetime import date, timedelta
import json
import os

ARCHIVO = 'gantt_servicio_social.xlsx'
TAREAS_JSON = 'gantt_tareas.json'

# Fechas del proyecto
INICIO = date(2026, 9, 1)
FIN = date(2027, 1, 15)

# Generar semanas
def generar_semanas(inicio, fin):
    semanas = []
    actual = inicio
    num = 1
    while actual <= fin:
        fin_semana = actual + timedelta(days=6)
        if fin_semana > fin:
            fin_semana = fin
        semanas.append({
            'num': num,
            'inicio': actual,
            'fin': fin_semana,
            'etiqueta': f"Sem {num}\n{actual.strftime('%d/%m')} - {fin_semana.strftime('%d/%m')}"
        })
        actual = fin_semana + timedelta(days=1)
        num += 1
    return semanas

SEMANAS = generar_semanas(INICIO, FIN)

# Tareas del proyecto
TAREAS = [
    # FASE 1: CONFIGURACION (Semanas 1-2)
    {'id': 1,  'tarea': 'Clonar repo y configurar entorno de desarrollo',
     'equipo': 'Eq. 1 (Desarrollo)', 'inicio': 1, 'fin': 1, 'estado': 'Pendiente',
     'descripcion': 'Instalar Python, dependencias, clonar desde GitHub, verificar que la app corre local.'},
    {'id': 2,  'tarea': 'Configurar GraphHopper y probar encaje de caminos',
     'equipo': 'Eq. 1 (Desarrollo)', 'inicio': 1, 'fin': 2, 'estado': 'Pendiente',
     'descripcion': 'Obtener clave, guardar .graphhopper_key, probar /api/snap con puntos reales de la FES.'},
    {'id': 3,  'tarea': 'Primer recorrido de validacion en campo',
     'equipo': 'Eq. 2 (Mapeo)', 'inicio': 1, 'fin': 2, 'estado': 'Pendiente',
     'descripcion': 'Salir a la FES con la app, hacer un recorrido corto, verificar que el tracking y los puntos funcionan bien.'},
    {'id': 4,  'tarea': 'Reportar errores y sugerencias encontrados',
     'equipo': 'Eq. 2 (Mapeo)', 'inicio': 2, 'fin': 2, 'estado': 'Pendiente',
     'descripcion': 'Documentar que no funciono, que se necesita mejorar, que botones faltan, etc.'},

    # FASE 2: DESARROLLO Y MAPEO (Semanas 3-10)
    {'id': 5,  'tarea': 'Corregir errores de tracking y tipos de puntos',
     'equipo': 'Eq. 1 (Desarrollo)', 'inicio': 3, 'fin': 4, 'estado': 'Pendiente',
     'descripcion': 'Ajustar el encaje de caminos, agregar tipos de punto que falten, corregir bugs reportados.'},
    {'id': 6,  'tarea': 'Mapear zona norte de la FES (edificios principales)',
     'equipo': 'Eq. 2 (Mapeo)', 'inicio': 3, 'fin': 5, 'estado': 'Pendiente',
     'descripcion': 'Recorrer y marcar: edificios, escaleras, rampas, banos, biblioteca, etc. de la zona norte.'},
    {'id': 7,  'tarea': 'Agregar funcionalidad de compartir recorrido (QR/WhatsApp)',
     'equipo': 'Eq. 1 (Desarrollo)', 'inicio': 5, 'fin': 6, 'estado': 'Pendiente',
     'descripcion': 'Generar codigo QR con la URL del mapa exportado, boton para compartir por WhatsApp.'},
    {'id': 8,  'tarea': 'Mapear zona central de la FES (patios, canchas)',
     'equipo': 'Eq. 2 (Mapeo)', 'inicio': 5, 'fin': 7, 'estado': 'Pendiente',
     'descripcion': 'Recorrer patios, canchas de basquet/futbol, cafeterias, zona de descanso.'},
    {'id': 9,  'tarea': 'Mejorar narracion por voz de puntos cercanos',
     'equipo': 'Eq. 1 (Desarrollo)', 'inicio': 7, 'fin': 8, 'estado': 'Pendiente',
     'descripcion': 'Al acercarse a un punto marcado, que la app anuncie por voz: "Cerca hay un baño a 15 metros".'},
    {'id': 10, 'tarea': 'Mapear zona sur de la FES (canchas, zonas deportivas)',
     'equipo': 'Eq. 2 (Mapeo)', 'inicio': 7, 'fin': 9, 'estado': 'Pendiente',
     'descripcion': 'Recorrer zona deportiva, entradas/salidas, escaleras exteriores, zonas de descanso.'},
    {'id': 11, 'tarea': 'Optimizar rendimiento y bateria',
     'equipo': 'Eq. 1 (Desarrollo)', 'inicio': 9, 'fin': 10, 'estado': 'Pendiente',
     'descripcion': 'Reducir frecuencia de GPS si no se esta moviendo, optimizar fetch, minimizar datos.'},
    {'id': 12, 'tarea': 'Completar mapeo de zonas faltantes',
     'equipo': 'Eq. 2 (Mapeo)', 'inicio': 9, 'fin': 10, 'estado': 'Pendiente',
     'descripcion': 'Revisar el mapa general, ir por las zonas que no estan cubiertas aun.'},

    # FASE 3: PRUEBAS Y VALIDACION (Semanas 11-14)
    {'id': 13, 'tarea': 'Pruebas de usabilidad con usuarios ciegos',
     'equipo': 'Eq. 2 (Mapeo)', 'inicio': 11, 'fin': 12, 'estado': 'Pendiente',
     'descripcion': 'Invitar a personas con discapacidad visual a probar la app, observar dificultades.'},
    {'id': 14, 'tarea': 'Corregir errores de pruebas de usabilidad',
     'equipo': 'Eq. 1 (Desarrollo)', 'inicio': 12, 'fin': 13, 'estado': 'Pendiente',
     'descripcion': 'Ajustar la app segun el feedback de los usuarios: tamanos, contraste, navegacion, etc.'},
    {'id': 15, 'tarea': 'Segunda ronda de pruebas con usuarios',
     'equipo': 'Eq. 2 (Mapeo)', 'inicio': 13, 'fin': 14, 'estado': 'Pendiente',
     'descripcion': 'Validar que las correcciones funcionaron, probar con otros usuarios.'},
    {'id': 16, 'tarea': 'Ajustes finales de la aplicacion',
     'equipo': 'Eq. 1 (Desarrollo)', 'inicio': 14, 'fin': 14, 'estado': 'Pendiente',
     'descripcion': 'Corregir ultimo bug, asegurar que todo funcione para la demo final.'},

    # FASE 4: DOCUMENTACION Y PRESENTACION (Semanas 15-20)
    {'id': 17, 'tarea': 'Redactar documento de servicio social',
     'equipo': 'Eq. 2 (Mapeo)', 'inicio': 15, 'fin': 17, 'estado': 'Pendiente',
     'descripcion': 'Introduccion, metodologia, resultados, conclusiones, evidencias fotograficas.'},
    {'id': 18, 'tarea': 'Preparar material de presentacion',
     'equipo': 'Eq. 1 (Desarrollo)', 'inicio': 17, 'fin': 18, 'estado': 'Pendiente',
     'descripcion': 'Diapositivas, demo en vivo del funcionamiento de la app, videos cortos.'},
    {'id': 19, 'tarea': 'Ensayo de presentacion final',
     'equipo': 'Ambos equipos', 'inicio': 19, 'fin': 19, 'estado': 'Pendiente',
     'descripcion': 'Practicar la presentacion, coordinar que dice cada quien, ensayar la demo.'},
    {'id': 20, 'tarea': 'Entrega final del proyecto',
     'equipo': 'Ambos equipos', 'inicio': 20, 'fin': 20, 'estado': 'Pendiente',
     'descripcion': 'Entregar documento, app funcional, evidencias de mapeo, presentacion.'},
]

# Guardar las tareas como JSON para poder actualizarlas despues
def guardar_tareas_json():
    with open(TAREAS_JSON, 'w', encoding='utf-8') as f:
        json.dump(TAREAS, f, ensure_ascii=False, indent=2)

# Cargar tareas desde JSON si existe
def cargar_tareas():
    global TAREAS
    if os.path.exists(TAREAS_JSON):
        with open(TAREAS_JSON, 'r', encoding='utf-8') as f:
            TAREAS = json.load(f)

# Colores por equipo
COLORES_EQUIPO = {
    'Eq. 1 (Desarrollo)': '4472C4',   # Azul
    'Eq. 2 (Mapeo)': 'ED7D31',        # Naranja
    'Ambos equipos': '70AD47',         # Verde
}

COLORES_ESTADO = {
    'Pendiente': 'D9D9D9',      # Gris
    'En progreso': 'FFC000',    # Amarillo
    'Completada': '70AD47',     # Verde
}

def crear_gantt():
    cargar_tareas()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Gantt Servicio Social'

    # ---- Estilos ----
    fuente_titulo = Font(name='Calibri', size=16, bold=True, color='1F4E79')
    fuente_sub = Font(name='Calibri', size=11, italic=True, color='595959')
    fuente_header = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
    fuente_header_semana = Font(name='Calibri', size=8, bold=True, color='FFFFFF')
    fuente_tarea = Font(name='Calibri', size=10)
    fuente_tarea_negrita = Font(name='Calibri', size=10, bold=True)
    fuente_estado = Font(name='Calibri', size=9, bold=True, color='FFFFFF')
    fuente_id = Font(name='Calibri', size=9, color='595959')

    borde_fino = Border(
        left=Side(style='thin', color='B4C6E7'),
        right=Side(style='thin', color='B4C6E7'),
        top=Side(style='thin', color='B4C6E7'),
        bottom=Side(style='thin', color='B4C6E7')
    )
    alineacion_centro = Alignment(horizontal='center', vertical='center', wrap_text=True)
    alineacion_izq = Alignment(horizontal='left', vertical='center', wrap_text=True)

    # ---- Fila 1: Titulo ----
    ws.merge_cells('A1:Z1')
    celda = ws['A1']
    celda.value = 'GANTT - Servicio Social: Mapeo Accesible FES'
    celda.font = fuente_titulo
    celda.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 35

    # ---- Fila 2: Subtitulo ----
    ws.merge_cells('A2:Z2')
    celda = ws['A2']
    celda.value = f'Inicio: {INICIO.strftime("%d/%m/%Y")}  |  Fin: {FIN.strftime("%d/%m/%Y")}  |  4 horas/dia  |  2 equipos de 2 personas'
    celda.font = fuente_sub
    celda.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[2].height = 22

    # ---- Fila 3: Leyenda de colores ----
    ws.merge_cells('A3:F3')
    ws['A3'].value = 'Leyenda de colores por equipo:'
    ws['A3'].font = Font(name='Calibri', size=9, bold=True)
    col = 7
    for eq, color in COLORES_EQUIPO.items():
        ws.cell(row=3, column=col).fill = PatternFill(start_color=color, fill_type='solid')
        ws.cell(row=3, column=col).font = Font(name='Calibri', size=8, bold=True, color='FFFFFF')
        ws.cell(row=3, column=col).value = eq
        ws.cell(row=3, column=col).alignment = alineacion_centro
        col += 1
    # Leyenda de estados
    col += 1
    ws.cell(row=3, column=col).value = 'Estado:'
    ws.cell(row=3, column=col).font = Font(name='Calibri', size=9, bold=True)
    col += 1
    for est, color in COLORES_ESTADO.items():
        ws.cell(row=3, column=col).fill = PatternFill(start_color=color, fill_type='solid')
        ws.cell(row=3, column=col).font = Font(name='Calibri', size=8, bold=True, color='FFFFFF' if est != 'Pendiente' else '333333')
        ws.cell(row=3, column=col).value = est
        ws.cell(row=3, column=col).alignment = alineacion_centro
        col += 1
    ws.row_dimensions[3].height = 20

    # ---- Fila 4: Cabeceras ----
    fila_header = 5
    headers = ['#', 'Tarea', 'Equipo', 'Sem Ini', 'Sem Fin', 'Estado']
    anchos = [4, 50, 22, 8, 8, 14]
    for i, (h, w) in enumerate(zip(headers, anchos), 1):
        celda = ws.cell(row=fila_header, column=i, value=h)
        celda.font = fuente_header
        celda.fill = PatternFill(start_color='1F4E79', fill_type='solid')
        celda.alignment = alineacion_centro
        celda.border = borde_fino
        ws.column_dimensions[get_column_letter(i)].width = w

    # Columnas de semanas
    col_semana_inicio = len(headers) + 1
    for s in SEMANAS:
        celda = ws.cell(row=fila_header, column=col_semana_inicio + s['num'] - 1)
        celda.value = f"Sem {s['num']}\n{s['inicio'].strftime('%d/%m')}\n{s['fin'].strftime('%d/%m')}"
        celda.font = fuente_header_semana
        celda.fill = PatternFill(start_color='2E75B6', fill_type='solid')
        celda.alignment = alineacion_centro
        celda.border = borde_fino
        ws.column_dimensions[get_column_letter(col_semana_inicio + s['num'] - 1)].width = 11

    ws.row_dimensions[fila_header].height = 45

    # ---- Filas de tareas ----
    for idx, tarea in enumerate(TAREAS):
        fila = fila_header + 1 + idx
        color_eq = COLORES_EQUIPO.get(tarea['equipo'], '78909C')
        color_estado = COLORES_ESTADO.get(tarea['estado'], 'D9D9D9')

        # Columnas fijas
        ws.cell(row=fila, column=1, value=tarea['id']).font = fuente_id
        ws.cell(row=fila, column=1).alignment = alineacion_centro

        ws.cell(row=fila, column=2, value=tarea['tarea']).font = fuente_tarea
        ws.cell(row=fila, column=2).alignment = alineacion_izq

        ws.cell(row=fila, column=3, value=tarea['equipo']).font = fuente_tarea
        ws.cell(row=fila, column=3).alignment = alineacion_centro
        ws.cell(row=fila, column=3).fill = PatternFill(start_color=color_eq, fill_type='solid')
        ws.cell(row=fila, column=3).font = Font(name='Calibri', size=9, bold=True, color='FFFFFF')

        ws.cell(row=fila, column=4, value=tarea['inicio']).font = fuente_tarea
        ws.cell(row=fila, column=4).alignment = alineacion_centro

        ws.cell(row=fila, column=5, value=tarea['fin']).font = fuente_tarea
        ws.cell(row=fila, column=5).alignment = alineacion_centro

        ws.cell(row=fila, column=6, value=tarea['estado']).font = fuente_estado
        ws.cell(row=fila, column=6).fill = PatternFill(start_color=color_estado, fill_type='solid')
        ws.cell(row=fila, column=6).alignment = alineacion_centro

        # Aplicar bordes a columnas fijas
        for c in range(1, 7):
            ws.cell(row=fila, column=c).border = borde_fino

        # Barras del Gantt
        for s in SEMANAS:
            col_barra = col_semana_inicio + s['num'] - 1
            celda_barra = ws.cell(row=fila, column=col_barra)
            celda_barra.border = borde_fino

            if tarea['inicio'] <= s['num'] <= tarea['fin']:
                celda_barra.fill = PatternFill(start_color=color_eq, fill_type='solid')
                # Si la tarea esta completada, poner check
                if tarea['estado'] == 'Completada':
                    celda_barra.value = '✓'
                    celda_barra.font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
                    celda_barra.alignment = alineacion_centro
                else:
                    celda_barra.value = '●'
                    celda_barra.font = Font(name='Calibri', size=9, color='FFFFFF')
                    celda_barra.alignment = alineacion_centro
            else:
                celda_barra.value = ''

        ws.row_dimensions[fila].height = 28

    # ---- Fila de descripcion detallada (debajo de cada tarea) ----
    # Insertar filas de descripcion debajo de cada tarea
    fila_actual = fila_header + 1
    for idx, tarea in enumerate(TAREAS):
        fila_desc = fila_actual + 1
        # Mover todas las filas inferiores hacia abajo
        # En su lugar, pondremos la descripcion en un tooltip o en la misma celda
        # Simplificacion: agregar la descripcion como texto en la celda de la tarea
        celda_tarea = ws.cell(row=fila_actual, column=2)
        celda_tarea.value = f"{tarea['tarea']}\n({tarea['descripcion']})"
        celda_tarea.font = fuente_tarea
        celda_tarea.alignment = Alignment(horizontal='left', vertical='top', wrap_text=True)
        ws.row_dimensions[fila_actual].height = 40
        fila_actual += 1

    # ---- Fila de resumen al final ----
    fila_resumen = fila_actual + 1
    ws.cell(row=fila_resumen, column=1).value = ''
    ws.cell(row=fila_resumen, column=2).value = 'RESUMEN DE PROGRESO'
    ws.cell(row=fila_resumen, column=2).font = Font(name='Calibri', size=11, bold=True, color='1F4E79')
    fila_resumen += 1
    completadas = sum(1 for t in TAREAS if t['estado'] == 'Completada')
    en_progreso = sum(1 for t in TAREAS if t['estado'] == 'En progreso')
    pendientes = sum(1 for t in TAREAS if t['estado'] == 'Pendiente')
    total = len(TAREAS)
    ws.cell(row=fila_resumen, column=2).value = f'Total: {total} tareas | Completadas: {completadas} | En progreso: {en_progreso} | Pendientes: {pendientes}'
    ws.cell(row=fila_resumen, column=2).font = fuente_tarea

    # ---- Congelar paneles (para que las columnas fijas se queden fijas al hacer scroll) ----
    ws.freeze_panes = ws.cell(row=fila_header + 1, column=col_semana_inicio)

    # ---- Filtro automatico ----
    ws.auto_filter.ref = f"A{fila_header}:{get_column_letter(col_semana_inicio + len(SEMANAS) - 1)}{fila_actual - 1}"

    # Guardar
    wb.save(ARCHIVO)
    print(f"Archivo generado: {ARCHIVO}")
    print(f"Tareas: {total} | Completadas: {completadas} | En progreso: {en_progreso} | Pendientes: {pendientes}")
    print(f"Semanas: {len(SEMANAS)} ({INICIO.strftime('%d/%m/%Y')} - {FIN.strftime('%d/%m/%Y')})")

if __name__ == '__main__':
    guardar_tareas_json()
    crear_gantt()
