// E2E vista Gerente: ajuste rápido, conteo físico (con concurrencia),
// importación de ventas (+ guarda anti-doble), y alta de producto.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  seedDefaults, loadView, store, byId, $, setSelect, setValue, click, text, setConfirm, uploadExcel, flush
} from "../harness/env.mjs";

before(async () => {
  seedDefaults({ role: "Gerente" });
  await loadView("gerente");
});

// ── AJUSTE RÁPIDO ─────────────────────────────────────────────
async function abrirAjusteRapido() {
  await click("btn-mov-ajuste");     // abre modal de tipo de ajuste
  await click("btn-ajuste-rapido");  // abre el modal de ajuste rápido
}

test("ajuste rápido de acopio deja el balde en el valor ingresado (increment del delta)", async () => {
  await abrirAjusteRapido();
  setSelect("ajt-producto", "p-cerveza");
  setSelect("ajt-ubicacion", "acopio");
  setValue("ajt-stock", "15");
  setValue("ajt-motivo", "corrección");
  await click("btn-confirmar-ajuste");
  assert.equal(store.get("productos", "p-cerveza").stock_deposito, 15);
  const mov = store.dump("movimientos").at(-1);
  assert.equal(mov.tipo, "AJUSTE");
  assert.equal(mov.origen, "acopio");
});

test("ajuste de un sector NO toca los demás sectores (field-path increment)", async () => {
  const salonAntes = store.get("productos", "p-cerveza").stock_despacho.Salon;
  await abrirAjusteRapido();
  setSelect("ajt-producto", "p-cerveza");
  setSelect("ajt-ubicacion", "desp:Barra");
  setValue("ajt-stock", "30");
  setValue("ajt-motivo", "conteo barra");
  await click("btn-confirmar-ajuste");
  const p = store.get("productos", "p-cerveza");
  assert.equal(p.stock_despacho.Barra, 30, "Barra queda en 30");
  assert.equal(p.stock_despacho.Salon, salonAntes, "Salon intacto");
});

// ── CONTEO FÍSICO con VENTA CONCURRENTE ───────────────────────
test("conteo físico aplica el DELTA y NO borra un retiro concurrente", async () => {
  await click("btn-mov-ajuste");
  await click("btn-ajuste-conteo");   // abre pantalla-conteo → cargar() congela la foto
  await flush(4);

  // Mientras el conteo está abierto, entra un retiro de 4 en Barra (otro dispositivo)
  store.applyUpdate("productos", "p-cerveza", { "stock_despacho.Barra": new store.Increment(-4) });

  // El operador cuenta Barra = 12
  const inp = $('.conteo-cont-desp[data-prod="p-cerveza"][data-sector="Barra"]');
  assert.ok(inp, "existe el input de conteo de Barra");
  inp.value = "12";
  await click("conteo-btn-aplicar");

  // final = (foto + retiro) + (contado - foto) = contado + retiro = 12 - 4 = 8
  // Con el código viejo (absoluto) habría quedado 12, PERDIENDO el retiro.
  assert.equal(store.get("productos", "p-cerveza").stock_despacho.Barra, 8);
});

// ── IMPORTACIÓN DE VENTAS ─────────────────────────────────────
const excel = (filas) => [["Periodo", "01/06/2026", "15/06/2026"], ...filas];

test("importar ventas descuenta del sector y fija ventas_hasta", async () => {
  const barraAntes = store.get("productos", "p-cerveza").stock_despacho.Barra;
  await uploadExcel("import-file", excel([[101, "Cerveza", 5, 0, ""]]));
  await click("btn-import-confirmar");

  const p = store.get("productos", "p-cerveza");
  assert.equal(p.stock_despacho.Barra, barraAntes - 5, "Barra -5 por la venta");
  assert.ok(p.ventas_hasta, "quedó fijada la fecha de corte");
  assert.equal(store.dump("movimientos").at(-1).tipo, "VENTA");
});

test("importar una receta descuenta la materia prima (ingredientes)", async () => {
  const limonAntes = store.get("productos", "p-limon").stock_despacho?.Barra ?? 0;
  await uploadExcel("import-file", excel([[201, "Limonada", 3, 0, ""]]));
  await click("btn-import-confirmar");
  // 0.2 kg de limón por unidad × 3 = 0.6, desde el sector de la receta (Barra)
  assert.equal(store.get("productos", "p-limon").stock_despacho.Barra, +(limonAntes - 0.6).toFixed(4));
});

test("guarda anti-doble-importación: reimportar el mismo período pide confirmación y respeta el NO", async () => {
  const barraAntes = store.get("productos", "p-cerveza").stock_despacho.Barra;
  setConfirm(false);                 // el usuario responde "no" al aviso de solapamiento
  await uploadExcel("import-file", excel([[101, "Cerveza", 5, 0, ""]]));
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-cerveza").stock_despacho.Barra, barraAntes, "NO descontó de nuevo");
  assert.match(text("msg-import-2"), /ya estaban cargadas|cancelada/i);
});

test("guarda anti-doble: si el usuario confirma, sí vuelve a descontar", async () => {
  const barraAntes = store.get("productos", "p-cerveza").stock_despacho.Barra;
  setConfirm(true);
  await uploadExcel("import-file", excel([[101, "Cerveza", 2, 0, ""]]));
  await click("btn-import-confirmar");
  assert.equal(store.get("productos", "p-cerveza").stock_despacho.Barra, barraAntes - 2);
});

// ── ALTA DE PRODUCTO ──────────────────────────────────────────
test("crear una materia prima nueva la guarda en productos", async () => {
  const antes = store.count("productos");
  await click("btn-nuevo-producto");
  setValue("prod-nombre", "Azúcar");
  setValue("prod-tipo", "Materia prima");
  setValue("prod-stock", "7");
  await click("btn-guardar-producto");
  assert.equal(store.count("productos"), antes + 1, "se creó 1 producto");
  const nuevo = store.dump("productos").find(p => p.nombre === "Azúcar");
  assert.ok(nuevo, "existe el producto Azúcar");
  assert.equal(nuevo.tipo, "Materia prima");
  assert.equal(nuevo.stock_deposito, 7);
});
