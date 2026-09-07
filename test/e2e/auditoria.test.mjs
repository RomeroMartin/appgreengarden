// E2E de la pestaña Auditoría (Gerente): esperado s/movimientos y reajuste.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, $, $$, click, byId, flush, win, setConfirm } from "../harness/env.mjs";

before(async () => {
  seedDefaults({
    role: "Gerente",
    seed: {
      productos: [
        { id: "p-torta", nombre: "Torta", plu: "500", rubro: "Pasteleria", sector: "Barra",
          unidad_medida: "Unidad", tipo: "Despacho", sectores_asignados: ["Barra"],
          stock_deposito: 0, stock_despacho: { Barra: 20 }, stock_minimo: 2 },
      ],
      // Historial: ancla (conteo 20→6) + una venta de 3 → esperado Barra = 3.
      movimientos: [
        { id: "mv1", id_producto: "p-torta", nombre_producto: "Torta", tipo: "AJUSTE",
          origen: "Barra", destino: "Barra", cantidad: 14, unidad: "Unidad",
          motivo: "Conteo físico Barra (20 → 6)", fecha_hora: new Date(2026,0,1,10,0) },
        { id: "mv2", id_producto: "p-torta", nombre_producto: "Torta", tipo: "VENTA",
          origen: "Barra", destino: "salon", cantidad: 3, unidad: "Unidad",
          motivo: "Importación Excel", fecha_hora: new Date(2026,0,2,10,0) },
      ],
    },
  });
  await loadView("gerente");
});

beforeEach(() => setConfirm(true));

test("auditoría calcula el esperado (ancla + movimientos) y muestra la diferencia", async () => {
  win().document.querySelector('.tab-btn[data-tab="auditoria"]').click();
  await click("btn-audit-analizar");
  await flush(8);

  const chk = $(".aud-chk[data-pid='p-torta'][data-sector='Barra']");
  assert.ok(chk, "hay una fila ajustable para Torta/Barra");
  assert.equal(chk.dataset.esp, "3", "esperado = 6 (conteo) − 3 (venta) = 3");
  assert.equal(chk.dataset.app, "20", "app muestra 20");
});

test("reajustar al esperado deja el stock en 3 y registra un AJUSTE", async () => {
  const movsAntes = store.count("movimientos");
  const chk = $(".aud-chk[data-pid='p-torta'][data-sector='Barra']");
  chk.checked = true;
  await click("btn-audit-reajustar");   // abre el modal de confirmación
  await click("btn-confirm-ok");        // confirma
  await flush(8);

  const p = store.get("productos", "p-torta");
  assert.equal(p.stock_despacho.Barra, 3, "el stock quedó en el esperado (3)");
  const nuevos = store.dump("movimientos").filter(m => m.tipo === "AJUSTE" && /Recálculo/.test(m.motivo || ""));
  assert.equal(nuevos.length, 1, "se registró 1 AJUSTE de recálculo");
  assert.equal(store.count("movimientos"), movsAntes + 1, "solo se agregó el AJUSTE");
});

test("restablecer a 0 por rubro deja los sectores en 0 con su AJUSTE", async () => {
  // Torta quedó en 3 tras el test anterior; el reset debe llevarla a 0.
  byId("audit-cero-rubro").value = "Pasteleria";
  await click("btn-audit-cero");   // abre confirmación
  await click("btn-confirm-ok");   // confirma
  await flush(8);

  const p = store.get("productos", "p-torta");
  assert.equal(p.stock_despacho.Barra, 0, "el sector quedó en 0");
  const reset = store.dump("movimientos").filter(m => m.tipo === "AJUSTE" && /Reset a 0/.test(m.motivo || ""));
  assert.equal(reset.length, 1, "se registró el AJUSTE de reset");
});
