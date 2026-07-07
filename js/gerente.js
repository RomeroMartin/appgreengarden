// ============================================================
// gerente.js — Panel Gerente v3.0
// Modelo: tipo de producto (Despacho / Materia prima)
// Retiro inteligente según tipo y sectores asignados
// ============================================================

import { auth, db, firebaseConfig } from "./firebase-config.js";
import { protegerRuta, logout } from "./auth.js";
import { initImportador, abrirImportador, actualizarProductosImportador } from "./importador-ventas.js";
import { renderResumen, badgeProducto, calcularResumen, debeAvanzar } from "./corte-ventas.js";
import { initConteo, abrirConteo, setProductosConteo } from "./conteo-fisico.js";
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, onSnapshot, query, orderBy, limit, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSec } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

protegerRuta("Gerente");

const appSec  = initializeApp(firebaseConfig, "secondary-gerente");
const authSec = getAuth(appSec);

let productos         = [];
let rubros            = [];
let sectores          = [];
let sectoresDespacho  = [];
let movimientosCached = [];
let movIndex          = {};   // id -> movimiento (para corregir motivo)
let usuarioActual     = null;
let confirmCallback   = null;

// ── Helpers de stock v3 ───────────────────────────────────────
function stockTotal(p) {
  const dep = p.stock_deposito ?? 0;
  const des = p.stock_despacho ?? {};
  return dep + Object.values(des).reduce((a, b) => a + (b || 0), 0);
}

// Redondeo SOLO para mostrar: máx 2 decimales, sin ceros sobrantes.
// El valor real guardado no se toca. (6 → 6, 1.4571 → 1.46, 1.5 → 1.5)
function fmtN(n) {
  const x = Number(n) || 0;
  return +x.toFixed(2);
}

function getBadge(p) {
  const total = stockTotal(p);
  const min   = p.stock_minimo;
  if (min == null || min === "") return null;
  if (total <= 0)    return { cls: "critico", label: "Sin stock" };
  if (total <= min)  return { cls: "critico", label: "Bajo mínimo" };
  return null;
}

function esDespacho(p) { return p.tipo === "Despacho"; }
function esReceta(p)   { return p.tipo === "Receta"; }
function sectoresDe(p) { return p.sectores_asignados ?? []; }

// Estado del editor de recetas
function freshRecetaState() {
  return { porVariantes: false, simple: { sector: "", ingredientes: [] }, variantes: [] };
}
let recetaState = freshRecetaState();

const MOTIVOS_SALIDA_DEFAULT = [
  { nombre: "Retiro para uso", transfiere: false },
  { nombre: "Merma / Desperdicio", transfiere: false },
  { nombre: "Vencimiento", transfiere: false },
  { nombre: "Rotura", transfiere: false },
  { nombre: "Reposición", transfiere: true }
];
let motivosSalida = [...MOTIVOS_SALIDA_DEFAULT];

function poblarMotivosSalida() {
  const prod = productos.find(p => p.id === document.getElementById("sal-producto")?.value);
  const sel = document.getElementById("sal-motivo");
  if (!sel) return;
  const actual = sel.value;
  const lista = (prod && !esDespacho(prod)) ? motivosSalida.filter(m => !m.transfiere) : motivosSalida;
  sel.innerHTML = lista.map(m => `<option value="${m.nombre}">${m.nombre}</option>`).join("");
  if (lista.some(m => m.nombre === actual)) sel.value = actual;
}


document.addEventListener("usuarioListo", (e) => {
  usuarioActual = e.detail;
  document.getElementById("pantalla-carga").style.display = "none";
  document.getElementById("contenido").style.display      = "flex";
  iniciar();
});

document.getElementById("btn-logout").addEventListener("click", logout);

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

function abrirModal(id)  { document.getElementById(id).classList.add("open"); }
function cerrarModal(id) { document.getElementById(id).classList.remove("open"); }
document.querySelectorAll("[data-cerrar]").forEach(b => b.addEventListener("click", () => cerrarModal(b.dataset.cerrar)));
document.querySelectorAll(".modal-overlay").forEach(o => o.addEventListener("click", e => { if (e.target === o) cerrarModal(o.id); }));

function iniciar() {
  escucharRubros();
  escucharSectores();
  escucharSectoresDespacho();
  escucharMotivosSalida();
  escucharProductos();
  escucharUsuarios();
  cargarHistorial();
  cargarMovRecientes();
}

// ── RUBROS ────────────────────────────────────────────────────
function escucharRubros() {
  onSnapshot(collection(db, "rubros"), snap => {
    rubros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRubros(); poblarSelectRubros();
  });
}

function renderRubros() {
  const cont = document.getElementById("lista-rubros");
  if (!rubros.length) { cont.innerHTML = '<p class="empty-state">Sin rubros.</p>'; return; }
  cont.innerHTML = rubros.map(r => `
    <div class="config-item"><span>${escHtml(r.nombre)}</span>
      <button class="btn-icono danger" onclick="eliminarItem('rubros','${r.id}','${escJs(r.nombre)}')">🗑</button>
    </div>`).join("");
}

function poblarSelectRubros() {
  const filtro = document.getElementById("filtro-rubro");
  const actual = filtro?.value;
  if (filtro) filtro.innerHTML = '<option value="">Todos los rubros</option>' + rubros.map(r => `<option value="${r.nombre}" ${r.nombre===actual?"selected":""}>${r.nombre}</option>`).join("");
  document.getElementById("prod-rubro").innerHTML = rubros.map(r => `<option value="${r.nombre}">${r.nombre}</option>`).join("");
}

document.getElementById("btn-agregar-rubro").addEventListener("click", async () => {
  const inp = document.getElementById("input-nuevo-rubro");
  const nom = inp.value.trim(); if (!nom) return;
  await addDoc(collection(db, "rubros"), { nombre: nom }); inp.value = "";
});

// ── SECTORES ACOPIO ───────────────────────────────────────────
function escucharSectores() {
  onSnapshot(collection(db, "sectores"), snap => {
    sectores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSectores(); poblarSelectSectores();
  });
}

function renderSectores() {
  const cont = document.getElementById("lista-sectores");
  if (!sectores.length) { cont.innerHTML = '<p class="empty-state">Sin sectores.</p>'; return; }
  cont.innerHTML = sectores.map(s => `
    <div class="config-item"><span>${escHtml(s.nombre)}</span>
      <button class="btn-icono danger" onclick="eliminarItem('sectores','${s.id}','${escJs(s.nombre)}')">🗑</button>
    </div>`).join("");
}

function poblarSelectSectores() {
  const filtro = document.getElementById("filtro-sector");
  const actual = filtro?.value;
  if (filtro) filtro.innerHTML = '<option value="">Todos los sectores acopio</option>' + sectores.map(s => `<option value="${s.nombre}" ${s.nombre===actual?"selected":""}>${s.nombre}</option>`).join("");
  document.getElementById("prod-sector").innerHTML = sectores.map(s => `<option value="${s.nombre}">${s.nombre}</option>`).join("");
}

document.getElementById("btn-agregar-sector").addEventListener("click", async () => {
  const inp = document.getElementById("input-nuevo-sector");
  const nom = inp.value.trim(); if (!nom) return;
  await addDoc(collection(db, "sectores"), { nombre: nom }); inp.value = "";
});

// ── SECTORES DESPACHO ─────────────────────────────────────────
function escucharSectoresDespacho() {
  onSnapshot(collection(db, "sectores_despacho"), snap => {
    sectoresDespacho = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSectoresDespacho(); renderChecksDespacho();
  });
}

function renderSectoresDespacho() {
  const cont = document.getElementById("lista-despacho");
  if (!sectoresDespacho.length) { cont.innerHTML = '<p class="empty-state">Sin sectores de despacho.</p>'; return; }
  cont.innerHTML = sectoresDespacho.map(s => `
    <div class="config-item"><span>${escHtml(s.nombre)}</span>
      <button class="btn-icono danger" onclick="eliminarItem('sectores_despacho','${s.id}','${escJs(s.nombre)}')">🗑</button>
    </div>`).join("");
}

// Checkboxes de sectores despacho en el modal de producto
function renderChecksDespacho(seleccionados = []) {
  const cont = document.getElementById("prod-despacho-checks");
  if (!cont) return;
  cont.innerHTML = sectoresDespacho.map(s => `
    <label style="display:flex;align-items:center;gap:8px;padding:7px 0;cursor:pointer;font-size:0.88rem;">
      <input type="checkbox" class="check-despacho" value="${escHtml(s.nombre)}" ${seleccionados.includes(s.nombre)?"checked":""} style="width:17px;height:17px;accent-color:var(--verde);" />
      ${escHtml(s.nombre)}
    </label>`).join("");
}

document.getElementById("btn-agregar-despacho").addEventListener("click", async () => {
  const inp = document.getElementById("input-nuevo-despacho");
  const nom = inp.value.trim(); if (!nom) return;
  await addDoc(collection(db, "sectores_despacho"), { nombre: nom }); inp.value = "";
});

window.eliminarItem = (col, id, nombre) => {
  mostrarConfirm(`¿Eliminás "${nombre}"?`, async () => { await deleteDoc(doc(db, col, id)); });
};

// ── MOTIVOS DE SALIDA (configurables) ─────────────────────────
let motivosSeedeados = false;
function escucharMotivosSalida() {
  onSnapshot(collection(db, "motivos_salida"), async (snap) => {
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!lista.length) {
      if (!motivosSeedeados) {
        motivosSeedeados = true;
        for (const m of MOTIVOS_SALIDA_DEFAULT) {
          await addDoc(collection(db, "motivos_salida"), { nombre: m.nombre, transfiere: m.transfiere });
        }
      }
      return;
    }
    motivosSalida = lista;
    renderMotivosSalida();
  });
}

function renderMotivosSalida() {
  const cont = document.getElementById("lista-motivos");
  if (!cont) return;
  cont.innerHTML = motivosSalida.map(m => `
    <div class="config-item">
      <span>${escHtml(m.nombre)} ${m.transfiere ? '<span style="font-size:0.65rem;background:var(--verde-claro);color:var(--verde);padding:2px 8px;border-radius:10px;font-weight:600;">→ despacho</span>' : ""}</span>
      ${m.id ? `<button class="btn-icono danger" onclick="eliminarItem('motivos_salida','${m.id}','${escJs(m.nombre)}')">🗑</button>` : ""}
    </div>`).join("");
}

