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
