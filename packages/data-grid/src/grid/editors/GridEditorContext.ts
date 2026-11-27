import { createContext } from 'react';
import type { GridOptions } from '../../model/gridModel.js';
import { DEFAULT_GRID_LABELS, type GridLabels } from '../labels.js';

/**
 * What the overlay editors need from the grid. Glide renders them through a portal
 * but inside this React tree, so a context reaches them while the editor components
 * themselves stay stable (a new component identity would remount the open editor).
 */
export const GridEditorContext = createContext<{ options: GridOptions; labels: GridLabels }>({ options: {}, labels: DEFAULT_GRID_LABELS });
