# CONTEXTO COMPLETO — Green Garden Inventario (v3.10.0)

> Pegá este documento al iniciar una conversación nueva. Resume TODO el proyecto: qué es, cómo está hecho técnicamente, la lógica de negocio, la UX/UI, el estado actual y lo que queda pendiente. Está escrito para que una instancia nueva de Claude entienda el proyecto sin necesidad de la conversación anterior.

---

## 1. QUÉ ES

**Green Garden Inventario** es una PWA (app web instalable) de gestión de inventario para un restaurante. Corre 100% en el navegador (celular, tablet o PC), sin instalación. Maneja stock en tiempo real, ventas, recetas/tragos, y control multi-usuario por roles.

- **URL en producción:** https://control-stoks---green-garden.web.app
- **Cliente:** un restaurante (Green Garden). El desarrollador es **Martín Romero** (Tincho/Tin), de **Martin Romero Studio**, La Plata, Argentina.
- **Comunicación:** español rioplatense informal ("vos", "dale", "fijate"). Martín es de perfil técnico (sabe HTML/CSS/JS básico-intermedio), estilo directo e iterativo: prueba en local con Live Server, reporta visualmente, y **prefiere que se le entregue el archivo completo o un ZIP, no diffs**.

---

## 2. STACK TÉCNICO

- **Frontend:** HTML + CSS + JavaScript **vanilla, sin frameworks** (nada de React/Vue). ES Modules.
- **Backend:** **Firebase** (todo serverless):
  - **Auth** (email/password) — login y roles.
  - **Firestore** — base de datos en tiempo real (`onSnapshot`).
  - **Hosting** — donde está deployada.
- **Firebase project ID:** `control-stoks---green-garden`
- **SDK Firestore:** v10.12.2 importado por CDN como ES module (`https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`).
- **Excel:** SheetJS (`xlsx`) importado por CDN dinámicamente para importar ventas y exportar historial.
- **Sin build step.** Se edita el archivo y se deploya tal cual.

### Plan Firebase: Spark (gratis)
Importante: el plan gratuito **rechaza deploys que incluyan archivos ejecutables** (HTTP 400). Por eso el `firebase.exe` va en el `.gitignore`/ignore del `firebase.json`.

---

## 3. MÉTODO DE DEPLOY ("método blindado" de Martín — Windows)

Martín deploya manualmente en Windows con un `firebase.exe` portátil:

1. Init Hosting desde la consola web (Build > Hosting > Get Started) para evitar el error "resolving hosting target with no site name".
2. Descargar `firebase.exe` portable de https://firebase.tools/bin/win/instant/latest y ponerlo en la raíz del proyecto.
3. `.firebaserc` con el project ID por defecto; `firebase.json` con `"public": "."` y `"firebase.exe"` en la lista de `ignore` (si no, el plan Spark rechaza el deploy).
4. Doble clic en `firebase.exe` (saltear SmartScreen) → `firebase login` → `firebase deploy`.

### ⚠️ QUIRK DE DEPLOY CRÍTICO (causa de MUCHOS dolores de cabeza)
Cuando se agregan **archivos nuevos** (ej. `version.js`), Martín a veces los deploya y **no aparecen**. La causa: deploya desde una carpeta cuya `js/` no tiene el archivo nuevo. **Solución que SIEMPRE hay que recordarle:** descomprimir el ZIP y **copiar la carpeta `js` COMPLETA (y las vistas) pisando** las de la carpeta donde está el `firebase.exe`, no archivo por archivo. Por eso, históricamente, se evita depender de archivos nuevos y se prefiere meter cosas dentro de archivos que ya se deployan bien.
- **Caché del navegador:** después de deployar, hacer **hard refresh** (`Ctrl+Shift+R`) o incógnito. Si "no aparece" un cambio, casi siempre es caché o el quirk de arriba.
- **Verificar versión deployada:** abrir la consola (F12) → debe verse "🍃 Green Garden Inventario v3.8.6", y abajo a la derecha una pastillita dorada con la versión.

---

## 4. ESTRUCTURA DE ARCHIVOS

