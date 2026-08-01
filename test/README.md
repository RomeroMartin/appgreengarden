# Tests — Green Garden Inventario

Dos capas de tests (62 en total). Todo corre con **`npm test`** (sin navegador, sin Firebase real).

```bash
npm test          # unit + e2e (9 + 53)
npm run test:unit # lógica pura (corte de ventas)
npm run test:e2e  # simulador de las 5 vistas (serie, determinista)
```

## 1. Unit (`test/corte-ventas.test.js`)
Prueba la lógica de fechas del corte de ventas de forma aislada.

## 2. Simulador E2E de vistas (`test/e2e/*.test.mjs`)
Ejecuta el **código real** de cada vista (`js/<vista>.js` + `vistas/<vista>.html`)
sobre **jsdom**, contra un **Firebase falso en memoria**. Simula el login, dispara
los clicks/inputs reales de la UI y verifica cómo queda el stock en la "base".

Cubre las 5 vistas y toda la lógica que toca stock:

| Archivo | Qué verifica |
|---------|--------------|
| `entradas` | ingreso a acopio (increment), validaciones |
| `salidas` | retiro de acopio/despacho, transferencia, selector de origen, stock insuficiente |
| `encargado` | entrada, retiro, transferencia, stock insuficiente |
| `gerente` | ajuste rápido (delta), **conteo con venta concurrente**, importación, **guarda anti-doble**, alta de producto |
| `administrador` | venta directa, ajuste, conteo concurrente, importación con guarda |
| `importador` | PLU inexistente, multi-sector, dedup, recetas por variantes (match/no-config), sin período |
| `productos` | alta despacho/receta, validaciones, editar sin pisar `stock_despacho`, cambio de tipo |
| `movimientos` | editar/eliminar retiros (reverse + apply atómico) |
| `ajuste-conteo` | validaciones de ajuste, conteo multi-balde, conteo sin cambios |
| `config` | rubros, sectores, sectores de despacho, motivos, alta de usuario, borrado |

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
