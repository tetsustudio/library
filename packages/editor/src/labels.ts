import type { SpellcheckLanguage } from './spellcheck/settings.js';

/** Every user-facing string of the editor. Pass a partial set in `labels`; the rest falls back to English. */
export interface EditorLabels {
  // Toolbar
  bold: string;
  italic: string;
  inlineCode: string;
  heading1: string;
  heading2: string;
  bulletList: string;
  numberedList: string;
  checklist: string;
  quote: string;
  link: string;
  linkPrompt: string;
  undo: string;
  redo: string;
  insertImage: string;
  uploadingImage: string;
  imageUploadFailed: string;
  moreOptions: string;
  fewerOptions: string;
  outline: string;
  // Search
  searchPlaceholder: string;
  searchNoResults: string;
  searchCount: (current: number, total: number) => string;
  searchPrevious: string;
  searchNext: string;
  searchClose: string;
  // Spellcheck popup and settings
  close: string;
  noSuggestions: string;
  ignoreWord: (word: string) => string;
  spellcheckTitle: string;
  spellcheckEnabled: string;
  autoAccent: string;
  autoAccentDescription: string;
  language: string;
  languageNames: Record<SpellcheckLanguage, string>;
  ignoredWords: string;
  noIgnoredWords: string;
  unignoreWord: (word: string) => string;
  // Blocks and headings
  addBlock: string;
  dragBlock: string;
  expandSection: string;
  collapseSection: string;
  // Code blocks
  copy: string;
  searchLanguage: string;
  noLanguageResults: string;
  preview: string;
  previewLoading: string;
  // Image viewer
  image: string;
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  // Plain text mode
  plainText: string;
}

export const defaultLabels: EditorLabels = {
  bold: 'Bold',
  italic: 'Italic',
  inlineCode: 'Inline code',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  bulletList: 'Bullet list',
  numberedList: 'Numbered list',
  checklist: 'Checklist',
  quote: 'Quote',
  link: 'Link',
  linkPrompt: 'Link URL',
  undo: 'Undo',
  redo: 'Redo',
  insertImage: 'Insert image',
  uploadingImage: 'Uploading image…',
  imageUploadFailed: 'Could not upload the image. Try again.',
  moreOptions: 'More options',
  fewerOptions: 'Fewer options',
  outline: 'Outline',
  searchPlaceholder: 'Search in document',
  searchNoResults: 'No results',
  searchCount: (current, total) => `${current} of ${total}`,
  searchPrevious: 'Previous match',
  searchNext: 'Next match',
  searchClose: 'Close search',
  close: 'Close',
  noSuggestions: 'No suggestions',
  ignoreWord: (word) => `Ignore "${word}"`,
  spellcheckTitle: 'Spelling',
  spellcheckEnabled: 'Spellchecker',
  autoAccent: 'Auto-accent',
  autoAccentDescription: 'Fixes the accent when you finish a word, when that is the only possible correction.',
  language: 'Language',
  languageNames: { es: 'Español (España)', 'es-ar': 'Español (Latinoamérica)', en: 'English' },
  ignoredWords: 'Ignored words',
  noIgnoredWords: 'No ignored words.',
  unignoreWord: (word) => `Stop ignoring "${word}"`,
  addBlock: 'Add block',
  dragBlock: 'Drag to reorder',
  expandSection: 'Expand section',
  collapseSection: 'Collapse section',
  copy: 'Copy',
  searchLanguage: 'Search language',
  noLanguageResults: 'No results',
  preview: 'Preview',
  previewLoading: 'Loading…',
  image: 'Image',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Original size',
  plainText: 'Markdown source',
};

/** The Spanish (es-AR) labels the editor was born with. */
export const esLabels: EditorLabels = {
  bold: 'Negrita',
  italic: 'Cursiva',
  inlineCode: 'Código',
  heading1: 'Título 1',
  heading2: 'Título 2',
  bulletList: 'Lista',
  numberedList: 'Lista numerada',
  checklist: 'Lista de tareas',
  quote: 'Cita',
  link: 'Enlace',
  linkPrompt: 'URL del enlace',
  undo: 'Deshacer',
  redo: 'Rehacer',
  insertImage: 'Insertar imagen',
  uploadingImage: 'Subiendo imagen…',
  imageUploadFailed: 'No se pudo subir la imagen. Probá de nuevo.',
  moreOptions: 'Más opciones',
  fewerOptions: 'Menos opciones',
  outline: 'Índice',
  searchPlaceholder: 'Buscar en la nota',
  searchNoResults: 'Sin resultados',
  searchCount: (current, total) => `${current} de ${total}`,
  searchPrevious: 'Coincidencia anterior',
  searchNext: 'Coincidencia siguiente',
  searchClose: 'Cerrar la búsqueda',
  close: 'Cerrar',
  noSuggestions: 'Sin sugerencias',
  ignoreWord: (word) => `Ignorar "${word}"`,
  spellcheckTitle: 'Ortografía',
  spellcheckEnabled: 'Corrector ortográfico',
  autoAccent: 'Auto-tilde',
  autoAccentDescription: 'Corrige la tilde al terminar de escribir la palabra, cuando es la única corrección posible.',
  language: 'Idioma',
  languageNames: { es: 'Español (España)', 'es-ar': 'Español (Latinoamérica)', en: 'English' },
  ignoredWords: 'Palabras ignoradas',
  noIgnoredWords: 'No hay palabras ignoradas.',
  unignoreWord: (word) => `Dejar de ignorar "${word}"`,
  addBlock: 'Agregar bloque',
  dragBlock: 'Arrastrar para reordenar',
  expandSection: 'Expandir sección',
  collapseSection: 'Colapsar sección',
  copy: 'Copiar',
  searchLanguage: 'Buscar lenguaje',
  noLanguageResults: 'Sin resultados',
  preview: 'Vista previa',
  previewLoading: 'Cargando...',
  image: 'Imagen',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  resetZoom: 'Tamaño original',
  plainText: 'Texto plano de la nota',
};

export function resolveLabels(labels?: Partial<EditorLabels>): EditorLabels {
  return labels ? { ...defaultLabels, ...labels } : defaultLabels;
}
