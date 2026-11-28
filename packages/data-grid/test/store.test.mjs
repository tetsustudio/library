// Contract of createGridStore: every effect goes through the injected adapters
// (transport, realtime, notify), never through an app's api client or env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGridStore, GridConflictError } from '../dist/store/index.js';

const columns = [
  { field: 'name', title: 'Nombre *', width: 200, kind: 'text', required: true },
  { field: 'qty', title: 'Cantidad', width: 100, kind: 'number' },
];

const apiRows = () => [
  { id: 2, version: 1, name: 'Granja', qty: 5 },
  { id: 1, version: 3, name: 'Molino', qty: 1 },
];

const rowFromApi = (r) => ({ key: String(r.id), id: r.id, version: r.version, values: { name: r.name, qty: r.qty } });

function fakeNotify() {
  const calls = { success: [], error: [], warning: [] };
  return {
    calls,
    success: (m) => calls.success.push(m),
    error: (m) => calls.error.push(m),
    warning: (m) => calls.warning.push(m),
  };
}

function fakeRealtime() {
  const rt = { emit: null, unsubscribed: 0, cursors: [], scopes: [] };
  rt.adapter = {
    subscribe: (scopeId, emit) => {
      rt.scopes.push(scopeId);
      rt.emit = emit;
      return () => { rt.unsubscribed++; };
    },
    sendCursor: (cursor) => rt.cursors.push(cursor),
  };
  return rt;
}

function setup(transportOverrides = {}, extra = {}) {
  const notify = fakeNotify();
  const transport = {
    fetchAll: async () => ({ rows: apiRows(), options: { tags: [] }, notice: 'capped' }),
    patch: async ({ id, field, value, version }) => ({ ...apiRows().find((r) => r.id === id), [field]: value, version: version + 1 }),
    batch: async () => ({ results: [] }),
    ...transportOverrides,
  };
  const store = createGridStore({
    columns,
    emptyOptions: {},
    rowFromApi,
    sortRows: (a, b) => a.id - b.id,
    transport,
    notify,
    ...extra,
  });
  return { store, notify, transport };
}

test('load: fetchAll fills rows (sorted), options and notice', async () => {
  const { store } = setup();
  await store.getState().load(7);
  const s = store.getState();
  assert.equal(s.scopeId, 7);
  assert.equal(s.loading, false);
  assert.deepEqual(s.rows.map((r) => r.id), [1, 2]);
  assert.deepEqual(s.rows[0].values, { name: 'Molino', qty: 1 });
  assert.deepEqual(s.options, { tags: [] });
  assert.equal(s.notice, 'capped');
});

test('load: a failing fetchAll sets error and stops loading', async () => {
  const { store } = setup({ fetchAll: async () => { throw new Error('boom'); } });
  await store.getState().load(1);
  assert.equal(store.getState().error, 'boom');
  assert.equal(store.getState().loading, false);
});

test('editCell: optimistic update, then the server row replaces it', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const sent = [];
  const { store } = setup({
    patch: async (req) => { sent.push(req); await gate; return { id: 1, version: 4, name: 'Molino SA', qty: 1 }; },
  });
  await store.getState().load(1);
  const saving = store.getState().editCell('1', 'name', 'Molino SA', { version: 3, base: 'Molino' });
  // Optimistic: visible and pending before the server answers.
  assert.equal(store.getState().rows[0].values.name, 'Molino SA');
  assert.equal(store.getState().savingCount, 1);
  assert.deepEqual(store.getState().pending, { 1: { name: 'Molino SA' } });
  release();
  await saving;
  assert.deepEqual(sent, [{ id: 1, field: 'name', value: 'Molino SA', version: 3, base: 'Molino' }]);
  const s = store.getState();
  assert.equal(s.rows[0].version, 4);
  assert.equal(s.savingCount, 0);
  assert.deepEqual(s.pending, {});
});

