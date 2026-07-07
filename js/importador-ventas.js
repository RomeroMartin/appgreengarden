// ============================================================
// importador-ventas.js — Importación de ventas desde Excel
// Match por código PLU. Descuenta de sectores de despacho.
// Compartido entre Gerente y Administrador.
// ============================================================

import { db } from "./firebase-config.js";
import { debeAvanzar } from "./corte-ventas.js";
import {
  collection, doc, addDoc, getDocs, query, orderBy,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Estado interno del importador
let _productos      = [];
let _usuarioActual  = null;
let _filasPreview   = [];   // [{prod, cantidad, sectorElegido, sectores}]
let _fechaCorte     = null; // Date "hasta" leída del Excel
let _onTerminado    = null;

// Helpers de tipo
const esDespacho = (p) => p.tipo === "Despacho";
const esReceta   = (p) => p.tipo === "Receta";
const sectoresDe = (p) => p.sectores_asignados ?? [];

// ── Inicializar el importador (lo llama cada panel) ───────────
export function initImportador({ productos, usuarioActual, onTerminado }) {
  _productos     = productos;
  _usuarioActual = usuarioActual;
  _onTerminado   = onTerminado || (()=>{});

  // Listeners (se registran una sola vez)
  const fileInput = document.getElementById("import-file");
  if (fileInput && !fileInput.dataset.ready) {
    fileInput.dataset.ready = "1";
    fileInput.addEventListener("change", manejarArchivo);
    document.getElementById("btn-import-cancelar").addEventListener("click", resetImportador);
    document.getElementById("btn-import-confirmar").addEventListener("click", confirmarImportacion);
    document.getElementById("btn-import-cerrar").addEventListener("click", () => {
      cerrarModalImport();
      resetImportador();
    });
  }
}

// Permite al panel refrescar la lista de productos antes de abrir
export function actualizarProductosImportador(productos) { _productos = productos; }

function cerrarModalImport() {
  document.getElementById("modal-importar").classList.remove("open");
}

export function abrirImportador() {
  resetImportador();
  document.getElementById("modal-importar").classList.add("open");
}

function resetImportador() {
  _filasPreview = [];
  document.getElementById("import-paso-1").style.display = "";
  document.getElementById("import-paso-2").style.display = "none";
  document.getElementById("import-paso-3").style.display = "none";
  document.getElementById("import-file").value = "";
  document.getElementById("msg-import").classList.remove("show");
  const m2 = document.getElementById("msg-import-2");
  if (m2) m2.classList.remove("show");
}

// ── Paso 1: leer y parsear el Excel ───────────────────────────
async function manejarArchivo(e) {
  const file = e.target.files[0];
  if (!file) return;
  const msgEl = document.getElementById("msg-import");
  msgEl.className = "msg show msg-ok";
  msgEl.textContent = "Leyendo archivo...";

  try {
    const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data, { type: "array" });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    // Matriz de filas (array de arrays), sin encabezados
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

    _fechaCorte = extraerFechaCorte(filas, XLSX);
    const parsed = parsearFilas(filas);
    if (!parsed.length) {
      msgEl.className = "msg show msg-error";
      msgEl.textContent = "No se encontraron productos con código en el archivo.";
      return;
    }
    construirPreview(parsed);
  } catch (err) {
    msgEl.className = "msg show msg-error";
    msgEl.textContent = "Error al leer el archivo: " + err.message;
  }
}

// ── Extraer la fecha de corte (fin del período) del encabezado ─
function extraerFechaCorte(filas, XLSX) {
  for (const fila of filas) {
    if (!fila) continue;
    // Buscar la celda que contenga "periodo"
    const idx = fila.findIndex(c => typeof c === "string" && c.toLowerCase().includes("periodo"));
    if (idx === -1) continue;
    // Las dos celdas siguientes son desde y hasta. Tomamos la última no vacía.
    const candidatas = fila.slice(idx + 1).filter(c => c !== null && c !== undefined && String(c).trim() !== "");
    if (!candidatas.length) continue;
    const valHasta = candidatas[candidatas.length - 1];
    return parsearFechaCelda(valHasta, XLSX);
  }
  return null;
}

