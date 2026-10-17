# Facturas

App de facturación para un negocio pequeño. Funciona en móvil y ordenador y no necesita servidor: se entra con una cuenta de Google y los clientes y las facturas se guardan en el Google Drive de esa cuenta, compartidos entre todos los dispositivos.

## Publicarla en GitHub Pages

1. Crea un repositorio **público** en GitHub (Pages es gratis en repos públicos; en privados necesita un plan de pago). El repo solo contiene el código: los clientes y las facturas van del dispositivo al Google Drive de la cuenta, nunca al repositorio.
2. Sube todos los archivos de esta carpeta a la raíz del repo.
3. En el repo: Settings → Pages → Source: "Deploy from a branch", rama `main`, carpeta `/ (root)`.
4. En un par de minutos estará en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

## Instalarla en cada dispositivo

- **iPhone/iPad:** ábrela en Safari → Compartir → "Añadir a pantalla de inicio". Úsala siempre desde ese icono: Safari y la app instalada guardan datos por separado.
- **Android:** Chrome → menú → "Instalar app".
- **Ordenador:** Chrome o Edge → icono de instalar en la barra de direcciones.

Hace falta conexión para entrar con Google y guardar en Drive.

## Primer uso

1. Entra con la cuenta de Google del negocio. En los demás dispositivos, entra con la misma cuenta.
2. Ajustes → elige la serie de facturación (por ejemplo F). Es la misma para todos los dispositivos.
3. Rellena tus datos de facturador.
4. Añade clientes y factura.

## Copias de seguridad

Los datos se guardan solos en Google Drive. Además, Ajustes → Exportar copia genera un archivo JSON con todo, por si quieres una copia aparte. Al importar una copia, sus datos se suman a los de la cuenta sin duplicar.

## Configurar Google (una sola vez)

La app exige entrar con Google y guarda los datos en el Google Drive de esa cuenta. No hay servidor: los datos van directamente del dispositivo al Drive.

Configuración (una sola vez, mejor desde un ordenador o con Safari en modo escritorio):

1. Entra en https://console.cloud.google.com y crea un proyecto, por ejemplo "Facturas".
2. APIs y servicios → Biblioteca → busca **Google Drive API** → Habilitar.
3. Google Auth Platform (pantalla de consentimiento): tipo **Externo**, nombre "Facturas" y tu email de contacto.
   - En **Acceso a datos**, añade el permiso `https://www.googleapis.com/auth/drive.file`. Es el más limitado: la app solo puede ver los archivos que ella misma crea, nunca el resto del Drive.
   - En **Público**, añade como usuario de prueba la cuenta de Google que vaya a usar la app, o pulsa "Publicar app". Con este permiso Google no exige revisión.
4. **Clientes** → Crear cliente → tipo **Aplicación web**. En "Orígenes de JavaScript autorizados" añade `https://miguelvalera.github.io` (sin barra ni carpeta al final). Copia el **ID de cliente**.
5. En `app.js`, pega ese ID en `const GOOGLE_CLIENT_ID = '';`, cambia la `VERSION` de `sw.js` y sube los dos archivos.

El ID de cliente no es secreto: identifica la app ante Google pero no da acceso a ningún dato.

Uso: al abrir la app, "Entrar con Google". El permiso de Google dura una hora; mientras está vigente, cada factura emitida o cliente guardado se sube solo. Cuando caduca, la app vuelve a la pantalla de entrar y se renueva con un toque. Antes de numerar cada factura, la app trae lo último de Drive para no repetir números entre dispositivos. El archivo en Drive se llama "Facturas - datos (no borrar).json".

## Actualizar la app

Tras cambiar código, sube también `sw.js` con `VERSION` cambiada (por ejemplo `facturas-v1.0.1`). Los dispositivos mostrarán "Hay una versión nueva" con un botón para actualizar.

## Aviso sobre Verifactu

La app deja las facturas emitidas inalterables, usa rectificativas y encadena cada registro con una huella SHA-256 que se puede comprobar en Ajustes. Eso es la base técnica, pero **no** cubre todo el reglamento (QR de la AEAT, firma de registros, registro de eventos, declaración responsable). Revisadlo con vuestro gestor antes de la fecha obligatoria.
