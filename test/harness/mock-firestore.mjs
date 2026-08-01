// ============================================================
// mock-firestore.mjs — Reemplaza al SDK firebase-firestore.js.
// El loader mapea la URL de gstatic a este archivo.
// ============================================================
import * as S from "./store.mjs";

export function getFirestore() { return { __db: true }; }

export function collection(_dbOrRef, ...path) {
  // collection(db, "productos")  |  collection(db, "a", id, "b")
  const name = path.length ? path.join("/") : (_dbOrRef && _dbOrRef.name) || "";
  return { __col: true, name, constraints: [] };
}

export function doc(a, b, c) {
  if (a && a.__col) return { __doc: true, name: a.name, id: b ?? S.nextId() };      // doc(colRef, id?)
  // doc(db, name, id?)
  return { __doc: true, name: b, id: c ?? S.nextId() };
}

export function query(src, ...constraints) {
  return { __col: true, name: src.name, constraints: [...(src.constraints || []), ...constraints] };
}
export const orderBy = (field, dir = "asc") => ({ type: "orderBy", field, dir });
export const where   = (field, op, val)   => ({ type: "where", field, op, val });
export const limit   = (n)                => ({ type: "limit", n });

export async function getDoc(ref)  { return S.getDocRaw(ref.name, ref.id); }
export async function getDocs(src) { return S.snapshotOf(src.name, src.constraints || []); }

export async function addDoc(colRef, data) {
  const id = S.applyAdd(colRef.name, data);
  return { __doc: true, id, name: colRef.name };
}
export async function updateDoc(ref, data) { S.applyUpdate(ref.name, ref.id, data); }
export async function setDoc(ref, data)    { S.applySet(ref.name, ref.id, data); }
export async function deleteDoc(ref)       { S.applyDelete(ref.name, ref.id); }

export function onSnapshot(src, cb) {
  return S.addListener({ name: src.name, constraints: src.constraints || [], cb });
}

export const serverTimestamp = () => new S._ServerTs();
export const increment       = (n) => new S.Increment(n);
export const deleteField     = () => S.DELETE;

export function writeBatch() {
  const ops = [];
  return {
    set(ref, data)    { ops.push(["set", ref, data]); return this; },
    update(ref, data) { ops.push(["update", ref, data]); return this; },
    delete(ref)       { ops.push(["delete", ref]); return this; },
    async commit() {
      for (const [k, ref, data] of ops) {
        if (k === "set") S.applySet(ref.name, ref.id, data);
        else if (k === "update") S.applyUpdate(ref.name, ref.id, data);
        else if (k === "delete") S.applyDelete(ref.name, ref.id);
      }
      ops.length = 0;
    }
  };
}

// Timestamp helper por si alguna vista lo usa
export const Timestamp = S.Ts;
