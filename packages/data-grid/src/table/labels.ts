/** User-facing text of the table view. Defaults are Spanish (es-AR), as in the source app. */
export interface TableLabels {
    search: string;
    clear: string;
    create: string;
    showFilters: string;
    columns: string;
    density: string;
    refreshing: string;
    emptyTitle: string;
    empty: string;
    selectAll: string;
    selectRow: string;
    edit: string;
    delete: string;
    restore: string;
    selected: (count: number) => string;
    selectable: (count: number) => string;
    hiddenColumns: (count: number) => string;
    pagination: string;
    previous: string;
    next: string;
    page: (current: number, total: number) => string;
    range: (from: number, to: number, total: number) => string;
}

export const DEFAULT_TABLE_LABELS: TableLabels = {
    search: 'Buscar…',
    clear: 'Limpiar',
    create: 'Nuevo',
    showFilters: 'Mostrar filtros',
    columns: 'Mostrar/ocultar columnas',
    density: 'Cambiar densidad',
    refreshing: 'Actualizando datos…',
    emptyTitle: 'Nada para mostrar',
    empty: 'No se encontraron datos',
    selectAll: 'Seleccionar todo',
    selectRow: 'Seleccionar fila',
    edit: 'Editar',
    delete: 'Eliminar',
    restore: 'Activar',
    selected: (n) => `${n} seleccionadas`,
    selectable: (n) => `${n} seleccionables`,
    hiddenColumns: (n) => `${n} columnas ocultas`,
    pagination: 'Paginación',
    previous: 'Anterior',
    next: 'Siguiente',
    page: (c, t) => `Página ${c} de ${t}`,
    range: (from, to, total) => `${from}–${to} de ${total}`,
};
