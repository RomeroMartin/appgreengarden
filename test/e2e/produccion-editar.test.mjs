// E2E (vista Gerente): editar/eliminar un Ingreso Producción revierte también los
// insumos consumidos (caso "se cargó mal"), y borra sus movimientos enlazados.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, setSelect, setValue, click, callGlobal } from "../harness/env.mjs";

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

async function producir(cantidad) {
  await click("btn-mov-entrada");
  setSelect("ent-tipo", "INGRESO_PRODUCCION");
  setSelect("ent-producto", "p-noqui");
  setValue("ent-cantidad", String(cantidad));
  await click("btn-confirmar-entrada");
  return store.dump("movimientos").find(m => m.tipo === "INGRESO_PRODUCCION" && m.id_producto === "p-noqui" && m.cantidad === cantidad);
}

test("eliminar un Ingreso Producción devuelve los insumos y borra sus movimientos enlazados", async () => {
  const mov = await producir(50);
  assert.ok(mov, "se creó la producción");
  assert.equal(store.get("productos", "p-harina").stock_deposito, 90);
  assert.equal(store.get("productos", "p-papa").stock_deposito, 175);

  await callGlobal("abrirEditarEntrada", mov.id);
  await click("btn-eliminar-entrada");
  await click("btn-confirmar-eliminar-entrada");

  assert.equal(store.get("productos", "p-noqui").stock_deposito, 0, "ñoqui vuelve a 0");
  assert.equal(store.get("productos", "p-harina").stock_deposito, 100, "harina devuelta");
  assert.equal(store.get("productos", "p-papa").stock_deposito, 200, "papa devuelta");
  assert.equal(store.get("movimientos", mov.id), undefined, "se borró la producción");
  const consumosVivos = store.dump("movimientos").filter(m => m.produccion_id === mov.id);
  assert.equal(consumosVivos.length, 0, "se borraron los movimientos de consumo enlazados");
});

test("editar la cantidad de un Ingreso Producción reajusta los insumos", async () => {
  const mov = await producir(50);   // harina 100→90, papa 200→175
  await callGlobal("abrirEditarEntrada", mov.id);
  setValue("ede-cantidad", "30");
  await click("btn-confirmar-editar-entrada");
  // 30 porciones: harina −6 (100→94), papa −15 (200→185), ñoqui = 30
  assert.equal(store.get("productos", "p-noqui").stock_deposito, 30);
  assert.equal(store.get("productos", "p-harina").stock_deposito, 94);
  assert.equal(store.get("productos", "p-papa").stock_deposito, 185);
  assert.equal(store.get("movimientos", mov.id).cantidad, 30);
  assert.equal(store.get("movimientos", mov.id).consumo_produccion.find(c => c.id === "p-harina").cantidad, 6);
  const consumos = store.dump("movimientos").filter(m => m.produccion_id === mov.id);
  assert.equal(consumos.length, 2, "quedan 2 movimientos de consumo (recreados)");
});
