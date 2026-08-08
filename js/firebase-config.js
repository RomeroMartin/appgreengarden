// ============================================================
// firebase-config.js — Conexión con Firebase
// Green Garden Inventario
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey:            "AIzaSyDFtkYUGNXiVqItsE-r9lNHnwsJrhRu-i0",
  authDomain:        "control-stoks---green-garden.firebaseapp.com",
  projectId:         "control-stoks---green-garden",
  storageBucket:     "control-stoks---green-garden.firebasestorage.app",
  messagingSenderId: "360760033886",
  appId:             "1:360760033886:web:b58bc78c3886151d80aacf"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);

// ── Dueño / super-admin ──────────────────────────────────────
// Único email que puede auto-crearse como Gerente la primera vez
// (bootstrap sin consola de Firebase) y recuperarse si perdiera el
// perfil. Debe coincidir con el email anclado en firestore.rules.
export const EMAIL_DUENO = "martingreengaren@gmail.com";
