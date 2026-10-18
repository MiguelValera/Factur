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
- IndexedDB `facturas-db` (versión 2), con los almacenes `ajustes`, `clientes`, `facturas` y `presupuestos`. Los importes se calculan en céntimos con redondeo simétrico.
- Una sola serie para toda la cuenta (ajuste `serie`, `{serie, actualizado}`), que viaja con los datos de Drive. Las rectificativas usan la serie con una R al final (FR) y la serie no puede terminar en R. La numeración es `SERIE-AÑO-0001`, correlativa por serie y año. Hasta la v1.2 cada dispositivo tenía su serie (ajuste `dispositivo`); `migrarSerie` la convierte en la serie común si no hay otra.
- Para no repetir números entre dispositivos, al emitir se sincroniza con Drive antes de numerar y se sube justo después. Si aun así dos dispositivos emiten a la vez, `fusionar` detecta el número repetido y avisa. `emitidaEn` nunca es anterior a la factura previa de la cadena, aunque el reloj del dispositivo vaya atrasado.
- Las facturas emitidas son inmutables. Para corregirlas se crea una rectificativa por diferencias.
- Huella SHA-256 encadenada por serie (`contenidoHash`). Cualquier campo nuevo debe añadirse a la huella como `undefined` cuando esté vacío, para que las facturas antiguas sigan verificando.
- **Presupuestos**: almacén `presupuestos`, numerados `PRE-AÑO-0001` al crearlos (tras sincronizar). No son facturas: se pueden cambiar siempre, no entran en la huella. «Pasar a factura» crea un borrador de factura con sus datos (`presupuestoId`) y marca el presupuesto (`facturaId`). El editor es `editorBorrador(f, esPres)`.
- **Guardado**: cada acción (cliente, factura, presupuesto, ajustes, importar) llama a `Nube.guardar()`, que sube a Drive al momento; lo que se escribe en un formulario se sube a los 3 s (`Nube.programar`). Si no hay sesión, `pedirSesion` abre una ventana que bloquea la app hasta volver a entrar, sin perder la pantalla. Las sincronizaciones van en fila (`sincronizar`).
- **Interfaz para personas mayores**: letra de 18 px, campos y botones de 56 px, botones principales a todo el ancho en el móvil y «Eliminar» separado al final. Mantenerlo así en pantallas nuevas.
- `extras`: datos clave-valor por factura (Matrícula, Kilómetros…). Se imprimen centrados, en negrita y dentro de un recuadro, debajo del cliente.
- Documento impreso (`docHtml`): columnas Precio sin IVA, IVA y Total con IVA por línea (`lineaConIva`, solo para mostrar). La huella no se imprime. `@page { margin: 0 }` para que el navegador no añada su cabecera y su pie (fecha, hora, dirección web); el margen lo pone el propio documento. Impresión (`imprimir`): antes de imprimir se mide la factura con el mismo navegador, a tamaño A4. Si mide hasta `ALTO_HOJA_MM` (235mm), aunque sea reduciéndola hasta un 80 % (`zoom`), va en una hoja con el bloque `.doc-pie` anclado al final de la página (`position: fixed`, clase `.una-hoja`). Si no, `repartirEnHojas` la parte en varias hojas de como mucho 235mm, cada una con su margen y la cabecera de la tabla. No usar altos fijos de página (`min-height`, `vh`) ni márgenes de `@page`: en Safari la factura salía en dos hojas o cortada. La prueba 11 imprime con Chromium y con WebKit (Safari, vía `swiftc` en el Mac) a varios anchos de ventana y comprueba que cada hoja es una página.
- Las copias se mezclan por UUID (`fusionar`). Las eliminaciones se registran en el ajuste `eliminados`.
- **Sesión de Google obligatoria**: sin cuenta conectada y permiso vigente, el router solo muestra `vistaEntrar`. Los datos viven en Google Drive (archivo «Facturas - datos (no borrar).json») y IndexedDB es la copia local. Google Identity Services con modelo de token y permiso `drive.file`, sin servidor. El permiso dura 1 hora: al caducar se vuelve a la pantalla de entrar y se renueva con un toque. Al entrar con otra cuenta se vacían los datos locales. `GOOGLE_CLIENT_ID` está al principio de `app.js`.

## Seguridad
- `index.html` lleva una Content-Security-Policy: solo scripts propios y de `accounts.google.com/gsi/`, conexiones a `www.googleapis.com`. Nada de manejadores en línea (`onclick="…"`); si se añade otro servicio externo, hay que permitirlo ahí.
- Todo lo que se pinta con `innerHTML` pasa por `esc()`, también los identificadores. Lo que llega de una copia o de Drive se valida en `fusionar` (`documentoOk`, `idOk`) y lo que no cumple se descarta.
- Cerrar sesión borra los datos del dispositivo (`DB.vaciar`); siguen en Drive.
- La app comparte origen con cualquier otro repo publicado en `miguelvalera.github.io` sin dominio propio: ese sitio podría leer los datos y el permiso de Google. No publicar otras páginas ahí sin dominio propio.
- Los commits usan el email noreply de GitHub (configurado en este repositorio).

## Legal
Verifactu: la base técnica (inmutabilidad y huella encadenada) está hecha, pero no cumple el reglamento completo. Faltan el QR de la AEAT, la firma de registros, el registro de eventos y la declaración responsable. No afirmar cumplimiento.

## Probar
- Pruebas completas: `pip install playwright && playwright install chromium`, y después `python3 pruebas_e2e.py`. Simulan la pantalla de entrar, una copia manipulada, cerrar sesión, la CSP, la ventana de sesión caducada, los presupuestos, dos dispositivos con la misma cuenta, el cambio de cuenta, la copia manual y Google Drive (Google simulado, sin llamadas reales). Ejecútalas antes de cada push.
- A mano: `python3 -m http.server` y abrir http://localhost:8000. La app exige https o localhost.
- `.gitignore` excluye todos los `*.json` para que nunca se suba una copia de seguridad.

## Estado actual (v1.4.4)
Hecho: clientes con validación de DNI, NIE y CIF; facturas con IVA 21, 10, 4 y 0 % y retención IRPF opcional; datos adicionales (matrícula…); rectificativas; impresión y PDF; serie única para todos los dispositivos; entrar con Google obligatorio y datos en Google Drive; presupuestos; guardado en Drive tras cada cambio con aviso «Guardado ✓»; copia manual exportar/importar; aviso de nueva versión; interfaz con letra y botones grandes pensada para personas mayores.

## Pendiente
1. **ID de cliente de Google.** Hecho en v1.2.1 (`GOOGLE_CLIENT_ID` en `app.js`, origen autorizado `https://miguelvalera.github.io`).
2. **Probar el login de Google en el iPhone**, con la app instalada en la pantalla de inicio. Ahora usa la ventana emergente de Google Identity Services. Si falla en ese modo, cambiar a OAuth por redirección: `response_type=token`, `redirect_uri` igual a la URL de la app, y leer `access_token` del hash antes de arrancar el router, que también usa el hash.
3. **Verifactu.** Decidir con el gestor antes de la fecha obligatoria (1 de enero de 2027 para sociedades, 1 de julio de 2027 para autónomos). Las opciones son completar la app (QR, firma, eventos, declaración responsable) o pasar a un software ya certificado.

## Flujo de trabajo
Trabaja en una rama y abre un pull request. Miguel lo fusiona desde la app de GitHub y GitHub Pages publica desde `main`. Para probar una rama antes de fusionarla, se puede apuntar Pages a esa rama temporalmente.
