// E2E (vista Gerente): editar y eliminar movimientos de ENTRADA (INGRESO) con
// reverse + apply sobre el acopio, atómico con increment. Solo Gerente (la UI del
// modal-editar-entrada vive únicamente en gerente.js).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, setValue, click, callGlobal } from "../harness/env.mjs";

const ts = (offset = 0) => new store.Ts(Date.now() - offset);

before(async () => {
  seedDefaults({
    role: "Gerente",
    seed: {
      movimientos: [
        { id: "ent-1", tipo: "INGRESO_PROVEEDOR", id_producto: "p-limon", nombre_producto: "Limón",
          cantidad: 5, unidad: "kg", origen: "externo", destino: "acopio", motivo: "Proveedor",
          id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: ts(1000) },
        { id: "ent-prod", tipo: "INGRESO_PROVEEDOR", id_producto: "p-limon", nombre_producto: "Limón",
          cantidad: 2, unidad: "kg", origen: "externo", destino: "acopio", motivo: "Proveedor",
          id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: ts(2000) },
        { id: "ent-del", tipo: "INGRESO_PROVEEDOR", id_producto: "p-limon", nombre_producto: "Limón",
          cantidad: 4, unidad: "kg", origen: "externo", destino: "acopio", motivo: "Proveedor",
          id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: ts(3000) },
      ],
    },
  });
  await loadView("gerente");
});

test("editar la cantidad de una entrada ajusta el acopio por la diferencia", async () => {
  const antes = store.get("productos", "p-limon").stock_deposito; // 8
  await callGlobal("abrirEditarEntrada", "ent-1");
  setValue("ede-cantidad", "3");
  await click("btn-confirmar-editar-entrada");
  // reverse(-5) + apply(+3) = -2 neto en acopio
  assert.equal(store.get("productos", "p-limon").stock_deposito, antes - 2);
  const m = store.get("movimientos", "ent-1");
  assert.equal(m.cantidad, 3);
  assert.equal(m.corregido, true);
});

test("editar una entrada cambiando el producto mueve el acopio del viejo al nuevo", async () => {
  const limonAntes   = store.get("productos", "p-limon").stock_deposito;
  const cervezaAntes = store.get("productos", "p-cerveza").stock_deposito;
  await callGlobal("abrirEditarEntrada", "ent-prod");   // 2 kg de Limón
  setValue("ede-producto", "p-cerveza");
  await click("btn-confirmar-editar-entrada");
  // Limón: revierte -2 · Cerveza: aplica +2
  assert.equal(store.get("productos", "p-limon").stock_deposito, limonAntes - 2);
  assert.equal(store.get("productos", "p-cerveza").stock_deposito, cervezaAntes + 2);
  assert.equal(store.get("movimientos", "ent-prod").id_producto, "p-cerveza");
});

test("eliminar una entrada revierte el acopio y borra el registro", async () => {
  const antes = store.get("productos", "p-limon").stock_deposito;
  const movsAntes = store.count("movimientos");
  await callGlobal("abrirEditarEntrada", "ent-del");
  await click("btn-eliminar-entrada");             // muestra el confirm
  await click("btn-confirmar-eliminar-entrada");   // confirma
  assert.equal(store.get("productos", "p-limon").stock_deposito, antes - 4, "se revirtió la entrada");
  assert.equal(store.count("movimientos"), movsAntes - 1, "se borró el movimiento");
  assert.equal(store.get("movimientos", "ent-del"), undefined);
});
