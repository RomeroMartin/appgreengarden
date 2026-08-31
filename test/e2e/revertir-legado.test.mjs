// E2E: revertir en bloque las cargas de importación VIEJAS (sin lote) — vista Gerente.
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
          stock_deposito: 0, stock_despacho: { Barra: 45 }, ventas_hasta: new Date(2026, 2, 15) },
      ],
      // Movimiento de importación VIEJO (sin lote_id): en su día descontó 5 de Barra.
      movimientos: [
        { id: "mv-legacy", tipo: "VENTA", motivo: "Importación Excel", id_producto: "p-agua",
          nombre_producto: "Agua", cantidad: 5, unidad: "Unidad", origen: "Barra", destino: "salon",
          id_usuario: "uid-test", nombre_usuario: "Tester", fecha_hora: new Date(2026, 2, 15) },
      ],
    },
  });
  await loadView("gerente");
});

test("revertir cargas viejas: devuelve el stock, borra los movimientos y limpia el corte", async () => {
  assert.equal(store.count("movimientos"), 1, "parte de 1 movimiento importado legado");
  setConfirm(true);
  win().revertirLegadoUI();
  await click("btn-confirm-ok");
  const p = store.get("productos", "p-agua");
  assert.equal(p.stock_despacho.Barra, 50, "devolvió 5 a Barra (45 → 50)");
  assert.equal(store.count("movimientos"), 0, "borró el movimiento importado");
  assert.equal(p.ventas_hasta ?? null, null, "limpió ventas_hasta para poder reimportar");
});
