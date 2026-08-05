// E2E (vista Gerente): al cambiar el rendimiento de una materia prima, las
// recetas que la usan EN SUBUNIDAD recalculan su cantidad base (lo que descuenta
// del stock el importador), sin tener que reabrir y volver a guardar cada receta.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, setValue, click, callGlobal } from "../harness/env.mjs";

const wait = (ms) => new Promise(r => setTimeout(r, ms)); // abrirEditarProducto puebla campos en un setTimeout(50)

before(async () => {
  seedDefaults({
    role: "Gerente",
    seed: {
      productos: [
        // Materia prima con fracción: 1 botella = 700 ml
        { id: "p-gin", nombre: "Gin", plu: "", rubro: "Bebidas", sector: "Barra",
          unidad_medida: "botella", tipo: "Materia prima", sectores_asignados: [],
          rendimiento: 700, subunidad: "ml",
          stock_deposito: 5, stock_despacho: {}, stock_minimo: null },
        // Receta que usa 60 ml de Gin → cantidad base = 60/700 botellas
        { id: "p-gintonic", nombre: "Gin Tonic", plu: "202", rubro: "Bebidas", sector: "Barra",
          unidad_medida: "Unidad", tipo: "Receta", por_variantes: false, sector_receta: "Barra",
          ingredientes: [{ id: "p-gin", nombre: "Gin", cantidad: +(60/700).toFixed(6),
                           unidad: "botella", cant_in: 60, unidad_in: "ml" }],
          variantes: [], stock_deposito: 0, stock_despacho: {} },
      ],
    },
  });
  await loadView("gerente");
});

test("cambiar el rendimiento recalcula la cantidad base de la receta que usa el producto en subunidad", async () => {
  assert.equal(store.get("productos", "p-gintonic").ingredientes[0].cantidad, +(60/700).toFixed(6));
  await callGlobal("abrirEditarProducto", "p-gin");
  await wait(80);                       // dejar que el setTimeout(50) puble rendimiento/subunidad
  setValue("prod-rendimiento", "750");  // ahora 1 botella = 750 ml
  await click("btn-guardar-producto");
  // 60 ml / 750 = 0.08 botellas (antes 60/700 ≈ 0.085714)
  assert.equal(store.get("productos", "p-gin").rendimiento, 750);
  assert.equal(store.get("productos", "p-gintonic").ingredientes[0].cantidad, +(60/750).toFixed(6));
  // cant_in / unidad_in se mantienen (lo que el usuario tipeó)
  assert.equal(store.get("productos", "p-gintonic").ingredientes[0].cant_in, 60);
  assert.equal(store.get("productos", "p-gintonic").ingredientes[0].unidad_in, "ml");
});
