/** User-facing text of the sheet view. Defaults are Spanish (es-AR), as in the source app. */
export interface GridLabels {
    newRow: string;
    saving: string;
    saved: string;
    reconnecting: string;
    readOnly: string;
    deleteHint: string;
    /** "Fila 3 · Nombre: Campo obligatorio" in the error list. */
    errorRow: (row: number, column: string, message: string) => string;
    deleteTitle: string;
    deleteMessage: (count: number) => string;
    deleteConfirm: string;
    cancel: string;
    presence: string;
    editing: (name: string) => string;
    datePlaceholder: string;
    dateLabel: string;
    search: string;
    searchPlaceholder: string;
    options: string;
    noResults: string;
    selectHint: string;
    multiHint: string;
}

export const DEFAULT_GRID_LABELS: GridLabels = {
    newRow: 'Nueva fila',
    saving: 'Guardando…',
    saved: 'Todos los cambios guardados',
    reconnecting: 'Reconectando…',
    readOnly: 'Solo lectura: no tenés permiso para editar',
    deleteHint: 'Ctrl+Supr: eliminar filas',
    errorRow: (row, column, message) => `Fila ${row} · ${column}: ${message}`,
    deleteTitle: 'Eliminar filas',
    deleteMessage: (count) => `¿Eliminar ${count} ${count === 1 ? 'fila' : 'filas'}?`,
    deleteConfirm: 'Eliminar',
    cancel: 'Cancelar',
    presence: 'Usuarios con la tabla abierta',
    editing: (name) => `${name} (editando)`,
    datePlaceholder: 'dd/mm/aaaa',
    dateLabel: 'Fecha',
    search: 'Buscar',
    searchPlaceholder: 'Escribí para buscar…',
    options: 'Opciones',
    noResults: 'Sin resultados',
    selectHint: 'Enter: elegir · Tab: elegir y seguir · Esc: cancelar',
    multiHint: 'Enter: marcar · Tab: aceptar · Ctrl+Enter: aceptar y bajar · Esc: cancelar',
};
