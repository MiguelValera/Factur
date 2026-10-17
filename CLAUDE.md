# Facturas: contexto para Claude Code

PWA de facturación para el taller mecánico familiar. Funciona sin conexión en iPhone, Android, Mac y Windows. Se publica con GitHub Pages desde la rama `main`, en la raíz, en https://miguelvalera.github.io/Factur/ (la ruta distingue mayúsculas: `/factur/` da 404)

## Reglas del repositorio
- Todos los archivos van en la raíz, sin subcarpetas: el dueño a veces sube archivos desde el iPhone y GitHub no deja subir carpetas desde allí.
- Sin dependencias ni paso de compilación: HTML, CSS y JS a mano (`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`).
- Nunca subir datos reales: ni copias `facturas-copia-*.json`, ni DNI, ni nombres de clientes en código, tests o commits.
- En cada cambio, subir `VERSION` en `sw.js` y `APP_VERSION` en `app.js` (versión semántica). Si no, los dispositivos no reciben la actualización.
- Si se añade un archivo nuevo, incluirlo en `ARCHIVOS` de `sw.js`.
- Interfaz y textos en español de España, pensados para un usuario no técnico.

## Datos y lógica
- IndexedDB `facturas-db`, con los almacenes `ajustes`, `clientes` y `facturas`. Los importes se calculan en céntimos con redondeo simétrico.
- Cada dispositivo tiene su propia serie (M, P…). Las rectificativas usan la serie con una R al final (MR) y la serie no puede terminar en R. La numeración es `SERIE-AÑO-0001`, correlativa por serie y año.
- Las facturas emitidas son inmutables. Para corregirlas se crea una rectificativa por diferencias.
- Huella SHA-256 encadenada por serie de dispositivo (`contenidoHash`). Cualquier campo nuevo debe añadirse a la huella como `undefined` cuando esté vacío, para que las facturas antiguas sigan verificando.
- `extras`: datos clave-valor por factura (Matrícula, Kilómetros…). Se imprimen centrados y en negrita debajo del cliente.
- Las copias se mezclan por UUID (`fusionar`). Las eliminaciones se registran en el ajuste `eliminados`.
- Sincronización opcional con Google Drive, sin servidor: Google Identity Services con modelo de token y permiso `drive.file`. El permiso dura 1 hora y se renueva con un toque. `GOOGLE_CLIENT_ID` está al principio de `app.js`.

## Legal
Verifactu: la base técnica (inmutabilidad y huella encadenada) está hecha, pero no cumple el reglamento completo. Faltan el QR de la AEAT, la firma de registros, el registro de eventos y la declaración responsable. No afirmar cumplimiento.

## Probar
- Pruebas completas: `pip install playwright && playwright install chromium`, y después `python3 pruebas_e2e.py`. Simulan dos dispositivos, la copia manual y Google Drive (Google simulado, sin llamadas reales). Ejecútalas antes de cada push.
- A mano: `python3 -m http.server` y abrir http://localhost:8000. La app exige https o localhost.
- `.gitignore` excluye todos los `*.json` para que nunca se suba una copia de seguridad.

## Estado actual (v1.2.1)
Hecho: clientes con validación de DNI, NIE y CIF; facturas con IVA 21, 10, 4 y 0 % y retención IRPF opcional; datos adicionales (matrícula…); rectificativas; impresión y PDF; serie por dispositivo; copia manual exportar/importar; sincronización con Google Drive; funcionamiento sin conexión con aviso de nueva versión.

## Pendiente
1. **ID de cliente de Google.** Hecho en v1.2.1 (`GOOGLE_CLIENT_ID` en `app.js`, origen autorizado `https://miguelvalera.github.io`).
2. **Probar el login de Google en el iPhone**, con la app instalada en la pantalla de inicio. Ahora usa la ventana emergente de Google Identity Services. Si falla en ese modo, cambiar a OAuth por redirección: `response_type=token`, `redirect_uri` igual a la URL de la app, y leer `access_token` del hash antes de arrancar el router, que también usa el hash.
3. **Verifactu.** Decidir con el gestor antes de la fecha obligatoria (1 de enero de 2027 para sociedades, 1 de julio de 2027 para autónomos). Las opciones son completar la app (QR, firma, eventos, declaración responsable) o pasar a un software ya certificado.

## Flujo de trabajo
Trabaja en una rama y abre un pull request. Miguel lo fusiona desde la app de GitHub y GitHub Pages publica desde `main`. Para probar una rama antes de fusionarla, se puede apuntar Pages a esa rama temporalmente.
