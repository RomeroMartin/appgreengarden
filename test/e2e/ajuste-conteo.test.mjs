// E2E ajuste rápido (validaciones) y conteo físico (multi-balde / sin cambios).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, $, byId, setSelect, setValue, click, text, flush } from "../harness/env.mjs";

before(async () => {
  seedDefaults({ role: "Gerente" });
  await loadView("gerente");
});

async function abrirAjusteRapido() {
  await click("btn-mov-ajuste");
  await click("btn-ajuste-rapido");
}
async function abrirConteo() {
  await click("btn-mov-ajuste");
  await click("btn-ajuste-conteo");
  await flush(4);
}

test("ajuste sin motivo es rechazado", async () => {
  await abrirAjusteRapido();
  setSelect("ajt-producto", "p-cerveza");
  setSelect("ajt-ubicacion", "acopio");
  setValue("ajt-stock", "10");
  setValue("ajt-motivo", "");            // motivo vacío
  const antes = store.get("productos", "p-cerveza").stock_deposito;
  await click("btn-confirmar-ajuste");
  assert.equal(store.get("productos", "p-cerveza").stock_deposito, antes, "no cambia el stock");
  assert.match(text("msg-ajuste"), /motivo/i);
});

test("ajuste sin valor de stock es rechazado", async () => {
  await abrirAjusteRapido();
  setSelect("ajt-producto", "p-cerveza");
  setSelect("ajt-ubicacion", "acopio");
  setValue("ajt-stock", "");
  setValue("ajt-motivo", "algo");
  const antes = store.get("productos", "p-cerveza").stock_deposito;
  await click("btn-confirmar-ajuste");
  assert.equal(store.get("productos", "p-cerveza").stock_deposito, antes);
  assert.match(text("msg-ajuste"), /stock/i);
});

test("conteo físico ajusta acopio y varios sectores a la vez", async () => {
  await abrirConteo();
  $('.conteo-cont-acopio[data-prod="p-cerveza"]').value = "25";
  $('.conteo-cont-desp[data-prod="p-cerveza"][data-sector="Barra"]').value = "13";
  $('.conteo-cont-desp[data-prod="p-cerveza"][data-sector="Salon"]').value = "6";
  await click("conteo-btn-aplicar");
  const p = store.get("productos", "p-cerveza");
  assert.equal(p.stock_deposito, 25);
  assert.equal(p.stock_despacho.Barra, 13);
  assert.equal(p.stock_despacho.Salon, 6);
});

test("conteo físico sin cambios (contar el mismo valor) no crea movimientos", async () => {
  await abrirConteo();
  const dep = store.get("productos", "p-limon").stock_deposito;
  const movsAntes = store.count("movimientos");
  $('.conteo-cont-acopio[data-prod="p-limon"]').value = String(dep);  // igual al actual
  await click("conteo-btn-aplicar");
  assert.equal(store.get("productos", "p-limon").stock_deposito, dep, "sin cambio");
  assert.equal(store.count("movimientos"), movsAntes, "sin movimientos nuevos");
});
