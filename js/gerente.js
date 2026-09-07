// ============================================================
// gerente.js — Panel Gerente v3.0
// Modelo: tipo de producto (Despacho / Materia prima)
// Retiro inteligente según tipo y sectores asignados
// ============================================================

import { auth, db, firebaseConfig } from "./firebase-config.js";
import { protegerRuta, logout } from "./auth.js";
import { initImportador, abrirImportador, actualizarProductosImportador } from "./importador-ventas.js";
import { renderResumen, badgeProducto, calcularResumen, debeAvanzar, formatearFecha } from "./corte-ventas.js";
import { initConteo, abrirConteo, setProductosConteo } from "./conteo-fisico.js";
import { calcularConsumoProduccion, agregarConsumoAlBatch } from "./produccion.js";
import {
  escHtml, fmtN, esDespacho, esReceta, sectoresDe, stockTotal, getBadge, acopioBajoOcero,
  origenRetiroActual, aDatetimeLocal, MOTIVOS_SALIDA_DEFAULT, poblarMotivosSalida,
  instalarCandadoMotivoReposicion, ordenarMotivos
} from "./core-inventario.js";
import { icono } from "./iconos.js";
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch, increment
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
let lotesCache        = [];   // lotes de importación (cargas masivas de ventas)
let usuarioActual     = null;
let confirmCallback   = null;

// Estado del editor de recetas
function freshRecetaState() {
  return { porVariantes: false, simple: { sector: "", ingredientes: [] }, variantes: [] };
}
let recetaState = freshRecetaState();

let motivosSalida = [...MOTIVOS_SALIDA_DEFAULT];


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
  cargarCargasImportadas();
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
      <button class="btn-icono danger" onclick="eliminarItem('rubros','${r.id}','${escJs(r.nombre)}')">${icono("eliminar",{size:16})}</button>
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
      <button class="btn-icono danger" onclick="eliminarItem('sectores','${s.id}','${escJs(s.nombre)}')">${icono("eliminar",{size:16})}</button>
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
      <button class="btn-icono danger" onclick="eliminarItem('sectores_despacho','${s.id}','${escJs(s.nombre)}')">${icono("eliminar",{size:16})}</button>
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
  cont.innerHTML = ordenarMotivos(motivosSalida).map(m => `
    <div class="config-item">
      <span>${escHtml(m.nombre)} ${m.transfiere ? '<span style="font-size:0.65rem;background:var(--verde-claro);color:var(--verde);padding:2px 8px;border-radius:10px;font-weight:600;">→ despacho</span>' : ""}</span>
      ${m.id ? `<button class="btn-icono danger" onclick="eliminarItem('motivos_salida','${m.id}','${escJs(m.nombre)}')">${icono("eliminar",{size:16})}</button>` : ""}
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
  initImportador({ productos, usuarioActual, onTerminado: () => { cargarMovRecientes(); cargarCargasImportadas(); renderResumen("indicador-corte", productos); renderStock(); } });
  initConteo({ usuarioActual, onAplicado: () => { cargarMovRecientes(); } });
}

document.getElementById("filtro-sector").addEventListener("change", renderStock);
document.getElementById("filtro-rubro").addEventListener("change", renderStock);
document.getElementById("filtro-busqueda").addEventListener("input", renderStock);
document.getElementById("prod-buscar").addEventListener("input", renderProductos);

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
      ? `<span style="font-size:0.65rem;background:var(--verde-claro);color:var(--verde);padding:2px 8px;border-radius:10px;font-weight:600;display:inline-flex;align-items:center;gap:3px;">${icono("despacho",{size:12})} Despacho</span>`
      : `<span style="font-size:0.65rem;background:var(--bg-secondary);color:var(--texto-3);padding:2px 8px;border-radius:10px;font-weight:600;display:inline-flex;align-items:center;gap:3px;">${icono("materia",{size:12})} Mat. prima</span>`;
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
      <div style="font-size:0.78rem;color:var(--texto-3);display:flex;align-items:center;gap:4px;flex-wrap:wrap;">${icono("acopio",{size:13})} Acopio: <strong style="color:var(--texto-2);">${fmtN(dep)}</strong> ${desglose?`· ${desglose}`:""}</div>
      ${badgeProducto(p, _masReciente) ? `<div style="margin-top:2px;">${badgeProducto(p, _masReciente)}</div>` : ""}
    </div>`;
  }).join("");
  // Refrescar el resumen cada vez que se renderiza el stock
  renderResumen("indicador-corte", productos);
}