```
green-garden/
├── index.html              ← login (raíz). Tiene su <script type="module"> inline.
├── firebase.json, .firebaserc
├── css/
│   └── estilos.css         ← design system completo (variables CSS, componentes)
├── vistas/
│   ├── gerente.html        ← panel Gerente (6 pestañas)
│   ├── administrador.html  ← panel Administrador
│   ├── encargado.html      ← panel Encargado
│   ├── entradas.html       ← Cargador de Entradas
│   └── salidas.html        ← Cargador de Salidas
├── js/
│   ├── firebase-config.js  ← init de Firebase (config + export auth, db)
│   ├── auth.js             ← protegerRuta(rol), logout, evento "usuarioListo"
│   ├── version.js          ← APP_VERSION (fuente única) + inyecta el sello
│   ├── gerente.js          ← lógica del panel Gerente (el más grande, ~1500 líneas)
│   ├── administrador.js    ← lógica Admin (similar a gerente, más acotado)
│   ├── encargado.js        ← lógica Encargado
│   ├── entradas.js         ← lógica Cargador Entradas
│   ├── salidas.js          ← lógica Cargador Salidas
│   ├── importador-ventas.js← importación de ventas desde Excel (módulo compartido gerente/admin)
│   ├── conteo-fisico.js    ← conteo físico / ajuste masivo (módulo compartido)
│   └── corte-ventas.js     ← control de "ventas cargadas hasta" (módulo compartido)
├── test/
│   ├── corte-ventas.test.js   ← unit (node --test)
│   ├── e2e/*.test.mjs         ← simulador E2E de cada vista
│   ├── harness/               ← Firebase falso + loader + jsdom (ver sección 16)
│   └── README.md
├── package.json            ← scripts test/test:unit/test:e2e; jsdom devDependency
└── manual-green-garden-v3.8.html  ← manual de usuario branded (imprimible a PDF)
```

**Directorio de trabajo de Claude:** `/home/claude/green-garden` (persiste entre turnos de una misma tanda). El ZIP fuente original fue `green-garden-v3-6.zip`.

---

## 5. MODELO DE DATOS (Firestore)

### Colecciones
`productos`, `movimientos`, `usuarios`, `rubros`, `sectores` (sectores de acopio), `sectores_despacho`, `motivos_salida`.

### Documento `productos`
```
nombre, plu (opcional, string — para matchear importación de ventas),
rubro, sector (sector de ACOPIO), unidad_medida (Kg/Litros/Unidades/...),
tipo: "Despacho" | "Materia prima" | "Receta",
sectores_asignados: [string]   // sectores de despacho donde puede estar (solo Despacho)
stock_deposito: number          // stock en ACOPIO
stock_despacho: { [sector]: number }  // stock por sector de DESPACHO
stock_minimo: number | null     // alerta de bajo mínimo
// Fracción / rendimiento (opcional, para ingredientes de recetas):
rendimiento: number | null      // cuántas subunidades hay en 1 unidad base (ej. 700)
subunidad: string | null        // nombre de la subunidad (ej. "ml")
// Solo si tipo === "Receta":
por_variantes: boolean
sector_receta: string | null    // sector donde se arma (receta simple)
ingredientes: [Ingrediente]     // receta simple
variantes: [Variante]           // receta con variantes por tamaño
// Control de ventas (solo Despacho):
ventas_hasta: Timestamp | null  // hasta qué fecha están cargadas sus ventas
```

**Ingrediente** (dentro de `ingredientes`):
```
{
  id,           // id del producto-ingrediente
  nombre,
  cantidad,     // SIEMPRE en unidad base (lo que descuenta el importador). Ej: 0.0857 botellas
  unidad,       // unidad base (ej. "Unidades")
  cant_in,      // valor tal como lo escribió el usuario (ej. 60). Para mostrar/editar.
  unidad_in     // unidad ingresada (ej. "ml")
}
```

**Variante** (dentro de `variantes`):
```
{ tamano: string, sector: string, ingredientes: [Ingrediente] }
```

### Documento `movimientos`
```
fecha_hora: Timestamp,
id_usuario, nombre_usuario,
id_producto, nombre_producto,
tipo: "INGRESO_PROVEEDOR" | "INGRESO_PRODUCCION" | "RETIRO" | "VENTA" | "AJUSTE",
cantidad, unidad,
motivo,                 // ej. "Reposición", "Vencimiento — observación"
origen,                 // "acopio" | nombre de sector | "externo" (entradas)
destino,                // "consumo" | nombre de sector de despacho
// solo en correcciones de motivo:
corregido: true, motivo_anterior, fecha_correccion,
// solo en ventas:
periodo, periodo_desde, periodo_hasta
```