document.getElementById("btn-agregar-motivo").addEventListener("click", async () => {
  const inp = document.getElementById("input-nuevo-motivo");
  const nom = inp.value.trim(); if (!nom) return;
  const transfiere = document.getElementById("check-motivo-transfiere").checked;
  await addDoc(collection(db, "motivos_salida"), { nombre: nom, transfiere });
  inp.value = "";
  document.getElementById("check-motivo-transfiere").checked = false;
});

// ── PRODUCTOS ─────────────────────────────────────────────────
function escucharProductos() {
  onSnapshot(query(collection(db, "productos"), orderBy("nombre")), snap => {
    productos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStock(); renderProductos(); renderAlertas();
    actualizarProductosImportador(productos);
  });
  initImportador({ productos, usuarioActual, onTerminado: () => { cargarMovRecientes(); renderResumen("indicador-corte", productos); renderStock(); } });
  initConteo({ usuarioActual, onAplicado: () => { cargarMovRecientes(); } });
}

document.getElementById("filtro-sector").addEventListener("change", renderStock);
document.getElementById("filtro-rubro").addEventListener("change", renderStock);
document.getElementById("filtro-busqueda").addEventListener("input", renderStock);

let alertasAbierto = false;
function renderAlertas() {
  const alertas = productos.filter(p => { const min = p.stock_minimo; return min != null && min !== "" && stockTotal(p) <= min; });
  const sec = document.getElementById("seccion-alertas");
  const lst = document.getElementById("lista-alertas");
  if (!alertas.length) { sec.style.display = "none"; return; }
  sec.style.display = "block";
  document.getElementById("alertas-count").textContent = `(${alertas.length})`;
  lst.innerHTML = alertas.map(p => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(217,83,79,0.15);">
      <span style="font-size:0.88rem;font-weight:600;">${escHtml(p.nombre)}</span>
      <span style="font-weight:700;color:var(--critico-txt);">${fmtN(stockTotal(p))} / ${p.stock_minimo} ${escHtml(p.unidad_medida||"")}</span>
    </div>`).join("");
  lst.style.display = alertasAbierto ? "block" : "none";
  document.getElementById("alertas-chevron").style.transform = alertasAbierto ? "rotate(180deg)" : "";
  const header = document.getElementById("alertas-header");
  if (header && !header.dataset.wired) {
    header.dataset.wired = "1";
    header.addEventListener("click", () => {
      alertasAbierto = !alertasAbierto;
      lst.style.display = alertasAbierto ? "block" : "none";
      document.getElementById("alertas-chevron").style.transform = alertasAbierto ? "rotate(180deg)" : "";
    });
  }
}

function renderStock() {
  const _resumen = calcularResumen(productos);
  const _masReciente = _resumen.masReciente;
  const sector = document.getElementById("filtro-sector").value;
  const rubro  = document.getElementById("filtro-rubro").value;
  const busq   = document.getElementById("filtro-busqueda").value.toLowerCase();
  const cont   = document.getElementById("lista-stock");
  let lista    = productos;
  if (sector) lista = lista.filter(p => p.sector === sector);
  if (rubro)  lista = lista.filter(p => p.rubro === rubro);
  if (busq)   lista = lista.filter(p => p.nombre.toLowerCase().includes(busq));
  if (!lista.length) { cont.innerHTML = '<div class="empty-state"><p>Sin resultados.</p></div>'; return; }
  cont.innerHTML = lista.map(p => {
    const dep   = p.stock_deposito ?? 0;
    const des   = p.stock_despacho ?? {};
    const total = stockTotal(p);
    const badge = getBadge(p);
    const tipoBadge = esDespacho(p)
      ? '<span style="font-size:0.65rem;background:var(--verde-claro);color:var(--verde);padding:2px 8px;border-radius:10px;font-weight:600;">🥤 Despacho</span>'
      : '<span style="font-size:0.65rem;background:var(--bg-secondary);color:var(--texto-3);padding:2px 8px;border-radius:10px;font-weight:600;">🌾 Mat. prima</span>';
    const desglose = Object.entries(des).filter(([,v]) => v !== 0)
      .map(([k,v]) => { const neg = v < 0; return `<span style="font-size:0.75rem;background:var(--bg-secondary);padding:2px 8px;border-radius:4px;margin-right:4px;${neg?'color:var(--critico-txt);':''}">${escHtml(k)}: <strong>${fmtN(v)}</strong></span>`; }).join("");
    return `<div class="item-row" style="flex-direction:column;align-items:flex-start;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
        <div>
          <div class="item-nombre">${escHtml(p.nombre)} ${tipoBadge}</div>
          <div class="item-meta">Acopio: ${escHtml(p.sector||"—")} · ${escHtml(p.rubro||"—")}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:0.9rem;font-weight:600;color:var(--texto-2);">Total: ${fmtN(total)} ${p.unidad_medida||""}</div>
          ${badge ? `<span class="stock-badge ${badge.cls}">${badge.label}</span>` : ""}
        </div>
      </div>
      <div style="font-size:0.78rem;color:var(--texto-3);">🏪 Acopio: <strong style="color:var(--texto-2);">${fmtN(dep)}</strong> ${desglose?`· ${desglose}`:""}</div>
      ${badgeProducto(p, _masReciente) ? `<div style="margin-top:2px;">${badgeProducto(p, _masReciente)}</div>` : ""}
    </div>`;
  }).join("");
  // Refrescar el resumen cada vez que se renderiza el stock
  renderResumen("indicador-corte", productos);
}

function renderProductos() {
  const cont = document.getElementById("lista-productos");
  if (!productos.length) { cont.innerHTML = '<div class="empty-state"><p>Sin productos.</p></div>'; return; }
  cont.innerHTML = productos.map(p => {
    const tipoIcon = esReceta(p) ? "🍸" : esDespacho(p) ? "🥤" : "🌾";
    let detalle;
    if (esReceta(p)) {
      if (p.por_variantes) {
        const tams = (p.variantes || []).map(v => v.tamano).filter(Boolean).join(" / ");
        detalle = ` 🍸 ${(p.variantes||[]).length} variantes: ${tams || "—"}`;
      } else {
        const ings = (p.ingredientes || []).map(i => `${i.cantidad} ${i.unidad} ${i.nombre}`).join(" + ");
        detalle = ` 🍸 ${p.sector_receta||"sin sector"} · ${ings||"sin ingredientes"}`;
      }
    } else {
      const despachoInfo = esDespacho(p) ? ` → ${sectoresDe(p).join(", ")||"sin despacho"}` : "";
      detalle = `${p.sector||"—"}${despachoInfo} · ${p.unidad_medida||"—"}`;
    }
    const pluBadge = p.plu ? `<span style="font-size:0.65rem;background:var(--bg-secondary);color:var(--texto-3);padding:1px 7px;border-radius:6px;font-weight:600;margin-left:4px;">PLU ${escHtml(p.plu)}</span>` : "";
    return `<div class="item-row">
      <div style="flex:1;min-width:0;">
        <div class="item-nombre">${tipoIcon} ${escHtml(p.nombre)}${pluBadge}</div>
        <div class="item-meta">${escHtml(detalle)}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn-icono" onclick="abrirEditarProducto('${p.id}')">✏️</button>
        <button class="btn-icono danger" onclick="eliminarItem('productos','${p.id}','${escJs(p.nombre)}')">🗑</button>
      </div>
    </div>`;
  }).join("");
}

// Modal producto: mostrar/ocultar bloques según tipo
function aplicarVistaTipo(tipo) {
  document.getElementById("grupo-despacho").style.display = tipo === "Despacho" ? "" : "none";
  document.getElementById("grupo-receta").style.display   = tipo === "Receta"   ? "" : "none";
  // Las recetas no tienen stock propio: ocultamos los campos de stock y unidad
  const esRec = tipo === "Receta";
  document.getElementById("prod-stock").closest(".form-group").style.display     = esRec ? "none" : "";
  document.getElementById("prod-stock-min").closest(".form-group").style.display = esRec ? "none" : "";
  document.getElementById("prod-unidad").closest(".form-group").style.display    = esRec ? "none" : "";
  document.getElementById("prod-sector").closest(".form-group").style.display    = esRec ? "none" : "";
  document.getElementById("grupo-rendimiento").style.display                     = esRec ? "none" : "";
  if (esRec) {
    document.getElementById("prod-receta-varia").checked = recetaState.porVariantes;
    renderRecetaEditor();
  }
}

document.getElementById("prod-tipo").addEventListener("change", function() {
  aplicarVistaTipo(this.value);
});

// ── Editor de recetas (simple o por variantes) ────────────────
const primerSector = () => (sectoresDespacho[0]?.nombre || "");

document.getElementById("prod-receta-varia").addEventListener("change", function() {
  recetaState.porVariantes = this.checked;
  if (this.checked && !recetaState.variantes.length) {
    recetaState.variantes = [{ tamano: "", sector: primerSector(), ingredientes: [] }];
  }
  if (!this.checked && !recetaState.simple.sector) {
    recetaState.simple.sector = primerSector();
  }
  renderRecetaEditor();
});

function optsSectores(sel) {
  if (!sectoresDespacho.length) return '<option value="">⚠️ Sin sectores de despacho</option>';
  return sectoresDespacho.map(s => `<option value="${s.nombre}" ${s.nombre===sel?"selected":""}>${s.nombre}</option>`).join("");
}
function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
// Escapa un texto para meterlo dentro de un onclick="fn('...')" (string JS en atributo HTML).
function escJs(s) {
  return String(s ?? "").replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function optsIngredientes(filtro = "") {
  const t = filtro.trim().toLowerCase();
  let items = productos.filter(p => p.tipo !== "Receta");
  if (t) items = items.filter(p => (p.nombre || "").toLowerCase().includes(t));
  if (!productos.some(p => p.tipo !== "Receta")) return '<option value="">Sin productos cargados</option>';
  if (!items.length) return '<option value="">Sin coincidencias</option>';
  return '<option value="">Elegí un producto…</option>' +
    items.map(m => {
      const et = m.tipo === "Materia prima" ? "🌾" : "🥤";
      return `<option value="${m.id}">${et} ${escHtml(m.nombre)} (${escHtml(m.unidad_medida||"—")})</option>`;
    }).join("");
}

// Renderiza un "bloque de ingredientes" (sector + lista + fila para agregar)
// Opciones de unidad para un ingrediente: si el producto tiene rendimiento,
// ofrece la subunidad (ml) como opción por defecto + la unidad base.
function optsUnidadIngrediente(prod) {
  if (!prod) return '<option value="">—</option>';
  const base = `<option value="${escHtml(prod.unidad_medida||'u')}">${escHtml(prod.unidad_medida||'u')}</option>`;
  if (prod.rendimiento > 0 && prod.subunidad) {
    return `<option value="${escHtml(prod.subunidad)}" selected>${escHtml(prod.subunidad)}</option>` + base;
  }
  return base;
}

// Actualiza el cartel "= X unidad base" según producto, cantidad y unidad elegida
function actualizarHintIngrediente(bloque) {
  if (!bloque) return;
  const hint = bloque.querySelector(".bloque-ing-hint");
  if (!hint) return;
  const prod = productos.find(p => p.id === bloque.querySelector(".bloque-ing-mat")?.value);
  const cant = parseFloat(bloque.querySelector(".bloque-ing-cant")?.value);
  const uni  = bloque.querySelector(".bloque-ing-unidad")?.value;
  if (!prod || isNaN(cant) || cant <= 0) { hint.textContent = ""; return; }
  const esSub = prod.rendimiento > 0 && prod.subunidad && uni === prod.subunidad;
  hint.textContent = esSub
    ? `= ${+(cant / prod.rendimiento).toFixed(4)} ${prod.unidad_medida || ""} (lo que se descuenta del stock)`
    : "";
}

function bloqueIngredientesHTML(target, sector, ingredientes, conSector = true) {
  const hayProductos = productos.some(p => p.tipo !== "Receta");
  const ings = ingredientes.length
    ? ingredientes.map((ing, i) => {
        const disp = (ing.cant_in != null && ing.unidad_in) ? `${ing.cant_in} ${escHtml(ing.unidad_in)}` : `${ing.cantidad} ${escHtml(ing.unidad)}`;
        const conv = (ing.unidad_in && ing.unidad_in !== ing.unidad)
          ? ` <span style="color:var(--texto-3);font-size:0.72rem;">(= ${+(+ing.cantidad).toFixed(4)} ${escHtml(ing.unidad)})</span>` : "";
        return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;${i>0?'border-top:1px solid var(--borde);':''}">
          <span style="font-size:0.83rem;">${disp.replace(/^(\S+)/, '<strong>$1</strong>')} de ${escHtml(ing.nombre)}${conv}</span>
          <button type="button" class="btn-icono danger" data-action="del-ing" data-target="${target}" data-idx="${i}" style="padding:2px 7px;">🗑</button>
        </div>`;
      }).join("")
    : '<p style="font-size:0.76rem;color:var(--texto-3);margin:0;">Sin ingredientes.</p>';
  const selSector = conSector
    ? `<div style="margin-bottom:8px;">
         <label style="font-size:0.74rem;color:var(--texto-3);display:block;margin-bottom:3px;">Sector donde se arma (de ahí se descuentan los ingredientes)</label>
         <select class="form-control bloque-sector" data-target="${target}" style="font-size:0.85rem;">${optsSectores(sector)}</select>
       </div>` : "";
  const filaAgregar = hayProductos
    ? `<div style="margin-top:4px;">
         <label style="font-size:0.74rem;color:var(--texto-3);display:block;margin-bottom:3px;">Agregar ingrediente</label>
         <input type="search" class="form-control bloque-ing-buscar" placeholder="🔍 Buscar producto…" style="font-size:0.85rem;width:100%;margin-bottom:6px;" />
         <select class="form-control bloque-ing-mat" style="font-size:0.9rem;width:100%;margin-bottom:8px;">${optsIngredientes()}</select>
         <div style="display:flex;gap:8px;margin-bottom:6px;">
           <input class="form-control bloque-ing-cant" type="number" inputmode="decimal" placeholder="Cantidad" min="0" step="any" style="font-size:1rem;flex:1;min-width:0;text-align:right;font-weight:600;" />
           <select class="form-control bloque-ing-unidad" style="font-size:0.9rem;width:110px;flex-shrink:0;"><option value="">—</option></select>
         </div>
         <div class="bloque-ing-hint" style="font-size:0.74rem;color:var(--verde,#2d6a4f);font-weight:600;margin-bottom:8px;min-height:1em;"></div>
         <button type="button" class="btn btn-secondary" data-action="add-ing" data-target="${target}" style="width:100%;padding:11px;">＋ Agregar ingrediente</button>
       </div>`
    : `<div style="font-size:0.78rem;color:var(--bajo-txt,#b45309);background:var(--bg-secondary);border:1px dashed var(--borde);border-radius:8px;padding:10px 12px;">⚠️ No hay productos cargados todavía. Creá primero los productos que componen la receta (ej. Gin, Tónica, Barril).</div>`;
  return `${selSector}
    <div class="bloque-ings" style="background:var(--bg-primary);border:1px solid var(--borde);border-radius:8px;padding:8px 10px;margin-bottom:6px;">${ings}</div>
    ${filaAgregar}`;
}

