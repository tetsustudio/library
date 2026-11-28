// Pure grid model, ported from chefdesk: keyboard dates (dd/mm/aaaa), foreign keys
// by name, comma decimals and the block pasted from Excel/Sheets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellText, isBlockClipboard, isoToDisplay, missingRequired, parseCellInput, parseClipboardBlock,
  parseDateInput, planPaste, plainTitle, shiftIsoDate,
} from '../dist/model/gridModel.js';

const options = { providers: [{ id: 1, name: 'Molino' }, { id: 2, name: 'Granja' }, { id: 3, name: 'Granja' }] };
const col = (over) => ({ field: 'f', title: 'F', width: 100, kind: 'text', ...over });
const TODAY = new Date(2026, 10, 1);

test('dates: separators, two-digit years and digits only', () => {
  for (const input of ['1/2/2026', '01-02-26', '01.02', '01022026', '010226', '0102']) {
    assert.equal(parseDateInput(input, TODAY), '2026-02-01', input);
  }
});

test('dates: impossible dates are null', () => {
  assert.equal(parseDateInput('31/02/2026', TODAY), null);
  assert.equal(parseDateInput('32/01/2026', TODAY), null);
  assert.equal(parseDateInput('hola', TODAY), null);
});

test('dates: display dd/mm/yyyy and shift by days', () => {
  assert.equal(isoToDisplay('2026-02-01'), '01/02/2026');
  assert.equal(isoToDisplay('2026-02-01T00:00:00.000Z'), '01/02/2026');
  assert.equal(shiftIsoDate('2026-02-28', 1), '2026-03-01');
  assert.equal(shiftIsoDate('2026-01-01', -1), '2025-12-31');
});

test('parseCellInput: date values and per-cell errors', () => {
  assert.deepEqual(parseCellInput(col({ kind: 'date' }), '15/03/2026', options), { value: '2026-03-15' });
  assert.deepEqual(parseCellInput(col({ kind: 'date' }), '', options), { value: null });
  assert.deepEqual(parseCellInput(col({ kind: 'date', required: true }), '', options), { error: 'La fecha es obligatoria' });
  assert.deepEqual(parseCellInput(col({ kind: 'date' }), '99/99/2026', options), { error: 'Fecha inválida (usá dd/mm/aaaa)' });
  assert.equal(cellText(col({ kind: 'date' }), '2026-03-15', options), '15/03/2026');
});

test('select: shows the name, parses the name back to the id', () => {
  const c = col({ kind: 'select', optionsKey: 'providers' });
  assert.equal(cellText(c, 1, options), 'Molino');
  assert.deepEqual(parseCellInput(c, ' molino ', options), { value: 1 });
  assert.deepEqual(parseCellInput(c, '', options), { value: null });
  assert.deepEqual(parseCellInput(c, 'Pepe', options), { error: 'No existe: Pepe' });
  assert.deepEqual(parseCellInput(c, 'Granja', options), { error: 'Hay más de una opción llamada "Granja": elegila con el selector' });
});

test('multi: names to sorted unique ids', () => {
  const c = col({ kind: 'multi', optionsKey: 'providers' });
  assert.deepEqual(parseCellInput(c, 'molino, Molino', options), { value: [1] });
  assert.equal(cellText(c, [1, 9], options), 'Molino, #9');
});

test('numbers: decimals accept comma and thousands dots; integers otherwise', () => {
  const amount = col({ kind: 'number', decimals: true });
  assert.deepEqual(parseCellInput(amount, '1.234,56', options), { value: 1234.56 });
  assert.deepEqual(parseCellInput(amount, '10.5', options), { value: 10.5 });
  assert.deepEqual(parseCellInput(amount, 'abc', options), { error: 'Tiene que ser un número' });
  assert.deepEqual(parseCellInput(col({ kind: 'number' }), '3.5', options), { error: 'Tiene que ser un número entero' });
});

test('clipboard: rows and cells, Excel trailing break dropped', () => {
  assert.deepEqual(parseClipboardBlock('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseClipboardBlock('solo\r\n'), [['solo']]);
  assert.equal(isBlockClipboard('hola'), false);
  assert.equal(isBlockClipboard('hola\r\n'), false);
  assert.equal(isBlockClipboard('a\tb'), true);
  assert.equal(isBlockClipboard('a\nb'), true);
});

test('planPaste: updates existing rows, creates past the end, skips read-only columns', () => {
  const columns = [col({ field: 'name' }), col({ field: 'ctx', readOnly: true }), col({ field: 'qty', kind: 'number' })];
  const rows = [{ key: '1', id: 1, version: 2, values: { name: 'A', qty: 1 } }];
  const plan = planPaste({ col: 0, row: 0 }, [['B', 'x', '2'], ['C', 'y', 'nope']], rows, {}, columns);
  assert.deepEqual(plan.rows, [{ key: '1', batch: { id: 1, version: 2, values: { name: 'B', qty: 2 }, base: { name: 'A', qty: 1 } } }]);
  assert.deepEqual(plan.localErrors, { 'new:1': { qty: 'Tiene que ser un número entero' } });
  assert.deepEqual(plan.newRowValues, { 'new:1': { name: 'C' } });
});

test('missingRequired and plainTitle', () => {
  const columns = [col({ field: 'a', required: true }), col({ field: 'b' })];
  assert.deepEqual(missingRequired(columns, { b: 1 }), ['a']);
  assert.equal(plainTitle({ title: 'Nombre *' }), 'Nombre');
});
