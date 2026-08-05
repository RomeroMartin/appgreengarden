// E2E (vista Gerente): el filtro de historial por rango de fechas debe traer
// TODOS los movimientos del rango, incluso los que quedan fuera del cache de los
// 200 más recientes (antes filtraba sobre el cache → un rango viejo mostraba de menos).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, $$, setValue, click, flush } from "../harness/env.mjs";

const AGO = Date.parse("2026-08-05T10:00:00");
const ENE = Date.parse("2026-01-15T10:00:00");

before(async () => {
  const movs = [];
  // 200 movimientos recientes (agosto) → empujan a los viejos fuera del cache de 200
  for (let i = 0; i < 200; i++) {
    movs.push({ id: `m-new-${i}`, tipo: "RETIRO", id_producto: "p-limon", nombre_producto: "Limón",
      cantidad: 1, unidad: "kg", origen: "acopio", destino: "consumo", motivo: "2 - Vencimiento",
      id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: new store.Ts(AGO - i * 60000) });
  }
  // 5 movimientos viejos (enero) → NO entran en el cache de 200
  for (let i = 0; i < 5; i++) {
    movs.push({ id: `m-old-${i}`, tipo: "INGRESO_PROVEEDOR", id_producto: "p-limon", nombre_producto: "Limón",
      cantidad: 3, unidad: "kg", origen: "externo", destino: "acopio", motivo: "Proveedor",
      id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: new store.Ts(ENE + i * 60000) });
  }
  seedDefaults({ role: "Gerente", seed: { movimientos: movs } });
  await loadView("gerente");
  await flush();
});

test("filtrar un rango de fechas viejo trae los movimientos que están fuera del cache de 200", async () => {
  setValue("filtro-hist-desde", "2026-01-01");
  setValue("filtro-hist-hasta", "2026-01-31");
  await click("btn-aplicar-filtros");
  await flush();
  assert.equal($$("#lista-historial .mov-row").length, 5, "aparecen los 5 movimientos de enero");
});
