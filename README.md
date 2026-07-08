# 🌿 Green Garden — Sistema de Inventario

App web de gestión de inventario para restaurante. Controla stock de
acopio y de sectores de despacho, ventas (manuales e importadas desde
Excel), recetas que consumen materia prima, conteos físicos y un
historial completo de movimientos, con acceso por roles.

- **Stack:** HTML + CSS + JavaScript vanilla (ES Modules, sin build step).
- **Backend:** Firebase Authentication + Cloud Firestore.
- **Hosting:** Firebase Hosting.
- **Proyecto Firebase:** `control-stoks---green-garden`.

---

## 🗂️ Estructura del proyecto

```
index.html            Login + recuperar contraseña
vistas/               Una pantalla por rol
  gerente.html        Panel completo (catálogo, usuarios, todo)
  administrador.html  Movimientos + ventas + ajustes + historial
  encargado.html      Entradas + salidas + inventario + historial
  entradas.html       Solo carga de entradas (Cargador Entradas)
  salidas.html        Solo carga de salidas (Cargador Salidas)
js/
  firebase-config.js  Inicializa Firebase (auth + db)
  auth.js             Login, logout, guardián de rutas por rol
  version.js          Fuente ÚNICA de la versión (sello en pantalla)
  gerente.js / administrador.js / encargado.js / entradas.js / salidas.js
                      Lógica de cada panel
  importador-ventas.js  Importa ventas desde Excel (match por PLU)
  conteo-fisico.js      Conteo físico (fija stock a un valor exacto)
  corte-ventas.js       Corte de ventas por producto (lógica pura de fechas)
css/estilos.css       Estilos base (variables + clases)
firestore.rules       Reglas de seguridad (hacen cumplir los roles)
firebase.json         Config de hosting + firestore
test/                 Tests de la lógica pura (node --test)
```

---

## 👥 Roles y rutas

El rol se guarda en el documento del usuario (`usuarios/{uid}.rol`). Al
loguear, `auth.js` redirige a la vista del rol. `protegerRuta()` bloquea
el acceso directo a una vista que no corresponde.

| Rol | Vista | Puede |
|-----|-------|-------|
| **Gerente** | `gerente.html` | Todo: catálogo (productos, rubros, sectores, motivos, recetas), usuarios, movimientos, ventas, ajustes, importar, historial |
| **Administrador** | `administrador.html` | Entradas, salidas, ventas, ajustes, importar, conteo, corregir motivos, historial |
| **Encargado** | `encargado.html` | Entradas, salidas, ver inventario, historial |
| **Cargador Entradas** | `entradas.html` | Solo registrar entradas |
| **Cargador Salidas** | `salidas.html` | Solo registrar salidas |

> ⚠️ **La seguridad real vive en `firestore.rules`**, no en el navegador.
> El guardián de rutas es solo UX. Las reglas son las que impiden que un
> rol haga lo que no le corresponde (ver más abajo).

---

## 🧱 Modelo de datos (Firestore)

**`productos`**
| Campo | Tipo | Notas |
|-------|------|-------|
| `nombre`, `plu`, `rubro`, `sector`, `unidad_medida` | string | — |
| `tipo` | string | `"Despacho"`, `"Materia prima"` o `"Receta"` |
| `stock_deposito` | number | Stock en el acopio |
| `stock_despacho` | map | `{ sector: cantidad }` por sector de despacho |
| `stock_minimo` | number\|null | Dispara alerta de "bajo mínimo" |
| `sectores_asignados` | array | Sectores de despacho del producto |
| `rendimiento`, `subunidad` | number, string | Fracción (ej. 1 botella = 700 ml) |
| `ventas_hasta` | timestamp | Corte de ventas del producto (solo avanza) |
| `por_variantes`, `variantes`, `ingredientes`, `sector_receta` | — | Solo recetas |

**`movimientos`** — historial inmutable de operaciones
`fecha_hora`, `id_usuario`, `nombre_usuario`, `id_producto`,
`nombre_producto`, `tipo` (`INGRESO_PROVEEDOR`, `INGRESO_PRODUCCION`,
`RETIRO`, `VENTA`, `AJUSTE`), `cantidad`, `unidad`, `motivo`, `origen`,
`destino`.

**`usuarios`** — `nombre`, `email`, `rol`, `activo`.
**`rubros` / `sectores` / `sectores_despacho` / `motivos_salida`** — catálogo (`nombre`, y `transfiere` en motivos).

### Modelo de stock
Cada producto tiene dos "baldes": **acopio** (`stock_deposito`) y
**despacho** (`stock_despacho`, un mapa por sector). Una salida con
motivo *Reposición* transfiere de acopio a un sector de despacho; una
venta descuenta del sector; una entrada suma al acopio.

> **Todas las escrituras de stock usan `increment()`** (operaciones
> atómicas del servidor), no "leer y escribir el total". Esto evita
> perder cantidades cuando varios usuarios operan a la vez. El conteo
> físico y el ajuste manual son la excepción: fijan un valor exacto a
> propósito.

---

## 🔐 Seguridad (resumen de `firestore.rules`)

- Todo requiere estar logueado y `activo == true`.
- **Catálogo** (rubros, sectores, motivos, productos: crear/borrar/editar): solo **Gerente**.
- **Mover stock** de un producto: cualquier rol, pero SOLO los campos de stock (`stock_deposito`, `stock_despacho`); el Admin además puede tocar `ventas_hasta`.
- **Movimientos:** todos crean (con `id_usuario` = su propio uid, no se puede falsificar el autor) y leen; corregir = Gerente/Admin; borrar = Gerente.
- **Usuarios:** solo el Gerente administra. Un Gerente **no puede** cambiarse a sí mismo el rol, desactivarse ni borrarse (anti-lockout).

### ⚠️ Bootstrap del primer Gerente
El primer Gerente hay que crearlo a mano: creá el usuario en Firebase
Authentication y luego el documento `usuarios/{uid}` con
`rol: "Gerente"`, `activo: true`. Desde ahí, el Gerente crea al resto
desde la app.

---

## 🚀 Deploy

```bash
firebase deploy --only hosting          # HTML/JS/CSS
firebase deploy --only firestore:rules  # reglas de seguridad
# o todo junto:
firebase deploy
```

La versión que se muestra en pantalla se cambia en **un solo lugar**:
`js/version.js` → `APP_VERSION`.

---

## 🧪 Desarrollo y tests

No hay build step: se edita y se deploya. Para probar la lógica pura
(corte de ventas / fechas) sin Firebase ni navegador:

```bash
npm test        # o: node --test
```

Los tests están en `test/` y usan el runner nativo de Node (sin
dependencias). Cubren `js/corte-ventas.js`, que es lógica pura y por eso
testeable de forma aislada. La lógica que toca Firestore/DOM se valida
manualmente en la app después de deployar.
