# Tests — Green Garden Inventario

Dos capas de tests. Todo corre con **`npm test`** (sin navegador, sin Firebase real).

```bash
npm test          # unit + e2e
npm run test:unit # lógica pura (corte de ventas)
npm run test:e2e  # simulador de las 5 vistas
```

## 1. Unit (`test/corte-ventas.test.js`)
Prueba la lógica de fechas del corte de ventas de forma aislada.

## 2. Simulador E2E de vistas (`test/e2e/*.test.mjs`)
Ejecuta el **código real** de cada vista (`js/<vista>.js` + `vistas/<vista>.html`)
sobre **jsdom**, contra un **Firebase falso en memoria**. Simula el login, dispara
los clicks/inputs reales de la UI y verifica cómo queda el stock en la "base".

Cubre las 5 vistas y toda la lógica que toca stock:

| Vista | Qué verifica |
|-------|--------------|
| Entradas | ingreso a acopio (increment), validaciones |
| Salidas | retiro de acopio/despacho, transferencia (reposición), stock insuficiente |
| Encargado | entrada, retiro, transferencia, stock insuficiente |
| Gerente | ajuste rápido (increment del delta), **conteo físico con venta concurrente** (no se pierde), importación de ventas, **guarda anti-doble-importación**, alta de producto |
| Administrador | venta directa, ajuste, conteo concurrente, importación con guarda |

### Cómo funciona el andamiaje (`test/harness/`)
- `store.mjs` — Firestore falso en memoria: `increment()`, field-paths con punto,
  `serverTimestamp()`, `writeBatch`, y `onSnapshot` que se re-dispara tras cada escritura.
- `mock-firestore.mjs` / `mock-auth.mjs` / `mock-app.mjs` / `mock-xlsx.mjs` — reemplazan
  al SDK de Firebase y a SheetJS.
- `hooks.mjs` + `register.mjs` — loader de Node que intercepta las URLs del SDK
  (`https://www.gstatic.com/...`, `https://cdn.sheetjs.com/...`) y las apunta a los mocks.
- `env.mjs` — monta la vista sobre jsdom, siembra un catálogo realista, simula el
  usuario logueado y expone helpers (`click`, `setSelect`, `setValue`, `uploadExcel`, …).

### Agregar un test de una vista nueva
```js
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seedDefaults, loadView, store, setSelect, setValue, click } from "../harness/env.mjs";

before(async () => { seedDefaults({ role: "Gerente" }); await loadView("gerente"); });

test("mi caso", async () => {
  setSelect("ajt-producto", "p-cerveza");
  // ...
  await click("btn-confirmar-ajuste");
  assert.equal(store.get("productos", "p-cerveza").stock_deposito, 15);
});
```
Para sembrar productos/datos extra: `seedDefaults({ role, seed: { productos: [...] } })`.