function renderRecetaEditor() {
  const cont = document.getElementById("receta-editor");
  if (!recetaState.porVariantes) {
    if (!recetaState.simple.sector) recetaState.simple.sector = primerSector();
    cont.innerHTML = `<div class="receta-bloque" style="margin-top:6px;">${bloqueIngredientesHTML("simple", recetaState.simple.sector, recetaState.simple.ingredientes)}</div>`;
    return;
  }
  // Por variantes
  const bloques = recetaState.variantes.map((v, idx) => `
    <div class="receta-bloque" style="border:1px solid var(--borde);border-radius:10px;padding:10px 12px;margin-top:8px;background:var(--bg-secondary);">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
        <input class="form-control variante-tamano" data-idx="${idx}" placeholder="Tamaño (ej. NACIONAL)" value="${(v.tamano||'').replace(/"/g,'&quot;')}" style="font-size:0.85rem;flex:1;" />
        <button type="button" class="btn-icono danger" data-action="del-var" data-idx="${idx}" style="padding:4px 9px;">🗑</button>
      </div>
      ${bloqueIngredientesHTML(String(idx), v.sector, v.ingredientes)}
    </div>`).join("");
  cont.innerHTML = `${bloques}
    <button type="button" class="btn btn-secondary" data-action="add-var" style="margin-top:10px;width:100%;">＋ Agregar variante</button>
    <div style="font-size:0.72rem;color:var(--texto-3);margin-top:5px;">El "tamaño" debe coincidir con la columna Tamanio del Excel (no importan mayúsculas ni espacios).</div>`;
}

// Devuelve el array de ingredientes según el target ("simple" o índice de variante)
function ingredientesDe(target) {
  return target === "simple" ? recetaState.simple.ingredientes : recetaState.variantes[+target].ingredientes;
}

// Delegación de eventos del editor
document.getElementById("receta-editor").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const msgEl  = document.getElementById("msg-producto");

  if (action === "add-var") {
    recetaState.variantes.push({ tamano: "", sector: primerSector(), ingredientes: [] });
    renderRecetaEditor(); return;
  }
  if (action === "del-var") {
    recetaState.variantes.splice(+btn.dataset.idx, 1);
    renderRecetaEditor(); return;
  }
  if (action === "del-ing") {
    ingredientesDe(btn.dataset.target).splice(+btn.dataset.idx, 1);
    renderRecetaEditor(); return;
  }
  if (action === "add-ing") {
    const bloque = btn.closest(".receta-bloque");
    const selMat = bloque.querySelector(".bloque-ing-mat");
    const inpCant = bloque.querySelector(".bloque-ing-cant");
    const id = selMat.value;
    const cant = parseFloat(inpCant.value);
    const lista = ingredientesDe(btn.dataset.target);
    if (!id) { mostrarMsg(msgEl, "error", "Primero elegí un producto del desplegable."); return; }
    if (isNaN(cant) || cant <= 0) { mostrarMsg(msgEl, "error", "Poné una cantidad válida."); return; }
    if (lista.some(i => i.id === id)) { mostrarMsg(msgEl, "error", "Ese ingrediente ya está en este bloque."); return; }
    const mat = productos.find(p => p.id === id);
    if (!mat) return;
    const selUni = bloque.querySelector(".bloque-ing-unidad");
    const unidadElegida = (selUni && selUni.value) || mat.unidad_medida || "";
    const esSub = mat.rendimiento > 0 && mat.subunidad && unidadElegida === mat.subunidad;
    const base  = esSub ? (cant / mat.rendimiento) : cant;
    lista.push({
      id, nombre: mat.nombre,
      cantidad: +base.toFixed(6),      // SIEMPRE en unidad base (lo que descuenta el importador)
      unidad: mat.unidad_medida || "",
      cant_in: cant,                   // valor tal como lo escribió el usuario (para mostrar/editar)
      unidad_in: unidadElegida
    });
    msgEl.classList.remove("show");
    renderRecetaEditor();
  }
});

// Cambios de sector y de nombre de variante (no re-renderizan, solo guardan en estado)
document.getElementById("receta-editor").addEventListener("change", (e) => {
  if (e.target.classList.contains("bloque-sector")) {
    const t = e.target.dataset.target;
    if (t === "simple") recetaState.simple.sector = e.target.value;
    else recetaState.variantes[+t].sector = e.target.value;
  }
  if (e.target.classList.contains("bloque-ing-mat")) {
    const bloque = e.target.closest(".receta-bloque");
    const prod = productos.find(p => p.id === e.target.value);
    const selUni = bloque.querySelector(".bloque-ing-unidad");
    if (selUni) selUni.innerHTML = optsUnidadIngrediente(prod);
    actualizarHintIngrediente(bloque);
  }
  if (e.target.classList.contains("bloque-ing-unidad")) {
    actualizarHintIngrediente(e.target.closest(".receta-bloque"));
  }
});
document.getElementById("receta-editor").addEventListener("input", (e) => {
  if (e.target.classList.contains("variante-tamano")) {
    recetaState.variantes[+e.target.dataset.idx].tamano = e.target.value;
  }
  if (e.target.classList.contains("bloque-ing-cant")) {
    actualizarHintIngrediente(e.target.closest(".receta-bloque"));
  }
  if (e.target.classList.contains("bloque-ing-buscar")) {
    const bloque = e.target.closest(".receta-bloque");
    const sel = bloque.querySelector(".bloque-ing-mat");
    const t = e.target.value;
    sel.innerHTML = optsIngredientes(t);
    const primerReal = [...sel.options].find(o => o.value);
    if (t.trim() && primerReal) sel.value = primerReal.value;
    const prod = productos.find(p => p.id === sel.value);
    const selUni = bloque.querySelector(".bloque-ing-unidad");
    if (selUni) selUni.innerHTML = optsUnidadIngrediente(prod);
    actualizarHintIngrediente(bloque);
  }
});

