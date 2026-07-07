// ============================================================
// conteo-fisico.js — Conteo físico integrado (módulo compartido)
// Ajusta acopio y despacho de varios productos a un valor exacto.
// Usado por Gerente y Administrador desde dentro de la app.
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, doc, getDocs, updateDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esDespacho = p => p.tipo === "Despacho";
const sectoresDe = p => p.sectores_asignados || [];

let _productos     = [];
let _usuarioActual = null;
let _onAplicado    = null;

// Inicializa el módulo (una vez)
export function initConteo({ usuarioActual, onAplicado }) {
  _usuarioActual = usuarioActual;
  _onAplicado    = onAplicado || (()=>{});

  const btnCargar = document.getElementById("conteo-btn-cargar");
  if (btnCargar && !btnCargar.dataset.ready) {
    btnCargar.dataset.ready = "1";
    btnCargar.addEventListener("click", cargar);
    document.getElementById("conteo-filtro-rubro").addEventListener("change", render);
    document.getElementById("conteo-filtro-busqueda").addEventListener("input", render);
    document.getElementById("conteo-btn-aplicar").addEventListener("click", aplicar);
  }
}

// Refresca productos antes de abrir
export function setProductosConteo(productos) { _productos = productos; }

export function abrirConteo() {
  // Auto-cargar al abrir
  cargar();
}

async function cargar() {
  const snap = await getDocs(collection(db, "productos"));
  _productos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (a.nombre||"").localeCompare(b.nombre||""));
  const rubros = [...new Set(_productos.map(p => p.rubro).filter(Boolean))].sort();
  const selR = document.getElementById("conteo-filtro-rubro");
  selR.innerHTML = '<option value="">Todos los rubros</option>' + rubros.map(r=>`<option value="${r}">${r}</option>`).join("");
  render();
}

function render() {
  const rubro = document.getElementById("conteo-filtro-rubro").value;
  const busq  = document.getElementById("conteo-filtro-busqueda").value.toLowerCase();
  let lista = _productos;
  if (rubro) lista = lista.filter(p => p.rubro === rubro);
  if (busq)  lista = lista.filter(p => (p.nombre||"").toLowerCase().includes(busq));

  const tbody = document.getElementById("conteo-tbody");
  if (!lista.length) { tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--texto-3);">Sin resultados.</td></tr>'; return; }

  tbody.innerHTML = lista.map(p => {
    const dep = p.stock_deposito ?? 0;
    const unidad = p.unidad_medida || "";
    let despachoHtml = '<span style="color:var(--texto-3);">—</span>';
    if (esDespacho(p)) {
      const sects = sectoresDe(p);
      despachoHtml = '<div style="display:flex;flex-direction:column;gap:4px;">' + sects.map(s => {
        const actual = p.stock_despacho?.[s] ?? 0;
        return `<div style="display:flex;align-items:center;gap:5px;font-size:0.78rem;"><label style="color:var(--texto-3);min-width:64px;">${s}:</label> <span style="color:var(--texto-3);">${actual}</span> → <input type="number" step="0.1" class="conteo-cont-desp" data-prod="${p.id}" data-sector="${s}" placeholder="${actual}" style="width:62px;text-align:center;padding:5px;border:1px solid var(--borde);border-radius:6px;" /></div>`;
      }).join("") + '</div>';
    }
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid var(--borde);"><div style="font-weight:600;font-size:0.86rem;">${p.nombre}</div>${p.plu?`<div style="font-size:0.66rem;color:var(--texto-3);">PLU ${p.plu}</div>`:""}</td>
      <td style="padding:8px;border-bottom:1px solid var(--borde);text-align:center;color:var(--texto-3);font-size:0.82rem;">${dep} ${unidad}</td>
      <td style="padding:8px;border-bottom:1px solid var(--borde);text-align:center;"><input type="number" step="0.1" class="conteo-cont-acopio" data-prod="${p.id}" placeholder="${dep}" style="width:64px;text-align:center;padding:6px;border:1px solid var(--borde);border-radius:6px;" /></td>
      <td style="padding:8px;border-bottom:1px solid var(--borde);">${despachoHtml}</td>
    </tr>`;
  }).join("");
}

async function aplicar() {
  const cambios = {}; // prodId -> { acopio?, despacho:{sector:val} }
  document.querySelectorAll(".conteo-cont-acopio").forEach(inp => {
    if (inp.value !== "") {
      const id = inp.dataset.prod;
      cambios[id] = cambios[id] || { despacho: {} };
      cambios[id].acopio = parseFloat(inp.value);
    }
  });
  document.querySelectorAll(".conteo-cont-desp").forEach(inp => {
    if (inp.value !== "") {
      const id = inp.dataset.prod;
      cambios[id] = cambios[id] || { despacho: {} };
      cambios[id].despacho[inp.dataset.sector] = parseFloat(inp.value);
    }
  });

  const ids = Object.keys(cambios);
  const msgEl = document.getElementById("conteo-msg");
  if (!ids.length) { mostrar(msgEl,"error","No ingresaste ningún conteo."); return; }

  const btn = document.getElementById("conteo-btn-aplicar");
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

  try {
    let cuenta = 0;
    for (const id of ids) {
      const prod = _productos.find(p => p.id === id);
      const c = cambios[id];
      const update = {};
      if (c.acopio !== undefined) {
        const anterior = prod.stock_deposito ?? 0;
        update.stock_deposito = c.acopio;
        if (c.acopio !== anterior) {
          await addDoc(collection(db, "movimientos"), {
            fecha_hora: serverTimestamp(), id_usuario: _usuarioActual.uid || null,
            nombre_usuario: _usuarioActual.nombre, id_producto: id, nombre_producto: prod.nombre,
            tipo: "AJUSTE", cantidad: Math.abs(c.acopio - anterior), unidad: prod.unidad_medida,
            motivo: `Conteo físico (${anterior} → ${c.acopio})`, origen: "acopio", destino: "acopio"
          });
        }
      }
      if (Object.keys(c.despacho).length) {
        const nuevoDesp = { ...(prod.stock_despacho || {}) };
        for (const s in c.despacho) {
          const anterior = nuevoDesp[s] ?? 0;
          nuevoDesp[s] = c.despacho[s];
          if (c.despacho[s] !== anterior) {
            await addDoc(collection(db, "movimientos"), {
              fecha_hora: serverTimestamp(), id_usuario: _usuarioActual.uid || null,
              nombre_usuario: _usuarioActual.nombre, id_producto: id, nombre_producto: prod.nombre,
              tipo: "AJUSTE", cantidad: Math.abs(c.despacho[s] - anterior), unidad: prod.unidad_medida,
              motivo: `Conteo físico ${s} (${anterior} → ${c.despacho[s]})`, origen: s, destino: s
            });
          }
        }
        update.stock_despacho = nuevoDesp;
      }
      await updateDoc(doc(db, "productos", id), update);
      cuenta++;
    }
    mostrar(msgEl,"ok",`✓ Conteo aplicado a ${cuenta} producto(s).`);
    _onAplicado();
    // Re-cargar para reflejar los nuevos valores
    setTimeout(cargar, 800);
  } catch (err) {
    mostrar(msgEl,"error","Error: " + err.message);
  } finally {
    btn.disabled = false; btn.innerHTML = "Aplicar conteo al inventario";
  }
}

function mostrar(el, tipo, texto) {
  if (!el) return;
  el.textContent = texto;
  el.className = `msg show msg-${tipo === "error" ? "error" : "ok"}`;
}
