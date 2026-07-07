// ============================================================
// corte-ventas.js — Corte de ventas POR PRODUCTO (v3.4)
// Cada producto de despacho guarda su propio "ventas_hasta".
// Regla: solo avanza, nunca retrocede.
// Las materias primas quedan fuera de este sistema.
// ============================================================

const esDespacho = (p) => p.tipo === "Despacho";

// ── Helpers de fecha ──────────────────────────────────────────
function aFecha(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();        // Timestamp Firestore
  if (val instanceof Date) return val;
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

export function ventasHastaDe(p) {
  return aFecha(p.ventas_hasta);
}

// Decide si hay que actualizar: true si la nueva fecha es más reciente
export function debeAvanzar(productoActualValor, nuevaFecha) {
  const actual = aFecha(productoActualValor);
  if (!actual) return true;
  return nuevaFecha > actual;
}

// ── Formateo ──────────────────────────────────────────────────
export function formatearFecha(fecha, conHora) {
  if (!fecha) return "sin ventas";
  const f = aFecha(fecha);
  if (!f) return "sin ventas";
  const fecha_str = f.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  if (conHora) {
    const hora = f.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    return `${fecha_str} ${hora}`;
  }
  return fecha_str;
}

// ── Cálculo del resumen (solo productos de despacho) ──────────
// Devuelve { masReciente, masAtrasada, totalDespacho, conVentas, atrasados, sinVentas }
export function calcularResumen(productos) {
  const despacho = productos.filter(esDespacho);
  let masReciente = null, masAtrasada = null;
  let conVentas = 0, sinVentas = 0;

  despacho.forEach(p => {
    const f = ventasHastaDe(p);
    if (!f) { sinVentas++; return; }
    conVentas++;
    if (!masReciente || f > masReciente) masReciente = f;
    if (!masAtrasada || f < masAtrasada) masAtrasada = f;
  });

  // Atrasados: productos con ventas cuya fecha (por día) es anterior a la más reciente
  let atrasados = 0;
  if (masReciente) {
    const refDia = new Date(masReciente.getFullYear(), masReciente.getMonth(), masReciente.getDate());
    despacho.forEach(p => {
      const f = ventasHastaDe(p);
      if (!f) return;
      const fDia = new Date(f.getFullYear(), f.getMonth(), f.getDate());
      if (fDia < refDia) atrasados++;
    });
  }

  return { masReciente, masAtrasada, totalDespacho: despacho.length, conVentas, atrasados, sinVentas };
}

// ¿Este producto está atrasado respecto a la fecha más reciente del sistema?
export function estaAtrasado(producto, masReciente) {
  if (!esDespacho(producto) || !masReciente) return false;
  const f = ventasHastaDe(producto);
  if (!f) return false; // sin ventas no es "atrasado", es "sin cargar"
  const refDia = new Date(masReciente.getFullYear(), masReciente.getMonth(), masReciente.getDate());
  const fDia = new Date(f.getFullYear(), f.getMonth(), f.getDate());
  return fDia < refDia;
}

// ── Render del panel resumen ──────────────────────────────────
export function renderResumen(contenedorId, productos) {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;
  const r = calcularResumen(productos);

  if (!r.totalDespacho) { cont.innerHTML = ""; return; }

  const recienteStr = r.masReciente ? formatearFecha(r.masReciente, false) : "—";
  let detalle = "";
  if (r.atrasados > 0) {
    detalle = `<span style="color:var(--bajo-txt);font-weight:600;">${r.atrasados} ${r.atrasados===1?"producto atrasado":"productos atrasados"}</span>`;
  } else if (r.conVentas > 0) {
    detalle = `<span style="color:var(--verde);font-weight:600;">Todo al día</span>`;
  }
  const sinCargar = r.sinVentas > 0 ? ` · ${r.sinVentas} sin ventas cargadas` : "";

  const hayAtraso = r.atrasados > 0;
  cont.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;background:${hayAtraso ? 'var(--bajo-bg)' : 'var(--verde-claro)'};border:1px solid ${hayAtraso ? '#F0D9B5' : 'var(--verde-suave)'};border-radius:var(--radio-input);padding:10px 14px;">
      <span style="font-size:1.2rem;">${hayAtraso ? '⚠️' : '📅'}</span>
      <div style="flex:1;">
        <div style="font-size:0.68rem;color:var(--texto-3);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Ventas cargadas</div>
        <div style="font-size:0.9rem;font-weight:700;color:var(--texto);">Más reciente: ${recienteStr}</div>
        <div style="font-size:0.78rem;margin-top:2px;">${detalle}${sinCargar}</div>
      </div>
    </div>`;
}

// ── Badge individual por producto (para el listado) ───────────
// Devuelve HTML del badge o "" si no corresponde (materia prima)
export function badgeProducto(producto, masReciente) {
  if (!esDespacho(producto)) return ""; // materias primas: nada
  const f = ventasHastaDe(producto);
  if (!f) {
    return `<span style="font-size:0.68rem;color:var(--texto-3);">📅 sin ventas cargadas</span>`;
  }
  const atrasado = estaAtrasado(producto, masReciente);
  const color = atrasado ? "var(--bajo-txt)" : "var(--texto-3)";
  const icono = atrasado ? "⚠️" : "📅";
  const etiqueta = atrasado ? " (atrasado)" : "";
  return `<span style="font-size:0.68rem;color:${color};font-weight:${atrasado?'600':'400'};">${icono} ventas al ${formatearFecha(f, false)}${etiqueta}</span>`;
}
