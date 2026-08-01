// ============================================================
// mock-auth.mjs — Reemplaza a firebase-auth.js.
// El usuario "logueado" lo controla el test vía globalThis.__AUTH_USER.
// ============================================================
function currentUser() {
  return globalThis.__AUTH_USER || { uid: "uid-test", email: "test@greengarden.app" };
}

export function getAuth() {
  return { get currentUser() { return globalThis.__AUTH_USER ?? currentUser(); } };
}

export function onAuthStateChanged(_auth, cb) {
  // Dispara en microtask, como el SDK real
  Promise.resolve().then(() => cb(globalThis.__AUTH_USER === null ? null : currentUser()));
  return () => {};
}

export async function signInWithEmailAndPassword(_auth, email) {
  return { user: { uid: "uid-test", email } };
}
export async function createUserWithEmailAndPassword(_auth, email) {
  return { user: { uid: "uid-" + email, email } };
}
// No toca __AUTH_USER: en la app real, signOut de la app SECUNDARIA (creación de
// usuarios) no desloguea al usuario principal. Mantenerlo no-op evita efectos
// cruzados entre tests.
export async function signOut() {}
export async function setPersistence() {}
export const browserLocalPersistence = {};
