// E2E importación de ventas (casos borde) — vista Gerente.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, $, click, text, uploadExcel, setConfirm, win } from "../harness/env.mjs";

const PERIODO = ["Periodo", "01/03/2026", "15/03/2026"];
const excel = (filas) => [PERIODO, ...filas];

before(async () => {
  seedDefaults({
    role: "Gerente",
    seed: {
      productos: [
        // single sector → sin selector
        { id: "p-agua", nombre: "Agua", plu: "102", rubro: "Bebidas", sector: "Barra",
          unidad_medida: "Unidad", tipo: "Despacho", sectores_asignados: ["Barra"],
          stock_deposito: 0, stock_despacho: { Barra: 50 } },
        // multi sector → con selector
        { id: "p-multi", nombre: "Multi", plu: "103", rubro: "Bebidas", sector: "Barra",
          unidad_medida: "Unidad", tipo: "Despacho", sectores_asignados: ["Barra", "Salon"],
          stock_deposito: 0, stock_despacho: { Barra: 30, Salon: 30 } },
        // materia prima para recetas
        { id: "p-gin", nombre: "Gin", plu: "", rubro: "Insumos", sector: "Barra",
          unidad_medida: "Unidad", tipo: "Materia prima", sectores_asignados: [],
          stock_deposito: 0, stock_despacho: {} },
        // receta por variantes (Nacional / Importado), matchea por columna Tamanio
        { id: "p-gintonic", nombre: "Gin Tonic", plu: "202", rubro: "Bebidas", sector: "Barra",
          unidad_medida: "Unidad", tipo: "Receta", por_variantes: true, sector_receta: null,
          ingredientes: [],
          variantes: [
            { tamano: "Nacional",  sector: "Barra", ingredientes: [{ id: "p-gin", nombre: "Gin", cantidad: 0.1, unidad: "Unidad" }] },
            { tamano: "Importado", sector: "Barra", ingredientes: [{ id: "p-gin", nombre: "Gin", cantidad: 0.15, unidad: "Unidad" }] },
          ],
          stock_deposito: 0, stock_despacho: {} },
      ],
    },
  });
  await loadView("gerente");
});

beforeEach(() => setConfirm(true));

test("PLU inexistente cae en 'ignorados' y no descuenta nada", async () => {
  const movs = store.count("movimientos");
  await uploadExcel("import-file", excel([[9999, "Fantasma", 5, 0, ""]]));
  assert.match(text("import-count-ignorados"), /1/);
  // No hay filas para descontar → el botón confirmar avisa; el stock no cambia
  await click("btn-import-confirmar");
  assert.equal(store.count("movimientos"), movs, "no se creó ningún movimiento");
});

test("descuenta de un producto de un solo sector (sin selector)", async () => {
  const antes = store.get("productos", "p-agua").stock_despacho.Barra;
  await uploadExcel("import-file", excel([[102, "Agua", 8, 0, ""]]));
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-agua").stock_despacho.Barra, antes - 8);
});

test("con multi-sector, elegir otro sector descuenta de ESE sector", async () => {
  const barra = store.get("productos", "p-multi").stock_despacho.Barra;
  const salon = store.get("productos", "p-multi").stock_despacho.Salon;
  await uploadExcel("import-file", excel([[103, "Multi", 6, 0, ""]]));
  const sel = $(".import-sector-sel");
  assert.ok(sel, "hay selector de sector para producto multi-sector");
  sel.value = "Salon";
  sel.dispatchEvent(new (win().Event)("change", { bubbles: true }));
  await click("btn-import-confirmar");
  const p = store.get("productos", "p-multi");
  assert.equal(p.stock_despacho.Salon, salon - 6, "descontó de Salon");
  assert.equal(p.stock_despacho.Barra, barra, "Barra intacto");
});

test("mismo PLU+tamaño en dos filas se SUMA y descuenta una sola vez", async () => {
  const antes = store.get("productos", "p-agua").stock_despacho.Barra;
  await uploadExcel("import-file", excel([[102, "Agua", 3, 0, ""], [102, "Agua", 4, 0, ""]]));
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-agua").stock_despacho.Barra, antes - 7, "3+4 = 7 en un solo descuento");
});

test("receta por variantes: matchea la variante por la columna Tamanio", async () => {
  const antes = store.get("productos", "p-gin").stock_despacho?.Barra ?? 0;
  // 2 Nacional (0.1) + 3 Importado (0.15) = 0.2 + 0.45 = 0.65
  await uploadExcel("import-file", excel([[202, "Gin Tonic", 2, 0, "Nacional"], [202, "Gin Tonic", 3, 0, "Importado"]]));
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-gin").stock_despacho.Barra, +(antes - 0.65).toFixed(4));
});

test("receta con variante NO configurada no descuenta", async () => {
  const antes = store.get("productos", "p-gin").stock_despacho?.Barra ?? 0;
  const movs = store.count("movimientos");
  await uploadExcel("import-file", excel([[202, "Gin Tonic", 5, 0, "XL"]]));
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-gin").stock_despacho.Barra, antes, "no descontó la variante desconocida");
  assert.equal(store.count("movimientos"), movs, "sin movimientos");
});

test("sin fila de 'periodo' descuenta igual pero NO fija ventas_hasta", async () => {
  const p0 = store.get("productos", "p-agua");
  const vhAntes = p0.ventas_hasta ?? null;
  const antes = p0.stock_despacho.Barra;
  // Excel sin encabezado de periodo
  await uploadExcel("import-file", [[102, "Agua", 2, 0, ""]]);
  await click("btn-import-confirmar");
  const p = store.get("productos", "p-agua");
  assert.equal(p.stock_despacho.Barra, antes - 2, "descuenta igual");
  assert.deepEqual(p.ventas_hasta ?? null, vhAntes ?? null, "ventas_hasta no cambió");
});

