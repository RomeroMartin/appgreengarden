// E2E vista Entradas (Cargador Entradas): ingreso a acopio con increment.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, byId, setSelect, setValue, click, text } from "../harness/env.mjs";

before(async () => {
  seedDefaults({ role: "Cargador Entradas" });
  await loadView("entradas");
});

test("la vista carga y muestra el saludo y el selector de productos", () => {
  assert.match(text("saludo"), /Hola, Tester/);
  const opts = [...byId("ent-producto").options].map(o => o.value);
  assert.ok(opts.includes("p-cerveza"), "el select debe listar productos");
});

test("registrar un ingreso suma al acopio con increment y crea el movimiento", async () => {
  setSelect("ent-producto", "p-cerveza");
  setValue("ent-tipo", "INGRESO_PROVEEDOR");
  setValue("ent-cantidad", "7");
  const antes = store.get("productos", "p-cerveza").stock_deposito; // 20
  const movsAntes = store.count("movimientos");

  await click("btn-confirmar-entrada");

  assert.equal(store.get("productos", "p-cerveza").stock_deposito, antes + 7, "acopio +7");
  assert.equal(store.count("movimientos"), movsAntes + 1, "se registró 1 movimiento");
  const mov = store.dump("movimientos").at(-1);
  assert.equal(mov.tipo, "INGRESO_PROVEEDOR");
  assert.equal(mov.cantidad, 7);
  assert.equal(mov.id_producto, "p-cerveza");
});

test("no permite cantidad <= 0", async () => {
  setSelect("ent-producto", "p-cerveza");
  setValue("ent-cantidad", "0");
  const antes = store.get("productos", "p-cerveza").stock_deposito;
  const movsAntes = store.count("movimientos");
  await click("btn-confirmar-entrada");
  assert.equal(store.get("productos", "p-cerveza").stock_deposito, antes, "no cambia el stock");
  assert.equal(store.count("movimientos"), movsAntes, "no crea movimiento");
});
