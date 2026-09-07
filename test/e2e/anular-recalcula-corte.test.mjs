// Regresión: al anular una carga, ventas_hasta se RECALCULA desde las cargas
// que siguen vigentes (no se restaura a ciegas el "anterior"). Si otra carga no
// anulada cubre el mismo producto, su corte se mantiene y la guarda anti-doble
// importación sigue protegiendo. Antes, anular una de dos cargas del mismo
// producto reseteaba ventas_hasta → doble descuento silencioso al reimportar.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, click, uploadExcel, setConfirm, win } from "../harness/env.mjs";

const excel = (desde, hasta, filas) => [["Periodo", desde, hasta], ...filas];

before(async () => {
  seedDefaults({
    role: "Gerente",
    seed: {
      productos: [
        { id: "p-torta", nombre: "Torta", plu: "500", rubro: "Pasteleria", sector: "Pasteleria",
          unidad_medida: "Unidad", tipo: "Despacho", sectores_asignados: ["Pasteleria"],
          stock_deposito: 0, stock_despacho: { Pasteleria: 100 } },
      ],
    },
  });
  await loadView("gerente");
});

beforeEach(() => setConfirm(true));

const stock = () => store.get("productos", "p-torta").stock_despacho.Pasteleria;
const vh = () => { const v = store.get("productos", "p-torta").ventas_hasta; return v == null ? null : (v.toDate ? v.toDate().getTime() : new Date(v).getTime()); };
const nuevoLote = (ids) => store.dump("lotes_importacion").find(l => !ids.has(l.id));
const loteIds = () => new Set(store.dump("lotes_importacion").map(l => l.id));
const anular = async (lote) => { setConfirm(true); win().anularCargaUI(lote.id); await click("btn-confirm-ok"); };
const MARZO15 = new Date(2026, 2, 15).getTime();

// Escenario: dos lotes del MISMO producto y MISMO corte (marzo).
// Se anula UNO. La venta del otro sigue descontada, PERO ventas_hasta queda
// reseteado a null → el producto figura "sin ventas" y la guarda anti-doble
// ya no protege. Luego una importacion del mismo periodo NO avisa y descuenta
// de nuevo → doble descuento (stock por debajo de lo real).
test("anular recalcula ventas_hasta desde las cargas vigentes y no habilita doble descuento", async () => {
  const S0 = stock();

  // Lote A (marzo) -10
  let ids = loteIds();
  await uploadExcel("import-file", excel("01/03/2026", "15/03/2026", [[500, "Torta", 10, 0, ""]]));
  await click("btn-import-confirmar");
  const loteA = nuevoLote(ids);

  // Lote B (mismo periodo marzo, correccion) -4. Dispara overlap; confirmamos.
  ids = loteIds();
  await uploadExcel("import-file", excel("01/03/2026", "15/03/2026", [[500, "Torta", 4, 0, ""]]));
  await click("btn-import-confirmar");
  const loteB = nuevoLote(ids);

  assert.equal(stock(), S0 - 14, "A(-10)+B(-4) descontados");
  assert.equal(vh(), MARZO15, "ventas_hasta = 15/03");

  // Se anula SOLO el lote A. La venta de B sigue vigente (-4).
  await anular(loteA);
  console.log("Tras anular A: stock =", stock(), "(real esperado", S0 - 4, ") ventas_hasta =", vh());

  assert.equal(stock(), S0 - 4, "queda descontada la venta de B");
  // FIX: ventas_hasta sigue en 15/03 porque la carga B (no anulada) lo cubre.
  assert.equal(vh(), MARZO15, "ventas_hasta se mantiene en 15/03 porque B sigue vigente");

  // La guarda anti-doble vuelve a proteger: si reimportamos marzo y el operador
  // NO confirma el aviso de solapamiento, el descuento se cancela (stock intacto).
  // Con el bug, la guarda no disparaba y el stock caía a S0-8 (doble descuento).
  setConfirm(false);
  await uploadExcel("import-file", excel("01/03/2026", "15/03/2026", [[500, "Torta", 4, 0, ""]]));
  await click("btn-import-confirmar");
  setConfirm(true);

  assert.equal(stock(), S0 - 4, "la guarda frenó el reimport: sin doble descuento");
});