test('editCell: a failed patch rolls back, marks the cell and calls notify.error', async () => {
  const { store, notify } = setup({ patch: async () => { throw new Error('No tenés permiso'); } });
  await store.getState().load(1);
  await store.getState().editCell('1', 'name', 'Otro', { version: 3, base: 'Molino' });
  const s = store.getState();
  assert.equal(s.rows[0].values.name, 'Molino');
  assert.deepEqual(s.cellErrors, { 1: { name: 'No tenés permiso' } });
  assert.deepEqual(notify.calls.error, ['No tenés permiso']);
  assert.equal(s.savingCount, 0);
});

test('editCell: errorMessage maps transport errors to the text shown', async () => {
  const { store, notify } = setup(
    { patch: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); } },
    { errorMessage: (e) => (e.status === 403 ? 'Sin permiso' : String(e)) },
  );
  await store.getState().load(1);
  await store.getState().editCell('1', 'qty', 9, { version: 3, base: 1 });
  assert.deepEqual(notify.calls.error, ['Sin permiso']);
});

test('editCell: a version conflict takes the current row and warns', async () => {
  const { store, notify } = setup({
    patch: async () => { throw new GridConflictError({ id: 1, version: 5, name: 'Molino Nuevo', qty: 1 }); },
  });
  await store.getState().load(1);
  await store.getState().editCell('1', 'name', 'Mío', { version: 3, base: 'Molino' });
  const s = store.getState();
  assert.equal(s.rows[0].values.name, 'Molino Nuevo');
  assert.equal(s.rows[0].version, 5);
  assert.equal(s.cellErrors[1].name, 'Conflicto: otro usuario cambió este valor');
  assert.equal(notify.calls.warning.length, 1);
  assert.match(notify.calls.warning[0], /^Nombre: otro usuario lo cambió a "Molino Nuevo"/);
});

test('undo: re-sends the previous value of the last saved cell', async () => {
  const sent = [];
  const { store } = setup({
    patch: async (req) => { sent.push(req); return { id: 1, version: req.version + 1, name: req.value, qty: 1 }; },
  });
  await store.getState().load(1);
  await store.getState().editCell('1', 'name', 'B', { version: 3, base: 'Molino' });
  await store.getState().undo();
  assert.deepEqual(sent.map((r) => r.value), ['B', 'Molino']);
  assert.equal(store.getState().rows[0].values.name, 'Molino');
});

test('draft row: created through transport.batch once required fields are set', async () => {
  const batches = [];
  const { store } = setup({
    batch: async (scopeId, rows) => {
      batches.push({ scopeId, rows });
      return { results: [{ index: 0, status: 'created', row: { id: 9, version: 1, name: 'Nuevo', qty: null } }] };
    },
  });
  await store.getState().load(4);
  const key = store.getState().addDraftRow();
  await store.getState().editCell(key, 'qty', 3, { base: null });
  assert.equal(batches.length, 0, 'not sent while a required field is empty');
  await store.getState().editCell(key, 'name', 'Nuevo', { base: null });
  assert.deepEqual(batches, [{ scopeId: 4, rows: [{ values: { qty: 3, name: 'Nuevo' } }] }]);
  assert.deepEqual(store.getState().rows.map((r) => r.key), ['1', '2', '9']);
});

test('paste: one batch, results applied and a summary through notify', async () => {
  const { store, notify } = setup({
    batch: async (_scope, rows) => ({
      results: rows.map((r, index) => r.id
        ? { index, status: 'updated', row: { id: r.id, version: 10, name: r.values.name, qty: 1 } }
        : { index, status: 'created', row: { id: 50 + index, version: 1, name: r.values.name, qty: null } }),
    }),
  });
  await store.getState().load(1);
  await store.getState().paste({ col: 0, row: 1 }, [['Granja 2'], ['Tercero']]);
  const s = store.getState();
  assert.deepEqual(s.rows.map((r) => r.values.name), ['Molino', 'Granja 2', 'Tercero']);
  assert.deepEqual(notify.calls.success, ['Pegado: 1 creados, 1 actualizados']);
});

