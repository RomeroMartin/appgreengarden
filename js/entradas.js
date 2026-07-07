// ============================================================
// entradas.js — Cargador de Entradas v2.0
// Ingreso Proveedor + Ingreso Producción
// ============================================================

import { auth, db } from "./firebase-config.js";
import { protegerRuta, logout } from "./auth.js";
import {
  collection, doc, addDoc, updateDoc, getDocs,
  query, orderBy, limit, where, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

protegerRuta("Cargador Entradas");

let productos     = [];
let usuarioActual = null;

// Escapa datos antes de inyectarlos por innerHTML (evita XSS via motivo/nombres).
function escHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

document.addEventListener("usuarioListo", async (e) => {
  usuarioActual = e.detail;
  document.getElementById("pantalla-carga").style.display = "none";
  document.getElementById("contenido").style.display      = "flex";
  document.getElementById("saludo").textContent = `Hola, ${usuarioActual.nombre.split(" ")[0]} 👋`;
  await cargarProductos();
  cargarEntradasHoy();
});

document.getElementById("btn-logout").addEventListener("click", logout);

async function cargarProductos() {
  const snap = await getDocs(query(collection(db,"productos"), orderBy("nombre")));
  productos  = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  const sel  = document.getElementById("ent-producto");
  const busq = document.getElementById("ent-busqueda");

  const poblar = (lista) => {
    sel.innerHTML = lista.length ? lista.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join("") : '<option value="">Sin resultados</option>';
    actualizarInfo();
  };

  poblar(productos);
  sel.addEventListener("change", actualizarInfo);
  busq.addEventListener("input", () => {
    const t = busq.value.toLowerCase();
    poblar(t ? productos.filter(p=>p.nombre.toLowerCase().includes(t)) : productos);
  });

}

function actualizarInfo() {
  const prod = productos.find(p=>p.id===document.getElementById("ent-producto").value);
  const info = document.getElementById("producto-info");
  if (prod) {
    info.style.display = "";
    document.getElementById("stock-actual-display").textContent = `${prod.stock_deposito??0} ${prod.unidad_medida}`;
    document.getElementById("ent-unidad").textContent = `(${prod.unidad_medida})`;
  } else {
    info.style.display = "none";
    document.getElementById("ent-unidad").textContent = "";
  }
}

const inputCant = document.getElementById("ent-cantidad");
document.getElementById("ent-menos").addEventListener("click",()=>{ inputCant.value=Math.max(0.1,parseFloat((parseFloat(inputCant.value)||0)-1).toFixed(2)); });
document.getElementById("ent-mas").addEventListener("click",()=>{ inputCant.value=parseFloat((parseFloat(inputCant.value)||0)+1).toFixed(2); });

document.getElementById("btn-confirmar-entrada").addEventListener("click", async () => {
  const tipo     = document.getElementById("ent-tipo").value;
  const prodId   = document.getElementById("ent-producto").value;
  const cantidad = parseFloat(document.getElementById("ent-cantidad").value) || 0;
  const motivo   = tipo === "INGRESO_PROVEEDOR" ? "Proveedor" : "Producción";
  const obs      = document.getElementById("ent-obs").value.trim();
  const msgEl    = document.getElementById("msg-entrada");
  const btn      = document.getElementById("btn-confirmar-entrada");
  const prod     = productos.find(p=>p.id===prodId);
  if (!prod || cantidad <= 0) { mostrarMsg(msgEl,"error","Completá los campos."); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    await addDoc(collection(db,"movimientos"), {
      fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid,
      nombre_usuario: usuarioActual.nombre, id_producto: prodId,
      nombre_producto: prod.nombre, tipo, cantidad, unidad: prod.unidad_medida,
      motivo: obs ? `${motivo} — ${obs}` : motivo, origen: "externo", destino: "acopio"
    });
    await updateDoc(doc(db,"productos",prodId), { stock_deposito: increment(cantidad) });
    prod.stock_deposito = (prod.stock_deposito??0) + cantidad;
    actualizarInfo();
    mostrarFlash();
    document.getElementById("ent-cantidad").value = "1";
    document.getElementById("ent-obs").value = "";
    msgEl.classList.remove("show");
    cargarEntradasHoy();
  } catch(err) { mostrarMsg(msgEl,"error","Error: "+err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Registrar entrada"; }
});

async function cargarEntradasHoy() {
  const cont = document.getElementById("lista-entradas-hoy");
  const hoy  = new Date(); hoy.setHours(0,0,0,0);
  // Filtramos por fecha (solo hoy) en Firestore → evita descargar todo el historial.
  // Es un rango sobre un solo campo, no requiere índice compuesto. El filtro por
  // usuario y tipo se hace en el código.
  const snap = await getDocs(query(collection(db,"movimientos"),
    where("fecha_hora",">=",hoy)
  ));
  const hoyMovs = snap.docs.filter(d => {
    const m = d.data();
    const ts = m.fecha_hora?.toDate?.();
    return ts && ts >= hoy && m.id_usuario === auth.currentUser?.uid && (m.tipo === "INGRESO_PROVEEDOR" || m.tipo === "INGRESO_PRODUCCION");
  }).sort((a,b)=>(b.data().fecha_hora?.toDate?.()||0)-(a.data().fecha_hora?.toDate?.()||0));
  if (!hoyMovs.length) { cont.innerHTML='<div class="empty-state"><p>Sin entradas hoy.</p></div>'; return; }
  const labels = { INGRESO_PROVEEDOR:"↑ Proveedor", INGRESO_PRODUCCION:"↑ Producción" };
  cont.innerHTML = hoyMovs.map(d=>{
    const m=d.data(); const ts=m.fecha_hora?.toDate?.();
    const hora=ts?ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}):"";
    return `<div class="mov-mini"><div><div style="font-size:0.88rem;font-weight:600;">${escHtml(m.nombre_producto)}</div><div style="font-size:0.72rem;color:var(--texto-3);">${hora} · ${labels[m.tipo]||escHtml(m.tipo)} · ${escHtml(m.motivo||"—")}</div></div><span style="font-size:0.9rem;font-weight:700;color:var(--normal-txt);">+${escHtml(m.cantidad)} ${escHtml(m.unidad||"")}</span></div>`;
  }).join("");
}

function mostrarFlash() { const el=document.getElementById("flash-ok"); el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2500); }
function mostrarMsg(el,tipo,texto) { el.textContent=texto; el.className=`msg show msg-${tipo==="error"?"error":"ok"}`; }

// ── Sello de versión (autocontenido, no depende de version.js) ──
(function () {
  let v = document.querySelector(".app-version");
  if (!v) { v = document.createElement("div"); (document.body || document.documentElement).appendChild(v); }
  v.textContent = "v3.8.7";
  v.style.cssText = "position:fixed;bottom:8px;right:10px;font:600 11px/1 ui-monospace,monospace;color:#9a7f43;background:rgba(248,244,234,0.92);border:1px solid #ddd0b8;padding:3px 9px;border-radius:20px;z-index:99999;pointer-events:none;letter-spacing:0.5px;box-shadow:0 1px 4px rgba(0,0,0,0.08);";
})();