document.getElementById("btn-nuevo-producto").addEventListener("click", () => {
  document.getElementById("modal-producto-titulo").textContent = "Nuevo producto";
  document.getElementById("prod-id").value        = "";
  document.getElementById("prod-nombre").value    = "";
  document.getElementById("prod-plu").value       = "";
  document.getElementById("prod-stock").value     = "0";
  document.getElementById("prod-stock-min").value = "";
  document.getElementById("prod-rendimiento").value = "";
  document.getElementById("prod-subunidad").value   = "";
  document.getElementById("prod-tipo").value      = "Despacho";
  recetaState = freshRecetaState();
  document.getElementById("prod-receta-varia").checked = false;
  renderChecksDespacho([]);
  aplicarVistaTipo("Despacho");
  document.getElementById("msg-producto").classList.remove("show");
  abrirModal("modal-producto");
});

window.abrirEditarProducto = (id) => {
  const p = productos.find(x => x.id === id); if (!p) return;
  document.getElementById("modal-producto-titulo").textContent = "Editar producto";
  document.getElementById("prod-id").value        = p.id;
  document.getElementById("prod-nombre").value    = p.nombre;
  document.getElementById("prod-plu").value       = p.plu ?? "";
  document.getElementById("prod-stock").value     = p.stock_deposito ?? 0;
  document.getElementById("prod-stock-min").value = p.stock_minimo ?? "";
  document.getElementById("prod-tipo").value      = p.tipo || "Materia prima";
  renderChecksDespacho(sectoresDe(p));
  if (esReceta(p)) {
    if (p.por_variantes) {
      recetaState = {
        porVariantes: true,
        simple: { sector: "", ingredientes: [] },
        variantes: (p.variantes || []).map(v => ({ tamano: v.tamano || "", sector: v.sector || "", ingredientes: (v.ingredientes || []).map(i => ({ ...i })) }))
      };
    } else {
      recetaState = {
        porVariantes: false,
        simple: { sector: p.sector_receta || "", ingredientes: (p.ingredientes || []).map(i => ({ ...i })) },
        variantes: []
      };
    }
  } else {
    recetaState = freshRecetaState();
  }
  aplicarVistaTipo(p.tipo || "Materia prima");
  document.getElementById("msg-producto").classList.remove("show");
  setTimeout(() => {
    document.getElementById("prod-rubro").value  = p.rubro  || "";
    document.getElementById("prod-sector").value = p.sector || "";
    document.getElementById("prod-unidad").value = p.unidad_medida || "Kg";
    document.getElementById("prod-rendimiento").value = p.rendimiento ?? "";
    document.getElementById("prod-subunidad").value   = p.subunidad ?? "";
  }, 50);
  abrirModal("modal-producto");
};

document.getElementById("btn-guardar-producto").addEventListener("click", async () => {
  const id      = document.getElementById("prod-id").value;
  const nombre  = document.getElementById("prod-nombre").value.trim();
  const plu     = document.getElementById("prod-plu").value.trim();
  const rubro   = document.getElementById("prod-rubro").value;
  const sector  = document.getElementById("prod-sector").value;
  const unidad  = document.getElementById("prod-unidad").value;
  const tipo    = document.getElementById("prod-tipo").value;
  const stock   = parseFloat(document.getElementById("prod-stock").value) || 0;
  const minVal  = document.getElementById("prod-stock-min").value;
  const minData = minVal !== "" ? { stock_minimo: parseFloat(minVal) } : { stock_minimo: null };
  // Fracción / rendimiento (opcional): 1 unidad base = N subunidades (ej. 1 botella = 700 ml)
  const rendVal = parseFloat(document.getElementById("prod-rendimiento").value);
  const subVal  = document.getElementById("prod-subunidad").value.trim();
  const fraccionData = (tipo !== "Receta" && rendVal > 0 && subVal)
    ? { rendimiento: rendVal, subunidad: subVal }
    : { rendimiento: null, subunidad: null };
  const msgEl   = document.getElementById("msg-producto");
  const btn     = document.getElementById("btn-guardar-producto");

  const seleccionados = [...document.querySelectorAll(".check-despacho:checked")].map(c => c.value);

  if (!nombre) { mostrarMsg(msgEl, "error", "El nombre es obligatorio."); return; }
  if (tipo === "Despacho" && !seleccionados.length) { mostrarMsg(msgEl, "error", "Un producto de despacho necesita al menos un sector de despacho."); return; }

  let datosReceta = { por_variantes: false, sector_receta: null, ingredientes: [], variantes: [] };
  if (tipo === "Receta") {
    if (recetaState.porVariantes) {
      if (!recetaState.variantes.length) { mostrarMsg(msgEl, "error", "Agregá al menos una variante."); return; }
      const tams = [];
      for (const v of recetaState.variantes) {
        const t = (v.tamano || "").trim();
        if (!t) { mostrarMsg(msgEl, "error", "Cada variante necesita un tamaño (ej. Nacional)."); return; }
        if (!v.sector) { mostrarMsg(msgEl, "error", `La variante "${t}" necesita un sector.`); return; }
        if (!v.ingredientes.length) { mostrarMsg(msgEl, "error", `La variante "${t}" necesita al menos un ingrediente.`); return; }
        const tnorm = t.toUpperCase();
        if (tams.includes(tnorm)) { mostrarMsg(msgEl, "error", `Hay dos variantes con el mismo tamaño "${t}".`); return; }
        tams.push(tnorm);
      }
      datosReceta = {
        por_variantes: true,
        variantes: recetaState.variantes.map(v => ({ tamano: v.tamano.trim(), sector: v.sector, ingredientes: v.ingredientes.map(i => ({ ...i })) })),
        sector_receta: null, ingredientes: [], unidad_medida: "Unidad"
      };
    } else {
      if (!recetaState.simple.sector) { mostrarMsg(msgEl, "error", "Elegí el sector donde se arma la receta."); return; }
      if (!recetaState.simple.ingredientes.length) { mostrarMsg(msgEl, "error", "La receta necesita al menos un ingrediente."); return; }
      datosReceta = {
        por_variantes: false,
        sector_receta: recetaState.simple.sector,
        ingredientes: recetaState.simple.ingredientes.map(i => ({ ...i })),
        variantes: [], unidad_medida: "Unidad"
      };
    }
  }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    if (id) {
      // Editar: actualizar datos y sincronizar mapa de despacho sin pisar stocks existentes
      const prodActual = productos.find(x => x.id === id);
      const despachoActual = prodActual?.stock_despacho ?? {};
      const nuevoDespacho = {};
      if (tipo === "Despacho") {
        seleccionados.forEach(s => { nuevoDespacho[s] = despachoActual[s] ?? 0; });
      }
      await updateDoc(doc(db, "productos", id), {
        nombre, plu, rubro, sector, unidad_medida: unidad, tipo,
        sectores_asignados: tipo === "Despacho" ? seleccionados : [],
        stock_despacho: nuevoDespacho,
        ...minData,
        ...fraccionData,
        ...datosReceta
      });
    } else {
      const despachoInit = {};
      if (tipo === "Despacho") seleccionados.forEach(s => { despachoInit[s] = 0; });
      await addDoc(collection(db, "productos"), {
        nombre, plu, rubro, sector, unidad_medida: unidad, tipo,
        sectores_asignados: tipo === "Despacho" ? seleccionados : [],
        stock_deposito: stock,
        stock_despacho: despachoInit,
        ...minData,
        ...fraccionData,
        ...datosReceta
      });
    }
    cerrarModal("modal-producto");
  } catch(err) {
    mostrarMsg(msgEl, "error", "Error: " + err.message);
  } finally {
    btn.disabled = false; btn.innerHTML = "Guardar producto";
  }
});

// ── CONTROLES CANTIDAD ────────────────────────────────────────
function setupCant(menosId, masId, inputId) {
  const inp = document.getElementById(inputId);
  document.getElementById(menosId).addEventListener("click", () => { inp.value = Math.max(0.1, parseFloat((parseFloat(inp.value)||0) - 1).toFixed(2)); });
  document.getElementById(masId).addEventListener("click",   () => { inp.value = parseFloat((parseFloat(inp.value)||0) + 1).toFixed(2); });
}
setupCant("ent-menos","ent-mas","ent-cantidad");
setupCant("sal-menos","sal-mas","sal-cantidad");
setupCant("vta-menos","vta-mas","vta-cantidad");

function poblarSelect(selectId, lista = productos) {
  document.getElementById(selectId).innerHTML = lista.map(p => `<option value="${p.id}">${p.nombre}</option>`).join("");
}

function actualizarUnidad(selectId, spanId) {
  const prod = productos.find(p => p.id === document.getElementById(selectId).value);
  document.getElementById(spanId).textContent = prod ? `(${prod.unidad_medida})` : "";
}

// Ubicaciones ajustables de un producto: acopio + cada sector de despacho (asignado o con stock)
function ubicacionesDe(prod) {
  const desp = prod.stock_despacho || {};
  const locs = [{ key: "acopio", label: "Acopio", val: prod.stock_deposito ?? 0 }];
  const sectores = [...new Set([...(prod.sectores_asignados || []), ...Object.keys(desp)])];
  for (const s of sectores) locs.push({ key: "desp:" + s, label: "Despacho · " + s, val: desp[s] ?? 0 });
  return locs;
}

function poblarUbicacionesAjuste() {
  const prod = productos.find(p => p.id === document.getElementById("ajt-producto").value);
  const sel  = document.getElementById("ajt-ubicacion");
  if (!prod) { sel.innerHTML = ""; document.getElementById("ajt-actual").textContent = ""; return; }
  sel.innerHTML = ubicacionesDe(prod).map(u => `<option value="${u.key}">${u.label} (actual: ${fmtN(u.val)} ${prod.unidad_medida || ""})</option>`).join("");
  actualizarActualAjuste();
}

