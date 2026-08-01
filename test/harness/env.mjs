// ============================================================
// env.mjs — Monta una vista REAL (HTML + su .js) sobre jsdom con el
// Firebase falso, simula el login y expone helpers para clickear la UI.
// Un archivo de test = una vista = un proceso (node --test aísla por archivo).
// ============================================================
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import * as S from "./store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let _dom = null;

export const store = S;

// ── Catálogo base realista (se puede extender por test) ───────
// opts.role: rol del usuario logueado (debe coincidir con el que exige la vista)
// opts.seed: colecciones extra a sembrar { coleccion: [docs] }
export function seedDefaults(opts = {}) {
  const { role = "Gerente", seed: extra = {} } = opts;
  S.reset();
  S.seed("usuarios", [{ id: "uid-test", nombre: "Tester", rol: role, activo: true }]);
  S.seed("rubros", [{ id: "r1", nombre: "Bebidas" }, { id: "r2", nombre: "Insumos" }]);
  S.seed("sectores", [{ id: "s1", nombre: "Cocina" }, { id: "s2", nombre: "Barra" }]);
  S.seed("sectores_despacho", [{ id: "d1", nombre: "Barra" }, { id: "d2", nombre: "Salon" }]);
  S.seed("motivos_salida", [
    { id: "m1", nombre: "1 - Reposición", transfiere: true },
    { id: "m2", nombre: "2 - Vencimiento", transfiere: false },
  ]);
  S.seed("productos", [
    // Despacho con dos sectores
    { id: "p-cerveza", nombre: "Cerveza", plu: "101", rubro: "Bebidas", sector: "Barra",
      unidad_medida: "Unidad", tipo: "Despacho", sectores_asignados: ["Barra", "Salon"],
      stock_deposito: 20, stock_despacho: { Barra: 10, Salon: 5 }, stock_minimo: 3 },
    // Materia prima (acopio)
    { id: "p-limon", nombre: "Limón", plu: "", rubro: "Insumos", sector: "Cocina",
      unidad_medida: "kg", tipo: "Insumo", sectores_asignados: [],
      stock_deposito: 8, stock_despacho: {}, stock_minimo: null },
    // Receta simple que consume Limón desde "Barra"
    { id: "p-limonada", nombre: "Limonada", plu: "201", rubro: "Bebidas", sector: "Barra",
      unidad_medida: "Unidad", tipo: "Receta", por_variantes: false, sector_receta: "Barra",
      ingredientes: [{ id: "p-limon", nombre: "Limón", cantidad: 0.2, unidad: "kg" }],
      variantes: [], stock_deposito: 0, stock_despacho: {} },
  ]);
  for (const [name, docs] of Object.entries(extra)) S.seed(name, docs);
}

// ── Cargar la vista real ──────────────────────────────────────
export async function loadView(viewName, { user } = {}) {
  globalThis.__AUTH_USER = user || { uid: "uid-test", email: "test@greengarden.app" };
  globalThis.__CONFIRM__ = true;
  globalThis.__XLSX_ROWS = [];

  const html = readFileSync(join(ROOT, "vistas", viewName + ".html"), "utf8");
  const dom = new JSDOM(html, {
    url: "https://app.test/vistas/" + viewName + ".html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  _dom = dom;
  const w = dom.window;

  // Globals que el código de la vista espera encontrar. Algunos (navigator) son
  // de solo-lectura en Node → se ignoran con try/catch.
  for (const k of ["window", "document", "CustomEvent", "Event", "Node", "MouseEvent",
                   "HTMLElement", "getComputedStyle", "requestAnimationFrame",
                   "cancelAnimationFrame", "FileReader", "Blob", "DOMParser"]) {
    if (w[k] !== undefined) { try { globalThis[k] = w[k]; } catch {} }
  }
  // El código de las vistas llama a confirm()/alert() como globales (no window.*),
  // y en Node esos globales no existen → hay que ponerlos en globalThis también.
  w.confirm = globalThis.confirm = () => globalThis.__CONFIRM__;
  w.alert   = globalThis.alert   = () => {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  w.scrollTo = () => {};

  // Importa el módulo real de la vista (cache-bust para reejecutar top-level)
  const url = pathToFileURL(join(ROOT, "js", viewName + ".js")).href + "?t=" + Date.now();
  await import(url);
  await flush();          // deja correr onAuthStateChanged + usuarioListo + onSnapshot
  return { dom, window: w, document: w.document };
}

// ── Utilidades de interacción ─────────────────────────────────
export const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const doc = () => _dom.window.document;
export const $  = (sel) => doc().querySelector(sel);
export const $$ = (sel) => [...doc().querySelectorAll(sel)];
export const byId = (id) => doc().getElementById(id);
export const text = (id) => (byId(id)?.textContent ?? "").trim();

export function setValue(id, val) {
  const el = byId(id);
  if (!el) throw new Error("setValue: no existe #" + id);
  el.value = String(val);
  el.dispatchEvent(new _dom.window.Event("input", { bubbles: true }));
  el.dispatchEvent(new _dom.window.Event("change", { bubbles: true }));
}
export function setSelect(id, val) { setValue(id, val); }

export async function click(id) {
  const el = byId(id);
  if (!el) throw new Error("click: no existe #" + id);
  el.dispatchEvent(new _dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await flush();
}

// Simula subir un Excel: inyecta las filas y dispara el change del <input file>
export async function uploadExcel(inputId, rows) {
  globalThis.__XLSX_ROWS = rows;
  const el = byId(inputId);
  const fakeFile = { name: "ventas.xlsx", arrayBuffer: async () => new ArrayBuffer(8) };
  Object.defineProperty(el, "files", { value: [fakeFile], configurable: true });
  el.dispatchEvent(new _dom.window.Event("change", { bubbles: true }));
  await flush(10);
}

export const setConfirm = (v) => { globalThis.__CONFIRM__ = v; };
