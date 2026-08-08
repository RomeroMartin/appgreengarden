# Contexto — Gestión de usuarios y seguridad (v3.13.0)

> Documento para **no olvidar** cómo funciona la creación de usuarios y las
> reglas de seguridad de Green Garden Inventario. Escrito en criollo, para
> retomarlo dentro de meses sin tener que releer todo el código.

---

## 1. El problema que resolvíamos

Dos pedidos:

1. **Crear usuarios desde la app**, sin tener que ir a Firebase a copiar el UID
   a mano.
2. **Reglas de seguridad** para que **nadie** pueda crearse usuarios (ni
   ascenderse a Gerente) por la consola del navegador.

## 2. Qué encontramos (ya estaba hecho en v3.12)

- La app **ya creaba usuarios desde adentro**, sin copiar UIDs. Lo hace con una
  **segunda instancia de Firebase** (`secondary-gerente`) en `js/gerente.js`.
- Las reglas **ya impedían** la auto-escalada: solo un Gerente podía crear/editar
  perfiles; nadie podía escribir su propio `usuarios/{uid}`.
- **Lo único que faltaba**: el arranque inicial (el **primer Gerente**) obligaba
  a entrar a la consola de Firestore a mano. Eso es lo que cerramos en v3.13.0.

## 3. El truco de la "segunda instancia" (por qué no te desloguea)

Firebase tiene una limitación conocida: si creás un usuario con el SDK normal
(`createUserWithEmailAndPassword` sobre el `auth` principal), Firebase **te
loguea como el usuario recién creado** y te saca de tu sesión de Gerente.

Solución (100% en el navegador, **sin plan pago ni Cloud Functions**):

```
// js/gerente.js
const appSec  = initializeApp(firebaseConfig, "secondary-gerente"); // 2da instancia
const authSec = getAuth(appSec);

// al crear:
const cred = await createUserWithEmailAndPassword(authSec, email, password);
await setDoc(doc(db, "usuarios", cred.user.uid), { nombre, email, rol, activo: true });
await signOutSec(authSec);   // cerramos SOLO la sesión secundaria
```

- La cuenta se crea en la instancia **secundaria** → tu sesión de Gerente
  (instancia principal) **queda intacta**.
- El **UID se toma de `cred.user.uid`** → **nunca** hay que copiarlo de la
  consola.
- Al final `signOut` de la instancia secundaria, y listo.

## 4. Bootstrap del dueño SIN consola (lo nuevo en v3.13.0)

Para que exista el **primer** Gerente sin tocar Firebase, anclamos **tu email de
dueño** como super-admin único:

- **Email del dueño:** `martingreengaren@gmail.com`
- Ese email —y **solo** ese— puede crearse/restaurarse a sí mismo como
  `Gerente` activo.
- Cuando el dueño inicia sesión y todavía no tiene perfil, `js/auth.js` se lo
  crea automáticamente. Las **reglas** son las que autorizan eso, y solo para su
  email.

### ⚠️ Si cambiás el email del dueño, hay que tocarlo en DOS lugares:

1. `firestore.rules` → función `esDueno()`
2. `js/firebase-config.js` → constante `EMAIL_DUENO`

Si quedan distintos, el bootstrap deja de funcionar.

## 5. Cómo quedan las reglas de `usuarios` (resumen)

| Acción | Quién puede |
|---|---|
| **Leer** el propio perfil | cualquiera logueado (lo necesita el login) |
| **Leer** todos | solo Gerente |
| **Crear** un perfil | un Gerente ya existente, **o** el dueño su propio perfil (bootstrap) |
| **Editar** rol/estado de otros | solo Gerente |
| **Editarse a sí mismo** el rol / desactivarse / borrarse | **NADIE** (ni el Gerente) — evita quedarse afuera. Excepción: el dueño puede restaurar su propio perfil a Gerente activo |
| **Borrar** un perfil | Gerente, pero no el suyo |

**Conclusión de seguridad:** ningún usuario autenticado puede escribir su propio
`usuarios/{uid}` desde la consola. El único caso especial es el email del dueño
fijando/restaurando **su propio** perfil como Gerente. Nada más.

## 6. Roles válidos

`Gerente`, `Administrador`, `Encargado`, `Cargador Entradas`, `Cargador Salidas`.
(Definidos en `js/auth.js` → `RUTA_POR_ROL` y en el selector de rol del modal de
usuario en `vistas/gerente.html`.)

## 7. Cómo crear un usuario desde la app (flujo actual)

1. Entrar como **Gerente** → sección **Usuarios** → **Nuevo usuario**.
2. Cargar **nombre + email + contraseña temporal + rol** (todo en un solo paso).
3. Guardar. La app crea la cuenta y el perfil sin desloguearte.
4. Avisale al nuevo usuario su email + contraseña temporal. (Recomendable que la
   cambie después desde Firebase Auth o agregando un "cambiar contraseña".)

## 8. Deploy

```bash
# App (hosting) + reglas de Firestore
firebase deploy --only hosting,firestore:rules
```

- Solo la app:     `firebase deploy --only hosting`
- Solo las reglas: `firebase deploy --only firestore:rules`

## 9. Archivos tocados en v3.13.0

- `firestore.rules` — ancla del dueño + bootstrap.
- `js/auth.js` — auto-creación del perfil del dueño al loguear.
- `js/gerente.js` — elegir rol al crear (antes forzaba "Cargador Salidas").
- `js/firebase-config.js` — constante `EMAIL_DUENO`.
- `js/version.js` — v3.12.0 → v3.13.0.

## 10. Ideas para más adelante (no hechas)

- Botón "cambiar mi contraseña" dentro de la app (hoy se hace desde Firebase Auth).
- Enviar mail de "restablecer contraseña" al crear el usuario, para que el nuevo
  se ponga su propia clave (`sendPasswordResetEmail`).
- Registro de auditoría de quién creó/editó cada usuario.
