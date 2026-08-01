// E2E CRUD de productos (vista Gerente): altas, validaciones y el fix de que
// editar un producto NO pisa su stock_despacho.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, $, byId, setValue, click, text, callGlobal } from "../harness/env.mjs";

before(async () => {
  seedDefaults({ role: "Gerente" });
  await loadView("gerente");
});

test("crear producto de despacho con sectores lo guarda con sectores_asignados y stock inicial", async () => {
  const antes = store.count("productos");
  await click("btn-nuevo-producto");            // tipo Despacho por defecto
  setValue("prod-nombre", "Fernet");
  setValue("prod-plu", "301");
  setValue("prod-stock", "12");
  const cb = $('.check-despacho[value="Barra"]');
  assert.ok(cb, "hay checkbox del sector Barra");
  cb.checked = true;
  await click("btn-guardar-producto");

  assert.equal(store.count("productos"), antes + 1);
  const nuevo = store.dump("productos").find(p => p.nombre === "Fernet");
  assert.ok(nuevo);
  assert.equal(nuevo.tipo, "Despacho");
  assert.deepEqual(nuevo.sectores_asignados, ["Barra"]);
  assert.equal(nuevo.stock_deposito, 12);
  assert.equal(nuevo.stock_despacho.Barra, 0, "el mapa de despacho arranca en 0");
});

test("validación: producto de despacho sin sectores no se crea", async () => {
  const antes = store.count("productos");
  await click("btn-nuevo-producto");
  setValue("prod-nombre", "Sin Sector");
  // no marco ningún check-despacho
  await click("btn-guardar-producto");
  assert.equal(store.count("productos"), antes, "no se creó nada");
  assert.match(text("msg-producto"), /sector de despacho/i);
});

test("validación: receta sin ingredientes no se crea", async () => {
  const antes = store.count("productos");
  await click("btn-nuevo-producto");
  setValue("prod-nombre", "Trago Vacío");
  setValue("prod-tipo", "Receta");
  await click("btn-guardar-producto");
  assert.equal(store.count("productos"), antes, "no se creó nada");
  assert.match(text("msg-producto"), /ingrediente|sector/i);
});

test("editar un producto (cambiar nombre) NO pisa su stock_despacho", async () => {
  const antes = store.get("productos", "p-cerveza").stock_despacho;
  await callGlobal("abrirEditarProducto", "p-cerveza");
  setValue("prod-nombre", "Cerveza Rubia");
  await click("btn-guardar-producto");
  const p = store.get("productos", "p-cerveza");
  assert.equal(p.nombre, "Cerveza Rubia", "se actualizó el nombre");
  assert.deepEqual(p.stock_despacho, antes, "el stock de despacho quedó intacto");
});

test("editar y cambiar el tipo a Materia prima vacía el mapa de despacho", async () => {
  await callGlobal("abrirEditarProducto", "p-cerveza");
  setValue("prod-tipo", "Materia prima");
  await click("btn-guardar-producto");
  const p = store.get("productos", "p-cerveza");
  assert.equal(p.tipo, "Materia prima");
  assert.deepEqual(p.stock_despacho, {}, "al dejar de ser despacho, se limpia el mapa");
});
