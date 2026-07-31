# 🔙 Guía de Rollback — Green Garden Inventario

Cómo volver atrás si un deploy sale mal. La app es **Firebase Hosting +
Firestore** (proyecto `control-stoks---green-garden`).

> **Estado de referencia**
> - Último commit **antes** de los cambios de stock: `153df10` (v3.8.7).
> - Cambios de stock: `2bcb4dc` (stock en vivo), `f95f1c9` (motivos numerados),
>   `df9c90e` (sello v3.8.8).

---

## Opción A — Rollback de Hosting (instantáneo, sin tocar git) ✅ recomendado en urgencia

Firebase guarda el historial de releases.

1. **Firebase Console** → proyecto `control-stoks---green-garden` → **Hosting**.
2. En **"Release history"**, ubicá el release anterior (el que quieras volver).
3. Menú **⋮ → "Rollback"**. Vuelve a producción en segundos.

Revierte **solo el sitio** (el código). No toca Firestore ni el repo. Ideal para
"algo salió mal, volvé ya".

---

## Opción B — Redeploy del commit bueno anterior (sin reescribir historial)

```bash
cd <carpeta-del-proyecto>
git fetch origin
git checkout 153df10          # estado "bueno" anterior (v3.8.7)
firebase deploy --only hosting
git checkout main             # volvés a main (sigue con el código nuevo)
```

Sirve el código viejo ya mismo y **no altera** el historial de git. Después se
arregla y se vuelve a subir.

---

## Opción C — Revertir en el repo también (deja `main` en el estado viejo)

```bash
git checkout main && git pull origin main
git revert --no-edit 153df10..df9c90e     # revierte los commits nuevos
git push origin main
firebase deploy --only hosting
```

`git revert` es seguro: crea commits nuevos que deshacen, sin borrar historia.

---

## Rollback del paso manual de motivos (es dato, no código)

La lógica de stock **no depende del nombre** del motivo (usa la bandera
`transfiere`), así que renombrar/volver atrás es inofensivo. En
**Gerente → Configuración → Motivos**, eliminá y volvé a crear los que quieras.

---

## ⚠️ Qué podría salir mal (por probabilidad)

1. **Paso manual de motivos (operativo).** El auto-sembrado numerado solo corre
   en el panel **Gerente** y una vez por carga de página. Si borrás los 5 y no
   reaparecen, quedás sin motivos y el select de retiro queda vacío hasta que
   existan. **Hacelo desde el panel Gerente y confirmá que reaparecen los 5**
   (con `1 - Reposición → despacho`) antes de operar. Si los cargás a mano,
   **tildá "→ despacho" solo en Reposición**.
2. **onSnapshot y el desplegable de producto (UX menor, celular).** Si llega una
   actualización de stock justo con el `<select>` de producto abierto, podría
   cerrarse. Se preserva selección y búsqueda; es solo un pestañeo posible.
3. **Costo/lecturas de Firestore (marginal).** Los cargadores mantienen un
   listener en vivo, como ya hacían gerente/admin/encargado. Colección chica →
   impacto mínimo.
4. **Deploy completo vs solo hosting.** `firebase deploy` completo redeploya
   `firestore.rules` (no cambiaron → inofensivo). Ante la duda:
   `firebase deploy --only hosting`.

**Verificación post-deploy:** recargá fuerte (Ctrl/Cmd+Shift+R), mirá el sello
abajo a la derecha (**`v3.8.8`**) y probá una entrada→retiro entre los dos
cargadores.
