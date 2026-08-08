// ============================================================
// auth.js — Autenticación, roles y guardián de rutas v2.0
// Green Garden Inventario
// ============================================================

import { auth, db, EMAIL_DUENO } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ¿El email es el del dueño? (comparación robusta, sin mayúsculas/espacios)
function esEmailDueno(email) {
  return !!email && email.trim().toLowerCase() === EMAIL_DUENO.trim().toLowerCase();
}

// ── Roles válidos y sus rutas ────────────────────────────────
const RUTA_POR_ROL = {
  "Gerente":            "../vistas/gerente.html",
  "Administrador":      "../vistas/administrador.html",
  "Encargado":          "../vistas/encargado.html",
  "Cargador Entradas":  "../vistas/entradas.html",
  "Cargador Salidas":   "../vistas/salidas.html"
};

// ── Obtener datos del usuario desde Firestore ────────────────
export async function obtenerDatosUsuario(uid) {
  const ref  = doc(db, "usuarios", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

// ── Login ────────────────────────────────────────────────────
export async function login(email, password) {
  const cred  = await signInWithEmailAndPassword(auth, email, password);
  let   datos = await obtenerDatosUsuario(cred.user.uid);
  // Bootstrap del dueño: la primera vez que entra (o si perdió su perfil),
  // se crea a sí mismo como Gerente activo, sin tocar la consola de Firebase.
  // Las reglas de Firestore solo permiten esto para el email del dueño.
  if (!datos && esEmailDueno(cred.user.email)) {
    await setDoc(doc(db, "usuarios", cred.user.uid), {
      nombre: "Gerente", email: cred.user.email, rol: "Gerente", activo: true
    });
    datos = { uid: cred.user.uid, nombre: "Gerente", email: cred.user.email, rol: "Gerente", activo: true };
  }
  if (!datos)        throw new Error("Usuario no encontrado en el sistema.");
  if (!datos.activo) throw new Error("Tu cuenta está desactivada. Consultá al administrador.");
  const ruta = RUTA_POR_ROL[datos.rol];
  if (!ruta) throw new Error("Rol no reconocido. Consultá al administrador.");
  window.location.href = ruta;
}

// ── Logout ───────────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
  const profundidad = window.location.pathname.includes("/vistas/") ? "../" : "./";
  window.location.href = profundidad + "index.html";
}

// ── Guardián de ruta ─────────────────────────────────────────
// Acepta un rol o array de roles permitidos
export function protegerRuta(rolesPermitidos) {
  const roles = Array.isArray(rolesPermitidos) ? rolesPermitidos : [rolesPermitidos];
  document.body.style.visibility = "hidden";

  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "../index.html"; return; }
    const datos = await obtenerDatosUsuario(user.uid);
    if (!datos || !datos.activo || !roles.includes(datos.rol)) {
      window.location.href = "../index.html"; return;
    }
    document.body.style.visibility = "visible";
    document.dispatchEvent(new CustomEvent("usuarioListo", { detail: datos }));
  });
}

// ── Redirigir si ya está logueado ────────────────────────────
// onNoUser (opcional): se llama cuando Firebase confirma que NO hay sesión
// activa, para revelar el login recién ahí (sin demoras artificiales) y sin
// que parpadee el formulario cuando el usuario ya está logueado.
export function redirigirSiYaLogeado(onNoUser) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { if (onNoUser) onNoUser(); return; }
    const datos = await obtenerDatosUsuario(user.uid);
    if (!datos || !datos.activo) { if (onNoUser) onNoUser(); return; }
    const ruta = RUTA_POR_ROL[datos.rol];
    if (ruta) { window.location.href = ruta; return; }
    if (onNoUser) onNoUser();  // rol no reconocido → que vea el login igual
  });
}