function actualizarActualAjuste() {
  const prod = productos.find(p => p.id === document.getElementById("ajt-producto").value);
  const sel  = document.getElementById("ajt-ubicacion");
  const hint = document.getElementById("ajt-actual");
  if (!prod || !sel.value) { hint.textContent = ""; return; }
  const u = ubicacionesDe(prod).find(x => x.key === sel.value);
  hint.textContent = u ? `· actual: ${fmtN(u.val)}` : "";
  document.getElementById("ajt-stock").placeholder = u ? String(fmtN(u.val)) : "0";
}

function setupBuscador(busqId, selectId, unidadId, extra) {
  document.getElementById(busqId).oninput = () => {
    const t = document.getElementById(busqId).value.toLowerCase();
    const f = t ? productos.filter(p => p.nombre.toLowerCase().includes(t)) : productos;
    document.getElementById(selectId).innerHTML = f.map(p => `<option value="${p.id}">${p.nombre}</option>`).join("");
    actualizarUnidad(selectId, unidadId);
    if (extra) extra();
  };
  document.getElementById(selectId).onchange = () => { actualizarUnidad(selectId, unidadId); if (extra) extra(); };
}

// ── ENTRADA ───────────────────────────────────────────────────
document.getElementById("btn-mov-entrada").addEventListener("click", () => {
  poblarSelect("ent-producto");
  document.getElementById("ent-busqueda").value = "";
  document.getElementById("ent-cantidad").value = "1";
  document.getElementById("ent-obs").value = "";
  actualizarUnidad("ent-producto","ent-unidad");
  setupBuscador("ent-busqueda","ent-producto","ent-unidad");
  document.getElementById("msg-entrada").classList.remove("show");
  abrirModal("modal-entrada");
});

document.getElementById("btn-confirmar-entrada").addEventListener("click", async () => {
  const tipo     = document.getElementById("ent-tipo").value;
  const prodId   = document.getElementById("ent-producto").value;
  const cantidad = parseFloat(document.getElementById("ent-cantidad").value) || 0;
  const motivo   = tipo === "INGRESO_PROVEEDOR" ? "Proveedor" : "Producción";
  const obs      = document.getElementById("ent-obs").value.trim();
  const msgEl    = document.getElementById("msg-entrada");
  const btn      = document.getElementById("btn-confirmar-entrada");
  const prod     = productos.find(p => p.id === prodId);
  if (!prod || cantidad <= 0) { mostrarMsg(msgEl,"error","Completá los campos."); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    await addDoc(collection(db,"movimientos"), {
      fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid,
      nombre_usuario: usuarioActual.nombre, id_producto: prodId,
      nombre_producto: prod.nombre, tipo, cantidad, unidad: prod.unidad_medida,
      motivo: obs ? `${motivo} — ${obs}` : motivo, origen: "externo", destino: "acopio"
    });
    await updateDoc(doc(db,"productos",prodId), { stock_deposito: (prod.stock_deposito ?? 0) + cantidad });
    mostrarMsg(msgEl,"ok",`✓ ${cantidad} ${prod.unidad_medida} ingresados al acopio.`);
    document.getElementById("ent-cantidad").value = "1";
    cargarMovRecientes();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Registrar entrada"; }
});

// ── RETIRO INTELIGENTE v3.5 ───────────────────────────────────
// Origen del retiro: por defecto "acopio". Cuando el acopio está en cero
// o en/bajo el mínimo, se ofrece sacar desde un sector de despacho.
function acopioBajoOcero(p) {
  const dep = p.stock_deposito ?? 0;
  const min = p.stock_minimo;
  if (dep <= 0) return true;
  if (min != null && min !== "" && dep <= min) return true;
  return false;
}

// ¿Qué origen está elegido ahora mismo? "acopio" o nombre de un sector de despacho
function origenRetiroActual() {
  const grupo = document.getElementById("sal-grupo-origen");
  if (grupo && grupo.style.display !== "none") {
    return document.getElementById("sal-origen").value || "acopio";
  }
  return "acopio";
}

function actualizarInfoRetiro() {
  const prod = productos.find(p => p.id === document.getElementById("sal-producto").value);
  poblarMotivosSalida();
  const grupoSector = document.getElementById("sal-grupo-sector");
  const infoDestino = document.getElementById("sal-info-destino");
  const grupoOrigen = document.getElementById("sal-grupo-origen");

  if (!prod) {
    grupoSector.style.display = "none";
    infoDestino.style.display = "none";
    if (grupoOrigen) grupoOrigen.style.display = "none";
    return;
  }

  // ── Selector de origen inteligente ──
  // Solo para productos de despacho con stock en algún sector, y cuando el acopio está bajo/cero
  let origenEsDespacho = false;
  if (grupoOrigen) {
    const despachoConStock = esDespacho(prod)
      ? Object.entries(prod.stock_despacho || {}).filter(([,v]) => (v||0) > 0)
      : [];
    if (acopioBajoOcero(prod) && despachoConStock.length > 0) {
      const sel = document.getElementById("sal-origen");
      // Reconstruir las opciones SOLO si cambió el producto (no en cada cambio de origen),
      // para no pisar la selección del usuario.
      if (sel.dataset.prod !== prod.id) {
        const opciones = [];
        opciones.push(`<option value="acopio">Acopio (${fmtN(prod.stock_deposito ?? 0)} ${prod.unidad_medida||""})</option>`);
        despachoConStock.forEach(([s,v]) => opciones.push(`<option value="${s}">${s} (${v} ${prod.unidad_medida||""})</option>`));
        sel.innerHTML = opciones.join("");
        sel.dataset.prod = prod.id;
        sel.onchange = actualizarInfoRetiro;
      }
      grupoOrigen.style.display = "";
      origenEsDespacho = origenRetiroActual() !== "acopio";
    } else {
      grupoOrigen.style.display = "none";
      document.getElementById("sal-origen").dataset.prod = "";
    }
  }

  // Si el origen elegido es un despacho, el retiro NO puede transferir (no se repone del despacho al despacho)
  const motivoObj  = motivosSalida.find(m => m.nombre === document.getElementById("sal-motivo").value);
  const transfiere = !!(motivoObj && motivoObj.transfiere) && !origenEsDespacho;

  if (origenEsDespacho) {
    // Retiro desde un sector de despacho: solo consumo, sin transferencia
    grupoSector.style.display = "none";
    infoDestino.style.display = "";
    const origen = origenRetiroActual();
    infoDestino.innerHTML = `<div style="background:var(--bajo-bg);border:1px solid #F0D9B5;border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--bajo-txt);">↓ Se descuenta de <strong>${origen}</strong> (sector de despacho). No suma a ningún otro lado.</div>`;
    return;
  }

  if (transfiere && esDespacho(prod)) {
    const sects = sectoresDe(prod);
    if (sects.length > 1) {
      grupoSector.style.display = "";
      document.getElementById("sal-sector-destino").innerHTML = sects.map(s => `<option value="${s}">${s}</option>`).join("");
      infoDestino.style.display = "none";
    } else if (sects.length === 1) {
      grupoSector.style.display = "none";
      infoDestino.style.display = "";
      infoDestino.innerHTML = `<div style="background:var(--verde-claro);border:1px solid var(--verde-suave);border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--texto-2);">🔁 ${motivoObj.nombre} — el stock irá automáticamente a <strong style="color:var(--verde);">${sects[0]}</strong></div>`;
    } else {
      grupoSector.style.display = "none";
      infoDestino.style.display = "";
      infoDestino.innerHTML = `<div style="background:var(--bajo-bg);border:1px solid #F0D9B5;border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--bajo-txt);">⚠️ Producto de despacho sin sector asignado.</div>`;
    }
  } else {
    grupoSector.style.display = "none";
    infoDestino.style.display = "";
    infoDestino.innerHTML = `<div style="background:var(--bg-secondary);border:1px solid var(--borde);border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--texto-3);">↓ Solo descuenta del acopio${esDespacho(prod) ? "" : " (materia prima)"}</div>`;
  }
}

document.getElementById("btn-mov-salida").addEventListener("click", () => {
  poblarSelect("sal-producto");
  document.getElementById("sal-busqueda").value = "";
  document.getElementById("sal-cantidad").value = "1";
  document.getElementById("sal-obs").value = "";
  const go = document.getElementById("sal-grupo-origen");
  if (go) go.style.display = "none";
  document.getElementById("sal-origen").dataset.prod = "";
  document.getElementById("sal-motivo").onchange = actualizarInfoRetiro;
  actualizarUnidad("sal-producto","sal-unidad");
  setupBuscador("sal-busqueda","sal-producto","sal-unidad", actualizarInfoRetiro);
  actualizarInfoRetiro();
  document.getElementById("msg-salida").classList.remove("show");
  abrirModal("modal-salida");
});

document.getElementById("btn-confirmar-salida").addEventListener("click", async () => {
  const prodId   = document.getElementById("sal-producto").value;
  const cantidad = parseFloat(document.getElementById("sal-cantidad").value) || 0;
  const motivo   = document.getElementById("sal-motivo").value;
  const obs      = document.getElementById("sal-obs").value.trim();
  const msgEl    = document.getElementById("msg-salida");
  const btn      = document.getElementById("btn-confirmar-salida");
  const prod     = productos.find(p => p.id === prodId);
  if (!prod || cantidad <= 0) { mostrarMsg(msgEl,"error","Completá los campos."); return; }

  const origen = origenRetiroActual();

  // ── Retiro desde un sector de despacho ──
  if (origen !== "acopio") {
    const stockSector = prod.stock_despacho?.[origen] ?? 0;
    if (cantidad > stockSector) { mostrarMsg(msgEl,"error",`Stock insuficiente en ${origen}. Hay ${stockSector} ${prod.unidad_medida}.`); return; }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      await updateDoc(doc(db,"productos",prodId), {
        [`stock_despacho.${origen}`]: Math.max(0, stockSector - cantidad)
      });
      await addDoc(collection(db,"movimientos"), {
        fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid,
        nombre_usuario: usuarioActual.nombre, id_producto: prodId,
        nombre_producto: prod.nombre, tipo: "RETIRO", cantidad, unidad: prod.unidad_medida,
        motivo: obs ? `${motivo} — ${obs}` : motivo, origen, destino: "consumo"
      });
      mostrarMsg(msgEl,"ok",`✓ Retiro de ${cantidad} ${prod.unidad_medida} desde ${origen}.`);
      document.getElementById("sal-cantidad").value = "1";
      cargarMovRecientes();
    } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
    finally { btn.disabled = false; btn.innerHTML = "Registrar retiro"; }
    return;
  }

  // ── Retiro desde acopio (flujo normal) ──
  if (cantidad > (prod.stock_deposito ?? 0)) { mostrarMsg(msgEl,"error",`Stock insuficiente en acopio. Hay ${prod.stock_deposito ?? 0} ${prod.unidad_medida}.`); return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const motivoObj  = motivosSalida.find(m => m.nombre === motivo);
    const transfiere = !!(motivoObj && motivoObj.transfiere);
    let destino = "consumo";
    if (transfiere && esDespacho(prod)) {
      const sects = sectoresDe(prod);
      if (sects.length > 1) destino = document.getElementById("sal-sector-destino").value;
      else if (sects.length === 1) destino = sects[0];
      else throw new Error("El producto no tiene sector de despacho asignado.");

      // Flujo lineal atómico: -acopio +despacho
      const batch = writeBatch(db);
      batch.update(doc(db,"productos",prodId), {
        stock_deposito: Math.max(0, (prod.stock_deposito ?? 0) - cantidad),
        [`stock_despacho.${destino}`]: ((prod.stock_despacho?.[destino] ?? 0) + cantidad)
      });
      await batch.commit();
    } else {
      // Materia prima o consumo: solo descuenta acopio
      await updateDoc(doc(db,"productos",prodId), { stock_deposito: Math.max(0, (prod.stock_deposito ?? 0) - cantidad) });
    }

    await addDoc(collection(db,"movimientos"), {
      fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid,
      nombre_usuario: usuarioActual.nombre, id_producto: prodId,
      nombre_producto: prod.nombre, tipo: "RETIRO", cantidad, unidad: prod.unidad_medida,
      motivo: obs ? `${motivo} — ${obs}` : motivo, origen: "acopio", destino
    });
    mostrarMsg(msgEl,"ok", destino !== "consumo" ? `✓ Retiro de ${cantidad} ${prod.unidad_medida} → ${destino}.` : `✓ Retiro registrado (${motivo}).`);
    document.getElementById("sal-cantidad").value = "1";
    cargarMovRecientes();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Registrar retiro"; }
});

// ── VENTA ─────────────────────────────────────────────────────
function actualizarSectoresVenta() {
  const prod = productos.find(p => p.id === document.getElementById("vta-producto").value);
  const sel  = document.getElementById("vta-sector");
  if (!prod || !esDespacho(prod)) { sel.innerHTML = '<option value="">—</option>'; return; }
  const sects = sectoresDe(prod);
  sel.innerHTML = sects.map(s => {
    const stock = prod.stock_despacho?.[s] ?? 0;
    return `<option value="${s}">${s} (${stock} ${prod.unidad_medida})</option>`;
  }).join("");
}

document.getElementById("btn-mov-venta").addEventListener("click", () => {
  const soloDespacho = productos.filter(esDespacho);
  poblarSelect("vta-producto", soloDespacho);
  document.getElementById("vta-busqueda").value = "";
  document.getElementById("vta-cantidad").value = "1";
  document.getElementById("vta-obs").value = "";
  // Buscador limitado a productos de despacho
  document.getElementById("vta-busqueda").oninput = () => {
    const t = document.getElementById("vta-busqueda").value.toLowerCase();
    const f = t ? soloDespacho.filter(p => p.nombre.toLowerCase().includes(t)) : soloDespacho;
    document.getElementById("vta-producto").innerHTML = f.map(p => `<option value="${p.id}">${p.nombre}</option>`).join("");
    actualizarUnidad("vta-producto","vta-unidad"); actualizarSectoresVenta();
  };
  document.getElementById("vta-producto").onchange = () => { actualizarUnidad("vta-producto","vta-unidad"); actualizarSectoresVenta(); };
  actualizarUnidad("vta-producto","vta-unidad");
  actualizarSectoresVenta();
  // Pre-cargar período con el día de hoy (inicio de día → ahora)
  const ahora = new Date();
  const inicioDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0);
  document.getElementById("vta-desde").value = aDatetimeLocal(inicioDia);
  document.getElementById("vta-hasta").value = aDatetimeLocal(ahora);
  document.getElementById("msg-venta").classList.remove("show");
  abrirModal("modal-venta");
});