function renderProductos() {
  const cont = document.getElementById("lista-productos");
  if (!productos.length) { cont.innerHTML = '<div class="empty-state"><p>Sin productos.</p></div>'; return; }
  // Buscador del catálogo: filtra por nombre o PLU para encontrar rápido qué editar.
  const q = (document.getElementById("prod-buscar")?.value || "").trim().toLowerCase();
  const lista = q
    ? productos.filter(p => (p.nombre || "").toLowerCase().includes(q) || String(p.plu ?? "").toLowerCase().includes(q))
    : productos;
  if (!lista.length) { cont.innerHTML = '<div class="empty-state"><p>Sin resultados para "' + escHtml(q) + '".</p></div>'; return; }
  cont.innerHTML = lista.map(p => {
    const tipoIcon = esReceta(p) ? icono("receta",{size:15}) : esDespacho(p) ? icono("despacho",{size:15}) : icono("materia",{size:15});
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
        <button class="btn-icono" onclick="abrirEditarProducto('${p.id}')">${icono("editar",{size:16})}</button>
        <button class="btn-icono danger" onclick="eliminarItem('productos','${p.id}','${escJs(p.nombre)}')">${icono("eliminar",{size:16})}</button>
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
  // Receta de PRODUCCIÓN: solo para productos con stock (Despacho / Materia prima),
  // que son los que se elaboran con un Ingreso Producción. Las recetas de barra no.
  document.getElementById("grupo-receta-produccion").style.display               = esRec ? "none" : "";
  if (esRec) {
    document.getElementById("prod-receta-varia").checked = recetaState.porVariantes;
    renderRecetaEditor();
  } else {
    renderRecetaProd();
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
          <button type="button" class="btn-icono danger" data-action="del-ing" data-target="${target}" data-idx="${i}" style="padding:2px 7px;">${icono("eliminar",{size:16})}</button>
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
    : `<div style="font-size:0.78rem;color:var(--bajo-txt,#b45309);background:var(--bg-secondary);border:1px dashed var(--borde);border-radius:8px;padding:10px 12px;">${icono("alerta",{size:13})} No hay productos cargados todavía. Creá primero los productos que componen la receta (ej. Gin, Tónica, Barril).</div>`;
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
        <button type="button" class="btn-icono danger" data-action="del-var" data-idx="${idx}" style="padding:4px 9px;">${icono("eliminar",{size:16})}</button>
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

// ── EDITOR DE RECETA DE PRODUCCIÓN (insumos consumidos al Ingreso Producción) ──
// Lista plana de insumos POR PORCIÓN. Mismo formato de ingrediente que las recetas
// de barra { id, nombre, cantidad(base), unidad, cant_in, unidad_in }, pero se
// consume al PRODUCIR (no al vender). El descuento vive en produccion.js.
let recetaProdState = [];

function renderRecetaProdLista() {
  const cont = document.getElementById("prodrec-lista");
  if (!recetaProdState.length) {
    cont.innerHTML = '<p style="font-size:0.76rem;color:var(--texto-3);margin:0;">Sin insumos. Este producto no descuenta nada al producirse.</p>';
    return;
  }
  cont.innerHTML = recetaProdState.map((ing, i) => {
    const disp = (ing.cant_in != null && ing.unidad_in) ? `${ing.cant_in} ${escHtml(ing.unidad_in)}` : `${ing.cantidad} ${escHtml(ing.unidad)}`;
    const conv = (ing.unidad_in && ing.unidad_in !== ing.unidad)
      ? ` <span style="color:var(--texto-3);font-size:0.72rem;">(= ${+(+ing.cantidad).toFixed(4)} ${escHtml(ing.unidad)})</span>` : "";
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;${i>0?'border-top:1px solid var(--borde);':''}">
      <span style="font-size:0.83rem;">${disp.replace(/^(\S+)/, '<strong>$1</strong>')} de ${escHtml(ing.nombre)}${conv} <span style="color:var(--texto-3);">/ porción</span></span>
      <button type="button" class="btn-icono danger" data-idx="${i}" style="padding:2px 7px;">${icono("eliminar",{size:16})}</button>
    </div>`;
  }).join("");
}

// Repuebla el select de insumos (optsIngredientes ya excluye recetas; además saca el propio producto)
function prodrecPoblarMat(filtro = "") {
  const sel = document.getElementById("prodrec-mat");
  const propioId = document.getElementById("prod-id").value;
  sel.innerHTML = optsIngredientes(filtro);
  if (propioId) [...sel.options].forEach(o => { if (o.value === propioId) o.remove(); });
  const t = (filtro || "").trim();
  const primerReal = [...sel.options].find(o => o.value);
  if (t && primerReal) sel.value = primerReal.value;
  const prod = productos.find(p => p.id === sel.value);
  document.getElementById("prodrec-unidad").innerHTML = optsUnidadIngrediente(prod);
  actualizarHintProdrec();
}

function actualizarHintProdrec() {
  const hint = document.getElementById("prodrec-hint");
  const prod = productos.find(p => p.id === document.getElementById("prodrec-mat").value);
  const cant = parseFloat(document.getElementById("prodrec-cant").value);
  const uni  = document.getElementById("prodrec-unidad").value;
  if (!prod || isNaN(cant) || cant <= 0) { hint.textContent = ""; return; }
  const esSub = prod.rendimiento > 0 && prod.subunidad && uni === prod.subunidad;
  hint.textContent = esSub ? `= ${+(cant / prod.rendimiento).toFixed(4)} ${prod.unidad_medida || ""} por porción (lo que se descuenta)` : "";
}

function renderRecetaProd() {
  renderRecetaProdLista();
  prodrecPoblarMat(document.getElementById("prodrec-buscar")?.value || "");
}

document.getElementById("prodrec-buscar").addEventListener("input", (e) => { prodrecPoblarMat(e.target.value); });
document.getElementById("prodrec-mat").addEventListener("change", () => {
  const prod = productos.find(p => p.id === document.getElementById("prodrec-mat").value);
  document.getElementById("prodrec-unidad").innerHTML = optsUnidadIngrediente(prod);
  actualizarHintProdrec();
});
document.getElementById("prodrec-cant").addEventListener("input", actualizarHintProdrec);
document.getElementById("prodrec-unidad").addEventListener("change", actualizarHintProdrec);
document.getElementById("prodrec-lista").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-idx]"); if (!btn) return;
  recetaProdState.splice(+btn.dataset.idx, 1);
  renderRecetaProdLista();
});
document.getElementById("prodrec-add").addEventListener("click", () => {
  const msgEl = document.getElementById("msg-producto");
  const id = document.getElementById("prodrec-mat").value;
  const cant = parseFloat(document.getElementById("prodrec-cant").value);
  const propioId = document.getElementById("prod-id").value;
  if (!id) { mostrarMsg(msgEl, "error", "Elegí un insumo del desplegable."); return; }
  if (id === propioId) { mostrarMsg(msgEl, "error", "Un producto no puede ser insumo de sí mismo."); return; }
  if (isNaN(cant) || cant <= 0) { mostrarMsg(msgEl, "error", "Poné una cantidad válida."); return; }
  if (recetaProdState.some(i => i.id === id)) { mostrarMsg(msgEl, "error", "Ese insumo ya está en la receta."); return; }
  const mat = productos.find(p => p.id === id);
  if (!mat) return;
  const unidadElegida = document.getElementById("prodrec-unidad").value || mat.unidad_medida || "";
  const esSub = mat.rendimiento > 0 && mat.subunidad && unidadElegida === mat.subunidad;
  const base  = esSub ? (cant / mat.rendimiento) : cant;
  recetaProdState.push({
    id, nombre: mat.nombre,
    cantidad: +base.toFixed(6),
    unidad: mat.unidad_medida || "",
    cant_in: cant,
    unidad_in: unidadElegida
  });
  document.getElementById("prodrec-cant").value = "";
  document.getElementById("prodrec-hint").textContent = "";
  msgEl.classList.remove("show");
  renderRecetaProdLista();
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
  recetaProdState = [];
  document.getElementById("prodrec-buscar").value = "";
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
  // Receta de producción (solo productos con stock): copia editable
  recetaProdState = (p.receta_produccion || []).map(i => ({ ...i }));
  document.getElementById("prodrec-buscar").value = "";
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

// Cuando cambia el rendimiento (o la subunidad / unidad base) de una materia prima,
// las recetas que la usan "en subunidad" tienen su cantidad BASE —lo que descuenta
// del stock el importador— calculada con el rendimiento VIEJO. Acá las recalculamos:
// cantidad = cant_in / rendimiento_nuevo, y refrescamos las etiquetas de display.
// Antes había que reabrir y volver a guardar cada receta a mano.
async function recalcularRecetasPorRendimiento(prodId, nuevoRend, nuevaSub, nuevaUnidadBase, nuevoNombre) {
  if (!(nuevoRend > 0)) return; // sin rendimiento válido no hay conversión de subunidad
  const fix = (ings) => {
    let cambio = false;
    const out = (ings || []).map(ing => {
      // Sólo ingredientes de ESTE producto ingresados en subunidad (unidad_in ≠ unidad base).
      if (ing.id !== prodId || ing.cant_in == null || !ing.unidad_in || ing.unidad_in === ing.unidad) return ing;
      const nueva = { ...ing, cantidad: +(+ing.cant_in / nuevoRend).toFixed(6) };
      if (nuevoNombre) nueva.nombre = nuevoNombre;
      if (nuevaUnidadBase) nueva.unidad = nuevaUnidadBase;
      if (nuevaSub) nueva.unidad_in = nuevaSub;
      cambio = cambio || (nueva.cantidad !== ing.cantidad || nueva.nombre !== ing.nombre ||
                          nueva.unidad !== ing.unidad || nueva.unidad_in !== ing.unidad_in);
      return nueva;
    });
    return cambio ? out : null;
  };
  for (const r of productos.filter(esReceta)) {
    if (r.por_variantes) {
      let algun = false;
      const variantes = (r.variantes || []).map(v => {
        const nuevos = fix(v.ingredientes);
        if (nuevos) { algun = true; return { ...v, ingredientes: nuevos }; }
        return v;
      });
      if (algun) await updateDoc(doc(db, "productos", r.id), { variantes });
    } else {
      const nuevos = fix(r.ingredientes);
      if (nuevos) await updateDoc(doc(db, "productos", r.id), { ingredientes: nuevos });
    }
  }
  // También las recetas de PRODUCCIÓN que usan este insumo en subunidad.
  for (const p of productos) {
    if (!(p.receta_produccion && p.receta_produccion.length) || p.id === prodId) continue;
    const nuevos = fix(p.receta_produccion);
    if (nuevos) await updateDoc(doc(db, "productos", p.id), { receta_produccion: nuevos });
  }
}

document.getElementById("btn-guardar-producto").addEventListener("click", async () => {
  const id      = document.getElementById("prod-id").value;
  const prev    = id ? productos.find(x => x.id === id) : null;
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
  // Receta de producción: solo la guardan los productos con stock (no las recetas de barra).
  const recetaProdData = { receta_produccion: (tipo !== "Receta") ? recetaProdState.map(i => ({ ...i })) : [] };
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
      // Editar: actualizar SOLO metadatos y sectores asignados. NUNCA reescribir
      // el mapa stock_despacho: ese stock lo administran EXCLUSIVAMENTE los
      // movimientos (reposición, venta, conteo, ajuste) con increments/escrituras
      // por sector. Antes se reconstruía el mapa entero desde el cache local y se
      // guardaba absoluto → si el cache estaba un instante atrasado, una
      // reposición recién hecha (ej. 10 a Barra) se PISABA con 0 y desaparecía.
      // Los sectores nuevos se autocompletan en 0 en su primera operación (todas
      // las lecturas usan `?? 0`); un sector que se desasigna conserva su stock en
      // la base (mejor que borrarlo en silencio).
      const update = {
        nombre, plu, rubro, sector, unidad_medida: unidad, tipo,
        sectores_asignados: tipo === "Despacho" ? seleccionados : [],
        ...minData,
        ...fraccionData,
        ...recetaProdData,
        ...datosReceta
      };
      // Si el producto deja de ser de Despacho, su mapa de despacho ya no aplica.
      if (tipo !== "Despacho") update.stock_despacho = {};
      await updateDoc(doc(db, "productos", id), update);
      // Si cambió el rendimiento/subunidad/unidad base, recalcular las recetas que lo usan.
      if (tipo !== "Receta" && prev) {
        const cambioFraccion =
          (prev.rendimiento ?? null) !== (fraccionData.rendimiento ?? null) ||
          (prev.subunidad ?? null)   !== (fraccionData.subunidad ?? null)   ||
          (prev.unidad_medida ?? null) !== unidad;
        if (cambioFraccion) {
          await recalcularRecetasPorRendimiento(id, fraccionData.rendimiento, fraccionData.subunidad, unidad, nombre);
        }
      }
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
        ...recetaProdData,
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
    // Si es Ingreso Producción y el producto tiene receta de producción, se
    // descuentan los insumos del acopio en el MISMO batch (atómico).
    const consumos = (tipo === "INGRESO_PRODUCCION") ? calcularConsumoProduccion(prod, cantidad) : [];
    const batch = writeBatch(db);
    const movRef = doc(collection(db,"movimientos"));
    batch.set(movRef, {
      fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid || null,
      nombre_usuario: usuarioActual.nombre, id_producto: prodId,
      nombre_producto: prod.nombre, tipo, cantidad, unidad: prod.unidad_medida,
      motivo: obs ? `${motivo} — ${obs}` : motivo, origen: "externo", destino: "acopio",
      ...(consumos.length ? { consumo_produccion: consumos } : {})
    });
    batch.update(doc(db,"productos",prodId), { stock_deposito: increment(cantidad) });
    agregarConsumoAlBatch(batch, { plato: prod, consumos, produccionId: movRef.id,
      usuarioNombre: usuarioActual.nombre, existe: (pid) => productos.some(p => p.id === pid) });
    await batch.commit();
    const extra = consumos.length ? ` · ${consumos.length} insumo(s) descontado(s)` : "";
    mostrarMsg(msgEl,"ok",`✓ ${cantidad} ${prod.unidad_medida} ingresados al acopio${extra}.`);
    document.getElementById("ent-cantidad").value = "1";
    cargarMovRecientes();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Registrar entrada"; }
});

// ── RETIRO INTELIGENTE v3.5 ───────────────────────────────────
function actualizarInfoRetiro() {
  const prod = productos.find(p => p.id === document.getElementById("sal-producto").value);
  poblarMotivosSalida(productos, motivosSalida);
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
      infoDestino.innerHTML = `<div style="background:var(--verde-claro);border:1px solid var(--verde-suave);border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--texto-2);">${icono("reposicion",{size:14})} ${motivoObj.nombre} — el stock irá automáticamente a <strong style="color:var(--verde);">${sects[0]}</strong></div>`;
    } else {
      grupoSector.style.display = "none";
      infoDestino.style.display = "";
      infoDestino.innerHTML = `<div style="background:var(--bajo-bg);border:1px solid #F0D9B5;border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--bajo-txt);">${icono("alerta",{size:13})} Producto de despacho sin sector asignado.</div>`;
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

// Al volver a la app, reasegura el motivo por defecto del retiro (el primero en orden, el "1 -").
instalarCandadoMotivoReposicion(actualizarInfoRetiro);

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
        [`stock_despacho.${origen}`]: increment(-cantidad)
      });
      await addDoc(collection(db,"movimientos"), {
        fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid || null,
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
        stock_deposito: increment(-cantidad),
        [`stock_despacho.${destino}`]: increment(cantidad)
      });
      await batch.commit();
    } else {
      // Materia prima o consumo: solo descuenta acopio
      await updateDoc(doc(db,"productos",prodId), { stock_deposito: increment(-cantidad) });
    }

    await addDoc(collection(db,"movimientos"), {
      fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid || null,
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
    await updateDoc(doc(db,"productos",prodId), { [`stock_despacho.${sector}`]: increment(-cantidad) });
    await addDoc(collection(db,"movimientos"), {
      fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid || null,
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
const LABELS_MOV  = { INGRESO_PROVEEDOR:"↑ Proveedor", INGRESO_PRODUCCION:"↑ Producción", RETIRO:"↓ Retiro", VENTA:`${icono("venta",{size:12})} Venta`, AJUSTE:`${icono("ajuste",{size:12})} Ajuste` };

function filaMovimiento(m) {
  const ts    = m.fecha_hora?.toDate?.();
  const fecha = ts ? ts.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"}) : "—";
  const hora  = ts ? ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit",hour12:false}) : "";
  const color = COLORES_MOV[m.tipo] || "var(--texto-2)";
  const label = LABELS_MOV[m.tipo]  || escHtml(m.tipo);
  const destinoExtra = (m.tipo === "RETIRO" && m.destino && m.destino !== "produccion" && m.destino !== "consumo") ? ` → ${escHtml(m.destino)}` : "";
  const corregido = m.corregido ? ` <span style="font-size:0.62rem;background:var(--bg-secondary);color:var(--texto-3);padding:1px 6px;border-radius:5px;display:inline-flex;align-items:center;gap:3px;">${icono("editar",{size:10})} corregido</span>` : "";
  const esEntrada = m.tipo === "INGRESO_PROVEEDOR" || m.tipo === "INGRESO_PRODUCCION";
  const btnEditar = (m.tipo === "RETIRO" && m.id)
    ? `<button class="btn-icono" onclick="abrirEditarMotivo('${m.id}')" title="Editar retiro" style="padding:2px 7px;">${icono("editar",{size:16})}</button>`
    : (esEntrada && m.id)
    ? `<button class="btn-icono" onclick="abrirEditarEntrada('${m.id}')" title="Editar entrada" style="padding:2px 7px;">${icono("editar",{size:16})}</button>`
    : "";
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

// ── CARGAS DE VENTAS IMPORTADAS (lotes) — listar y ANULAR ─────
// Cada importación de Excel deja un "lote" con lo necesario para revertirla por
// completo. Acá se listan las cargas recientes y se puede anular una: se devuelve
// el stock descontado, se borran sus movimientos y se restaura la fecha de corte.
const _ms = (v) => v == null ? null : (v.toDate ? v.toDate().getTime() : (v instanceof Date ? v.getTime() : (isNaN(new Date(v)) ? null : new Date(v).getTime())));

async function cargarCargasImportadas() {
  const cont = document.getElementById("lista-cargas");
  if (!cont) return;
  const snap = await getDocs(query(collection(db,"lotes_importacion"), orderBy("fecha_hora","desc"), limit(15)));
  lotesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!lotesCache.length) { cont.innerHTML = '<div class="empty-state" style="padding:14px 0 18px;"><p style="font-size:0.82rem;">Todavía no importaste ventas desde Excel.</p></div>'; return; }
  cont.innerHTML = lotesCache.map(filaCarga).join("");
}

function filaCarga(l) {
  const ts    = l.fecha_hora?.toDate?.();
  const fecha = ts ? ts.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"}) : "—";
  const hora  = ts ? ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit",hour12:false}) : "";
  const desde = l.fecha_desde ? formatearFecha(l.fecha_desde, false) : null;
  const hasta = l.fecha_corte ? formatearFecha(l.fecha_corte, false) : null;
  const periodo = hasta ? (desde ? `${desde} → ${hasta}` : `hasta ${hasta}`) : "sin fecha de período";
  const ing = l.total_ingredientes ? ` · ${l.total_ingredientes} ${l.total_ingredientes===1?"ingrediente":"ingredientes"}` : "";
  const resumen = `${l.total_productos||0} ${(l.total_productos===1)?"producto":"productos"}${ing} · ${l.total_movimientos||0} mov.`;
  const accion = l.anulado
    ? `<span style="font-size:0.66rem;background:var(--bg-secondary);color:var(--critico-txt);padding:3px 9px;border-radius:10px;font-weight:700;white-space:nowrap;">Anulada</span>`
    : `<button class="btn-icono danger" onclick="anularCargaUI('${l.id}')" title="Anular esta carga y devolver el stock" style="font-size:0.72rem;font-weight:700;padding:5px 11px;width:auto;border:1px solid var(--critico-txt);border-radius:8px;color:var(--critico-txt);white-space:nowrap;">Anular</button>`;
  const anuladaMeta = l.anulado
    ? `<div style="font-size:0.7rem;color:var(--texto-3);margin-top:2px;">Anulada por ${escHtml(l.nombre_usuario_anulo || "—")}${l.fecha_anulacion?.toDate ? " · " + l.fecha_anulacion.toDate().toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"}) : ""}</div>`
    : "";
  return `<div class="mov-row" style="${l.anulado?'opacity:0.6;':''}">
    <div class="mov-header">
      <span class="mov-producto">${icono("corte",{size:13})} ${escHtml(periodo)}</span>
      <div style="display:flex;align-items:center;gap:8px;">${accion}</div>
    </div>
    <div class="mov-meta">${fecha} ${hora} · ${escHtml(resumen)} · ${escHtml(l.nombre_usuario||"—")}${anuladaMeta}</div>
  </div>`;
}

window.anularCargaUI = (loteId) => {
  const l = lotesCache.find(x => x.id === loteId);
  if (!l || l.anulado) return;
  const desde = l.fecha_desde ? formatearFecha(l.fecha_desde, false) : null;
  const hasta = l.fecha_corte ? formatearFecha(l.fecha_corte, false) : null;
  const periodo = hasta ? (desde ? `${desde} → ${hasta}` : `hasta ${hasta}`) : "sin fecha";
  mostrarConfirm(
    `¿Anular la carga de ventas (${periodo})? Se devolverá el stock descontado a ` +
    `${l.total_productos||0} producto(s), se borrarán sus ${l.total_movimientos||0} movimiento(s) ` +
    `y se restaurará la fecha de corte anterior. Después vas a poder volver a importar el reporte.`,
    () => anularCarga(l)
  );
};

async function anularCarga(l) {
  const cont = document.getElementById("lista-cargas");
  try {
    const MAX_OPS = 450;
    let batch = writeBatch(db);
    let ops = 0;
    const flushBatch = async () => { if (ops >= MAX_OPS) { await batch.commit(); batch = writeBatch(db); ops = 0; } };

    // 1) Revertir el stock: sumar el OPUESTO de cada delta aplicado.
    //    Además, dejamos un MOVIMIENTO de reversión por cada ajuste, para que el
    //    contador nunca cambie "en silencio": toda modificación de stock queda
    //    reflejada en el historial y es auditable (antes anular devolvía stock
    //    sin registrar nada, y el contador se despegaba del historial).
    const dLbl = l.fecha_corte ? formatearFecha(l.fecha_corte, false) : "sin fecha";
    const periodoLbl = l.fecha_desde ? `${formatearFecha(l.fecha_desde, false)} → ${dLbl}` : `hasta ${dLbl}`;
    for (const d of (l.deltas || [])) {
      const prod = productos.find(p => p.id === d.id_producto);
      if (!prod) continue;   // producto borrado: no se toca
      await flushBatch();
      batch.update(doc(db,"productos",d.id_producto), { [d.campo]: increment(-d.delta) });
      ops++;
      // Movimiento de reversión (informativo; el stock lo mueve el increment de arriba).
      const rev = -d.delta;                                   // lo que se devuelve al stock
      const mm = String(d.campo).match(/^stock_despacho\.(.+)$/);
      const sector = mm ? mm[1] : "acopio";                   // sector de despacho o acopio
      const entra = rev >= 0;                                 // ¿vuelve a entrar al sector?
      await flushBatch();
      batch.set(doc(collection(db,"movimientos")), {
        fecha_hora: serverTimestamp(),
        id_usuario: auth.currentUser?.uid || null,
        nombre_usuario: usuarioActual?.nombre || null,
        id_producto: prod.id,
        nombre_producto: prod.nombre,
        tipo: "ANULACION",
        cantidad: Math.abs(rev),
        unidad: prod.unidad_medida,
        motivo: `Anulación carga importación (${periodoLbl})`,
        origen: entra ? "anulacion" : sector,
        destino: entra ? sector : "anulacion",
        anulacion_lote_id: l.id
      });
      ops++;
    }

    // 2) Recalcular ventas_hasta de cada producto afectado.
    //    NO alcanza con restaurar el "anterior" guardado ni con comparar contra
    //    el corte de ESTA carga: si otras cargas (no anuladas) también cargaron
    //    ventas del mismo producto, su corte sigue vigente. Restaurar a ciegas
    //    dejaba ventas_hasta apuntando a una fecha vieja (o null) mientras las
    //    ventas de esas otras cargas seguían descontadas → el producto figuraba
    //    "sin ventas" y la guarda anti-doble-importación dejaba de proteger,
    //    habilitando un doble descuento silencioso en la próxima importación.
    //    Regla correcta: ventas_hasta = corte MÁS RECIENTE entre las cargas NO
    //    anuladas (excluida ésta) que cargaron ventas de ese producto; si no
    //    queda ninguna, se vuelve al valor previo a esta carga ("anterior").
    // Productos que cubre un lote: preferimos "productos_venta" (todos los que
    // recibieron ventas, avancen o no el corte); para lotes viejos sin ese campo,
    // caemos a los ids de "ventas_hasta_prev".
    const cubiertosDe = (lote) => (lote.productos_venta && lote.productos_venta.length)
      ? lote.productos_venta
      : (lote.ventas_hasta_prev || []).map(v => v.id_producto);
    const productosARecalcular = cubiertosDe(l);
    if (productosARecalcular.length) {
      // Todas las cargas NO anuladas, salvo la que estamos anulando.
      const otrasSnap = await getDocs(query(collection(db,"lotes_importacion"), where("anulado","==",false)));
      const otras = otrasSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.id !== l.id);
      // prodId → corte más reciente (ms) entre las cargas vigentes que lo cubren.
      const corteVigente = new Map();
      for (const otro of otras) {
        const oMs = _ms(otro.fecha_corte);
        if (oMs == null) continue;
        for (const pid of cubiertosDe(otro)) {
          const prev = corteVigente.get(pid);
          if (prev == null || oMs > prev) corteVigente.set(pid, oMs);
        }
      }
      // Valor previo por producto (solo lo tienen los que ESTA carga avanzó).
      const anteriorDe = new Map((l.ventas_hasta_prev || []).map(v => [v.id_producto, v.anterior ?? null]));
      for (const pid of productosARecalcular) {
        if (!productos.some(p => p.id === pid)) continue;   // producto borrado
        const vigenteMs = corteVigente.get(pid);
        // Otra carga vigente cubre este producto → dejamos SU corte (más reciente).
        // Ninguna → volvemos al valor previo a esta carga (o null).
        const nuevoValor = vigenteMs != null ? new Date(vigenteMs) : (anteriorDe.get(pid) ?? null);
        await flushBatch();
        batch.update(doc(db,"productos",pid), { ventas_hasta: nuevoValor });
        ops++;
      }
    }

    // 3) Borrar todos los movimientos de esta carga.
    const movSnap = await getDocs(query(collection(db,"movimientos"), where("lote_id","==",l.id)));
    for (const m of movSnap.docs) {
      await flushBatch();
      batch.delete(doc(db,"movimientos",m.id));
      ops++;
    }

    // 4) Marcar el lote como anulado (queda el registro; no se borra).
    await flushBatch();
    batch.update(doc(db,"lotes_importacion",l.id), {
      anulado: true,
      id_usuario_anulo: auth.currentUser?.uid || null,
      nombre_usuario_anulo: usuarioActual?.nombre || null,
      fecha_anulacion: serverTimestamp()
    });
    ops++;

    if (ops > 0) await batch.commit();

    // Refrescar UI (el onSnapshot de productos ya recalcula stock/corte).
    cargarCargasImportadas();
    cargarMovRecientes();
    if (movimientosCached.length) cargarHistorial();
  } catch (err) {
    if (cont) cont.innerHTML = `<div class="empty-state"><p style="color:var(--critico-txt);">Error al anular: ${escHtml(err.message)}</p></div>`;
  }
}

// ── EDITAR RETIRO (producto, cantidad, motivo) + ELIMINAR ─────
// Todo pasa por reverse + apply: se revierte por completo el efecto del
// movimiento ORIGINAL (su producto, cantidad, origen y destino reales) y se
// aplica el efecto del movimiento EDITADO (producto/cantidad/motivo nuevos).
// Si cambia el producto, la reversión toca el producto viejo y la aplicación
// el nuevo (dos documentos). Eliminar = solo revertir y borrar el movimiento.
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

// Producto y cantidad elegidos actualmente en el modal
const edmProdSel = () => productos.find(p => p.id === document.getElementById("edm-producto").value);
const edmCant    = () => parseFloat(document.getElementById("edm-cantidad").value);

// Llena el desplegable de productos (con buscador opcional), manteniendo la selección
function edmPoblarProductos(filtro) {
  const sel = document.getElementById("edm-producto");
  const actual = sel.value;
  const t = (filtro || "").toLowerCase();
  const lista = productos.slice().sort((a,b) => (a.nombre||"").localeCompare(b.nombre||""));
  const f = t ? lista.filter(p => (p.nombre||"").toLowerCase().includes(t)) : lista;
  sel.innerHTML = f.map(p => `<option value="${p.id}">${escHtml(p.nombre)}</option>`).join("");
  if (actual && f.some(p => p.id === actual)) sel.value = actual;
}

// Llena el desplegable de motivos según el producto elegido. Al ABRIR el modal
// (desdeMovimiento=true) parte SIEMPRE del motivo real del movimiento; si no,
// preserva la selección actual (cambio de producto dentro del modal). Sin esto,
// al reabrir para otro retiro el <select> conservaba el motivo del anterior.
function edmPoblarMotivos(desdeMovimiento = false) {
  const m = edmMov; if (!m) return;
  const prod = edmProdSel();
  const sel = document.getElementById("edm-motivo");
  const prev = desdeMovimiento
    ? (m.motivo || "").split(" — ")[0]
    : (sel.value || (m.motivo || "").split(" — ")[0]);
  const desdeDespacho = !!(m.origen && m.origen !== "acopio");
  // Materia prima o retiro desde despacho: no se puede reponer → solo motivos sin transferencia
  let opciones = motivosSalida;
  if ((prod && !esDespacho(prod)) || desdeDespacho) opciones = motivosSalida.filter(x => !x.transfiere);
  opciones = ordenarMotivos(opciones);
  sel.innerHTML = opciones.map(x => `<option value="${escHtml(x.nombre)}" ${x.nombre===prev?"selected":""}>${escHtml(x.nombre)}${x.transfiere?" (→ despacho)":""}</option>`).join("");
  if (!opciones.some(x => x.nombre === prev) && opciones[0]) sel.value = opciones[0].nombre;
}

window.abrirEditarMotivo = (id) => {
  const m = movIndex[id];
  if (!m || m.tipo !== "RETIRO") return;
  edmMov = m;
  document.getElementById("edm-info").innerHTML =
    `<div><strong>${escHtml(m.nombre_producto)}</strong> · original: ${escHtml(m.cantidad)} ${escHtml(m.unidad||"")}</div>
     <div style="color:var(--texto-3);font-size:0.78rem;margin-top:2px;">Motivo actual: ${escHtml(m.motivo||"—")} · salió de <strong>${escHtml(m.origen||"acopio")}</strong>${esDestinoSector(m.destino) ? " → "+escHtml(m.destino) : ""}</div>`;
  document.getElementById("edm-buscar").value = "";
  edmPoblarProductos("");
  document.getElementById("edm-producto").value = m.id_producto;
  document.getElementById("edm-cantidad").value = m.cantidad;
  edmPoblarMotivos(true);
  document.getElementById("edm-confirm-eliminar").style.display = "none";
  document.getElementById("msg-editar-motivo").classList.remove("show");
  edmActualizar();
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
  const prod = edmProdSel();
  const origen = m.origen || "acopio";
  const mo = motivosSalida.find(x => x.nombre === document.getElementById("edm-motivo").value);
  return !!(mo && mo.transfiere) && esDespacho(prod) && origen === "acopio";
}

// Deltas de stock por producto. Revierte el efecto original y, si incluirApply,
// aplica el editado. Devuelve { [idProducto]: { acopio, despacho:{sector} } }.
function edmDeltas(incluirApply) {
  const m = edmMov;
  const origen = m.origen || "acopio";
  const deltas = {};
  const add = (pid, ef, sign) => {
    if (!deltas[pid]) deltas[pid] = { acopio: 0, despacho: {} };
    deltas[pid].acopio += sign * ef.acopio;
    Object.keys(ef.despacho).forEach(s => { deltas[pid].despacho[s] = (deltas[pid].despacho[s]||0) + sign * ef.despacho[s]; });
  };
  add(m.id_producto, efectoRetiro(origen, m.destino, m.cantidad), -1);   // revertir original
  if (incluirApply) {
    const prod = edmProdSel();
    if (prod) {
      const newDestino = edmEsTransfNuevo() ? edmDestinoNuevo(prod, true) : "consumo";
      add(prod.id, efectoRetiro(origen, newDestino, edmCant() || 0), +1); // aplicar editado
    }
  }
  return deltas;
}

// Convierte deltas en líneas legibles ("Producto: acopio +2 Kg, Barra -2 Kg")
function edmFmtDeltas(deltas) {
  const lineas = [];
  Object.keys(deltas).forEach(pid => {
    const p = productos.find(x => x.id === pid);
    const u = (p && p.unidad_medida) || "";
    const partes = [];
    if (deltas[pid].acopio) partes.push(`acopio ${deltas[pid].acopio>0?"+":""}${+deltas[pid].acopio.toFixed(3)} ${u}`);
    Object.keys(deltas[pid].despacho).forEach(s => {
      const d = deltas[pid].despacho[s];
      if (d) partes.push(`${s} ${d>0?"+":""}${+d.toFixed(3)} ${u}`);
    });
    if (partes.length) lineas.push(`${escHtml(p ? p.nombre : "producto eliminado")}: ${partes.join(", ")}`);
  });
  return lineas;
}

function edmActualizar() {
  const m = edmMov; if (!m) return;
  const prod = edmProdSel();
  const newTransf = edmEsTransfNuevo();
  const grupo = document.getElementById("edm-grupo-sector");
  if (newTransf) {
    const sects = sectoresDe(prod);
    document.getElementById("edm-sector").innerHTML = sects.map(s => `<option value="${s}" ${s===m.destino?"selected":""}>${s}</option>`).join("");
    grupo.style.display = sects.length > 1 ? "" : "none";
  } else {
    grupo.style.display = "none";
  }
  const lineas = edmFmtDeltas(edmDeltas(true));
  document.getElementById("edm-preview").innerHTML = lineas.length
    ? `Ajuste de stock: <strong>${lineas.join(" · ")}</strong>.`
    : "Sin cambios de stock — solo se actualiza la etiqueta del motivo.";
}

document.getElementById("edm-buscar").addEventListener("input", (e) => { edmPoblarProductos(e.target.value); });
document.getElementById("edm-producto").addEventListener("change", () => { edmPoblarMotivos(); edmActualizar(); });
document.getElementById("edm-cantidad").addEventListener("input", edmActualizar);
document.getElementById("edm-motivo").addEventListener("change", edmActualizar);
document.getElementById("edm-sector").addEventListener("change", edmActualizar);

// Aplica un mapa de deltas a las copias locales de productos (para render inmediato)
function edmAplicarLocal(deltas) {
  Object.keys(deltas).forEach(pid => {
    const p = productos.find(x => x.id === pid); if (!p) return;
    if (deltas[pid].acopio) p.stock_deposito = +(((p.stock_deposito ?? 0) + deltas[pid].acopio)).toFixed(4);
    const desp = { ...(p.stock_despacho || {}) };
    Object.keys(deltas[pid].despacho).forEach(s => {
      const d = deltas[pid].despacho[s];
      if (d) desp[s] = +(((desp[s] ?? 0) + d)).toFixed(4);
    });
    p.stock_despacho = desp;
  });
}

document.getElementById("btn-confirmar-editar-motivo").addEventListener("click", async () => {
  const m = edmMov;
  const msgEl = document.getElementById("msg-editar-motivo");
  const btn = document.getElementById("btn-confirmar-editar-motivo");
  if (!m) return;
  const newProd = edmProdSel();
  if (!newProd) { mostrarMsg(msgEl,"error","Elegí un producto válido."); return; }
  const newCant = edmCant();
  if (!(newCant > 0)) { mostrarMsg(msgEl,"error","La cantidad debe ser mayor a 0."); return; }

  const nuevo = document.getElementById("edm-motivo").value;
  const base  = (m.motivo || "").split(" — ")[0];
  const obs   = (m.motivo || "").includes(" — ") ? (m.motivo || "").split(" — ").slice(1).join(" — ") : "";
  const origen     = m.origen || "acopio";
  const newTransf  = edmEsTransfNuevo();
  const newDestino = newTransf ? edmDestinoNuevo(newProd, true) : "consumo";
  if (newTransf && !newDestino) { mostrarMsg(msgEl,"error","El producto no tiene sector de despacho asignado."); return; }

  const cambios = newProd.id !== m.id_producto || newCant !== m.cantidad || nuevo !== base || newDestino !== m.destino;
  if (!cambios) { mostrarMsg(msgEl,"error","No hiciste ningún cambio."); return; }

  const deltas = edmDeltas(true);

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const batch = writeBatch(db);
    // Escrituras atómicas por producto con increment (no pisa cambios concurrentes)
    Object.keys(deltas).forEach(pid => {
      if (!productos.some(p => p.id === pid)) return;   // producto inexistente: no se puede tocar su stock
      const upd = {};
      if (deltas[pid].acopio) upd.stock_deposito = increment(deltas[pid].acopio);
      Object.keys(deltas[pid].despacho).forEach(s => {
        const d = deltas[pid].despacho[s];
        if (d) upd[`stock_despacho.${s}`] = increment(d);
      });
      if (Object.keys(upd).length) batch.update(doc(db,"productos",pid), upd);
    });
    batch.update(doc(db,"movimientos",m.id), {
      id_producto: newProd.id,
      nombre_producto: newProd.nombre,
      cantidad: newCant,
      unidad: newProd.unidad_medida || m.unidad || "",
      motivo: obs ? `${nuevo} — ${obs}` : nuevo,
      destino: newDestino,
      origen,
      corregido: true,
      motivo_anterior: m.motivo,
      fecha_correccion: serverTimestamp()
    });
    await batch.commit();
    // Copias locales
    edmAplicarLocal(deltas);
    m.id_producto = newProd.id;
    m.nombre_producto = newProd.nombre;
    m.cantidad = newCant;
    m.unidad = newProd.unidad_medida || m.unidad || "";
    m.motivo  = obs ? `${nuevo} — ${obs}` : nuevo;
    m.destino = newDestino;
    m.corregido = true;

    cerrarModal("modal-editar-motivo");
    cargarMovRecientes();
    renderStock();
    if (movimientosCached.length) renderHistorial();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Aplicar cambios"; }
});

// ── ELIMINAR MOVIMIENTO (revierte el efecto y borra el registro) ──
document.getElementById("btn-eliminar-mov").addEventListener("click", () => {
  if (!edmMov) return;
  const lineas = edmFmtDeltas(edmDeltas(false));
  document.getElementById("edm-eliminar-preview").innerHTML =
    `Se eliminará este retiro y se devolverá el stock. ${lineas.length ? `Ajuste: <strong>${lineas.join(" · ")}</strong>.` : ""}`;
  document.getElementById("edm-confirm-eliminar").style.display = "";
});
document.getElementById("btn-cancelar-eliminar").addEventListener("click", () => {
  document.getElementById("edm-confirm-eliminar").style.display = "none";
});
document.getElementById("btn-confirmar-eliminar").addEventListener("click", async () => {
  const m = edmMov;
  const msgEl = document.getElementById("msg-editar-motivo");
  const btn = document.getElementById("btn-confirmar-eliminar");
  if (!m) return;
  const deltas = edmDeltas(false);   // solo revertir
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const batch = writeBatch(db);
    Object.keys(deltas).forEach(pid => {
      if (!productos.some(p => p.id === pid)) return;
      const upd = {};
      if (deltas[pid].acopio) upd.stock_deposito = increment(deltas[pid].acopio);
      Object.keys(deltas[pid].despacho).forEach(s => {
        const d = deltas[pid].despacho[s];
        if (d) upd[`stock_despacho.${s}`] = increment(d);
      });
      if (Object.keys(upd).length) batch.update(doc(db,"productos",pid), upd);
    });
    batch.delete(doc(db,"movimientos",m.id));
    await batch.commit();
    // Copias locales
    edmAplicarLocal(deltas);
    delete movIndex[m.id];
    movimientosCached = movimientosCached.filter(x => x.id !== m.id);

    cerrarModal("modal-editar-motivo");
    cargarMovRecientes();
    renderStock();
    if (movimientosCached.length) renderHistorial();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Sí, eliminar"; }
});

// ── EDITAR / ELIMINAR ENTRADA (INGRESO) — solo Gerente ────────
// Una entrada suma `cantidad` al acopio del producto. Editar = revertir el efecto
// original (acopio del producto viejo −= cantidad vieja) y aplicar el nuevo (acopio
// del producto nuevo += cantidad nueva), atómico con increment. Eliminar = solo
// revertir y borrar. Espeja "editar retiro" pero sin motivo ni sectores: una
// entrada siempre va a acopio. Antes, para corregir una entrada mal cargada había
// que hacer un ajuste de stock aparte.
let edeMov = null;
const edeProdSel = () => productos.find(p => p.id === document.getElementById("ede-producto").value);
const edeCant    = () => parseFloat(document.getElementById("ede-cantidad").value);

function edePoblarProductos(filtro) {
  const sel = document.getElementById("ede-producto");
  const actual = sel.value;
  const t = (filtro || "").toLowerCase();
  const lista = productos.slice().sort((a,b) => (a.nombre||"").localeCompare(b.nombre||""));
  const f = t ? lista.filter(p => (p.nombre||"").toLowerCase().includes(t)) : lista;
  sel.innerHTML = f.map(p => `<option value="${p.id}">${escHtml(p.nombre)}</option>`).join("");
  if (actual && f.some(p => p.id === actual)) sel.value = actual;
}

// Deltas de acopio por producto: revierte la entrada original y (si aplica) suma la editada.
function edeDeltas(incluirApply) {
  const m = edeMov;
  const deltas = {};
  const add = (pid, delta) => { deltas[pid] = (deltas[pid] || 0) + delta; };
  add(m.id_producto, -m.cantidad);                                              // revertir original
  if (incluirApply) { const prod = edeProdSel(); if (prod) add(prod.id, edeCant() || 0); }  // aplicar editado
  return deltas;
}

function edeFmtDeltas(deltas) {
  return Object.keys(deltas).filter(pid => deltas[pid]).map(pid => {
    const p = productos.find(x => x.id === pid);
    const u = (p && p.unidad_medida) || "";
    const d = deltas[pid];
    return `${escHtml(p ? p.nombre : "producto")}: acopio ${d>0?"+":""}${+d.toFixed(3)} ${u}`;
  });
}

function edeActualizar() {
  if (!edeMov) return;
  const lineas = edeFmtDeltas(edeDeltas(true));
  document.getElementById("ede-preview").innerHTML = lineas.length
    ? `Ajuste de stock: <strong>${lineas.join(" · ")}</strong>.`
    : "Sin cambios.";
}

window.abrirEditarEntrada = (id) => {
  const m = movIndex[id];
  if (!m || (m.tipo !== "INGRESO_PROVEEDOR" && m.tipo !== "INGRESO_PRODUCCION")) return;
  edeMov = m;
  const tipoTxt = m.tipo === "INGRESO_PROVEEDOR" ? "Proveedor" : "Producción";
  document.getElementById("ede-info").innerHTML =
    `<div><strong>${escHtml(m.nombre_producto)}</strong> · original: ${escHtml(m.cantidad)} ${escHtml(m.unidad||"")}</div>
     <div style="color:var(--texto-3);font-size:0.78rem;margin-top:2px;">Entrada (${escHtml(tipoTxt)}) → suma al acopio</div>`;
  document.getElementById("ede-buscar").value = "";
  edePoblarProductos("");
  document.getElementById("ede-producto").value = m.id_producto;
  document.getElementById("ede-cantidad").value = m.cantidad;
  document.getElementById("ede-confirm-eliminar").style.display = "none";
  document.getElementById("msg-editar-entrada").classList.remove("show");
  edeActualizar();
  abrirModal("modal-editar-entrada");
};

document.getElementById("ede-buscar").addEventListener("input", (e) => { edePoblarProductos(e.target.value); edeActualizar(); });
document.getElementById("ede-producto").addEventListener("change", edeActualizar);
document.getElementById("ede-cantidad").addEventListener("input", edeActualizar);

function edeAplicarLocal(deltas) {
  Object.keys(deltas).forEach(pid => {
    const p = productos.find(x => x.id === pid); if (!p) return;
    if (deltas[pid]) p.stock_deposito = +(((p.stock_deposito ?? 0) + deltas[pid])).toFixed(4);
  });
}

document.getElementById("btn-confirmar-editar-entrada").addEventListener("click", async () => {
  const m = edeMov;
  const msgEl = document.getElementById("msg-editar-entrada");
  const btn = document.getElementById("btn-confirmar-editar-entrada");
  if (!m) return;
  const newProd = edeProdSel();
  if (!newProd) { mostrarMsg(msgEl,"error","Elegí un producto válido."); return; }
  const newCant = edeCant();
  if (!(newCant > 0)) { mostrarMsg(msgEl,"error","La cantidad debe ser mayor a 0."); return; }
  if (newProd.id === m.id_producto && newCant === m.cantidad) { mostrarMsg(msgEl,"error","No hiciste ningún cambio."); return; }

  const deltas = edeDeltas(true);
  // Si es una producción, corregir = revertir el consumo viejo de insumos y
  // aplicar el nuevo (según la receta del producto editado × la cantidad nueva).
  const esProd = m.tipo === "INGRESO_PRODUCCION";
  const oldConsumos = (esProd && Array.isArray(m.consumo_produccion)) ? m.consumo_produccion : [];
  const newConsumos = esProd ? calcularConsumoProduccion(newProd, newCant) : [];
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const linked = oldConsumos.length
      ? (await getDocs(query(collection(db,"movimientos"), where("produccion_id","==",m.id)))).docs
      : [];
    const batch = writeBatch(db);
    Object.keys(deltas).forEach(pid => {
      if (!productos.some(p => p.id === pid)) return;
      if (deltas[pid]) batch.update(doc(db,"productos",pid), { stock_deposito: increment(deltas[pid]) });
    });
    // Revertir consumo viejo (devolver insumos + borrar sus movimientos)
    for (const c of oldConsumos) if (productos.some(p => p.id === c.id)) batch.update(doc(db,"productos",c.id), { stock_deposito: increment(c.cantidad) });
    for (const d of linked) batch.delete(doc(db,"movimientos", d.id));
    // Aplicar consumo nuevo (descontar insumos + crear movimientos enlazados)
    agregarConsumoAlBatch(batch, { plato: newProd, consumos: newConsumos, produccionId: m.id,
      usuarioNombre: usuarioActual.nombre, existe: (pid) => productos.some(p => p.id === pid) });
    batch.update(doc(db,"movimientos",m.id), {
      id_producto: newProd.id,
      nombre_producto: newProd.nombre,
      cantidad: newCant,
      unidad: newProd.unidad_medida || m.unidad || "",
      corregido: true,
      cantidad_anterior: m.cantidad,
      fecha_correccion: serverTimestamp(),
      ...(esProd ? { consumo_produccion: newConsumos } : {})
    });
    await batch.commit();
    edeAplicarLocal(deltas);
    for (const c of oldConsumos) { const p = productos.find(x => x.id === c.id); if (p) p.stock_deposito = +(((p.stock_deposito ?? 0) + c.cantidad)).toFixed(4); }
    for (const c of newConsumos) { const p = productos.find(x => x.id === c.id); if (p) p.stock_deposito = +(((p.stock_deposito ?? 0) - c.cantidad)).toFixed(4); }
    m.id_producto = newProd.id; m.nombre_producto = newProd.nombre; m.cantidad = newCant;
    m.unidad = newProd.unidad_medida || m.unidad || ""; m.corregido = true;
    if (esProd) m.consumo_produccion = newConsumos;
    cerrarModal("modal-editar-entrada");
    cargarMovRecientes();
    renderStock();
    if (movimientosCached.length) renderHistorial();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Aplicar cambios"; }
});

document.getElementById("btn-eliminar-entrada").addEventListener("click", () => {
  if (!edeMov) return;
  const lineas = edeFmtDeltas(edeDeltas(false));
  const hayConsumo = edeMov.tipo === "INGRESO_PRODUCCION" && Array.isArray(edeMov.consumo_produccion) && edeMov.consumo_produccion.length;
  const nota = hayConsumo ? " También se devolverán al acopio los insumos consumidos en esta producción." : "";
  document.getElementById("ede-eliminar-preview").innerHTML =
    `Se eliminará esta entrada y se revertirá el stock.${nota} ${lineas.length ? `Ajuste: <strong>${lineas.join(" · ")}</strong>.` : ""}`;
  document.getElementById("ede-confirm-eliminar").style.display = "";
});
document.getElementById("btn-cancelar-eliminar-entrada").addEventListener("click", () => {
  document.getElementById("ede-confirm-eliminar").style.display = "none";
});
document.getElementById("btn-confirmar-eliminar-entrada").addEventListener("click", async () => {
  const m = edeMov;
  const msgEl = document.getElementById("msg-editar-entrada");
  const btn = document.getElementById("btn-confirmar-eliminar-entrada");
  if (!m) return;
  const deltas = edeDeltas(false);
  // Producción: además de revertir el plato, devolver los insumos y borrar sus movimientos.
  const consumos = (m.tipo === "INGRESO_PRODUCCION" && Array.isArray(m.consumo_produccion)) ? m.consumo_produccion : [];
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const linked = consumos.length
      ? (await getDocs(query(collection(db,"movimientos"), where("produccion_id","==",m.id)))).docs
      : [];
    const batch = writeBatch(db);
    Object.keys(deltas).forEach(pid => {
      if (!productos.some(p => p.id === pid)) return;
      if (deltas[pid]) batch.update(doc(db,"productos",pid), { stock_deposito: increment(deltas[pid]) });
    });
    for (const c of consumos) if (productos.some(p => p.id === c.id)) batch.update(doc(db,"productos",c.id), { stock_deposito: increment(c.cantidad) });
    for (const d of linked) batch.delete(doc(db,"movimientos", d.id));
    batch.delete(doc(db,"movimientos",m.id));
    await batch.commit();
    edeAplicarLocal(deltas);
    for (const c of consumos) { const p = productos.find(x => x.id === c.id); if (p) p.stock_deposito = +(((p.stock_deposito ?? 0) + c.cantidad)).toFixed(4); }
    delete movIndex[m.id];
    movimientosCached = movimientosCached.filter(x => x.id !== m.id);
    cerrarModal("modal-editar-entrada");
    cargarMovRecientes();
    renderStock();
    if (movimientosCached.length) renderHistorial();
  } catch(err) { mostrarMsg(msgEl,"error","Error: " + err.message); }
  finally { btn.disabled = false; btn.innerHTML = "Sí, eliminar"; }
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
        <button class="btn-icono" onclick="abrirEditarUsuario('${u.id}')">${icono("editar",{size:16})}</button>
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
  // Productos: TODO el catálogo (no solo los de los 200 recientes), así uno con
  // movimientos viejos también se puede elegir y filtrar por rango de fechas. Se
  // suman los nombres que aparezcan en el cache por si un producto fue borrado.
  const prods = [...new Set([...productos.map(p=>p.nombre), ...movimientosCached.map(m=>m.nombre_producto)].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  document.getElementById("filtro-hist-usuario").innerHTML  = '<option value="">Todos los usuarios</option>'  + usrs.map(u=>`<option value="${u}">${escHtml(u)}</option>`).join("");
  document.getElementById("filtro-hist-producto").innerHTML = '<option value="">Todos los productos</option>' + prods.map(p=>`<option value="${escHtml(p)}">${escHtml(p)}</option>`).join("");
}

// Trae los movimientos a filtrar. Con rango de fechas consulta Firestore por ESE
// rango (sin el tope de 200 → no se pierde nada viejo); sin rango usa el cache de
// los 200 más recientes (rápido para el uso normal). Antes SIEMPRE filtraba sobre
// el cache de 200, así que un rango viejo mostraba de menos.
async function obtenerMovimientos(desde, hasta) {
  if (!desde && !hasta) return movimientosCached;
  const cond = [];
  if (desde) cond.push(where("fecha_hora", ">=", new Date(desde + "T00:00:00")));
  if (hasta) cond.push(where("fecha_hora", "<=", new Date(hasta + "T23:59:59")));
  const snap = await getDocs(query(collection(db, "movimientos"), ...cond, orderBy("fecha_hora", "desc")));
  const movs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  movs.forEach(m => { movIndex[m.id] = m; });   // que se puedan editar/eliminar los traídos
  return movs;
}

async function aplicarFiltros() {
  const tipo  = document.getElementById("filtro-hist-tipo").value;
  const usr   = document.getElementById("filtro-hist-usuario").value;
  const prod  = document.getElementById("filtro-hist-producto").value;
  const desde = document.getElementById("filtro-hist-desde").value;
  const hasta = document.getElementById("filtro-hist-hasta").value;
  let lista   = [...(await obtenerMovimientos(desde, hasta))];
  if (tipo)  lista = lista.filter(m => m.tipo === tipo);
  if (usr)   lista = lista.filter(m => m.nombre_usuario === usr);
  if (prod)  lista = lista.filter(m => m.nombre_producto === prod);
  // El rango de fechas ya lo aplicó Firestore en obtenerMovimientos.
  return lista;
}

async function renderHistorial() {
  const cont  = document.getElementById("lista-historial");
  cont.innerHTML = '<div class="empty-state"><div class="spinner spinner-verde"></div></div>';
  const lista = await aplicarFiltros();
  if (!lista.length) { cont.innerHTML = '<div class="empty-state"><p>Sin resultados.</p></div>'; return; }
  cont.innerHTML = lista.map(filaMovimiento).join("");
}

document.getElementById("btn-aplicar-filtros").addEventListener("click", renderHistorial);
document.getElementById("btn-limpiar-filtros").addEventListener("click", () => {
  ["filtro-hist-tipo","filtro-hist-usuario","filtro-hist-producto","filtro-hist-desde","filtro-hist-hasta"].forEach(id => document.getElementById(id).value = "");
  renderHistorial();
});

document.getElementById("btn-exportar-excel").addEventListener("click", async () => {
  const lista = await aplicarFiltros();
  if (!lista.length) { alert("No hay datos para exportar."); return; }
  const btn = document.getElementById("btn-exportar-excel");
  btn.disabled = true; btn.textContent = "Generando...";
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
  const filas = lista.map(m => {
    const ts = m.fecha_hora?.toDate?.();
    return { "Fecha": ts?ts.toLocaleDateString("es-AR"):"—","Hora":ts?ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit",hour12:false}):"—","Producto":m.nombre_producto||"—","Tipo":m.tipo||"—","Cantidad":m.cantidad??0,"Unidad":m.unidad||"—","Origen":m.origen||"—","Destino":m.destino||"—","Motivo":m.motivo||"—","Usuario":m.nombre_usuario||"—" };
  });
  const ws = XLSX.utils.json_to_sheet(filas);
  ws["!cols"] = [{wch:12},{wch:8},{wch:28},{wch:20},{wch:10},{wch:10},{wch:15},{wch:15},{wch:35},{wch:20}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Historial");
  XLSX.writeFile(wb, `historial-green-garden-${new Date().toLocaleDateString("es-AR").replace(/\//g,"-")}.xlsx`);
  btn.disabled = false; btn.innerHTML = icono("exportar",{size:15}) + " Exportar a Excel";
});

// ── CONFIRMACIÓN Y UTILIDADES ─────────────────────────────────
// ── AUDITORÍA DE STOCK DE DESPACHO ────────────────────────────
// Compara el stock de la app contra el ESPERADO según movimientos y permite
// reajustar (al esperado) o restablecer a 0 por rubro. Todo queda como AJUSTE.
let auditEsp = {};   // "pid|sector" -> { val, ancla } del último análisis

const _audFecha = (v) => v == null ? null : (v.toDate ? v.toDate().getTime() : (v instanceof Date ? v.getTime() : (isNaN(new Date(v)) ? null : new Date(v).getTime())));
const _audValAjuste = (m) => { const mm = String(m.motivo||"").match(/→\s*(-?[\d.,]+)\s*\)/); return mm ? parseFloat(mm[1].replace(",",".")) : null; };

// Stock esperado de un sector: último AJUSTE (ancla) + movimientos posteriores.
function _audEsperado(movsAsc, s) {
  let idx = -1, val = null;
  for (let i = movsAsc.length - 1; i >= 0; i--) {
    const m = movsAsc[i];
    if (m.tipo === "AJUSTE" && m.origen === s && m.destino === s) { const v = _audValAjuste(m); if (v != null) { val = v; idx = i; break; } }
  }
  if (idx === -1) return { val: null, ancla: null };
  const ancla = _audFecha(movsAsc[idx].fecha_hora);
  for (let i = idx + 1; i < movsAsc.length; i++) {
    const m = movsAsc[i], c = (+m.cantidad || 0);
    if (m.tipo === "AJUSTE" && m.origen === s && m.destino === s) { const v = _audValAjuste(m); if (v != null) val = v; }
    else if (m.tipo === "VENTA"     && m.origen  === s) val -= c;
    else if (m.tipo === "RETIRO"    && m.destino === s) val += c;
    else if (m.tipo === "RETIRO"    && m.origen  === s) val -= c;
    else if (m.tipo === "ANULACION" && m.destino === s) val += c;
    else if (m.tipo === "ANULACION" && m.origen  === s) val -= c;
  }
  return { val: +val.toFixed(3), ancla };
}

function poblarRubrosAudit() {
  const rbs = [...new Set(productos.filter(esDespacho).map(p => p.rubro).filter(Boolean))].sort();
  for (const id of ["audit-rubro", "audit-cero-rubro"]) {
    const sel = document.getElementById(id); if (!sel) continue;
    const prev = sel.value;
    const base = id === "audit-cero-rubro" ? '<option value="">Elegí un rubro…</option>' : '<option value="">Todos los rubros</option>';
    sel.innerHTML = base + rbs.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join("");
    sel.value = prev;
  }
}

async function analizarAuditoria() {
  const cont = document.getElementById("audit-resultado");
  const msg  = document.getElementById("audit-msg");
  const btn  = document.getElementById("btn-audit-analizar");
  const rubro = document.getElementById("audit-rubro").value;
  btn.disabled = true; btn.textContent = "Analizando…";
  msg.style.display = "none";
  try {
    const snap = await getDocs(query(collection(db, "movimientos"), orderBy("fecha_hora", "asc")));
    const movsAsc = snap.docs.map(d => d.data());
    const porProd = {};
    for (const m of movsAsc) { if (m.id_producto) (porProd[m.id_producto] ||= []).push(m); }

    const lista = productos.filter(esDespacho).filter(p => !rubro || p.rubro === rubro)
      .sort((a,b) => (a.nombre||"").localeCompare(b.nombre||""));
    auditEsp = {};
    let filas = "", nOff = 0;
    for (const p of lista) {
      const sects = sectoresDe(p).length ? sectoresDe(p) : Object.keys(p.stock_despacho || {});
      sects.forEach((s, i) => {
        const stock = p.stock_despacho?.[s] ?? 0;
        const e = _audEsperado(porProd[p.id] || [], s);
        auditEsp[p.id+"|"+s] = e;
        const dif = e.val == null ? null : +(stock - e.val).toFixed(3);
        const ok  = dif != null && Math.abs(dif) < 0.001;
        const ajustable = e.val != null && dif != null && !ok;
        if (ajustable) nOff++;
        filas += `<tr>
          <td style="padding:6px 6px;">${ajustable ? `<input type="checkbox" class="aud-chk" data-pid="${escHtml(p.id)}" data-sector="${escHtml(s)}" data-esp="${e.val}" data-app="${stock}" data-nombre="${escHtml(p.nombre)}" data-unidad="${escHtml(p.unidad_medida||"")}" style="width:16px;height:16px;accent-color:var(--verde);">` : ""}</td>
          <td style="padding:6px 6px;font-size:0.8rem;">${i===0?`<b>${escHtml(p.nombre)}</b>`:""}</td>
          <td style="padding:6px 6px;font-size:0.8rem;color:var(--texto-3);">${escHtml(s)}</td>
          <td style="padding:6px 6px;text-align:right;font-family:ui-monospace,monospace;">${fmtN(stock)}</td>
          <td style="padding:6px 6px;text-align:right;font-family:ui-monospace,monospace;">${e.val==null?'<span style="color:var(--texto-3);">s/ancla</span>':fmtN(e.val)}</td>
          <td style="padding:6px 6px;text-align:right;font-family:ui-monospace,monospace;font-weight:700;color:${dif==null?'var(--texto-3)':(ok?'var(--verde)':'var(--critico-txt)')};">${dif==null?"—":(ok?"✓":(dif>0?`+${fmtN(dif)}`:fmtN(dif)))}</td>
        </tr>`;
      });
    }

    cont.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:1px solid var(--borde);">
            <th style="padding:6px;"><input type="checkbox" id="aud-chk-todos" style="width:16px;height:16px;accent-color:var(--verde);"></th>
            <th style="padding:6px;text-align:left;font-size:0.7rem;color:var(--texto-3);">Producto</th>
            <th style="padding:6px;text-align:left;font-size:0.7rem;color:var(--texto-3);">Sector</th>
            <th style="padding:6px;text-align:right;font-size:0.7rem;color:var(--texto-3);">App</th>
            <th style="padding:6px;text-align:right;font-size:0.7rem;color:var(--texto-3);">Esperado</th>
            <th style="padding:6px;text-align:right;font-size:0.7rem;color:var(--texto-3);">Dif</th>
          </tr></thead>
          <tbody>${filas || '<tr><td colspan="6" style="padding:14px;text-align:center;color:var(--texto-3);">Sin productos de despacho.</td></tr>'}</tbody>
        </table>
      </div>
      ${nOff ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="btn btn-secondary btn-sm" id="btn-audit-reajustar" style="border-color:var(--verde);color:var(--verde);">Reajustar seleccionados al esperado</button>
        <span style="font-size:0.76rem;color:var(--texto-3);">${nOff} sector(es) con diferencia. Marcá los que quieras dejar en su esperado.</span>
      </div>` : `<p style="margin-top:12px;font-size:0.8rem;color:var(--verde);font-weight:600;">Todo coincide con el historial ✓</p>`}
      <p style="margin-top:10px;font-size:0.74rem;color:var(--texto-3);">Ojo: el “esperado” es confiable solo si las reposiciones se cargaron siempre. Donde dé negativo o “s/ancla”, hacé conteo físico en lugar de reajustar.</p>`;

    const todos = document.getElementById("aud-chk-todos");
    if (todos) todos.addEventListener("change", () => document.querySelectorAll(".aud-chk").forEach(c => c.checked = todos.checked));
    const btnR = document.getElementById("btn-audit-reajustar");
    if (btnR) btnR.addEventListener("click", reajustarAuditoria);
  } catch (e) {
    msg.style.display = ""; msg.className = "msg show msg-error"; msg.textContent = "Error al analizar: " + (e.code || e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Analizar";
  }
}

function reajustarAuditoria() {
  const filas = [...document.querySelectorAll(".aud-chk")].filter(c => c.checked).map(c => ({
    pid: c.dataset.pid, sector: c.dataset.sector,
    esp: parseFloat(c.dataset.esp), app: parseFloat(c.dataset.app),
    nombre: c.dataset.nombre, unidad: c.dataset.unidad,
  }));
  if (!filas.length) return;
  const prev = filas.slice(0, 10).map(f => `• ${f.nombre} / ${f.sector}: ${fmtN(f.app)} → ${fmtN(f.esp)}`).join("\n");
  const extra = filas.length > 10 ? `\n… y ${filas.length - 10} más` : "";
  mostrarConfirm(`Reajustar ${filas.length} sector(es) al valor esperado:\n\n${prev}${extra}\n\nQueda como AJUSTE en el historial.`, async () => {
    const MAX = 400; let batch = writeBatch(db); let ops = 0;
    for (const f of filas) {
      const delta = +(f.esp - f.app).toFixed(4);
      if (!delta) continue;
      if (ops >= MAX) { await batch.commit(); batch = writeBatch(db); ops = 0; }
      batch.update(doc(db, "productos", f.pid), { [`stock_despacho.${f.sector}`]: increment(delta) }); ops++;
      batch.set(doc(collection(db, "movimientos")), {
        fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid || null, nombre_usuario: usuarioActual?.nombre || null,
        id_producto: f.pid, nombre_producto: f.nombre, tipo: "AJUSTE", cantidad: Math.abs(delta), unidad: f.unidad,
        motivo: `Recálculo s/movimientos ${f.sector} (${fmtN(f.app)} → ${fmtN(f.esp)})`, origen: f.sector, destino: f.sector,
      }); ops++;
    }
    if (ops > 0) await batch.commit();
    analizarAuditoria();
  });
}

async function restablecerRubroCero(rubro) {
  const lista = productos.filter(esDespacho).filter(p => p.rubro === rubro);
  const msg = document.getElementById("audit-cero-msg");
  const MAX = 400; let batch = writeBatch(db); let ops = 0; let tocados = 0;
  try {
    for (const p of lista) {
      const sects = sectoresDe(p).length ? sectoresDe(p) : Object.keys(p.stock_despacho || {});
      for (const s of sects) {
        const actual = p.stock_despacho?.[s] ?? 0;
        if (!actual) continue;   // ya está en 0
        if (ops >= MAX) { await batch.commit(); batch = writeBatch(db); ops = 0; }
        batch.update(doc(db, "productos", p.id), { [`stock_despacho.${s}`]: increment(-actual) }); ops++;
        batch.set(doc(collection(db, "movimientos")), {
          fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid || null, nombre_usuario: usuarioActual?.nombre || null,
          id_producto: p.id, nombre_producto: p.nombre, tipo: "AJUSTE", cantidad: Math.abs(actual), unidad: p.unidad_medida,
          motivo: `Reset a 0 ${s} (${fmtN(actual)} → 0)`, origen: s, destino: s,
        }); ops++;
        tocados++;
      }
    }
    if (ops > 0) await batch.commit();
    msg.style.display = ""; msg.className = "msg show msg-ok"; msg.textContent = `✓ Puestos en 0: ${tocados} sector(es) del rubro ${rubro}.`;
  } catch (e) {
    msg.style.display = ""; msg.className = "msg show msg-error"; msg.textContent = "Error: " + (e.code || e.message);
  }
}

document.querySelector('.tab-btn[data-tab="auditoria"]')?.addEventListener("click", poblarRubrosAudit);
document.getElementById("btn-audit-analizar")?.addEventListener("click", analizarAuditoria);
document.getElementById("btn-audit-cero")?.addEventListener("click", () => {
  const rubro = document.getElementById("audit-cero-rubro").value;
  const msg = document.getElementById("audit-cero-msg");
  if (!rubro) { msg.style.display = ""; msg.className = "msg show msg-error"; msg.textContent = "Elegí un rubro."; return; }
  const n = productos.filter(esDespacho).filter(p => p.rubro === rubro).length;
  mostrarConfirm(`¿Poner en 0 el stock de despacho de TODOS los productos del rubro "${rubro}" (${n} producto/s)? Queda registrado como AJUSTE. No afecta el acopio.`, () => restablecerRubroCero(rubro));
});

function mostrarConfirm(texto, cb) {
  document.getElementById("confirm-texto").textContent = texto;
  confirmCallback = cb;
  abrirModal("modal-confirm");
}
document.getElementById("btn-confirm-ok").addEventListener("click", async () => {
  if (confirmCallback) { await confirmCallback(); confirmCallback = null; }
  cerrarModal("modal-confirm");
});

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
    lugar = "acopio";
  } else {
    const sector = ubic.slice(5); // saca "desp:"
    stockAnterior = prod.stock_despacho?.[sector] ?? 0;
    lugar = sector;
  }
  // Se aplica la DIFERENCIA con increment (no el valor absoluto): así el ajuste
  // COMPONE con cualquier venta/reposición/importación concurrente en vez de
  // pisarla. Ej.: veo 8, cuento 10 (Δ +2); si mientras tanto se vendió 1, el
  // resultado final es 8-1+2 = 9 (correcto), no 10 (que perdería la venta).
  // El resto del sistema (entradas/salidas/importación) ya usa increment; el
  // ajuste era el único que escribía absoluto y por eso pisaba movimientos.
  const delta = nuevoStock - stockAnterior;
  update = (ubic === "acopio")
    ? { stock_deposito: increment(delta) }
    : { [`stock_despacho.${lugar}`]: increment(delta) };

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    await updateDoc(doc(db,"productos",prodId), update);
    await addDoc(collection(db,"movimientos"), {
      fecha_hora: serverTimestamp(), id_usuario: auth.currentUser?.uid || null,
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

// El sello de versión lo aplica js/version.js (cargado desde el HTML de la vista).