function parsearFechaCelda(val, XLSX) {
  // Caso 1: número de serie de Excel
  if (typeof val === "number") {
    try {
      const o = XLSX.SSF.parse_date_code(val);
      if (o) return new Date(o.y, o.m - 1, o.d);
    } catch(e) {}
  }
  // Caso 2: texto tipo "14/6/2026" o "14-6-2026"
  if (typeof val === "string") {
    const m = val.trim().match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      let [, d, mes, a] = m;
      a = a.length === 2 ? "20" + a : a;
      return new Date(parseInt(a), parseInt(mes) - 1, parseInt(d));
    }
  }
  // Caso 3: ya es Date
  if (val instanceof Date && !isNaN(val)) return val;
  return null;
}

// ── Parser específico del formato del software ────────────────
// Estructura observada:
//   Producto real = código PLU largo + nombre + CANTIDAD + IMPORTE
//   Encabezado de rubro = código + nombre + cantidad + importe (es un total)
//   Subcategoría = código + nombre (sin cantidad)
// Distinguimos producto real: tiene 4+ celdas y la 3a (cantidad) es número,
// pero NO es una fila de total de rubro. Como el match es por PLU contra
// la base de la app, las filas que no son productos simplemente no matchean.
// Igual filtramos lo más obvio para no inflar la lista.
function parsearFilas(filas) {
  const items = [];
  for (const fila of filas) {
    if (!fila || fila.length < 3) continue;
    const codigo   = fila[0];
    const nombre   = fila[1];
    const cantidad = fila[2];
    const tamano   = (fila[4] != null) ? String(fila[4]).trim() : "";  // columna "Tamanio"

    // Necesitamos código numérico, nombre texto y cantidad numérica > 0
    const codNum = parseInt(codigo);
    const cant   = parseFloat(cantidad);
    if (isNaN(codNum) || codNum <= 0) continue;          // descarta SIN RUBRO (0), subcategorías sin cant
    if (typeof nombre !== "string" || !nombre.trim()) continue;
    if (isNaN(cant) || cant <= 0) continue;

    items.push({ plu: String(codNum), nombre: nombre.trim(), cantidad: cant, tamano });
  }
  // Deduplicar por PLU + tamaño: el mismo PLU con distinto tamaño (ej. Gin Tonic
  // Nacional vs Importado) son líneas distintas y no deben sumarse entre sí.
  const porClave = {};
  for (const it of items) {
    const clave = it.plu + "||" + it.tamano.toUpperCase();
    if (porClave[clave]) porClave[clave].cantidad += it.cantidad;
    else porClave[clave] = { ...it };
  }
  return Object.values(porClave);
}