document.getElementById("btn-confirmar-venta").addEventListener("click", async () => {
  const prodId   = document.getElementById("vta-producto").value;
  const cantidad = parseFloat(document.getElementById("vta-cantidad").value) || 0;
  const sector   = document.getElementById("vta-sector").value;
  const obs      = document.getElementById("vta-obs").value.trim();
  const desdeVal = document.getElementById("vta-desde").value;
  const hastaVal = document.getElementById("vta-hasta").value;
  const msgEl    = document.getElementById("msg-venta");
  const btn      = document.getElementById("btn-confirmar-venta");
  const prod     = productos.find(p => p.id === prodId);
  if (!prod || cantidad <= 0 || !sector) { mostrarMsg(msgEl,"error","Completá los campos."); return; }
  if (!hastaVal) { mostrarMsg(msgEl,"error","Indicá hasta qué fecha y hora corresponde la venta."); return; }
  const fechaHasta = new Date(hastaVal);
  const stockSector = prod.stock_despacho?.[sector] ?? 0;
  if (cantidad > stockSector) { mostrarMsg(msgEl,"error",`Stock insuficiente en ${sector}. Hay ${stockSector} ${prod.unidad_medida}.`); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    await updateDoc(doc(db,"productos",prodId), { [`stock_despacho.${sector}`]: Math.max(0, stockSector - cantidad) });
    await addDoc(collection(db,"movimientos"), {
      fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid,
      nombre_usuario: usuarioActual.nombre, id_producto: prodId,
      nombre_producto: prod.nombre, tipo: "VENTA", cantidad, unidad: prod.unidad_medida,
      motivo: obs || "Venta", origen: sector, destino: "salon",
      periodo_desde: desdeVal ? new Date(desdeVal) : null,
      periodo_hasta: fechaHasta
    });
    // Actualizar corte individual del producto si la fecha avanza
    if (debeAvanzar(prod.ventas_hasta, fechaHasta)) {
      await updateDoc(doc(db,"productos",prodId), { ventas_hasta: fechaHasta });
    }
    mostrarMsg(msgEl,"ok",`✓ Venta de ${cantidad} ${prod.unidad_medida} desde ${sector}.`);
    document.getElementById("vta-cantidad").value = "1";
    actualizarSectoresVenta();
    cargarMovRecientes();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Confirmar venta"; }
});

// ── MOVIMIENTOS RECIENTES Y FILA ──────────────────────────────
const COLORES_MOV = { INGRESO_PROVEEDOR:"var(--normal-txt)", INGRESO_PRODUCCION:"var(--normal-txt)", RETIRO:"var(--critico-txt)", VENTA:"var(--verde)", AJUSTE:"var(--texto-2)" };
const LABELS_MOV  = { INGRESO_PROVEEDOR:"↑ Proveedor", INGRESO_PRODUCCION:"↑ Producción", RETIRO:"↓ Retiro", VENTA:"💰 Venta", AJUSTE:"⚖ Ajuste" };

function filaMovimiento(m) {
  const ts    = m.fecha_hora?.toDate?.();
  const fecha = ts ? ts.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"}) : "—";
  const hora  = ts ? ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}) : "";
  const color = COLORES_MOV[m.tipo] || "var(--texto-2)";
  const label = LABELS_MOV[m.tipo]  || escHtml(m.tipo);
  const destinoExtra = (m.tipo === "RETIRO" && m.destino && m.destino !== "produccion" && m.destino !== "consumo") ? ` → ${escHtml(m.destino)}` : "";
  const corregido = m.corregido ? ' <span style="font-size:0.62rem;background:var(--bg-secondary);color:var(--texto-3);padding:1px 6px;border-radius:5px;">✏️ corregido</span>' : "";
  const btnEditar = (m.tipo === "RETIRO" && m.id) ? `<button class="btn-icono" onclick="abrirEditarMotivo('${m.id}')" title="Corregir motivo" style="padding:2px 7px;">✏️</button>` : "";
  return `<div class="mov-row">
    <div class="mov-header">
      <span class="mov-producto">${escHtml(m.nombre_producto||"—")}</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:0.85rem;font-weight:700;color:${color};">${escHtml(m.cantidad)} ${escHtml(m.unidad||"")}</span>
        ${btnEditar}
      </div>
    </div>
    <div class="mov-meta">${fecha} ${hora} · <span style="color:${color};font-weight:600;">${label}${destinoExtra}</span> · ${escHtml(m.nombre_usuario||"—")} · ${escHtml(m.motivo||"")}${corregido}</div>
  </div>`;
}

async function cargarMovRecientes() {
  const cont = document.getElementById("lista-mov-recientes");
  const snap = await getDocs(query(collection(db,"movimientos"), orderBy("fecha_hora","desc"), limit(20)));
  if (snap.empty) { cont.innerHTML = '<div class="empty-state"><p>Sin movimientos.</p></div>'; return; }
  const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  lista.forEach(m => { movIndex[m.id] = m; });
  cont.innerHTML = lista.map(filaMovimiento).join("");
}

// ── CORREGIR MOTIVO DE UN RETIRO ──────────────────────────────
// Revierte por completo el efecto del movimiento original y aplica el del
// nuevo motivo (reverse + apply). Contempla el ORIGEN real del retiro:
// puede haber salido del acopio o directamente de un sector de despacho.
let edmMov = null;

const esDestinoSector = (x) => !!x && !["consumo","produccion","externo","salon","acopio",""].includes(x);

// Efecto en stock de un retiro, según de dónde salió y a dónde fue.
// Devuelve deltas: { acopio:Δ, despacho:{sector:Δ} }
function efectoRetiro(origen, destino, cantidad) {
  const ef = { acopio: 0, despacho: {} };
  if (!origen || origen === "acopio") {
    ef.acopio -= cantidad;                                   // salió del acopio
    if (esDestinoSector(destino)) ef.despacho[destino] = (ef.despacho[destino]||0) + cantidad; // reposición
  } else {
    ef.despacho[origen] = (ef.despacho[origen]||0) - cantidad; // salió de un sector de despacho
    if (esDestinoSector(destino)) ef.despacho[destino] = (ef.despacho[destino]||0) + cantidad;
  }
  return ef;
}