---

## 6. MODELO DE STOCK (clave para entender TODO)

Cada producto tiene el stock en **dos baldes separados**:

1. **Acopio** (`stock_deposito`): el depósito/cámara/bodega. Acá entra la mercadería al comprarla.
2. **Despacho** (`stock_despacho`, un mapa `{sector: cantidad}`): los puntos operativos (Barra, Cocina, Parrilla...) donde el producto queda listo para venderse/usarse.

**Stock total = acopio + suma de todos los despachos.**

### Tres tipos de producto
- **🥤 Despacho:** se consume tal cual (gaseosas, vinos, cervezas). Tiene acopio + sectores de despacho. Se vende (descuenta del despacho).
- **🌾 Materia prima:** se usa para elaborar (harina, carne). Solo acopio. No se vende sola.
- **🍸 Receta:** se arma con otros productos (gin tonic, pinta). **No tiene stock propio**: al venderse descuenta sus ingredientes del despacho del sector donde se arma.

---

## 7. LÓGICA DE MOVIMIENTOS (el corazón del sistema)

### 7.1 Entrada (`entradas.js`, también en encargado/gerente/admin)
Suma al **acopio**. Dos tipos:
- `INGRESO_PROVEEDOR`: mercadería comprada.
- `INGRESO_PRODUCCION`: algo elaborado en el restaurante que entra al stock.

### 7.2 Retiro (`salidas.js`, `encargado.js`, `gerente.js`, `administrador.js`)
Saca del acopio. El efecto depende del **motivo**:
- **Reposición** (motivo con `transfiere: true`): ÚNICO que transfiere. Resta del acopio Y suma en el sector de despacho. Atómico con `writeBatch`.
- **Retiro para uso / Merma / Vencimiento / Rotura** (`transfiere: false`): solo restan del acopio.
- Para materias primas, Reposición no se ofrece (no van a despacho).

**Retiro inteligente (v3.5, ahora en TODOS los roles que retiran):** cuando el acopio está en cero o bajo el mínimo PERO hay stock en algún sector de despacho, aparece un selector **"¿De dónde retirás?"** (Acopio + sectores con stock). Si se elige un sector, el movimiento queda con `origen = sector`, `destino = "consumo"`, y descuenta de ese despacho. En ese caso NO se ofrece Reposición (no se repone de despacho a despacho).
- Helper `acopioBajoOcero(p)`, `origenRetiroActual()`. Disponible en gerente, admin, encargado y cargador de salidas.

### 7.3 Venta (solo Gerente y Admin)
Descuenta del **despacho**. Dos vías:
- **Manual:** valida stock y recorta a 0 (`Math.max(0,...)`).
- **Importación Excel** (`importador-ventas.js`): matchea por **PLU**, lee el período del reporte, y descuenta con `increment()` **atómico** (agrega los deltas por producto/sector antes de escribir → un solo `increment` por campo, no se pisa con operaciones concurrentes ni se duplica si un PLU aparece en varias filas). **Permite stock negativo** a propósito (señal de "se vendió algo que no se repuso al despacho"). Para **recetas**, descuenta los ingredientes (en unidad base) del sector de la receta; para **recetas con variantes**, matchea la variante por la columna **"Tamanio"** del Excel (normalizada: trim + uppercase).
  - **Guarda anti-doble-importación (v3.9):** antes de descontar, detecta **solapamiento** con lo ya cargado usando el `ventas_hasta` por producto y el período **desde/hasta** del reporte. Si el archivo (o un período que pisa lo ya cargado) ya se importó, **pide confirmación explícita** antes de volver a descontar. Evita el faltante por reimportar el mismo Excel. Limitación: un período nuevo pero parcialmente solapado se avisa, pero si se confirma sigue descontando el tramo repetido (haría falta ventas por día, que el reporte no trae).

