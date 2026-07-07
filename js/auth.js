// ============================================================
// auth.js — Autenticación, roles y guardián de rutas v2.0
// Green Garden Inventario
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
  const datos = await obtenerDatosUsuario(cred.user.uid);
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
export function redirigirSiYaLogeado() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const datos = await obtenerDatosUsuario(user.uid);
    if (!datos || !datos.activo) return;
    const ruta = RUTA_POR_ROL[datos.rol];
    if (ruta) window.location.href = ruta;
  });
}
