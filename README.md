# Facturas

App de facturación sin conexión para un negocio pequeño. Funciona en móvil y ordenador, guarda los datos solo en cada dispositivo y no necesita servidor.

## Publicarla en GitHub Pages

1. Crea un repositorio **público** en GitHub (Pages es gratis en repos públicos; en privados necesita un plan de pago). El repo solo contiene el código: los clientes y las facturas nunca salen del dispositivo.
2. Sube todos los archivos de esta carpeta a la raíz del repo.
3. En el repo: Settings → Pages → Source: "Deploy from a branch", rama `main`, carpeta `/ (root)`.
4. En un par de minutos estará en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

## Instalarla en cada dispositivo

- **iPhone/iPad:** ábrela en Safari → Compartir → "Añadir a pantalla de inicio". Úsala siempre desde ese icono: Safari y la app instalada guardan datos por separado.
- **Android:** Chrome → menú → "Instalar app".
- **Ordenador:** Chrome o Edge → icono de instalar en la barra de direcciones.

Abre la app una vez con conexión; a partir de ahí funciona sin ella.

## Primer uso

1. Ajustes → elige una serie distinta por dispositivo (por ejemplo M en el móvil, P en el portátil).
2. Rellena tus datos de facturador.
3. Añade clientes y factura.

## Copias de seguridad

Ajustes → Exportar copia genera un archivo JSON con todo. Guárdalo en Google Drive o iCloud. La app avisa en la pantalla de facturas cuando hay cambios sin copia.

- **Pasar clientes a otro dispositivo:** importa allí la copia. Se suman sin duplicar.
- **Si se rompe un dispositivo:** en el nuevo, importa la última copia y acepta usar la misma serie para seguir la numeración.

## Guardado automático en Google Drive (opcional)

Con esto, la app guarda los datos sola en el Google Drive de la cuenta que se conecte, y todos los dispositivos conectados a esa cuenta comparten clientes y facturas. No hay servidor: los datos van directamente del dispositivo al Drive.

Configuración (una sola vez, mejor desde un ordenador o con Safari en modo escritorio):

1. Entra en https://console.cloud.google.com y crea un proyecto, por ejemplo "Facturas".
2. APIs y servicios → Biblioteca → busca **Google Drive API** → Habilitar.
3. Google Auth Platform (pantalla de consentimiento): tipo **Externo**, nombre "Facturas" y tu email de contacto.
   - En **Acceso a datos**, añade el permiso `https://www.googleapis.com/auth/drive.file`. Es el más limitado: la app solo puede ver los archivos que ella misma crea, nunca el resto del Drive.
   - En **Público**, añade como usuario de prueba la cuenta de Google que vaya a usar la app, o pulsa "Publicar app". Con este permiso Google no exige revisión.
4. **Clientes** → Crear cliente → tipo **Aplicación web**. En "Orígenes de JavaScript autorizados" añade `https://miguelvalera.github.io` (sin barra ni carpeta al final). Copia el **ID de cliente**.
5. En `app.js`, pega ese ID en `const GOOGLE_CLIENT_ID = '';`, cambia la `VERSION` de `sw.js` y sube los dos archivos.

El ID de cliente no es secreto: identifica la app ante Google pero no da acceso a ningún dato.

Uso: Ajustes → Conectar con Google. El permiso de Google dura una hora; mientras está vigente, cada factura emitida o cliente guardado se sube solo. Cuando caduca, la pantalla de facturas muestra un botón "Sincronizar" que lo renueva con un toque. El archivo en Drive se llama "Facturas - datos (no borrar).json".

## Actualizar la app

Tras cambiar código, sube también `sw.js` con `VERSION` cambiada (por ejemplo `facturas-v1.0.1`). Los dispositivos mostrarán "Hay una versión nueva" con un botón para actualizar.

## Aviso sobre Verifactu

La app deja las facturas emitidas inalterables, usa rectificativas y encadena cada registro con una huella SHA-256 que se puede comprobar en Ajustes. Eso es la base técnica, pero **no** cubre todo el reglamento (QR de la AEAT, firma de registros, registro de eventos, declaración responsable). Revisadlo con vuestro gestor antes de la fecha obligatoria.
