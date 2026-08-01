// E2E configuración del Gerente: rubros, sectores, motivos y usuarios.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, byId, setValue, click, callGlobal } from "../harness/env.mjs";

before(async () => {
  seedDefaults({ role: "Gerente" });
  await loadView("gerente");
});

test("agregar un rubro lo guarda en la colección", async () => {
  const antes = store.count("rubros");
  setValue("input-nuevo-rubro", "Postres");
  await click("btn-agregar-rubro");
  assert.equal(store.count("rubros"), antes + 1);
  assert.ok(store.dump("rubros").some(r => r.nombre === "Postres"));
});

test("agregar un sector de acopio", async () => {
  const antes = store.count("sectores");
  setValue("input-nuevo-sector", "Depósito 2");
  await click("btn-agregar-sector");
  assert.equal(store.count("sectores"), antes + 1);
});

test("agregar un sector de despacho", async () => {
  const antes = store.count("sectores_despacho");
  setValue("input-nuevo-despacho", "Terraza");
  await click("btn-agregar-despacho");
  assert.equal(store.count("sectores_despacho"), antes + 1);
  assert.ok(store.dump("sectores_despacho").some(s => s.nombre === "Terraza"));
});

test("agregar un motivo de salida con transferencia", async () => {
  const antes = store.count("motivos_salida");
  setValue("input-nuevo-motivo", "6 - Devolución");
  byId("check-motivo-transfiere").checked = true;
  await click("btn-agregar-motivo");
  assert.equal(store.count("motivos_salida"), antes + 1);
  const nuevo = store.dump("motivos_salida").find(m => m.nombre === "6 - Devolución");
  assert.equal(nuevo.transfiere, true);
});

test("eliminar un item pide confirmación y lo borra al aceptar", async () => {
  const antes = store.count("rubros");
  const alguno = store.dump("rubros")[0];
  await callGlobal("eliminarItem", "rubros", alguno.id, alguno.nombre);
  await click("btn-confirm-ok");
  assert.equal(store.count("rubros"), antes - 1);
  assert.equal(store.get("rubros", alguno.id), undefined);
});

test("crear un usuario nuevo lo guarda como Cargador Salidas", async () => {
  const antes = store.count("usuarios");
  await click("btn-nuevo-usuario");
  setValue("usr-nombre", "Nuevo Empleado");
  setValue("usr-email", "empleado@greengarden.app");
  setValue("usr-password", "secreto123");
  await click("btn-guardar-usuario");
  assert.equal(store.count("usuarios"), antes + 1);
  const u = store.dump("usuarios").find(x => x.nombre === "Nuevo Empleado");
  assert.ok(u);
  assert.equal(u.rol, "Cargador Salidas");
  assert.equal(u.activo, true);
});