### 7.4 Ajuste de inventario (solo Gerente y Admin)
Aplica la **DIFERENCIA** entre lo contado y lo mostrado con `increment()` (v3.9; antes escribía el valor absoluto). Así el ajuste **compone** con ventas/reposiciones/importaciones concurrentes en vez de pisarlas: si veo 8, cuento 10 (Δ +2) y mientras tanto se vendió 1, el resultado final es 8−1+2 = 9 (correcto), no 10 (que perdería la venta). El resto del sistema ya usaba `increment`; el ajuste era el único que escribía absoluto y por eso era la causa probable de las inconsistencias de stock. Dos formas:
- **Ajuste rápido:** un producto, eligiendo la **ubicación** (Acopio o un sector de despacho). Escribe `stock_deposito: increment(nuevo − anterior)` o `stock_despacho.<sector>: increment(...)`. Helpers `ubicacionesDe()`, `poblarUbicacionesAjuste()`.
- **Conteo físico** (`conteo-fisico.js`): ajuste masivo de acopio y de cada despacho a la vez, también con `increment` del delta. La foto se toma al abrir la pantalla; como aplica deltas, un movimiento concurrente que entre mientras se cuenta ya no se borra. Si lo contado coincide con lo mostrado, no escribe.

### 7.5 Editar / eliminar un retiro (Gerente y Admin) — REVERSE + APPLY
Botón ✏️ en el historial / movimientos recientes abre el modal **"Editar retiro"** (`modal-editar-motivo`). Desde ahí se puede cambiar **producto, cantidad y motivo**, y **eliminar** el movimiento. Todo pasa por reverse + apply: se revierte por completo el efecto real del movimiento original (según su `id_producto`, `cantidad`, `origen` y `destino` reales) y se aplica el efecto del movimiento editado desde cero. Implementado con:
- `esDestinoSector(x)`, `efectoRetiro(origen, destino, cantidad)` → devuelve `{acopio:Δ, despacho:{sector:Δ}}`.
- `edmProdSel()`, `edmCant()`, `edmPoblarProductos(filtro)` (con buscador), `edmPoblarMotivos()` (filtra por producto: materia prima o retiro-desde-despacho no ofrecen transferencia).
- `edmDeltas(incluirApply)` → mapa `{idProducto:{acopio, despacho}}`: siempre revierte el original (−1) y, si `incluirApply`, aplica el editado (+1). Si cambia el producto, la reversión toca el producto viejo y la aplicación el nuevo (dos documentos).
- Se aplica con `increment()` en `writeBatch` atómico (los productos afectados + el movimiento juntos). Editar marca `corregido:true` y guarda `motivo_anterior`; eliminar hace `batch.delete` del movimiento.
- Guarda contra producto inexistente (no toca stock de un producto borrado).
- Casos validados por simulación: cambio de cantidad (para uso y reposición), cambio de producto (acopio y retiro-desde-despacho), cambio de motivo (para uso→reposición, etc.) y eliminación (reposición y retiro-desde-despacho).
- **Reglas Firestore:** `movimientos` `update` y `delete` habilitados para Gerente **o** Admin (antes `delete` era solo Gerente). El ajuste de stock del Admin queda dentro de `stock_deposito`/`stock_despacho`, que ya tenía permitido.

---

## 8. RECETAS Y FRACCIONES (rendimiento)

Las bebidas se cargan por unidad entera (ej. una botella de gin), pero las recetas usan fracciones (60 ml). Solución implementada (**Opción rendimiento**):

- En el producto, campos opcionales **rendimiento + subunidad**: "1 unidad = 700 ml". Solo se cargan en productos fraccionados (gin, vermut, jarabes); el resto no los necesita. Funciona al crear y al editar productos existentes.
- En el editor de receta, al elegir un ingrediente con rendimiento, aparece un **selector de unidad** (ml / unidad base, default ml) y un **cartel de conversión en vivo** ("= 0.0857 Unidades").
- Al guardar el ingrediente, se almacena `cantidad` en **unidad base** (60/700 = 0.0857) y se guardan `cant_in`/`unidad_in` (60, "ml") para mostrar/editar.
- **La lógica de descuento NO cambió**: el importador sigue descontando en unidad base. El ml es solo comodidad de carga. La preview del importador muestra el consumo en la unidad ingresada (ej. "300 ml").
- ⚠️ Limitación conocida: si se cambia el `rendimiento` de un producto, hay que reabrir y volver a guardar las recetas que lo usan para que recalculen.

Editor de receta también tiene: **buscador escribiendo** (input "🔍 Buscar producto…" que filtra el desplegable de ingredientes en vivo, autoseleccionando el primer match), y soporte de **variantes por tamaño** (ej. Gin Tonic Nacional/Importado, cada una con sus ingredientes).

---

## 9. CONTROL DE VENTAS CARGADAS (`corte-ventas.js`)