test('deleteRows: drafts vanish locally, saved rows go through transport.delete', async () => {
  const deleted = [];
  const { store, notify } = setup({ delete: async (ids) => { deleted.push(ids); } });
  await store.getState().load(1);
  const draft = store.getState().addDraftRow();
  await store.getState().deleteRows([draft, '2']);
  assert.deepEqual(deleted, [[2]]);
  assert.deepEqual(store.getState().rows.map((r) => r.key), ['1']);
  assert.deepEqual(notify.calls.success, ['Fila eliminada']);
});

test('deleteRows: without transport.delete only drafts are removed', async () => {
  const { store } = setup();
  await store.getState().load(1);
  await store.getState().deleteRows(['1']);
  assert.equal(store.getState().rows.length, 2);
});

test('realtime: rows, removals, presence and status events apply to the store', async () => {
  const rt = fakeRealtime();
  const { store } = setup({}, { realtime: rt.adapter });
  assert.equal(store.getState().connection, 'closed');
  await store.getState().load(3);
  store.getState().connect(3);
  assert.deepEqual(rt.scopes, [3]);

  rt.emit({ type: 'status', status: 'open' });
  assert.equal(store.getState().connection, 'open');

  rt.emit({ type: 'rows', rows: [{ id: 1, version: 9, name: 'Remoto', qty: 1 }, { id: 3, version: 1, name: 'Llegó', qty: 0 }] });
  assert.deepEqual(store.getState().rows.map((r) => r.values.name), ['Remoto', 'Granja', 'Llegó']);

  // An older version never overwrites a newer local row.
  rt.emit({ type: 'rows', rows: [{ id: 1, version: 2, name: 'Viejo', qty: 1 }] });
  assert.equal(store.getState().rows[0].values.name, 'Remoto');

  rt.emit({ type: 'removed', ids: [2] });
  assert.deepEqual(store.getState().rows.map((r) => r.id), [1, 3]);

  const members = [{ connId: 'c1', userId: 1, name: 'Ana', color: '#f00', cursor: null }];
  rt.emit({ type: 'presence', members, connId: 'c0' });
  assert.deepEqual(store.getState().members, members);
  assert.equal(store.getState().connId, 'c0');

  store.getState().disconnect();
  assert.equal(rt.unsubscribed, 1);
  assert.equal(store.getState().connection, 'closed');
});

test('realtime: a reconnect reloads to catch up', async () => {
  const rt = fakeRealtime();
  let loads = 0;
  const { store } = setup({ fetchAll: async () => { loads++; return { rows: apiRows(), options: {} }; } }, { realtime: rt.adapter });
  await store.getState().load(1);
  store.getState().connect(1);
  rt.emit({ type: 'status', status: 'open' });
  rt.emit({ type: 'status', status: 'closed' });
  rt.emit({ type: 'status', status: 'open' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(loads, 2);
});

test('realtime: an error event goes to notify.error', async () => {
  const rt = fakeRealtime();
  const { store, notify } = setup({}, { realtime: rt.adapter });
  store.getState().connect(1);
  rt.emit({ type: 'error', message: 'sin acceso' });
  assert.deepEqual(notify.calls.error, ['sin acceso']);
});

test('without realtime the connection is "none" and connect is a no-op', () => {
  const { store } = setup();
  store.getState().connect(1);
  assert.equal(store.getState().connection, 'none');
});

test('reset: unsubscribes and clears state', async () => {
  const rt = fakeRealtime();
  const { store } = setup({}, { realtime: rt.adapter });
  await store.getState().load(1);
  store.getState().connect(1);
  store.getState().reset();
  assert.equal(rt.unsubscribed, 1);
  assert.deepEqual(store.getState().rows, []);
  assert.equal(store.getState().scopeId, null);
});