window.abrirEditarMotivo = (id) => {
  const m = movIndex[id];
  if (!m || m.tipo !== "RETIRO") return;
  edmMov = m;
  const prod = productos.find(p => p.id === m.id_producto);
  const base = (m.motivo || "").split(" — ")[0];
  const desdeDespacho = !!(m.origen && m.origen !== "acopio");
  document.getElementById("edm-info").innerHTML =
    `<div><strong>${escHtml(m.nombre_producto)}</strong> · ${escHtml(m.cantidad)} ${escHtml(m.unidad||"")}</div>
     <div style="color:var(--texto-3);font-size:0.78rem;margin-top:2px;">Motivo actual: ${escHtml(m.motivo||"—")} · salió de <strong>${escHtml(m.origen||"acopio")}</strong>${esDestinoSector(m.destino) ? " → "+escHtml(m.destino) : ""}</div>`;
  const sel = document.getElementById("edm-motivo");
  // Materia prima o retiro desde despacho: no se puede reponer → solo motivos sin transferencia
  let opciones = motivosSalida;
  if ((prod && !esDespacho(prod)) || desdeDespacho) opciones = motivosSalida.filter(x => !x.transfiere);
  sel.innerHTML = opciones.map(x => `<option value="${x.nombre}" ${x.nombre===base?"selected":""}>${x.nombre}${x.transfiere?" (→ despacho)":""}</option>`).join("");
  edmActualizar();
  document.getElementById("msg-editar-motivo").classList.remove("show");
  abrirModal("modal-editar-motivo");
};

function edmDestinoNuevo(prod, newTransf) {
  if (!newTransf) return "consumo";
  const sects = sectoresDe(prod);
  if (!sects.length) return null;
  return sects.length > 1 ? document.getElementById("edm-sector").value : sects[0];
}

function edmEsTransfNuevo() {
  const m = edmMov; if (!m) return false;
  const prod = productos.find(p => p.id === m.id_producto);
  const origen = m.origen || "acopio";
  const mo = motivosSalida.find(x => x.nombre === document.getElementById("edm-motivo").value);
  return !!(mo && mo.transfiere) && esDespacho(prod) && origen === "acopio";
}

function edmActualizar() {
  const m = edmMov; if (!m) return;
  const prod = productos.find(p => p.id === m.id_producto);
  const origen = m.origen || "acopio";
  const newTransf = edmEsTransfNuevo();
  const grupo = document.getElementById("edm-grupo-sector");
  if (newTransf) {
    const sects = sectoresDe(prod);
    document.getElementById("edm-sector").innerHTML = sects.map(s => `<option value="${s}" ${s===m.destino?"selected":""}>${s}</option>`).join("");
    grupo.style.display = sects.length > 1 ? "" : "none";
  } else {
    grupo.style.display = "none";
  }
  const newDestino = newTransf ? edmDestinoNuevo(prod, true) : "consumo";
  const oldEf = efectoRetiro(origen, m.destino, m.cantidad);
  const newEf = efectoRetiro(origen, newDestino, m.cantidad);
  const u = m.unidad || "";
  const partes = [];
  const dAcopio = newEf.acopio - oldEf.acopio;
  if (dAcopio) partes.push(`acopio ${dAcopio > 0 ? "+" : ""}${+dAcopio.toFixed(3)} ${u}`);
  const sectores = new Set([...Object.keys(oldEf.despacho), ...Object.keys(newEf.despacho)]);
  sectores.forEach(s => {
    const d = (newEf.despacho[s]||0) - (oldEf.despacho[s]||0);
    if (d) partes.push(`${s} ${d > 0 ? "+" : ""}${+d.toFixed(3)} ${u}`);
  });
  document.getElementById("edm-preview").textContent = partes.length
    ? `Se revierte el movimiento y se aplica el nuevo. Ajuste neto: ${partes.join(", ")}.`
    : "Sin cambios de stock — solo se corrige la etiqueta del motivo.";
}

document.getElementById("edm-motivo").addEventListener("change", edmActualizar);
document.getElementById("edm-sector").addEventListener("change", edmActualizar);

document.getElementById("btn-confirmar-editar-motivo").addEventListener("click", async () => {
  const m = edmMov;
  const msgEl = document.getElementById("msg-editar-motivo");
  const btn = document.getElementById("btn-confirmar-editar-motivo");
  if (!m) return;
  const prod = productos.find(p => p.id === m.id_producto);
  if (!prod) { mostrarMsg(msgEl,"error","El producto de este movimiento ya no existe."); return; }
  const nuevo = document.getElementById("edm-motivo").value;
  const base  = (m.motivo || "").split(" — ")[0];
  const obs   = (m.motivo || "").includes(" — ") ? (m.motivo || "").split(" — ").slice(1).join(" — ") : "";
  if (nuevo === base) { mostrarMsg(msgEl,"error","Elegí un motivo distinto al actual."); return; }

  const origen     = m.origen || "acopio";
  const newTransf  = edmEsTransfNuevo();
  const newDestino = newTransf ? edmDestinoNuevo(prod, true) : "consumo";
  if (newTransf && !newDestino) { mostrarMsg(msgEl,"error","El producto no tiene sector de despacho asignado."); return; }

  // Reverse + apply
  const oldEf = efectoRetiro(origen, m.destino, m.cantidad);
  const newEf = efectoRetiro(origen, newDestino, m.cantidad);
  const nuevoAcopio = +( (prod.stock_deposito ?? 0) + (newEf.acopio - oldEf.acopio) ).toFixed(4);
  const despacho = { ...(prod.stock_despacho || {}) };
  new Set([...Object.keys(oldEf.despacho), ...Object.keys(newEf.despacho)]).forEach(s => {
    despacho[s] = +( (despacho[s] ?? 0) + ((newEf.despacho[s]||0) - (oldEf.despacho[s]||0)) ).toFixed(4);
  });

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const batch = writeBatch(db);
    batch.update(doc(db,"productos",prod.id), { stock_deposito: nuevoAcopio, stock_despacho: despacho });
    batch.update(doc(db,"movimientos",m.id), {
      motivo: obs ? `${nuevo} — ${obs}` : nuevo,
      destino: newDestino,
      corregido: true,
      motivo_anterior: m.motivo,
      fecha_correccion: serverTimestamp()
    });
    await batch.commit();
    // Copias locales
    prod.stock_deposito = nuevoAcopio;
    prod.stock_despacho = despacho;
    m.motivo  = obs ? `${nuevo} — ${obs}` : nuevo;
    m.destino = newDestino;
    m.corregido = true;

    cerrarModal("modal-editar-motivo");
    cargarMovRecientes();
    renderStock();
    if (movimientosCached.length) renderHistorial();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Aplicar corrección"; }
});