Lleva, por cada producto de despacho, hasta qué fecha están cargadas sus ventas (`ventas_hasta`). 
- Un panel resumen muestra la fecha más reciente y cuántos productos están "atrasados" (con ventas cargadas hasta una fecha anterior).
- La fecha **solo avanza, nunca retrocede** (importar un reporte viejo no pisa uno nuevo).
- Materias primas y recetas no cuentan (solo despacho).
- "X productos atrasados" es informativo, no un error: significa que esos productos no se vendieron en el período importado o no tienen PLU.

---

## 10. ROLES Y PERMISOS

| Función | Gerente | Admin | Encargado | C. Entradas | C. Salidas |
|---|---|---|---|---|---|
| Ver stock completo | ✓ | ✓ | ✓ | — | — |
| Registrar entradas | ✓ | ✓ | ✓ | ✓ | — |
| Registrar retiros (+ retiro desde despacho) | ✓ | ✓ | ✓ | — | ✓ |
| Registrar/importar ventas | ✓ | ✓ | — | — | — |
| Ajuste y conteo físico | ✓ | ✓ | — | — | — |
| Corregir motivo de retiro | ✓ | ✓ | — | — | — |
| Historial completo + Excel | ✓ | ✓ | ✓ | — | — |
| Crear/editar productos y recetas | ✓ | — | — | — | — |
| Configurar sectores/motivos/usuarios | ✓ | — | — | — | — |

`auth.js` expone `protegerRuta("Rol")` que redirige según el rol del usuario logueado y dispara el evento `usuarioListo` con `e.detail = {nombre, rol, uid...}`.

---

## 11. UX / UI — DESIGN SYSTEM (Martin Romero Studio)

**Paleta** (en `css/estilos.css` como variables):
- Negro `#1c1b18`, Tinta `#2c2a26`
- Dorado `#c2a35e`, Dorado hondo `#9a7f43`
- Crema `#f8f4ea`, Arena `#ece3d2`, Arena borde `#ddd0b8`
- Verde `#2d6a4f` (acción/éxito), Rojo/crítico `#b04a3a`/`var(--critico-txt)`
- Hay variables tipo `--texto-2`, `--texto-3`, `--borde`, `--bg-secondary`, `--verde-claro`, `--bajo-bg`, `--bajo-txt`, `--radio`, `--radio-input`, `--critico-bg`.

**Tipografías:** Cormorant Garamond (serif, títulos) + Plus Jakarta Sans (sans, cuerpo).

**Patrones UI:**
- Mobile-first (la usan mayormente desde el celular en pantalla angosta → **cuidar que los layouts flex no aplasten inputs/selects**; varios bugs históricos fueron por eso).
- Modales (`abrirModal(id)`/`cerrarModal(id)`), spinners (`<span class="spinner">`), mensajes inline (`mostrarMsg(el, "error"|"ok", txt)`), flash toasts.
- Buscadores con `<input type="search">` + `<select>` poblado dinámicamente.
- Sello de versión: pastillita dorada fija abajo a la derecha.
- Redondeo de display: helper **`fmtN(n)`** redondea a máx 2 decimales para mostrar (6→6, 1.4571→1.46) **sin tocar el valor real ni las comparaciones de stock mínimo**. Está en gerente, admin y encargado.
- Panel "Productos bajo mínimo": **colapsable** (header clickeable con contador y flecha; arranca cerrado) en gerente y admin.

---

## 12. VERSIONADO

- Fuente **única**: `js/version.js` → `export const APP_VERSION = "3.9.0"` + inyecta la pastillita en cualquier `.app-version` (y la crea si no existe). Está incluido con `<script type="module" src=".../version.js">` en las 5 vistas y en `index.html`.
- Ya **no** hay IIFEs con la versión hardcodeada en cada panel (se removieron): para subir de versión alcanza con cambiar `APP_VERSION` en `js/version.js`. Asegurarse de deployar ese archivo (ver quirk de deploy).

---

## 13. CONVENCIONES DE TRABAJO DE CLAUDE (importante respetarlas)

1. Trabajar en `/home/claude/green-garden`.
2. Tras cada edición de JS: `node --check js/<archivo>.js`.
3. Para lógica de stock delicada, **correr `npm test`** (y agregar/actualizar tests en `test/e2e/`). Es la red de seguridad principal; ver sección 16.
4. Subir el sello de versión.
5. Reempaquetar a `/mnt/user-data/outputs/` (incluir el manual dentro: `cp manual-green-garden-v3.8.html green-garden/` antes de zipear) y `present_files`.
6. Recordarle a Martín: pisar la carpeta `js` completa + las vistas tocadas, y hard refresh.
7. Entregar archivos/ZIP completos, no diffs.

