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
// Van numerados: el prefijo "N - " fija el ORDEN en que se muestran y cuál queda
// como default (el 1). Reposición = 1 para que siga siendo el motivo por defecto.
export const MOTIVOS_SALIDA_DEFAULT = [
  { nombre: "1 - Reposición", transfiere: true },
  { nombre: "2 - Vencimiento", transfiere: false },
  { nombre: "3 - Rotura", transfiere: false },
  { nombre: "4 - Merma / Desperdicio", transfiere: false },
  { nombre: "5 - Retiro para uso", transfiere: false }
];

// Número inicial del nombre del motivo ("2 - Vencimiento" → 2). Los motivos sin
// número van al final. Así el orden lo controla el prefijo numérico que configura
// el Gerente (1 - …, 2 - …), sin depender de nombres fijos.
function numeroMotivo(m) {
  const x = parseInt(String(m?.nombre ?? "").trim(), 10);
  return Number.isNaN(x) ? Infinity : x;
}

// Ordena los motivos por su prefijo numérico (1, 2, 3…); los que no tengan número
// quedan al final, en orden alfabético.
export function ordenarMotivos(lista) {
  return [...(lista || [])].sort((a, b) =>
    (numeroMotivo(a) - numeroMotivo(b)) || String(a?.nombre ?? "").localeCompare(String(b?.nombre ?? "")));
}

// Motivo por defecto de un listado YA ORDENADO. Si hay motivos numerados, es el
// primero (el de menor número → "1 - Reposición"). Si NINGUNO está numerado
// (configuración vieja sin números), cae al de "Reposición" para no cambiar el
// comportamiento previo. Devuelve "" si la lista está vacía.
export function motivoPorDefecto(listaOrdenada) {
  if (!listaOrdenada.length) return "";
  if (numeroMotivo(listaOrdenada[0]) !== Infinity) return listaOrdenada[0].nombre;
  const repo = listaOrdenada.find(m => /reposici[oó]n/i.test(m.nombre));
  return repo ? repo.nombre : listaOrdenada[0].nombre;
}

// Llena el <select id="sal-motivo"> según el producto elegido y la lista de
// motivos, SIEMPRE en orden numérico. Materia prima: oculta los motivos que
// transfieren a despacho. Default: mantiene la selección previa; si no hay,
// preselecciona el primero en orden (el "1 -", normalmente Reposición).
export function poblarMotivosSalida(productos, motivosSalida) {
  const prod = productos.find(p => p.id === document.getElementById("sal-producto")?.value);
  const sel = document.getElementById("sal-motivo");
  if (!sel) return;
  const actual = sel.value;
  const filtrada = (prod && !esDespacho(prod)) ? motivosSalida.filter(m => !m.transfiere) : motivosSalida;
  const lista = ordenarMotivos(filtrada);
  sel.innerHTML = lista.map(m => `<option value="${escHtml(m.nombre)}">${escHtml(m.nombre)}</option>`).join("");
  if (lista.some(m => m.nombre === actual)) sel.value = actual;
  else sel.value = motivoPorDefecto(lista);
}

// Reasegura el motivo por defecto (el primero en orden numérico, el "1 -") y
// refresca la vista. Se llama al volver a la app: si el usuario cambió de
// pantalla en el celu (ej. fue al bloc de notas) y vuelve, el motivo no debe
// quedar seteado en otro valor por accidente. Es genérico: toma el default del
// propio <select> ya ordenado, no de un nombre fijo.
export function fijarMotivoReposicion(onRefrescar) {
  const sel = document.getElementById("sal-motivo");
  if (sel && sel.options.length) {
    const def = motivoPorDefecto(ordenarMotivos([...sel.options].map(o => ({ nombre: o.value }))));
    if (def && sel.value !== def) sel.value = def;
  }
  if (typeof onRefrescar === "function") onRefrescar();
}

// Instala el "candado": cada vez que la app vuelve a estar VISIBLE (el usuario
// volvió de otra app/pantalla) reasegura el motivo por defecto (el "1 -"). Usa
// visibilitychange y el pageshow restaurado desde bfcache —NO 'focus'— para no
// pisar la selección mientras el usuario abre el desplegable y elige un motivo a
// mano dentro de la app (abrir un <select> nativo no dispara visibilitychange).
export function instalarCandadoMotivoReposicion(onRefrescar) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fijarMotivoReposicion(onRefrescar);
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) fijarMotivoReposicion(onRefrescar);
  });
}
