// E2E (vista Encargado): la sección "Productos bajo mínimo" es un desplegable
// colapsable (colapsado por defecto, se abre al tocar el header) igual que en Gerente.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, byId, text, click } from "../harness/env.mjs";

before(async () => {
  seedDefaults({
    role: "Encargado",
    seed: {
      productos: [
        // Producto bajo mínimo (total 1 <= 10) → dispara la alerta
        { id: "p-sal", nombre: "Sal", plu: "", rubro: "Insumos", sector: "Cocina",
          unidad_medida: "kg", tipo: "Materia prima", sectores_asignados: [],
          stock_deposito: 1, stock_despacho: {}, stock_minimo: 10 },
      ],
    },
  });
  await loadView("encargado");
});

test("la sección bajo mínimo aparece con el conteo y arranca colapsada", () => {
  assert.notEqual(byId("seccion-alertas").style.display, "none", "la sección se muestra");
  assert.match(text("alertas-count"), /\(1\)/, "muestra el conteo de productos bajo mínimo");
  assert.match(text("lista-alertas"), /Sal/, "la lista contiene el producto bajo mínimo");
  assert.equal(byId("lista-alertas").style.display, "none", "arranca colapsada");
});

test("tocar el header despliega y vuelve a colapsar la lista", async () => {
  await click("alertas-header");
  assert.equal(byId("lista-alertas").style.display, "block", "se despliega al tocar");
  await click("alertas-header");
  assert.equal(byId("lista-alertas").style.display, "none", "se colapsa de nuevo");
});
