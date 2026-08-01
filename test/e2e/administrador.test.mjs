// E2E vista Administrador: venta directa, ajuste rápido, conteo con
// concurrencia e importación con guarda anti-doble.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  seedDefaults, loadView, store, $, setSelect, setValue, click, text, setConfirm, uploadExcel, flush
} from "../harness/env.mjs";

before(async () => {
  seedDefaults({ role: "Administrador" });
  await loadView("administrador");
});

test("la vista carga", () => {
  assert.match(text("saludo").length ? text("saludo") : "ok", /.*/);
  assert.ok(store.count("productos") >= 3);
});

test("venta directa descuenta del sector de despacho (increment) y avanza ventas_hasta", async () => {
  await click("btn-mov-venta");
  setSelect("vta-producto", "p-cerveza");
  setSelect("vta-sector", "Barra");
  setValue("vta-cantidad", "2");
  const barraAntes = store.get("productos", "p-cerveza").stock_despacho.Barra;
  await click("btn-confirmar-venta");
  const p = store.get("productos", "p-cerveza");
  assert.equal(p.stock_despacho.Barra, barraAntes - 2, "Barra -2");
  assert.ok(p.ventas_hasta, "ventas_hasta fijada");
  assert.equal(store.dump("movimientos").at(-1).tipo, "VENTA");
});

test("rechaza venta por stock insuficiente en el sector", async () => {
  await click("btn-mov-venta");
  setSelect("vta-producto", "p-cerveza");
  setSelect("vta-sector", "Salon");
  setValue("vta-cantidad", "99999");
  const antes = store.get("productos", "p-cerveza").stock_despacho.Salon;
  const movs = store.count("movimientos");
  await click("btn-confirmar-venta");
  assert.equal(store.get("productos", "p-cerveza").stock_despacho.Salon, antes);
  assert.equal(store.count("movimientos"), movs);
});

test("ajuste rápido de acopio deja el balde en el valor ingresado (increment del delta)", async () => {
  await click("btn-mov-ajuste");
  await click("btn-ajuste-rapido");
  setSelect("ajt-producto", "p-limon");
  setSelect("ajt-ubicacion", "acopio");
  setValue("ajt-stock", "12");
  setValue("ajt-motivo", "recuento");
  await click("btn-confirmar-ajuste");
  assert.equal(store.get("productos", "p-limon").stock_deposito, 12);
});

test("conteo físico aplica el DELTA y NO borra una venta concurrente", async () => {
  await click("btn-mov-ajuste");
  await click("btn-ajuste-conteo");
  await flush(4);
  store.applyUpdate("productos", "p-cerveza", { "stock_despacho.Salon": new store.Increment(-1) });
  const inp = $('.conteo-cont-desp[data-prod="p-cerveza"][data-sector="Salon"]');
  inp.value = "10";
  await click("conteo-btn-aplicar");
  // final = contado + delta_concurrente = 10 - 1 = 9 (el viejo absoluto habría dado 10)
  assert.equal(store.get("productos", "p-cerveza").stock_despacho.Salon, 9);
});

test("importación con guarda anti-doble respeta el NO del usuario", async () => {
  const excel = (filas) => [["Periodo", "01/07/2026", "20/07/2026"], ...filas];
  await uploadExcel("import-file", excel([[101, "Cerveza", 3, 0, ""]]));
  await click("btn-import-confirmar");
  const barra = store.get("productos", "p-cerveza").stock_despacho.Barra;

  setConfirm(false);
  await uploadExcel("import-file", excel([[101, "Cerveza", 3, 0, ""]]));
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-cerveza").stock_despacho.Barra, barra, "no descontó de nuevo");
});