// ── PARSER JERÁRQUICO: ignora rubros y no suma re-listas ──────
test("ignora la fila de RUBRO (código corto con total) — no la carga como venta", async () => {
  const antes = store.get("productos", "p-agua").stock_despacho.Barra;
  // Fila de rubro [10, "BEBIDAS", 999] no debe tocar nada; solo el producto 102.
  await uploadExcel("import-file", excel([
    [10, "BEBIDAS", 999, 0, ""],   // RUBRO (código < 100 + total) → se ignora
    [102, "Agua", 4, 0, ""],       // producto real
  ]));
  assert.match(text("import-count-ignorados"), /0/, "el rubro no aparece como ignorado");
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-agua").stock_despacho.Barra, antes - 4, "descontó solo el producto");
});

test("re-lista del mismo producto bajo otra subcategoría NO se suma (doble conteo del reporte)", async () => {
  const antes = store.get("productos", "p-agua").stock_despacho.Barra;
  await uploadExcel("import-file", excel([
    [10, "BEBIDAS", 8, 0, ""],     // rubro
    [102, "Agua", 8, 0, ""],       // producto bajo el rubro
    [40, "PROMOS", "", "", ""],    // SUBCATEGORÍA (código corto, sin cantidad)
    [102, "Agua", 8, 0, ""],       // MISMA venta re-listada bajo otra subcat → se ignora
  ]));
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-agua").stock_despacho.Barra, antes - 8, "descontó 8, no 16");
});

test("mismo producto dos veces en la MISMA subcategoría (dos precios) SÍ suma", async () => {
  const antes = store.get("productos", "p-agua").stock_despacho.Barra;
  await uploadExcel("import-file", excel([
    [10, "BEBIDAS", 5, 0, ""],     // rubro
    [102, "Agua", 3, 0, ""],       // misma subcategoría (bajo el rubro)
    [102, "Agua", 2, 0, ""],       // consecutiva, misma subcat → suma
  ]));
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-agua").stock_despacho.Barra, antes - 5, "3+2 = 5");
});

// ── ANULAR CARGA MASIVA ───────────────────────────────────────
test("cada importación registra un lote anulable", async () => {
  const antesLotes = store.count("lotes_importacion");
  await uploadExcel("import-file", excel([[102, "Agua", 5, 0, ""]]));
  await click("btn-import-confirmar");
  assert.equal(store.count("lotes_importacion"), antesLotes + 1, "se creó un lote");
  const lote = store.dump("lotes_importacion").find(l => !l.anulado && l.total_movimientos === 1);
  assert.ok(lote, "el lote guarda su resumen");
  assert.ok((lote.deltas || []).length, "el lote guarda los deltas para revertir");
});

test("anular una carga devuelve el stock, deja un movimiento de reversión y restaura el corte", async () => {
  const p0 = store.get("productos", "p-agua");
  const stockAntes = p0.stock_despacho.Barra;
  const vhAntes    = p0.ventas_hasta ?? null;
  const movsAntes  = store.count("movimientos");
  const idsAntes   = new Set(store.dump("lotes_importacion").map(l => l.id));

  // Cargar: descuenta 9 de Agua y fija ventas_hasta al 15/03/2026
  await uploadExcel("import-file", excel([[102, "Agua", 9, 0, ""]]));
  await click("btn-import-confirmar");
  const pTrasCarga = store.get("productos", "p-agua");
  assert.equal(pTrasCarga.stock_despacho.Barra, stockAntes - 9, "descontó la carga");
  assert.equal(store.count("movimientos"), movsAntes + 1, "creó 1 movimiento");

  // Identificar el lote recién creado y anularlo por la UI (pasa por el confirm)
  const lote = store.dump("lotes_importacion").find(l => !idsAntes.has(l.id));
  assert.ok(lote, "hay un lote nuevo");
  setConfirm(true);
  win().anularCargaUI(lote.id);
  await click("btn-confirm-ok");

  const pFinal = store.get("productos", "p-agua");
  assert.equal(pFinal.stock_despacho.Barra, stockAntes, "el stock volvió a su valor previo");
  // La VENTA de la carga se borra, pero queda un movimiento ANULACION auditable
  // (el contador nunca cambia en silencio): neto = movsAntes + 1 reversión.
  const movs = store.dump("movimientos");
  assert.equal(movs.filter(m => m.lote_id === lote.id).length, 0, "no queda ninguna VENTA de la carga");
  const rev = movs.filter(m => m.tipo === "ANULACION" && m.anulacion_lote_id === lote.id);
  assert.equal(rev.length, 1, "quedó 1 movimiento de reversión");
  assert.equal(rev[0].cantidad, 9, "la reversión devuelve las 9 unidades");
  assert.equal(rev[0].destino, "Barra", "la reversión reingresa al sector Barra");
  assert.equal(store.count("movimientos"), movsAntes + 1, "queda solo la reversión");
  assert.deepEqual(_ms(pFinal.ventas_hasta), _ms(vhAntes), "ventas_hasta se restauró");
  assert.equal(store.get("lotes_importacion", lote.id).anulado, true, "el lote queda marcado como anulado");
});

// ms de un Ts/Date/null para comparar fechas de corte
function _ms(v) { return v == null ? null : (v.toDate ? v.toDate().getTime() : (v instanceof Date ? v.getTime() : new Date(v).getTime())); }
