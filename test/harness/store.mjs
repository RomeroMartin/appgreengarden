// ============================================================
// store.mjs — Firestore FALSO en memoria, con semántica real de
// increment(), field-paths con punto, serverTimestamp() y listeners
// de tiempo real (onSnapshot se re-dispara tras cada escritura).
// Singleton compartido por los mocks y los tests (mismo file URL).
// ============================================================

export class Ts {
  constructor(ms) { this.ms = ms; }
  toDate() { return new Date(this.ms); }
  get seconds() { return Math.floor(this.ms / 1000); }
}
export class Increment { constructor(n) { this.n = n; } }
export const DELETE = Symbol("deleteField");

let idSeq = 0;
const state = { cols: new Map() };      // name -> Map(id -> data)
const listeners = [];                    // { name, constraints, cb }

export function nextId() { return "auto_" + (++idSeq).toString().padStart(6, "0"); }
export function colMap(name) {
  if (!state.cols.has(name)) state.cols.set(name, new Map());
  return state.cols.get(name);
}

export function reset() {
  state.cols = new Map();
  listeners.length = 0;
  idSeq = 0;
}

export function clone(v) {
  if (v == null) return v;
  if (v instanceof Ts || v instanceof Date || v instanceof Increment) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (typeof v === "object") { const o = {}; for (const k in v) o[k] = clone(v[k]); return o; }
  return v;
}

export function seed(name, docs) {
  const m = colMap(name);
  const arr = Array.isArray(docs) ? docs : Object.entries(docs).map(([id, d]) => ({ id, ...d }));
  for (const d of arr) { const { id, ...rest } = d; m.set(id, clone(rest)); }
  fire(name);
}

// ── field-paths con punto ─────────────────────────────────────
function setPath(obj, path, val) {
  const p = path.split(".");
  let o = obj;
  for (let i = 0; i < p.length - 1; i++) { if (typeof o[p[i]] !== "object" || o[p[i]] == null) o[p[i]] = {}; o = o[p[i]]; }
  o[p[p.length - 1]] = val;
}
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function delPath(obj, path) {
  const p = path.split(".");
  let o = obj;
  for (let i = 0; i < p.length - 1; i++) { if (o == null) return; o = o[p[i]]; }
  if (o) delete o[p[p.length - 1]];
}

// ── mutaciones (comparten la misma semántica que Firestore) ───
export function applyUpdate(name, id, data) {
  const m = colMap(name);
  if (!m.has(id)) throw new Error(`updateDoc: ${name}/${id} no existe`);
  const cur = m.get(id);
  for (const [campo, val] of Object.entries(data)) {
    if (val instanceof Increment) setPath(cur, campo, (getPath(cur, campo) ?? 0) + val.n);
    else if (val === DELETE) delPath(cur, campo);
    else if (val instanceof _ServerTs) setPath(cur, campo, new Ts(Date.now()));
    else setPath(cur, campo, clone(val));
  }
  fire(name);
}
export function applySet(name, id, data) {
  colMap(name).set(id, resolveTs(clone(data)));
  fire(name);
}
export function applyAdd(name, data) {
  const id = nextId();
  colMap(name).set(id, resolveTs(clone(data)));
  fire(name);
  return id;
}
export function applyDelete(name, id) {
  colMap(name).delete(id);
  fire(name);
}

// serverTimestamp() → sentinel que se resuelve a Ts al escribir
export class _ServerTs {}
function resolveTs(obj) {
  if (obj instanceof _ServerTs) return new Ts(Date.now());
  if (obj == null || typeof obj !== "object" || obj instanceof Ts || obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(resolveTs);
  for (const k in obj) obj[k] = resolveTs(obj[k]);
  return obj;
}

// ── consultas (query/where/orderBy/limit) ─────────────────────
export function runQuery(name, constraints = []) {
  let rows = [...colMap(name).entries()].map(([id, d]) => ({ id, d }));
  for (const c of constraints) {
    if (c.type === "where") rows = rows.filter(r => cmp(getPath(r.d, c.field), c.op, c.val));
  }
  const ob = constraints.find(c => c.type === "orderBy");
  if (ob) {
    rows.sort((a, b) => {
      const x = getPath(a.d, ob.field), y = getPath(b.d, ob.field);
      const xv = x instanceof Ts ? x.ms : x, yv = y instanceof Ts ? y.ms : y;
      if (xv == null && yv == null) return 0;
      if (xv == null) return 1; if (yv == null) return -1;
      return (xv < yv ? -1 : xv > yv ? 1 : 0) * (ob.dir === "desc" ? -1 : 1);
    });
  }
  const lim = constraints.find(c => c.type === "limit");
  if (lim) rows = rows.slice(0, lim.n);
  return rows;
}
function cmp(a, op, b) {
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case ">": return a > b; case ">=": return a >= b;
    case "<": return a < b; case "<=": return a <= b;
    case "in": return Array.isArray(b) && b.includes(a);
    default: return false;
  }
}

// ── listeners de tiempo real ──────────────────────────────────
export function addListener(l) {
  listeners.push(l);
  l.cb(snapshotOf(l.name, l.constraints)); // primer disparo inmediato
  return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
}
function fire(name) {
  for (const l of listeners.slice()) if (l.name === name) l.cb(snapshotOf(l.name, l.constraints));
}
export function snapshotOf(name, constraints) {
  const rows = runQuery(name, constraints);
  const docs = rows.map(r => docSnap(name, r.id, r.d));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (f) => docs.forEach(f) };
}
export function docSnap(name, id, d) {
  const exists = d !== undefined;
  return { id, exists: () => exists, data: () => (exists ? clone(d) : undefined) };
}
export function getDocRaw(name, id) {
  const m = colMap(name);
  return docSnap(name, id, m.has(id) ? m.get(id) : undefined);
}

// helpers para tests
export function dump(name) { return [...colMap(name).entries()].map(([id, d]) => ({ id, ...clone(d) })); }
export function get(name, id) { const m = colMap(name); return m.has(id) ? clone(m.get(id)) : undefined; }
export function count(name) { return colMap(name).size; }
