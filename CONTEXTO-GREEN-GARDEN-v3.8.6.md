# CONTEXTO COMPLETO — Green Garden Inventario (v3.8.6)

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
- **Importación Excel** (`importador-ventas.js`): matchea por **PLU**, lee el período del reporte, y descuenta. **Permite stock negativo** a propósito (señal de "se vendió algo que no se repuso al despacho"). Para **recetas**, descuenta los ingredientes (en unidad base) del sector de la receta; para **recetas con variantes**, matchea la variante por la columna **"Tamanio"** del Excel (normalizada: trim + uppercase).

### 7.4 Ajuste de inventario (solo Gerente y Admin)
Setea un **valor absoluto** (no delta). Dos formas:
- **Ajuste rápido:** un producto, eligiendo la **ubicación** (Acopio o un sector de despacho). Helpers `ubicacionesDe()`, `poblarUbicacionesAjuste()`.
- **Conteo físico** (`conteo-fisico.js`): ajuste masivo de acopio y de cada despacho a la vez.

### 7.5 Corregir motivo de un retiro (Gerente y Admin) — REVERSE + APPLY
Botón ✏️ en el historial / movimientos recientes. **Lógica actual (reescrita):** revierte por completo el efecto real del movimiento original (según su `origen` y `destino` reales) y aplica el efecto del nuevo motivo desde cero. Implementado con:
- `esDestinoSector(x)`, `efectoRetiro(origen, destino, cantidad)` → devuelve `{acopio:Δ, despacho:{sector:Δ}}`.
- Net = efectoNuevo − efectoViejo, aplicado al stock actual, en `writeBatch` atómico (stock del producto + el movimiento juntos).
- Marca `corregido:true`, guarda `motivo_anterior`.
- Para retiros que salieron de un sector de despacho, no ofrece motivos con transferencia.
- Casos validados: Retiro para uso→Reposición (acopio igual, +sector); Reposición→Vencimiento (acopio igual, −sector); retiro desde despacho cambiando etiqueta (sin tocar stock); Reposición de un sector a otro (mueve entre sectores).

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

- Fuente única: `js/version.js` → `export const APP_VERSION = "3.8.6"` + inyecta la pastillita en cualquier `.app-version`.
- **Además**, por el quirk de deploy (archivos nuevos), cada panel JS (gerente, administrador, encargado, entradas, salidas) y el `index.html` tienen un **IIFE autocontenido** al final que crea/estiliza la pastillita con la versión **hardcodeada** ("v3.8.6"). Así el sello aparece aunque `version.js` no se haya deployado.
- **Para subir de versión:** `sed -i 's/v3.8.6/v3.8.7/g'` en `js/{gerente,administrador,encargado,entradas,salidas}.js` e `index.html`, y actualizar `APP_VERSION` en `version.js`. (El número está hardcodeado en ~6 lugares; conviene cambiarlo en todos de una pasada.)

---

## 13. CONVENCIONES DE TRABAJO DE CLAUDE (importante respetarlas)

1. Trabajar en `/home/claude/green-garden`.
2. Tras cada edición de JS: `node --check js/<archivo>.js`.
3. Para lógica de stock delicada, **simular con node** antes de entregar (se hizo con corregir-motivo y con la conversión de fracciones).
4. Subir el sello de versión.
5. Reempaquetar a `/mnt/user-data/outputs/` (incluir el manual dentro: `cp manual-green-garden-v3.8.html green-garden/` antes de zipear) y `present_files`.
6. Recordarle a Martín: pisar la carpeta `js` completa + las vistas tocadas, y hard refresh.
7. Entregar archivos/ZIP completos, no diffs.

---

## 14. ESTADO ACTUAL (v3.8.6) — qué se hizo recientemente

- Recetas con ingredientes de **cualquier** producto (no solo materia prima) + variantes por tamaño.
- Ajuste de inventario por **ubicación** (acopio o sector).
- **Corregir motivo** reescrito a reverse+apply (atómico, contempla origen).
- **Fracciones/rendimiento** para ingredientes (entrada en ml → guarda base).
- **Redondeo de display** con `fmtN()` (valor real intacto).
- **Retiro desde despacho** habilitado para Cargador de Salidas y Encargado.
- Panel **bajo mínimo colapsable** (gerente y admin).
- **Buscador** en el desplegable de productos del editor de receta.
- **Fix** filtro de historial: ahora filtra solo por rango de fechas (era bug de huso horario en el "hasta"; se parsea en hora local con `+"T00:00:00"` / `+"T23:59:59"`).

---

## 15. PENDIENTES / DEUDA TÉCNICA (de la auditoría de movimientos)

Ordenados por prioridad. Ninguno es bloqueante; la app es sólida.

1. **🟡 Atomicidad (condición de carrera):** casi todas las operaciones leen el stock del cache local y escriben valor absoluto. Con `onSnapshot` la ventana es chica, pero si dos dispositivos tocan el mismo producto a la vez, una actualización puede perderse. **Recomendación pendiente:** usar `increment()` de Firestore para los deltas (entradas, retiros, ventas, descuento de ingredientes). El más expuesto: importar ventas mientras otro repone el mismo producto.
2. **🟡 Inconsistencia de recorte:** venta manual y retiros usan `Math.max(0,...)` (recortan a 0); el importador permite negativo (señal útil). Decisión pendiente: unificar criterio (recomendado: permitir negativo en ventas también).
3. **🟢 Conteo físico:** registra el movimiento y actualiza el stock en dos escrituras separadas (no en batch) → si falla una, queda inconsistente. Conviene agruparlas en `writeBatch`.
4. **🟢 `id_usuario` inconsistente:** importador y conteo usan `_usuarioActual.uid`; los cargadores usan `auth.currentUser?.uid`.
5. **🟢 Venta de receta:** no deja un movimiento del trago en sí, solo de cada ingrediente (no hay línea "se vendieron 5 gin tonic" en el historial).
6. **🟢 Rendimiento:** cambiar el rendimiento de un producto no recalcula automáticamente las recetas que lo usan (hay que reabrir y guardar).

---

## 16. DATOS DE CONTACTO / SOPORTE (Martin Romero Studio)
- Web: martinromerostudio.com.ar
- Email: contacto@martinromerostudio.com.ar
- WhatsApp: +54 9 221 435-8401
- (El dominio viejo `martinromero.com.ar` está discontinuado; usar `martinromerostudio.com.ar`.)

---

*Fin del contexto. La app está en v3.8.6, operativa y deployada. Para continuar: pedir el ZIP actual o reconstruir desde el último entregado, trabajar en `/home/claude/green-garden`, y seguir las convenciones de la sección 13.*
