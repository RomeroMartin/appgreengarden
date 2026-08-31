// E2E: revertir SOLO la última carga de importación vieja (sin lote) — vista Gerente.
// Las cargas viejas se agrupan por fecha/hora; revertir una NO toca las demás.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, click, setConfirm, win } from "../harness/env.mjs";

before(async () => {
  seedDefaults({
    role: "Gerente",
    seed: {
      productos: [
        { id: "p-agua", nombre: "Agua", plu: "102", rubro: "Bebidas", sector: "Barra",
          unidad_medida: "Unidad", tipo: "Despacho", sectores_asignados: ["Barra"],
          stock_deposito: 0, stock_despacho: { Barra: 40 }, ventas_hasta: new Date(2026, 7, 28) },
        { id: "p-multi", nombre: "Multi", plu: "103", rubro: "Bebidas", sector: "Barra",
          unidad_medida: "Unidad", tipo: "Despacho", sectores_asignados: ["Barra"],
          stock_deposito: 0, stock_despacho: { Barra: 30 }, ventas_hasta: new Date(2026, 7, 31) },
      ],
      // Dos cargas viejas SIN lote, en fechas distintas (> 5 min de diferencia):
      movimientos: [
        // Carga VIEJA (28/8): descontó 5 de Agua
        { id: "mv-vieja", tipo: "VENTA", motivo: "Importación Excel", id_producto: "p-agua",
          nombre_producto: "Agua", cantidad: 5, unidad: "Unidad", origen: "Barra", destino: "salon",
          id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: new Date(2026, 7, 28, 10, 0) },
        // Carga NUEVA / última (31/8): descontó 3 de Multi
        { id: "mv-ultima", tipo: "VENTA", motivo: "Importación Excel", id_producto: "p-multi",
          nombre_producto: "Multi", cantidad: 3, unidad: "Unidad", origen: "Barra", destino: "salon",
          id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: new Date(2026, 7, 31, 10, 0) },
      ],
    },
  });
  await loadView("gerente");
});

test("revertir SOLO la última carga: devuelve su stock y deja intactas las cargas anteriores", async () => {
  assert.equal(store.count("movimientos"), 2, "parten 2 cargas viejas");
  setConfirm(true);
  win().revertirLegadoUI(0);   // índice 0 = la más reciente (31/8, Multi)
  await click("btn-confirm-ok");

  const multi = store.get("productos", "p-multi");
  assert.equal(multi.stock_despacho.Barra, 33, "devolvió 3 a Multi (30 → 33)");
  assert.equal(multi.ventas_hasta ?? null, null, "limpió el corte de Multi");

  const agua = store.get("productos", "p-agua");
  assert.equal(agua.stock_despacho.Barra, 40, "Agua (carga vieja) quedó intacta");
  assert.deepEqual(agua.ventas_hasta?.toDate?.() ?? agua.ventas_hasta, new Date(2026, 7, 28), "corte de la carga vieja intacto");

  assert.equal(store.count("movimientos"), 1, "solo se borró el movimiento de la última carga");
  assert.ok(store.get("movimientos", "mv-vieja"), "el movimiento de la carga vieja sigue existiendo");
});