---

## 14. ESTADO ACTUAL (v3.10.0) — qué se hizo recientemente

**v3.10.0 (features):**
- **Venta manual permite negativo:** ya no bloquea por stock insuficiente; registra la venta y deja el sector en negativo como señal de faltante (unificado con el importador). Los retiros conservan su guard.
- **Rendimiento recalcula recetas:** cambiar el rendimiento/subunidad de una materia prima recalcula la cantidad base de las recetas que la usan en subunidad, sin reabrirlas a mano.
- **Buscador en el catálogo de Productos** (Gerente): filtra por nombre o PLU.
- **Bajo mínimo colapsable en Encargado:** mismo desplegable que Gerente/Administrador.

**v3.9.1 (pulido de cositas):**
- **Conteo físico atómico:** el ajuste de stock y sus movimientos de historial van en un mismo `writeBatch` por producto (antes el movimiento era un `addDoc` suelto).
- **`id_usuario` consistente:** todos los módulos escriben `auth.currentUser?.uid || null` (nunca `undefined`).
- **Fix UX editar retiro:** al reabrir el modal para otro movimiento, el motivo se preselecciona con el del movimiento real, no con el del anterior. Con test e2e de regresión.

**v3.9.0 (auditoría de stock + tests):**
- **Ajustes atómicos:** ajuste rápido y conteo físico pasan de escribir valor absoluto a aplicar el **delta con `increment()`** → dejan de pisar ventas/reposiciones concurrentes (era la causa probable de las inconsistencias de stock).
- **Guarda anti-doble-importación:** el importador detecta solapamiento de período (por `ventas_hasta` + desde/hasta del reporte) y pide confirmación antes de re-descontar.
- **Suite de tests** (`npm test`): unit + un simulador E2E que ejecuta el código real de las 5 vistas sobre jsdom contra un Firebase falso (ver sección 17).

**Antes (v3.8.x):**
- Recetas con ingredientes de **cualquier** producto + variantes por tamaño.
- Ajuste de inventario por **ubicación** (acopio o sector).
- **Corregir/eliminar retiro** con reverse+apply (atómico, contempla origen).
- **Fracciones/rendimiento** para ingredientes (entrada en ml → guarda base).
- **Redondeo de display** con `fmtN()` (valor real intacto).
- **Retiro desde despacho** habilitado para Cargador de Salidas y Encargado.
- Panel **bajo mínimo colapsable** (gerente y admin).

---

## 15. PENDIENTES / DEUDA TÉCNICA

### ✅ Resueltos en v3.9.0
1. **Atomicidad / condición de carrera** — RESUELTO. **Todas** las operaciones de stock usan `increment()` atómico (entradas, retiros/transferencias, ventas manuales, importación, descuento de ingredientes, editar/eliminar movimientos y **los dos ajustes**). El ajuste rápido y el conteo físico eran los únicos que escribían absoluto y pisaban cambios concurrentes; ahora aplican el delta.
2. **Doble importación** — RESUELTO. Guarda anti-solapamiento en el importador (ver 7.3).

### ✅ Resueltos en v3.9.1 (pulido de cositas)
- **🟢 Conteo físico atómico** — RESUELTO. El update de stock y sus movimientos de historial ahora van en un mismo `writeBatch` por producto (`conteo-fisico.js`): o se aplican los dos, o ninguno. Antes el movimiento iba en un `addDoc` suelto y podía quedar sin su ajuste de stock (o al revés).
- **🟢 `id_usuario` consistente** — RESUELTO. Todos los módulos escriben `id_usuario: auth.currentUser?.uid || null` (antes los cargadores no tenían el `|| null`, así que sin sesión escribían `undefined` y Firestore borraba el campo). El `nombre_usuario` sigue viniendo del usuario actual pasado a cada módulo.
- **🟢 UX (editar retiro)** — RESUELTO. Al reabrir "editar retiro" para OTRO movimiento, el `<select>` de motivo ahora parte SIEMPRE del motivo real del movimiento (`edmPoblarMotivos(desdeMovimiento=true)` al abrir; el cambio de producto dentro del modal sigue preservando la selección). Antes conservaba el valor del movimiento anterior si era válido para el nuevo producto. Cubierto por un test e2e de regresión en `test/e2e/movimientos.test.mjs`.

