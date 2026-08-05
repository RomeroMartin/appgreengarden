// E2E editar/eliminar movimientos (vista Gerente): reverse + apply con increment.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, setValue, setSelect, click, callGlobal, byId } from "../harness/env.mjs";

const ts = (offset = 0) => new store.Ts(Date.now() - offset);

before(async () => {
  seedDefaults({
    role: "Gerente",
    seed: {
      movimientos: [
        // retiro simple de acopio (para editar cantidad)
        { id: "mov-ret", tipo: "RETIRO", id_producto: "p-limon", nombre_producto: "Limón",
          cantidad: 5, unidad: "kg", origen: "acopio", destino: "consumo",
          motivo: "2 - Vencimiento", id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: ts(1000) },
        // reposición de acopio a Barra (para editar cantidad de una transferencia)
        { id: "mov-repo", tipo: "RETIRO", id_producto: "p-cerveza", nombre_producto: "Cerveza",
          cantidad: 5, unidad: "Unidad", origen: "acopio", destino: "Barra",
          motivo: "1 - Reposición", id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: ts(2000) },
        // retiro simple de acopio (para eliminar)
        { id: "mov-del", tipo: "RETIRO", id_producto: "p-limon", nombre_producto: "Limón",
          cantidad: 4, unidad: "kg", origen: "acopio", destino: "consumo",
          motivo: "2 - Vencimiento", id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: ts(3000) },
      ],
    },
  });
  await loadView("gerente");
});

test("editar la cantidad de un retiro de acopio devuelve/re-descuenta la diferencia", async () => {
  const antes = store.get("productos", "p-limon").stock_deposito; // 8
  await callGlobal("abrirEditarMotivo", "mov-ret");
  setValue("edm-cantidad", "3");
  await click("btn-confirmar-editar-motivo");
  // reverse(+5) + apply(-3) = +2 neto en acopio
  assert.equal(store.get("productos", "p-limon").stock_deposito, antes + 2);
  const m = store.get("movimientos", "mov-ret");
  assert.equal(m.cantidad, 3);
  assert.equal(m.corregido, true);
});

test("editar la cantidad de una reposición ajusta acopio Y el sector, de forma atómica", async () => {
  const acopio = store.get("productos", "p-cerveza").stock_deposito;       // 20
  const barra  = store.get("productos", "p-cerveza").stock_despacho.Barra; // 10
  await callGlobal("abrirEditarMotivo", "mov-repo");
  setSelect("edm-motivo", "1 - Reposición");   // el usuario mantiene la reposición
  setSelect("edm-sector", "Barra");            // hacia el sector Barra
  setValue("edm-cantidad", "2");
  await click("btn-confirmar-editar-motivo");
  // reverse repo(5): acopio +5, Barra -5 · apply repo(2): acopio -2, Barra +2 → neto acopio +3, Barra -3
  const p = store.get("productos", "p-cerveza");
  assert.equal(p.stock_deposito, acopio + 3);
  assert.equal(p.stock_despacho.Barra, barra - 3);
});

test("reabrir 'editar retiro' para otro movimiento muestra SU motivo, no el del anterior", async () => {
  // Abrir primero un retiro cuyo motivo ("2 - Vencimiento") es válido también
  // para el segundo producto: así el <select> queda con un valor que, de no
  // reinicializarse, se arrastraría al reabrir para otro movimiento.
  await callGlobal("abrirEditarMotivo", "mov-ret");
  assert.equal(byId("edm-motivo").value, "2 - Vencimiento");
  // Reabrir para una reposición: debe preseleccionar SU motivo ("1 - Reposición"),
  // no conservar "2 - Vencimiento" del movimiento anterior.
  await callGlobal("abrirEditarMotivo", "mov-repo");
  assert.equal(byId("edm-motivo").value, "1 - Reposición");
});

test("eliminar un retiro devuelve el stock y borra el registro", async () => {
  const antes = store.get("productos", "p-limon").stock_deposito;
  const movsAntes = store.count("movimientos");
  await callGlobal("abrirEditarMotivo", "mov-del");
  await click("btn-eliminar-mov");        // muestra el confirm
  await click("btn-confirmar-eliminar");  // confirma
  assert.equal(store.get("productos", "p-limon").stock_deposito, antes + 4, "se devolvió el stock retirado");
  assert.equal(store.count("movimientos"), movsAntes - 1, "se borró el movimiento");
  assert.equal(store.get("movimientos", "mov-del"), undefined);
});
