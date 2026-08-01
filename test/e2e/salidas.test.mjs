// E2E vista Salidas (Cargador Salidas): retiros y transferencias con increment.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, byId, setSelect, setValue, click, text } from "../harness/env.mjs";

before(async () => {
  seedDefaults({
    role: "Cargador Salidas",
    seed: {
      productos: [
        // acopio en 0 pero con stock en un sector de despacho → habilita retiro desde despacho
        { id: "p-vino", nombre: "Vino", plu: "150", rubro: "Bebidas", sector: "Barra",
          unidad_medida: "Unidad", tipo: "Despacho", sectores_asignados: ["Barra"],
          stock_deposito: 0, stock_despacho: { Barra: 5 } },
      ],
    },
  });
  await loadView("salidas");
});

test("la vista carga y lista productos", () => {
  assert.match(text("saludo"), /Hola, Tester/);
  const opts = [...byId("sal-producto").options].map(o => o.value);
  assert.ok(opts.includes("p-limon") && opts.includes("p-cerveza"));
});

test("retiro simple de materia prima descuenta del acopio (increment) y registra RETIRO", async () => {
  setSelect("sal-producto", "p-limon");        // materia prima → solo motivo no-transfiere
  setValue("sal-cantidad", "2");
  const antes = store.get("productos", "p-limon").stock_deposito; // 8
  await click("btn-confirmar-salida");

  assert.equal(store.get("productos", "p-limon").stock_deposito, antes - 2, "acopio -2");
  const mov = store.dump("movimientos").at(-1);
  assert.equal(mov.tipo, "RETIRO");
  assert.equal(mov.cantidad, 2);
  assert.equal(mov.destino, "consumo");
});

test("reposición transfiere de acopio a un sector de despacho (batch de dos increment)", async () => {
  setSelect("sal-producto", "p-cerveza");      // despacho con 2 sectores → aparece selector de sector
  setSelect("sal-motivo", "1 - Reposición");
  setSelect("sal-sector-destino", "Barra");
  setValue("sal-cantidad", "3");
  const acopioAntes = store.get("productos", "p-cerveza").stock_deposito;        // 20
  const barraAntes  = store.get("productos", "p-cerveza").stock_despacho.Barra;  // 10

  await click("btn-confirmar-salida");

  const p = store.get("productos", "p-cerveza");
  assert.equal(p.stock_deposito, acopioAntes - 3, "acopio -3");
  assert.equal(p.stock_despacho.Barra, barraAntes + 3, "Barra +3 (transferido)");
  const mov = store.dump("movimientos").at(-1);
  assert.equal(mov.tipo, "RETIRO");
  assert.equal(mov.destino, "Barra");
});

test("retiro desde despacho: con acopio en 0 aparece el selector de origen y descuenta del sector", async () => {
  setSelect("sal-producto", "p-vino");
  // el selector de origen debe aparecer con Acopio + Barra
  assert.notEqual(byId("sal-grupo-origen").style.display, "none", "aparece el selector de origen");
  setSelect("sal-origen", "Barra");
  setValue("sal-cantidad", "2");
  const barraAntes = store.get("productos", "p-vino").stock_despacho.Barra; // 5
  await click("btn-confirmar-salida");
  const p = store.get("productos", "p-vino");
  assert.equal(p.stock_despacho.Barra, barraAntes - 2, "Barra -2");
  const mov = store.dump("movimientos").at(-1);
  assert.equal(mov.origen, "Barra");
  assert.equal(mov.destino, "consumo");
});

test("retiro desde despacho rechaza si supera el stock del sector", async () => {
  setSelect("sal-producto", "p-vino");
  setSelect("sal-origen", "Barra");
  setValue("sal-cantidad", "9999");
  const antes = store.get("productos", "p-vino").stock_despacho.Barra;
  const movs = store.count("movimientos");
  await click("btn-confirmar-salida");
  assert.equal(store.get("productos", "p-vino").stock_despacho.Barra, antes);
  assert.equal(store.count("movimientos"), movs);
});

test("rechaza retiro por stock insuficiente en acopio", async () => {
  setSelect("sal-producto", "p-limon");
  setValue("sal-cantidad", "9999");
  const antes = store.get("productos", "p-limon").stock_deposito;
  const movs = store.count("movimientos");
  await click("btn-confirmar-salida");
  assert.equal(store.get("productos", "p-limon").stock_deposito, antes, "no cambia el stock");
  assert.equal(store.count("movimientos"), movs, "no registra movimiento");
  assert.match(text("msg-salida"), /insuficiente/i);
});
