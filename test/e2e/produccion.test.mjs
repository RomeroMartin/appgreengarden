// E2E (vista Gerente): receta de producción. Al hacer Ingreso Producción de un
// producto con receta de producción, se descuentan sus insumos del ACOPIO en el
// mismo batch, dejando un movimiento por insumo (RETIRO → producción).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, setSelect, setValue, click, $ } from "../harness/env.mjs";

before(async () => {
  seedDefaults({
    role: "Gerente",
    seed: {
      productos: [
        { id: "p-harina", nombre: "Harina", plu: "", rubro: "Insumos", sector: "Cocina",
          unidad_medida: "kg", tipo: "Materia prima", sectores_asignados: [],
          stock_deposito: 100, stock_despacho: {}, stock_minimo: null },
        { id: "p-papa", nombre: "Papa", plu: "", rubro: "Insumos", sector: "Cocina",
          unidad_medida: "kg", tipo: "Materia prima", sectores_asignados: [],
          stock_deposito: 200, stock_despacho: {}, stock_minimo: null },
        // Ñoqui: producto de despacho con receta de producción (por porción)
        { id: "p-noqui", nombre: "Ñoqui de papa", plu: "500", rubro: "Cocina", sector: "Cocina",
          unidad_medida: "Porciones", tipo: "Despacho", sectores_asignados: ["Barra"],
          stock_deposito: 0, stock_despacho: { Barra: 0 }, stock_minimo: null,
          receta_produccion: [
            { id: "p-harina", nombre: "Harina", cantidad: 0.2, unidad: "kg", cant_in: 0.2, unidad_in: "kg" },
            { id: "p-papa",   nombre: "Papa",   cantidad: 0.5, unidad: "kg", cant_in: 0.5, unidad_in: "kg" },
          ] },
      ],
    },
  });
  await loadView("gerente");
});

test("Ingreso Producción de un plato descuenta sus insumos del acopio", async () => {
  await click("btn-mov-entrada");
  setSelect("ent-tipo", "INGRESO_PRODUCCION");
  setSelect("ent-producto", "p-noqui");
  setValue("ent-cantidad", "50");
  const movsAntes = store.count("movimientos");
  await click("btn-confirmar-entrada");

  // Plato: +50 al acopio
  assert.equal(store.get("productos", "p-noqui").stock_deposito, 50, "ñoqui +50");
  // Insumos: harina −0.2×50=10 (100→90), papa −0.5×50=25 (200→175)
  assert.equal(store.get("productos", "p-harina").stock_deposito, 90, "harina −10");
  assert.equal(store.get("productos", "p-papa").stock_deposito, 175, "papa −25");
  // Movimientos: 1 Ingreso Producción + 2 consumos
  assert.equal(store.count("movimientos"), movsAntes + 3, "1 ingreso + 2 consumos");
  const movs = store.dump("movimientos");
  const ingreso = movs.find(m => m.tipo === "INGRESO_PRODUCCION" && m.id_producto === "p-noqui");
  assert.ok(ingreso, "hay movimiento de Ingreso Producción");
  assert.equal(ingreso.consumo_produccion.length, 2, "guarda el resumen de consumo");
  const consumos = movs.filter(m => m.motivo === "Consumo producción: Ñoqui de papa");
  assert.equal(consumos.length, 2, "un movimiento por insumo");
  assert.ok(consumos.every(c => c.tipo === "RETIRO" && c.destino === "produccion" && c.produccion_id === ingreso.id),
    "los consumos son RETIRO → producción y enlazan con la producción");
});

test("producir sin stock suficiente de insumo deja el insumo negativo (no bloquea)", async () => {
  await click("btn-mov-entrada");
  setSelect("ent-tipo", "INGRESO_PRODUCCION");
  setSelect("ent-producto", "p-noqui");
  setValue("ent-cantidad", "1000");           // 1000×0.2 = 200 de harina, hay 90
  await click("btn-confirmar-entrada");
  assert.ok(store.get("productos", "p-harina").stock_deposito < 0, "harina queda negativa");
});

test("el editor guarda la receta de producción de un producto nuevo", async () => {
  await click("btn-nuevo-producto");               // tipo Despacho por defecto
  setValue("prod-nombre", "Milanesa");
  const cb = $('.check-despacho[value="Barra"]'); cb.checked = true;
  // Agregar insumo Harina (0.3 kg por porción) en el editor de receta de producción
  setSelect("prodrec-mat", "p-harina");
  setValue("prodrec-cant", "0.3");
  await click("prodrec-add");
  await click("btn-guardar-producto");
  const nuevo = store.dump("productos").find(p => p.nombre === "Milanesa");
  assert.ok(nuevo, "se creó el producto");
  assert.equal(nuevo.receta_produccion.length, 1, "guardó 1 insumo");
  assert.equal(nuevo.receta_produccion[0].id, "p-harina");
  assert.equal(nuevo.receta_produccion[0].cantidad, 0.3);
});