// ── USUARIOS ──────────────────────────────────────────────────
function escucharUsuarios() {
  onSnapshot(collection(db,"usuarios"), snap => {
    renderUsuarios(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

function renderUsuarios(usuarios) {
  const cont = document.getElementById("lista-usuarios");
  if (!usuarios.length) { cont.innerHTML = '<div class="empty-state"><p>Sin usuarios.</p></div>'; return; }
  usuarios.sort((a,b) => (b.activo?1:0)-(a.activo?1:0));
  cont.innerHTML = usuarios.map(u => {
    const ini = u.nombre ? u.nombre.split(" ").map(p=>p[0]).join("").toUpperCase().slice(0,2) : "?";
    return `<div class="usuario-row ${!u.activo?"usuario-desactivado":""}">
      <div class="usuario-avatar">${escHtml(ini)}</div>
      <div class="usuario-info">
        <div class="usuario-nombre">${escHtml(u.nombre)}</div>
        <div class="usuario-email">${escHtml(u.email)}</div>
        <span class="badge badge-entrada" style="margin-top:4px;display:inline-block;">${escHtml(u.rol)}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
        <button class="btn-icono" onclick="abrirEditarUsuario('${u.id}')">✏️</button>
        <div class="toggle ${u.activo?"on":""}" onclick="toggleUsuario('${u.id}',${u.activo})"></div>
      </div>
    </div>`;
  }).join("");
}

document.getElementById("btn-nuevo-usuario").addEventListener("click", () => {
  document.getElementById("modal-usuario-titulo").textContent = "Nuevo usuario";
  document.getElementById("usr-id").value       = "";
  document.getElementById("usr-modo").value     = "crear";
  document.getElementById("usr-nombre").value   = "";
  document.getElementById("usr-email").value    = "";
  document.getElementById("usr-password").value = "";
  document.getElementById("grupo-email").style.display    = "";
  document.getElementById("grupo-password").style.display = "";
  document.getElementById("grupo-rol").style.display      = "none";
  document.getElementById("msg-usuario").classList.remove("show");
  abrirModal("modal-usuario");
});

window.abrirEditarUsuario = async (id) => {
  const snap = await getDocs(collection(db,"usuarios"));
  const u    = snap.docs.find(d => d.id === id)?.data(); if (!u) return;
  document.getElementById("modal-usuario-titulo").textContent = "Editar usuario";
  document.getElementById("usr-id").value     = id;
  document.getElementById("usr-modo").value   = "editar";
  document.getElementById("usr-nombre").value = u.nombre;
  document.getElementById("usr-email").value  = u.email;
  document.getElementById("usr-rol").value    = u.rol;
  document.getElementById("grupo-email").style.display    = "none";
  document.getElementById("grupo-password").style.display = "none";
  document.getElementById("grupo-rol").style.display      = "";
  document.getElementById("msg-usuario").classList.remove("show");
  abrirModal("modal-usuario");
};

document.getElementById("btn-guardar-usuario").addEventListener("click", async () => {
  const modo     = document.getElementById("usr-modo").value;
  const id       = document.getElementById("usr-id").value;
  const nombre   = document.getElementById("usr-nombre").value.trim();
  const email    = document.getElementById("usr-email").value.trim();
  const password = document.getElementById("usr-password").value;
  const rol      = document.getElementById("usr-rol").value;
  const msgEl    = document.getElementById("msg-usuario");
  const btn      = document.getElementById("btn-guardar-usuario");
  if (!nombre) { mostrarMsg(msgEl,"error","El nombre es obligatorio."); return; }
  if (modo === "crear" && (!email || !password)) { mostrarMsg(msgEl,"error","Email y contraseña son obligatorios."); return; }
  if (modo === "crear" && password.length < 6) { mostrarMsg(msgEl,"error","Contraseña mínimo 6 caracteres."); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    if (modo === "crear") {
      const cred = await createUserWithEmailAndPassword(authSec, email, password);
      await setDoc(doc(db,"usuarios",cred.user.uid), { nombre, email, rol: "Cargador Salidas", activo: true });
      await signOutSec(authSec);
      mostrarMsg(msgEl,"ok","Usuario creado como Cargador Salidas. Editalo para cambiar el rol.");
      setTimeout(() => cerrarModal("modal-usuario"), 2000);
    } else {
      await updateDoc(doc(db,"usuarios",id), { nombre, rol });
      mostrarMsg(msgEl,"ok","Usuario actualizado.");
      setTimeout(() => cerrarModal("modal-usuario"), 1000);
    }
  } catch(err) {
    const cod = err.code || "";
    let msg = "Error al guardar.";
    if (cod.includes("email-already-in-use")) msg = "Ese email ya está registrado.";
    else if (cod.includes("invalid-email"))   msg = "Email inválido.";
    else if (cod.includes("weak-password"))   msg = "Contraseña muy débil.";
    mostrarMsg(msgEl,"error",msg);
  } finally { btn.disabled = false; btn.innerHTML = "Guardar usuario"; }
});

window.toggleUsuario = async (id, actual) => { await updateDoc(doc(db,"usuarios",id), { activo: !actual }); };

// ── HISTORIAL ─────────────────────────────────────────────────
async function cargarHistorial() {
  const cont = document.getElementById("lista-historial");
  cont.innerHTML = '<div class="empty-state"><div class="spinner spinner-verde"></div></div>';
  const snap = await getDocs(query(collection(db,"movimientos"), orderBy("fecha_hora","desc"), limit(200)));
  movimientosCached = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  movimientosCached.forEach(m => { movIndex[m.id] = m; });
  poblarFiltrosHist();
  renderHistorial();
}

function poblarFiltrosHist() {
  const usrs  = [...new Set(movimientosCached.map(m=>m.nombre_usuario).filter(Boolean))].sort();
  const prods = [...new Set(movimientosCached.map(m=>m.nombre_producto).filter(Boolean))].sort();
  document.getElementById("filtro-hist-usuario").innerHTML  = '<option value="">Todos los usuarios</option>'  + usrs.map(u=>`<option value="${u}">${u}</option>`).join("");
  document.getElementById("filtro-hist-producto").innerHTML = '<option value="">Todos los productos</option>' + prods.map(p=>`<option value="${p}">${p}</option>`).join("");
}

function aplicarFiltros() {
  const tipo  = document.getElementById("filtro-hist-tipo").value;
  const usr   = document.getElementById("filtro-hist-usuario").value;
  const prod  = document.getElementById("filtro-hist-producto").value;
  const desde = document.getElementById("filtro-hist-desde").value;
  const hasta = document.getElementById("filtro-hist-hasta").value;
  let lista   = [...movimientosCached];
  if (tipo)  lista = lista.filter(m => m.tipo === tipo);
  if (usr)   lista = lista.filter(m => m.nombre_usuario === usr);
  if (prod)  lista = lista.filter(m => m.nombre_producto === prod);
  if (desde) lista = lista.filter(m => { const ts = m.fecha_hora?.toDate?.(); return ts && ts >= new Date(desde + "T00:00:00"); });
  if (hasta) lista = lista.filter(m => { const ts = m.fecha_hora?.toDate?.(); return ts && ts <= new Date(hasta + "T23:59:59"); });
  return lista;
}

function renderHistorial() {
  const cont  = document.getElementById("lista-historial");
  const lista = aplicarFiltros();
  if (!lista.length) { cont.innerHTML = '<div class="empty-state"><p>Sin resultados.</p></div>'; return; }
  cont.innerHTML = lista.map(filaMovimiento).join("");
}

document.getElementById("btn-aplicar-filtros").addEventListener("click", renderHistorial);
document.getElementById("btn-limpiar-filtros").addEventListener("click", () => {
  ["filtro-hist-tipo","filtro-hist-usuario","filtro-hist-producto","filtro-hist-desde","filtro-hist-hasta"].forEach(id => document.getElementById(id).value = "");
  renderHistorial();
});

document.getElementById("btn-exportar-excel").addEventListener("click", async () => {
  const lista = aplicarFiltros();
  if (!lista.length) { alert("No hay datos para exportar."); return; }
  const btn = document.getElementById("btn-exportar-excel");
  btn.disabled = true; btn.textContent = "Generando...";
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
  const filas = lista.map(m => {
    const ts = m.fecha_hora?.toDate?.();
    return { "Fecha": ts?ts.toLocaleDateString("es-AR"):"—","Hora":ts?ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}):"—","Producto":m.nombre_producto||"—","Tipo":m.tipo||"—","Cantidad":m.cantidad??0,"Unidad":m.unidad||"—","Origen":m.origen||"—","Destino":m.destino||"—","Motivo":m.motivo||"—","Usuario":m.nombre_usuario||"—" };
  });
  const ws = XLSX.utils.json_to_sheet(filas);
  ws["!cols"] = [{wch:12},{wch:8},{wch:28},{wch:20},{wch:10},{wch:10},{wch:15},{wch:15},{wch:35},{wch:20}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Historial");
  XLSX.writeFile(wb, `historial-green-garden-${new Date().toLocaleDateString("es-AR").replace(/\//g,"-")}.xlsx`);
  btn.disabled = false; btn.textContent = "📥 Exportar a Excel";
});

// ── CONFIRMACIÓN Y UTILIDADES ─────────────────────────────────
function mostrarConfirm(texto, cb) {
  document.getElementById("confirm-texto").textContent = texto;
  confirmCallback = cb;
  abrirModal("modal-confirm");
}
document.getElementById("btn-confirm-ok").addEventListener("click", async () => {
  if (confirmCallback) { await confirmCallback(); confirmCallback = null; }
  cerrarModal("modal-confirm");
});

function aDatetimeLocal(d) {
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mostrarMsg(el, tipo, texto) {
  el.textContent = texto;
  el.className = `msg show msg-${tipo === "error" ? "error" : "ok"}`;
}

// ── AJUSTE DE INVENTARIO ──────────────────────────────────────
document.getElementById("btn-mov-importar").addEventListener("click", abrirImportador);

// El botón Ajuste ahora abre un menú de elección
document.getElementById("btn-mov-ajuste").addEventListener("click", () => {
  abrirModal("modal-ajuste-tipo");
});

// Opción: Ajuste rápido (de a un producto) → modal viejo
document.getElementById("btn-ajuste-rapido").addEventListener("click", () => {
  cerrarModal("modal-ajuste-tipo");
  poblarSelect("ajt-producto");
  document.getElementById("ajt-busqueda").value = "";
  document.getElementById("ajt-stock").value = "";
  document.getElementById("ajt-motivo").value = "";
  actualizarUnidad("ajt-producto","ajt-unidad");
  setupBuscador("ajt-busqueda","ajt-producto","ajt-unidad", poblarUbicacionesAjuste);
  poblarUbicacionesAjuste();
  document.getElementById("ajt-ubicacion").onchange = actualizarActualAjuste;
  document.getElementById("msg-ajuste").classList.remove("show");
  abrirModal("modal-ajuste");
});

// Opción: Conteo físico → sub-pantalla dentro de Movimientos
document.getElementById("btn-ajuste-conteo").addEventListener("click", () => {
  cerrarModal("modal-ajuste-tipo");
  document.getElementById("pantalla-movimientos-normal").style.display = "none";
  document.getElementById("pantalla-conteo").style.display = "";
  setProductosConteo(productos);
  abrirConteo();
});

// Volver de conteo a movimientos
document.getElementById("conteo-btn-volver").addEventListener("click", () => {
  document.getElementById("pantalla-conteo").style.display = "none";
  document.getElementById("pantalla-movimientos-normal").style.display = "";
});

document.getElementById("btn-confirmar-ajuste").addEventListener("click", async () => {
  const prodId     = document.getElementById("ajt-producto").value;
  const nuevoStock = parseFloat(document.getElementById("ajt-stock").value);
  const motivo     = document.getElementById("ajt-motivo").value.trim();
  const ubic       = document.getElementById("ajt-ubicacion").value;
  const msgEl      = document.getElementById("msg-ajuste");
  const btn        = document.getElementById("btn-confirmar-ajuste");
  const prod       = productos.find(p => p.id === prodId);
  if (!prod || isNaN(nuevoStock)) { mostrarMsg(msgEl,"error","Ingresá el nuevo stock."); return; }
  if (!ubic) { mostrarMsg(msgEl,"error","Elegí la ubicación a ajustar."); return; }
  if (!motivo) { mostrarMsg(msgEl,"error","El motivo es obligatorio para un ajuste."); return; }

  // Determinar el balde a ajustar
  let stockAnterior, update, lugar;
  if (ubic === "acopio") {
    stockAnterior = prod.stock_deposito ?? 0;
    update = { stock_deposito: nuevoStock };
    lugar = "acopio";
  } else {
    const sector = ubic.slice(5); // saca "desp:"
    const desp = { ...(prod.stock_despacho || {}) };
    stockAnterior = desp[sector] ?? 0;
    desp[sector] = nuevoStock;
    update = { stock_despacho: desp };
    lugar = sector;
  }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    await updateDoc(doc(db,"productos",prodId), update);
    await addDoc(collection(db,"movimientos"), {
      fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid,
      nombre_usuario: usuarioActual.nombre, id_producto: prodId,
      nombre_producto: prod.nombre, tipo: "AJUSTE",
      cantidad: Math.abs(nuevoStock - stockAnterior), unidad: prod.unidad_medida,
      motivo: `Ajuste ${lugar}: ${motivo} (${stockAnterior} → ${nuevoStock})`, origen: lugar, destino: lugar
    });
    mostrarMsg(msgEl,"ok",`✓ ${lugar} ajustado de ${stockAnterior} a ${nuevoStock} ${prod.unidad_medida}.`);
    cargarMovRecientes();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Aplicar ajuste"; }
});

// ── Sello de versión (autocontenido, no depende de version.js) ──
(function () {
  let v = document.querySelector(".app-version");
  if (!v) { v = document.createElement("div"); (document.body || document.documentElement).appendChild(v); }
  v.textContent = "v3.8.7";
  v.style.cssText = "position:fixed;bottom:8px;right:10px;font:600 11px/1 ui-monospace,monospace;color:#9a7f43;background:rgba(248,244,234,0.92);border:1px solid #ddd0b8;padding:3px 9px;border-radius:20px;z-index:99999;pointer-events:none;letter-spacing:0.5px;box-shadow:0 1px 4px rgba(0,0,0,0.08);";
})();
