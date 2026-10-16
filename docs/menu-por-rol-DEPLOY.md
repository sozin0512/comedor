# Menú por rol + roles de confianza — orden de publicación

Rama `feat/menu-por-rol` (sale de `feat/panel-viajes`; se publican juntas).

## Qué cambió
- **Rol de staff = valor del servidor.** Custom claim de Firebase Auth (`role`, `staff`) + doc
  `artifacts/{app}/roles/{uid}` (`write: false` en reglas). Lo escriben solo `setUserRole` (admin
  supremo), `syncAdminUid`, `refreshMyRoleClaims` y la migración. El `role` del perfil ya no da permisos.
- **Respaldo anti-bloqueo:** correo Auth `josuesoza0513@gmail.com` = admin siempre; `sozajob146@gmail.com`
  = supervisor (reglas y funciones). `syncAdminUid` vuelve a sellar al admin.
- **Reglas:** `getRole()` arreglado (`exists()`); el usuario solo puede dejar su `role` en client/driver;
  `staffGrantedBy/At`, `isTestAccount`, `lastPushTest` protegidos; campos de papelera/revisado/embudo/reenvío
  del viaje solo por callables; el catch-all público ya no escribe `users` ni `trips`.
- **Funciones:** `assertCallerCanModerate`, WhatsApp Cloud (`sendWhatsAppCloudText`,
  `testWhatsAppTripTemplate`) y los avisos a staff usan el rol de confianza. Nuevo callable `refreshMyRoleClaims`.
- **App:** menú ⋮ por rol (`js/role-menu.js`, `css/role-menu.css`); Panel Admin / Supervisión solo con rol
  confirmado por el servidor; `openAdminPanel` / `openSupervisorPanel` vuelven a validar y cierran el panel si no.

## Orden (NO cambiar)
1. **Functions**: `firebase deploy --only functions` (trae `refreshMyRoleClaims` y los chequeos nuevos;
   con el respaldo por correo / claim fresco nadie de staff real queda fuera).
2. **Migración de claims**:
   ```
   cd functions
   node scripts/migrate-role-claims.js            # DRY-RUN: revisar la lista
   node scripts/migrate-role-claims.js --apply --approve=UID1,UID2   # UIDs "A REVISAR" que sí son staff
   ```
   - "A REVISAR" = perfil dice supervisor pero no hay prueba de que lo dio el admin. Sin `--approve` quedan
     **sin staff** (doc roles = client). Revisar esa lista con Josué antes de `--apply`.
   - Se puede repetir: es idempotente.
3. **Hosting**: `firebase deploy --only hosting` (menú nuevo; al entrar llama `refreshMyRoleClaims` y renueva el token).
4. **Reglas** (al final, idealmente ≥1 h después de la migración o tras pedir a staff que abra la app):
   `firebase deploy --only firestore:rules`.

## Si alguien de staff queda fuera
- Admin: entrar con el correo supremo (siempre es admin) → Panel Admin → cambiar rol (usa `setUserRole`).
- O correr la migración otra vez con `--approve=UID`.
- Rollback de reglas: volver a publicar el `firestore.rules` anterior (las funciones nuevas siguen sirviendo).

## Pruebas (emulador)
```
RULES=firestore.rules firebase emulators:exec --project demo-hr --only firestore "node scripts/test-roles-rules.mjs"
firebase emulators:exec --project demo-hr --only firestore,auth "node scripts/test-roles-functions.cjs"
firebase emulators:exec --project demo-hr --only firestore,auth "node scripts/test-viajes-panel.cjs"
```
