// ============================================================
// Tests de la lógica pura de corte de ventas (fechas por producto).
// Corren con el runner nativo de Node: `npm test`  (o `node --test`).
// No tocan Firebase ni el DOM: son funciones puras.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  debeAvanzar,
  ventasHastaDe,
  calcularResumen,
  estaAtrasado,
  formatearFecha,
} from "../js/corte-ventas.js";

// Helper: simula un Timestamp de Firestore ({ toDate() })
const ts = (d) => ({ toDate: () => d });

test("debeAvanzar: sin fecha actual siempre avanza", () => {
  assert.equal(debeAvanzar(null, new Date(2026, 0, 1)), true);
  assert.equal(debeAvanzar(undefined, new Date(2026, 0, 1)), true);
});

test("debeAvanzar: solo avanza hacia adelante, nunca retrocede", () => {
  const enero = new Date(2026, 0, 1);
  const febrero = new Date(2026, 1, 1);
  assert.equal(debeAvanzar(enero, febrero), true);   // más nuevo → avanza
  assert.equal(debeAvanzar(febrero, enero), false);  // más viejo → no
  assert.equal(debeAvanzar(enero, enero), false);    // igual → no
});

test("debeAvanzar: acepta Timestamp de Firestore como valor actual", () => {
  assert.equal(debeAvanzar(ts(new Date(2026, 0, 1)), new Date(2026, 1, 1)), true);
  assert.equal(debeAvanzar(ts(new Date(2026, 1, 1)), new Date(2026, 0, 1)), false);
});

test("ventasHastaDe: normaliza Date, Timestamp, string y null", () => {
  const d = new Date(2026, 5, 14);
  assert.equal(ventasHastaDe({ ventas_hasta: d }).getTime(), d.getTime());
  assert.equal(ventasHastaDe({ ventas_hasta: ts(d) }).getTime(), d.getTime());
  assert.equal(ventasHastaDe({ ventas_hasta: null }), null);
  assert.equal(ventasHastaDe({}), null);
});

test("calcularResumen: ignora materias primas y cuenta despacho", () => {
  const productos = [
    { tipo: "Materia prima", ventas_hasta: new Date(2026, 0, 10) }, // ignorado
    { tipo: "Despacho", ventas_hasta: new Date(2026, 1, 1) },       // más reciente
    { tipo: "Despacho", ventas_hasta: new Date(2026, 0, 1) },       // atrasado
    { tipo: "Despacho" },                                            // sin ventas
  ];
  const r = calcularResumen(productos);
  assert.equal(r.totalDespacho, 3);
  assert.equal(r.conVentas, 2);
  assert.equal(r.sinVentas, 1);
  assert.equal(r.atrasados, 1);
  assert.equal(r.masReciente.getTime(), new Date(2026, 1, 1).getTime());
  assert.equal(r.masAtrasada.getTime(), new Date(2026, 0, 1).getTime());
});

test("calcularResumen: sin productos de despacho no rompe", () => {
  const r = calcularResumen([{ tipo: "Materia prima" }]);
  assert.equal(r.totalDespacho, 0);
  assert.equal(r.masReciente, null);
  assert.equal(r.atrasados, 0);
});

test("estaAtrasado: solo despacho con fecha anterior al día más reciente", () => {
  const masReciente = new Date(2026, 1, 1);
  assert.equal(estaAtrasado({ tipo: "Despacho", ventas_hasta: new Date(2026, 0, 1) }, masReciente), true);
  assert.equal(estaAtrasado({ tipo: "Despacho", ventas_hasta: new Date(2026, 1, 1) }, masReciente), false);
  assert.equal(estaAtrasado({ tipo: "Despacho" }, masReciente), false);            // sin ventas
  assert.equal(estaAtrasado({ tipo: "Materia prima", ventas_hasta: new Date(2026, 0, 1) }, masReciente), false);
});

test("estaAtrasado: mismo día pero distinta hora no cuenta como atrasado", () => {
  const masReciente = new Date(2026, 1, 1, 20, 0);
  const productoTemprano = { tipo: "Despacho", ventas_hasta: new Date(2026, 1, 1, 8, 0) };
  assert.equal(estaAtrasado(productoTemprano, masReciente), false);
});

test("formatearFecha: 'sin ventas' para vacío, string con dígitos para fecha", () => {
  assert.equal(formatearFecha(null), "sin ventas");
  const out = formatearFecha(new Date(2026, 5, 14));
  assert.match(out, /\d/); // contiene al menos un dígito (formato local)
});