### ✅ Resueltos en v3.10.0 (features)
- **🟡 Recorte de venta unificado** — RESUELTO. La **venta manual** ya no bloquea por stock insuficiente: SIEMPRE registra la venta y deja el sector en negativo (señal de faltante), igual que el importador. Los **retiros** conservan su guard (bloquear un sobre-retiro físico es intencional; hay tests que lo exigen). Test en `test/e2e/administrador.test.mjs`.
- **🟢 Rendimiento recalcula recetas** — RESUELTO. Al editar el rendimiento / subunidad / unidad base de una materia prima, las recetas que la usan **en subunidad** recalculan su `cantidad` base (`cantidad = cant_in / rendimiento_nuevo`) automáticamente (`recalcularRecetasPorRendimiento` en `gerente.js`). Test en `test/e2e/rendimiento.test.mjs`.
- **🟢 Buscador de catálogo** — nuevo `#prod-buscar` en la pestaña Productos del Gerente: filtra la lista por nombre o PLU para editar rápido. Test en `test/e2e/productos.test.mjs`.
- **🟢 Bajo mínimo colapsable en Encargado** — la sección "Productos bajo mínimo" del Encargado ahora es un desplegable (header + chevron + conteo), igual que Gerente y Administrador. Test en `test/e2e/alertas-encargado.test.mjs`. (Entradas y Salidas no tienen lista de bajo mínimo: solo muestran el stock del producto seleccionado.)

### Pendientes (ninguno bloqueante)
- **🟢 Venta de receta:** no deja un movimiento del trago en sí, solo de cada ingrediente (no hay línea "se vendieron 5 gin tonic" en el historial). **Descartado por decisión del cliente: no se necesita.**

---

## 16. TESTS Y SIMULADOR DE VISTAS (v3.10.0)

Hay una suite de tests que corre **sin navegador ni Firebase real** con `npm test` (unit + e2e). Sirve como red de seguridad para cambios futuros.

```bash
npm test          # 67 tests (9 unit + 58 e2e)
npm run test:unit # lógica de fechas del corte de ventas
npm run test:e2e  # simulador de las 5 vistas
```

**Simulador E2E** (`test/e2e/*.test.mjs` + `test/harness/`): ejecuta el **código real** de cada vista (`js/<vista>.js` + `vistas/<vista>.html`) sobre **jsdom**, contra un **Firestore falso en memoria** (`test/harness/store.mjs`) con semántica real de `increment()`, field-paths, `serverTimestamp`, `writeBatch` y `onSnapshot` de tiempo real. Un **loader de Node** (`test/harness/hooks.mjs` + `register.mjs`) intercepta las URLs del SDK de Firebase y de SheetJS y las apunta a mocks. `test/harness/env.mjs` monta la vista, siembra un catálogo, simula el login y expone helpers (`click`, `setSelect`, `setValue`, `uploadExcel`, …).

Cubre las 5 vistas y toda la lógica de stock: entradas, retiros/transferencias, ventas, ajuste rápido, conteo físico (incluyendo que no pierde movimientos concurrentes), importación con todos sus casos borde (PLU inexistente, multi-sector, dedup, recetas por variantes, guarda anti-doble), editar/eliminar movimientos, CRUD de productos y de configuración (rubros/sectores/motivos/usuarios) y validaciones.

- **`jsdom`** es `devDependency` (solo para tests). No se publica: `firebase.json` ignora `test/` y `node_modules/`.
- El e2e corre en serie (`--test-concurrency=1`) para que las ventanas async sean deterministas.
- Guía para extender: `test/README.md`.

---

## 17. DATOS DE CONTACTO / SOPORTE (Martin Romero Studio)
- Web: martinromerostudio.com.ar
- Email: contacto@martinromerostudio.com.ar
- WhatsApp: +54 9 221 435-8401
- (El dominio viejo `martinromero.com.ar` está discontinuado; usar `martinromerostudio.com.ar`.)

---

*Fin del contexto. La app está en v3.10.0, operativa y deployada. Para continuar: trabajar sobre el repo, correr `npm test` ante cualquier cambio de stock, y seguir las convenciones de la sección 13.*