// ── Construir vista previa (match por PLU) ────────────────────
function construirPreview(items) {
  const matcheados = [];
  const ignorados  = [];

  // Index de productos por PLU
  const porPlu = {};
  _productos.forEach(p => { if (p.plu) porPlu[String(p.plu).trim()] = p; });

  for (const item of items) {
    const prod = porPlu[item.plu];
    if (!prod) { ignorados.push(item); continue; }
    if (esReceta(prod)) {
      let sectorReceta = null, ingredientes = [], variante = "", noConfig = false;
      if (prod.por_variantes) {
        const tnorm = (item.tamano || "").trim().toUpperCase();
        const v = (prod.variantes || []).find(x => (x.tamano || "").trim().toUpperCase() === tnorm);
        if (v) { sectorReceta = v.sector; ingredientes = v.ingredientes || []; variante = v.tamano; }
        else   { noConfig = true; variante = item.tamano || "(sin tamaño)"; }
      } else {
        sectorReceta = prod.sector_receta || null;
        ingredientes = prod.ingredientes || [];
      }
      matcheados.push({
        prod,
        cantidad: item.cantidad,
        esReceta: true,
        sectorReceta,
        ingredientes,
        variante,
        noConfig,
        tamanoExcel: item.tamano || "",
        sectores: [],
        sectorElegido: null,
        nombreExcel: item.nombre
      });
      continue;
    }
    const sects = esDespacho(prod) ? sectoresDe(prod) : [];
    matcheados.push({
      prod,
      cantidad: item.cantidad,
      sectores: sects,
      sectorElegido: sects.length ? sects[0] : null,
      nombreExcel: item.nombre
    });
  }

  _filasPreview = matcheados;

  // Pintar contadores
  document.getElementById("import-count-ok").textContent        = matcheados.length;
  document.getElementById("import-count-ignorados").textContent = ignorados.length;

  // Pintar lista
  const cont = document.getElementById("import-preview-lista");
  let html = "";

  if (matcheados.length) {
    html += matcheados.map((f, idx) => {
      if (f.esReceta) {
        const sinSector = !f.sectorReceta;
        const sinIng    = !f.ingredientes.length;
        const tag = f.variante ? ` <span style="font-size:0.62rem;background:var(--dorado,#c8a96e);color:#1c1c1a;padding:1px 6px;border-radius:5px;font-weight:700;">${f.variante}</span>` : "";
        const ingHtml = f.ingredientes.map(ing => {
          const tieneIn = ing.cant_in != null && ing.unidad_in;
          const consumo = tieneIn
            ? `${+(ing.cant_in * f.cantidad).toFixed(3)} ${ing.unidad_in}`
            : `${+(ing.cantidad * f.cantidad).toFixed(3)} ${ing.unidad}`;
          return `<div style="font-size:0.74rem;color:var(--texto-3);">• ${ing.nombre}: <strong style="color:var(--texto-2);">${consumo}</strong></div>`;
        }).join("");
        let aviso;
        if (f.noConfig) {
          aviso = `<div style="font-size:0.72rem;color:var(--bajo-txt);">⚠️ variante "${f.tamanoExcel||"sin tamaño"}" no configurada en la receta — no se descuenta</div>`;
        } else if (sinSector || sinIng) {
          aviso = `<div style="font-size:0.72rem;color:var(--bajo-txt);">⚠️ ${sinSector ? "sin sector asignado" : "sin ingredientes"} — no se descuenta</div>`;
        } else {
          aviso = `<div style="font-size:0.72rem;color:var(--texto-3);margin-bottom:3px;">🍸 arma en ${f.sectorReceta}:</div>${ingHtml}`;
        }
        return `<div style="padding:10px 0;border-bottom:1px solid var(--borde);">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.88rem;font-weight:600;">🍸 ${f.prod.nombre}${tag} <span style="font-size:0.62rem;background:var(--bg-secondary);color:var(--texto-3);padding:1px 6px;border-radius:5px;">PLU ${f.prod.plu}</span></div>
              ${aviso}
            </div>
            <span style="font-size:0.95rem;font-weight:700;color:var(--verde);white-space:nowrap;">${f.cantidad} u.</span>
          </div>
        </div>`;
      }
      const multi = f.sectores.length > 1;
      const selector = multi
        ? `<select class="form-control import-sector-sel" data-idx="${idx}" style="font-size:0.8rem;padding:6px 8px;margin-top:4px;">${f.sectores.map(s=>`<option value="${s}">${s}</option>`).join("")}</select>`
        : (f.sectores.length === 1
            ? `<span style="font-size:0.72rem;color:var(--texto-3);">→ ${f.sectores[0]}</span>`
            : `<span style="font-size:0.72rem;color:var(--bajo-txt);">⚠️ sin sector de despacho</span>`);
      return `<div style="padding:10px 0;border-bottom:1px solid var(--borde);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.88rem;font-weight:600;">${f.prod.nombre} <span style="font-size:0.62rem;background:var(--bg-secondary);color:var(--texto-3);padding:1px 6px;border-radius:5px;">PLU ${f.prod.plu}</span></div>
            ${multi ? selector : `<div>${selector}</div>`}
          </div>
          <span style="font-size:0.95rem;font-weight:700;color:var(--verde);white-space:nowrap;">${f.cantidad} ${f.prod.unidad_medida||""}</span>
        </div>
      </div>`;
    }).join("");
  }

  if (ignorados.length) {
    html += `<div style="margin-top:14px;padding-top:10px;border-top:2px solid var(--borde);">
      <p style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--texto-3);margin-bottom:8px;">Ignorados (sin PLU en la app)</p>
      ${ignorados.map(i => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.78rem;color:var(--texto-3);"><span>${i.nombre} <span style="opacity:0.6;">· cód ${i.plu}</span></span><span>${i.cantidad}</span></div>`).join("")}
    </div>`;
  }

  cont.innerHTML = html;

  // Listeners de los selectores de sector
  cont.querySelectorAll(".import-sector-sel").forEach(sel => {
    sel.addEventListener("change", () => {
      const idx = parseInt(sel.dataset.idx);
      _filasPreview[idx].sectorElegido = sel.value;
    });
  });

  // Mostrar fecha de corte detectada
  const avisoFecha = document.getElementById("import-fecha-corte");
  if (avisoFecha) {
    if (_fechaCorte) {
      const fStr = _fechaCorte.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });
      avisoFecha.innerHTML = `<div style="background:var(--verde-claro);border:1px solid var(--verde-suave);border-radius:var(--radio-input);padding:9px 12px;font-size:0.82rem;color:var(--texto-2);margin-bottom:12px;">📅 Período del reporte detectado — las ventas quedarán cargadas <b>hasta el ${fStr}</b></div>`;
    } else {
      avisoFecha.innerHTML = `<div style="background:var(--bajo-bg);border:1px solid #F0D9B5;border-radius:var(--radio-input);padding:9px 12px;font-size:0.82rem;color:var(--bajo-txt);margin-bottom:12px;">⚠️ No se detectó la fecha del período en el archivo. La fecha de corte no se actualizará.</div>`;
    }
  }

  // Cambiar de paso
  document.getElementById("import-paso-1").style.display = "none";
  document.getElementById("import-paso-2").style.display = "";
}

// ── Paso 3: confirmar y descontar ─────────────────────────────
async function confirmarImportacion() {
  const btn   = document.getElementById("btn-import-confirmar");
  const msgEl = document.getElementById("msg-import-2");

  const aDescontar = _filasPreview.filter(f =>
    f.esReceta ? (f.sectorReceta && f.ingredientes.length) : f.sectorElegido
  );
  if (!aDescontar.length) {
    msgEl.className = "msg show msg-error";
    msgEl.textContent = "No hay productos con sector para descontar.";
    return;
  }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

  try {
    // Index de productos por id (para resolver ingredientes de recetas)
    const porId = {};
    _productos.forEach(p => { porId[p.id] = p; });

    // Batching por cantidad de operaciones (Firestore: máx 500 por batch).
    // Una venta simple = 2 ops; una receta = 2 ops por ingrediente (+1 si avanza el corte).
    const MAX_OPS = 450;
    let batch = writeBatch(db);
    let ops = 0;
    let ventasProcesadas = 0;
    let ingredientesDescontados = 0;

    const commitSiHaceFalta = async (proximas) => {
      if (ops + proximas > MAX_OPS && ops > 0) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    };

    for (const f of aDescontar) {
      if (f.esReceta) {
        // Calcular ops de esta receta antes de empezar (2 por ingrediente + 1 si avanza corte)
        const avanza = _fechaCorte && debeAvanzar(f.prod.ventas_hasta, _fechaCorte);
        await commitSiHaceFalta(f.ingredientes.length * 2 + (avanza ? 1 : 0));

        const sector = f.sectorReceta;
        for (const ing of f.ingredientes) {
          const materia = porId[ing.id];
          if (!materia) { console.warn(`Receta ${f.prod.nombre}: materia prima ${ing.id} no encontrada, se omite`); continue; }
          const consumo     = ing.cantidad * f.cantidad;
          const stockActual = materia.stock_despacho?.[sector] ?? 0;
          const nuevoStock  = +(stockActual - consumo).toFixed(4); // permite negativo (señal de reposición pendiente)

          batch.update(doc(db, "productos", materia.id), { [`stock_despacho.${sector}`]: nuevoStock });
          const movRef = doc(collection(db, "movimientos"));
          batch.set(movRef, {
            fecha_hora: serverTimestamp(),
            id_usuario: _usuarioActual.uid || null,
            nombre_usuario: _usuarioActual.nombre,
            id_producto: materia.id,
            nombre_producto: materia.nombre,
            tipo: "VENTA",
            cantidad: consumo,
            unidad: materia.unidad_medida,
            motivo: `Consumo receta: ${f.prod.nombre}${f.variante ? " ("+f.variante+")" : ""}`,
            origen: sector,
            destino: "salon"
          });
          ops += 2;
          // Copia local para coherencia entre filas del mismo import
          if (!materia.stock_despacho) materia.stock_despacho = {};
          materia.stock_despacho[sector] = nuevoStock;
          ingredientesDescontados++;
        }

        // Avanzar el corte de la receta misma (para trazabilidad de ventas)
        if (avanza) {
          batch.update(doc(db, "productos", f.prod.id), { ventas_hasta: _fechaCorte });
          f.prod.ventas_hasta = _fechaCorte;
          ops += 1;
        }
        ventasProcesadas++;
        continue;
      }

      // ── Venta simple (despacho directo) ──
      await commitSiHaceFalta(2);
      const sector = f.sectorElegido;
      const stockActual = f.prod.stock_despacho?.[sector] ?? 0;
      const nuevoStock = stockActual - f.cantidad;

      const updateData = { [`stock_despacho.${sector}`]: nuevoStock };
      if (_fechaCorte && debeAvanzar(f.prod.ventas_hasta, _fechaCorte)) {
        updateData.ventas_hasta = _fechaCorte;
        f.prod.ventas_hasta = _fechaCorte;
      }
      batch.update(doc(db, "productos", f.prod.id), updateData);

      const movRef = doc(collection(db, "movimientos"));
      batch.set(movRef, {
        fecha_hora: serverTimestamp(),
        id_usuario: _usuarioActual.uid || null,
        nombre_usuario: _usuarioActual.nombre,
        id_producto: f.prod.id,
        nombre_producto: f.prod.nombre,
        tipo: "VENTA",
        cantidad: f.cantidad,
        unidad: f.prod.unidad_medida,
        motivo: "Importación Excel",
        origen: sector,
        destino: "salon"
      });
      ops += 2;
      if (!f.prod.stock_despacho) f.prod.stock_despacho = {};
      f.prod.stock_despacho[sector] = nuevoStock;
      ventasProcesadas++;
    }

    if (ops > 0) await batch.commit();

    // Paso 3: resultado
    const recetas = aDescontar.filter(f => f.esReceta).length;
    let detalle = `${ventasProcesadas} ${ventasProcesadas === 1 ? "producto procesado" : "productos procesados"}.`;
    if (recetas) detalle += ` ${recetas} ${recetas === 1 ? "receta descontó" : "recetas descontaron"} ${ingredientesDescontados} ${ingredientesDescontados === 1 ? "ingrediente" : "ingredientes"} de materia prima.`;
    document.getElementById("import-resultado-detalle").textContent = detalle;
    document.getElementById("import-paso-2").style.display = "none";
    document.getElementById("import-paso-3").style.display = "";
    _onTerminado();
  } catch (err) {
    msgEl.className = "msg show msg-error";
    msgEl.textContent = "Error al descontar: " + err.message;
  } finally {
    btn.disabled = false; btn.innerHTML = "Confirmar y descontar";
  }
}
