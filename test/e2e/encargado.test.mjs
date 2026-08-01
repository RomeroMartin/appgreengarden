// E2E vista Encargado: entrada y salida (retiro + transferencia) vía modales.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, byId, setSelect, setValue, click, text, $$ } from "../harness/env.mjs";

before(async () => {
  seedDefaults({ role: "Encargado" });
  await loadView("encargado");
});

test("la vista carga y renderiza el inventario", () => {
  assert.match(text("saludo"), /Hola, Tester/);
  assert.match(text("lista-inventario"), /Cerveza/);
  assert.match(text("lista-inventario"), /Lim[oó]n/);
});

test("entrada (proveedor) suma al acopio con increment", async () => {
  await click("btn-abrir-entrada");
  setSelect("ent-producto", "p-limon");
  setValue("ent-tipo", "INGRESO_PROVEEDOR");
  setValue("ent-cantidad", "4");
  const antes = store.get("productos", "p-limon").stock_deposito; // 8
  await click("btn-confirmar-entrada");
  assert.equal(store.get("productos", "p-limon").stock_deposito, antes + 4);
  assert.equal(store.dump("movimientos").at(-1).tipo, "INGRESO_PROVEEDOR");
});

test("retiro simple descuenta del acopio con increment", async () => {
  await click("btn-abrir-salida");
  setSelect("sal-producto", "p-limon");
  setValue("sal-cantidad", "3");
  const antes = store.get("productos", "p-limon").stock_deposito;
  await click("btn-confirmar-salida");
  assert.equal(store.get("productos", "p-limon").stock_deposito, antes - 3);
  assert.equal(store.dump("movimientos").at(-1).tipo, "RETIRO");
});

test("reposición transfiere de acopio a sector de despacho", async () => {
  await click("btn-abrir-salida");
  setSelect("sal-producto", "p-cerveza");
  setSelect("sal-motivo", "1 - Reposición");
  setSelect("sal-sector-destino", "Salon");
  setValue("sal-cantidad", "2");
  const acopio = store.get("productos", "p-cerveza").stock_deposito;
  const salon  = store.get("productos", "p-cerveza").stock_despacho.Salon;
  await click("btn-confirmar-salida");
  const p = store.get("productos", "p-cerveza");
  assert.equal(p.stock_deposito, acopio - 2);
  assert.equal(p.stock_despacho.Salon, salon + 2);
  assert.equal(store.dump("movimientos").at(-1).destino, "Salon");
});

test("rechaza retiro por stock insuficiente", async () => {
  await click("btn-abrir-salida");
  setSelect("sal-producto", "p-limon");
  setValue("sal-cantidad", "99999");
  const antes = store.get("productos", "p-limon").stock_deposito;
  const movs = store.count("movimientos");
  await click("btn-confirmar-salida");
  assert.equal(store.get("productos", "p-limon").stock_deposito, antes);
  assert.equal(store.count("movimientos"), movs);
});
