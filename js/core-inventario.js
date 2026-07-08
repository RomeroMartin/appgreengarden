// ============================================================
// core-inventario.js — Helpers compartidos entre los paneles.
// Funciones PURAS (sin estado propio): reciben lo que necesitan por
// parámetro o leen el DOM por IDs que son iguales en todas las vistas.
// Antes estaban duplicadas en gerente/administrador/encargado/salidas/
// entradas; centralizarlas evita que un fix se aplique en un panel y se
// olvide en otro.
// ============================================================

// Escapa datos antes de inyectarlos por innerHTML (evita XSS via nombres/motivos).
export function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Redondeo SOLO para mostrar (máx 2 decimales, sin ceros sobrantes).
// No toca el valor real guardado. (6 → 6, 1.4571 → 1.46, 1.5 → 1.5)
export function fmtN(n) {
  const x = Number(n) || 0;
  return +x.toFixed(2);
}

export function esDespacho(p) { return p.tipo === "Despacho"; }
export function esReceta(p)   { return p.tipo === "Receta"; }
export function sectoresDe(p) { return p.sectores_asignados ?? []; }

// Stock total = acopio + suma de todos los sectores de despacho.
export function stockTotal(p) {
  const dep = p.stock_deposito ?? 0;
  const des = p.stock_despacho ?? {};
  return dep + Object.values(des).reduce((a, b) => a + (b || 0), 0);
}

// Badge de alerta según el stock total vs el mínimo. Devuelve {cls,label} o null.
export function getBadge(p) {
  const total = stockTotal(p);
  const min = p.stock_minimo;
  if (min == null || min === "") return null;
  if (total <= 0)   return { cls: "critico", label: "Sin stock" };
  if (total <= min) return { cls: "critico", label: "Bajo mínimo" };
  return null;
}

// ¿El acopio está en cero o en/bajo el mínimo? (habilita retiro desde despacho)
export function acopioBajoOcero(p) {
  const dep = p.stock_deposito ?? 0;
  const min = p.stock_minimo;
  if (dep <= 0) return true;
  if (min != null && min !== "" && dep <= min) return true;
  return false;
}

// Origen elegido del retiro: "acopio" o el nombre de un sector de despacho.
export function origenRetiroActual() {
  const g = document.getElementById("sal-grupo-origen");
  if (g && g.style.display !== "none") return document.getElementById("sal-origen").value || "acopio";
  return "acopio";
}

// Fecha → string "YYYY-MM-DDTHH:MM" para inputs datetime-local.
export function aDatetimeLocal(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Motivos de salida por defecto (se usan hasta que Firestore trae los configurados).
export const MOTIVOS_SALIDA_DEFAULT = [
  { nombre: "Retiro para uso", transfiere: false },
  { nombre: "Merma / Desperdicio", transfiere: false },
  { nombre: "Vencimiento", transfiere: false },
  { nombre: "Rotura", transfiere: false },
  { nombre: "Reposición", transfiere: true }
];

// Llena el <select id="sal-motivo"> según el producto elegido y la lista de
// motivos. Materia prima: oculta los motivos que transfieren a despacho.
// Default: mantiene la selección previa; si no hay, preselecciona "Reposición".
export function poblarMotivosSalida(productos, motivosSalida) {
  const prod = productos.find(p => p.id === document.getElementById("sal-producto")?.value);
  const sel = document.getElementById("sal-motivo");
  if (!sel) return;
  const actual = sel.value;
  const lista = (prod && !esDespacho(prod)) ? motivosSalida.filter(m => !m.transfiere) : motivosSalida;
  sel.innerHTML = lista.map(m => `<option value="${escHtml(m.nombre)}">${escHtml(m.nombre)}</option>`).join("");
  if (lista.some(m => m.nombre === actual)) sel.value = actual;
  else if (lista.some(m => m.nombre === "Reposición")) sel.value = "Reposición";
}
