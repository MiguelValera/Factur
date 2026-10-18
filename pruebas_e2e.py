"""Pruebas de extremo a extremo de la app (Chromium sin interfaz).

Uso:  pip install playwright && playwright install chromium
      python3 pruebas_e2e.py

Levanta un servidor local, simula dos dispositivos y simula Google (no hace llamadas reales).
"""
import functools, http.server, json, os, re, socketserver, tempfile, threading
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.abspath(__file__))
CARPETA_IMPRESION = None

def servidor():
    class Silencioso(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Silencioso, directory=RAIZ)
    srv = socketserver.TCPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://localhost:{srv.server_address[1]}/'

GIS = """window.google={accounts:{oauth2:{initTokenClient(c){return{requestAccessToken(){setTimeout(()=>c.callback({access_token:'tok',expires_in:3600}),30)}}},revoke(t,cb){cb&&cb()}}}};"""

class DriveFalso:
    """Un Google Drive en memoria. Cada instancia es una cuenta de Google distinta."""
    def __init__(self, email='taller@example.com'): self.archivos, self.email = {}, email
    def datos(self): return json.loads(self.archivos['F1'])
    def __call__(self, route):
        r, u = route.request, route.request.url
        assert r.headers.get('authorization') == 'Bearer tok'
        if '/about' in u: return route.fulfill(json={'user': {'emailAddress': self.email, 'displayName': 'Taller'}})
        m = re.search(r'/files/([^/?]+)', u)
        if r.method == 'GET' and m and 'alt=media' in u:
            f = self.archivos.get(m.group(1))
            return route.fulfill(status=404, body='') if f is None else route.fulfill(body=f, content_type='application/json')
        if r.method == 'GET': return route.fulfill(json={'files': [{'id': k} for k in self.archivos]})
        if r.method == 'POST':
            self.archivos['F1'] = r.post_data.split('\r\n\r\n')[2].rsplit('\r\n--', 1)[0]
            return route.fulfill(json={'id': 'F1'})
        if r.method == 'PATCH':
            self.archivos[m.group(1)] = r.post_data
            return route.fulfill(json={'id': m.group(1)})

def dispositivo(b, U, errores, drive):
    pg = b.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True).new_page()
    pg.on('dialog', lambda d: d.accept())
    pg.on('pageerror', lambda e: errores.append(str(e)))
    pg.on('console', lambda m: 'Content Security Policy' in m.text and errores.append('CSP: ' + m.text))
    pg.route('https://accounts.google.com/**', lambda r: r.fulfill(body=GIS, content_type='application/javascript'))
    pg.route('https://www.googleapis.com/**', drive)
    return pg

def entrar(pg, U):
    pg.goto(U); pg.wait_for_selector('#entrar:not([disabled])')
    assert not pg.is_visible('.tabs'), 'sin sesión no deben verse las pestañas'
    pg.click('#entrar'); pg.wait_for_selector('.tabs a', state='visible')

def configurar(pg, U, serie=None):
    pg.goto(U + '#/ajustes'); pg.wait_for_selector('#serie')
    if serie:
        pg.fill('#serie', serie); pg.click('#f-serie button[type=submit]'); pg.wait_for_timeout(200)
    if not pg.input_value('#e-nombre'):
        pg.fill('#e-nombre', 'Taller de Prueba S.L.'); pg.fill('#e-nif', 'B12345674'); pg.fill('#e-direccion', 'Calle Falsa 1')
        pg.click('#f-emisor button[type=submit]'); pg.wait_for_timeout(300)

def nuevo_cliente(pg, U, nombre='Cliente Prueba', nif='12345678Z'):
    pg.goto(U + '#/cliente/nuevo'); pg.wait_for_selector('#nif')
    pg.fill('#nombre', nombre); pg.fill('#nif', nif); pg.fill('#direccion', 'Av. Prueba 2')
    pg.click('#form button[type=submit]'); pg.wait_for_timeout(300)

def emitir(pg, U, concepto, precio, matricula=''):
    pg.goto(U + '#/factura/nueva'); pg.wait_for_selector('#cliente'); pg.select_option('#cliente', index=1)
    if matricula: pg.fill('.extra [data-e=valor]', matricula)
    pg.fill('.line [data-f=concepto]', concepto); pg.fill('.line [data-f=precio]', precio); pg.wait_for_timeout(500)
    pg.click('#emitir'); pg.wait_for_selector('.stamp:not(.draft)')
    return pg.inner_text('h1')

def verificar(pg, U):
    pg.goto(U + '#/ajustes'); pg.wait_for_selector('#verificar'); pg.click('#verificar'); pg.wait_for_timeout(500)
    return pg.inner_text('#res-verif')

# Imprime un HTML a PDF con WebKit, el motor de Safari (solo en un Mac con swiftc)
IMPRIMIR_WEBKIT = r"""
import AppKit
import WebKit
let a = CommandLine.arguments
let entrada = URL(fileURLWithPath: a[1]), salida = URL(fileURLWithPath: a[2])
let ancho = CGFloat(Double(a[3]) ?? 800)  // ancho de la ventana: Safari maqueta según ella
class D: NSObject, WKNavigationDelegate {
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      let i = NSPrintInfo()
      i.paperSize = NSSize(width: 595.28, height: 841.89)
      for m in [\NSPrintInfo.topMargin, \NSPrintInfo.bottomMargin, \NSPrintInfo.leftMargin, \NSPrintInfo.rightMargin] { i[keyPath: m] = 18 }
      i.jobDisposition = .save
      i.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = salida
      let op = w.printOperation(with: i)
      op.showsPrintPanel = false; op.showsProgressPanel = false
      op.view?.frame = NSRect(x: 0, y: 0, width: ancho, height: 1000)
      op.runModal(for: NSWindow(), delegate: nil, didRun: nil, contextInfo: nil)
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { NSApp.terminate(nil) }
    }
  }
}
NSApplication.shared.setActivationPolicy(.prohibited)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: ancho, height: 1000))
let d = D(); web.navigationDelegate = d
web.loadFileURL(entrada, allowingReadAccessTo: URL(fileURLWithPath: "/"))
NSApplication.shared.run()
"""

def paginas_pdf(ruta):
    return len(re.findall(rb'/Type\s*/Page(?![a-zA-Z])', open(ruta, 'rb').read()))

def comprobar_paginas(b, pg, U):
    """Una factura que cabe en una hoja debe salir en una hoja, con el pie en ella; una larga, en varias.
    Se imprime con Chromium y, si hay swiftc (Mac), con WebKit, el motor de Safari, a varios anchos de ventana."""
    import shutil, subprocess
    tmp = tempfile.mkdtemp()
    css = 'file://' + os.path.join(RAIZ, 'styles.css')
    # Emisor con todos los datos y texto al pie, como una factura real
    pg.goto(U + '#/ajustes'); pg.wait_for_selector('#e-nombre')
    for campo, valor in (('cp', '00000'), ('poblacion', 'Pueblo'), ('provincia', 'Provincia'), ('email', 'correo@example.com'),
                         ('telefono', '600000000'), ('pie', 'Texto al pie de prueba')):
        pg.fill(f'#e-{campo}', valor)
    pg.click('#f-emisor button[type=submit]'); pg.wait_for_timeout(300)
    def factura(n):
        pg.goto(U + '#/factura/nueva'); pg.wait_for_selector('#cliente'); pg.select_option('#cliente', index=1)
        pg.fill('.extra [data-e=valor]', '0000TST')
        for i in range(n):
            if i: pg.click('#anadir')
            l = pg.query_selector_all('.line')[i]
            l.query_selector('[data-f=concepto]').fill(f'Linea {i + 1}'); l.query_selector('[data-f=precio]').fill('10')
        pg.wait_for_timeout(500); pg.click('#emitir'); pg.wait_for_selector('.stamp:not(.draft)')
        pg.evaluate('window.print = () => {}')  # se usa el botón de verdad, que mide la factura, sin abrir el diálogo
        pg.click('#imprimir')
        ruta = os.path.join(tmp, f'f{n}.html')
        open(ruta, 'w').write(f'<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="{css}"></head>'
                              f'<body>{pg.eval_on_selector("#print-area", "e => e.outerHTML")}</body></html>')
        return ruta
    # n.º de conceptos -> páginas esperadas (None: las que salgan en Chromium, pero ni una más en Safari)
    casos = {nombre: (factura(n), esperado) for nombre, n, esperado in
             (('corta', 1, 1), ('media', 8, 1), ('casi-llena', 14, None), ('larga', 40, None))}
    for nombre, (html, esperado) in casos.items():
        if esperado == 1: assert 'una-hoja' in open(html).read(), f'la factura {nombre} debería imprimirse en una hoja'
    paginas_chrome = {}
    imp = b.new_page()
    for nombre, (html, esperado) in casos.items():
        imp.goto('file://' + html); imp.emulate_media(media='print')
        pdf = os.path.join(tmp, f'chrome-{nombre}.pdf'); imp.pdf(path=pdf, prefer_css_page_size=True)
        paginas_chrome[nombre] = n = paginas_pdf(pdf)
        assert n == open(html).read().count('<article class="doc'), f'Chromium, factura {nombre}: {n} páginas no coinciden con las hojas'
        assert esperado is None or n == esperado, f'Chromium, factura {nombre}: {n} páginas'
    imp.close()
    assert paginas_chrome['larga'] >= 2
    if not shutil.which('swiftc'):
        print('   (sin swiftc: no se comprueba la impresión con WebKit)'); return tmp
    src = os.path.join(tmp, 'imprimir.swift'); exe = os.path.join(tmp, 'imprimir')
    open(src, 'w').write(IMPRIMIR_WEBKIT)
    subprocess.run(['swiftc', '-O', src, '-o', exe], check=True, capture_output=True)
    for ancho in (500, 800, 1300):
        for nombre, (html, esperado) in casos.items():
            pdf = os.path.join(tmp, f'safari-{ancho}-{nombre}.pdf')
            subprocess.run([exe, html, pdf, str(ancho)], check=True, capture_output=True, timeout=60)
            n = paginas_pdf(pdf)
            assert n == paginas_chrome[nombre], f'WebKit (Safari) a {ancho}px, factura {nombre}: {n} páginas (Chromium: {paginas_chrome[nombre]})'
            hojas = open(html).read().count('<article class="doc')
            assert n == hojas, f'WebKit (Safari) a {ancho}px, factura {nombre}: {n} páginas para {hojas} hojas'
    return tmp

def main():
    srv, U = servidor()
    errores = []
    anio = __import__('datetime').date.today().year
    with sync_playwright() as p:
        b = p.chromium.launch()

        print('1. Sin sesión de Google no se puede usar la app')
        drive = DriveFalso()
        A = dispositivo(b, U, errores, drive)
        A.goto(U + '#/clientes'); A.wait_for_selector('#entrar')
        assert 'Nuevo cliente' not in A.inner_text('#app')

        print('2. Factura, IVA mixto, datos adicionales y rectificativa')
        entrar(A, U); configurar(A, U, 'F'); nuevo_cliente(A, U)
        A.goto(U + '#/factura/nueva'); A.wait_for_selector('#cliente'); A.select_option('#cliente', index=1)
        A.fill('.extra [data-e=valor]', '0000TST')
        A.fill('.line [data-f=concepto]', 'Pieza'); A.fill('.line [data-f=cantidad]', '2'); A.fill('.line [data-f=precio]', '19,99')
        A.click('#anadir'); l2 = A.query_selector_all('.line')[1]
        l2.query_selector('[data-f=concepto]').fill('Manual'); l2.query_selector('[data-f=precio]').fill('10'); l2.query_selector('[data-f=iva]').select_option('4')
        A.wait_for_timeout(500)
        assert '58,78' in A.inner_text('#totales'), A.inner_text('#totales')
        A.click('#emitir'); A.wait_for_selector('.stamp:not(.draft)')
        assert f'F-{anio}-0001' in A.inner_text('h1') and '0000TST' in A.inner_text('.doc-extras')
        A.click('text=Crear rectificativa'); A.wait_for_selector('#motivo'); A.fill('#motivo', 'Devolución')
        A.wait_for_timeout(500); A.click('#emitir'); A.wait_for_selector('.stamp:not(.draft)')
        assert A.inner_text('h1').startswith(f'Rectificativa FR-{anio}-0001')
        assert '2 facturas correctas' in verificar(A, U)
        assert len(drive.datos()['facturas']) == 2, 'cada factura emitida se sube a Drive en el acto'

        print('3. Otro dispositivo con la misma cuenta: misma serie y numeración seguida')
        B = dispositivo(b, U, errores, drive); entrar(B, U)
        B.goto(U + '#/ajustes'); B.wait_for_selector('#serie')
        assert B.input_value('#serie') == 'F' and B.input_value('#e-nombre'), 'la serie y el emisor vienen de Drive'
        assert f'F-{anio}-0002' in emitir(B, U, 'Frenos', '60')
        assert f'F-{anio}-0003' in emitir(A, U, 'Aceite', '30'), 'antes de numerar se trae lo último de Drive'
        B.goto(U + '#/ajustes'); B.wait_for_selector('#nube-sync'); B.click('#nube-sync'); B.wait_for_timeout(1000)
        v = verificar(B, U)
        assert 'Serie F: 4 facturas correctas' in v, v

        print('4. Al caducar el permiso de Google se vuelve a pedir')
        A.evaluate("localStorage.removeItem('nube-token')")
        A.goto(U + '#/clientes'); A.wait_for_selector('#entrar')
        assert 'caducado' in A.inner_text('#app')
        A.click('#entrar'); A.wait_for_selector('text=Nuevo cliente')

        print('5. Copia manual: exportar e importar en otra cuenta')
        with A.expect_download() as d:
            A.goto(U + '#/ajustes'); A.wait_for_selector('#exportar'); A.click('#exportar')
        ruta = os.path.join(tempfile.mkdtemp(), 'copia.json'); d.value.save_as(ruta)
        otra = DriveFalso('otra@example.com')
        C = dispositivo(b, U, errores, otra); entrar(C, U)
        C.goto(U + '#/ajustes'); C.wait_for_selector('#importar', state='attached')
        C.set_input_files('#importar', ruta); C.wait_for_timeout(800)
        assert '4 facturas nuevas' in C.inner_text('#res-import')
        C.wait_for_timeout(2500)
        assert len(otra.datos()['facturas']) == 4, 'lo importado se sube a Drive'

        print('6. Cambiar de cuenta en un dispositivo no mezcla los datos')
        A2 = A.context.new_page(); A2.on('dialog', lambda d: d.accept()); A2.on('pageerror', lambda e: errores.append(str(e)))
        A.close()
        vacia = DriveFalso('nueva@example.com')
        A2.route('https://accounts.google.com/**', lambda r: r.fulfill(body=GIS, content_type='application/javascript'))
        A2.route('https://www.googleapis.com/**', vacia)
        A2.goto(U); A2.evaluate("localStorage.removeItem('nube-token')")
        entrar(A2, U)
        A2.goto(U + '#/clientes'); A2.wait_for_selector('h1')
        assert 'Aún no hay clientes' in A2.inner_text('#app')

        print('7. Presupuesto: se guarda en Drive, se imprime y se pasa a factura')
        P = dispositivo(b, U, errores, drive); entrar(P, U)
        P.goto(U + '#/presupuesto/nuevo'); P.wait_for_selector('#cliente')
        assert f'PRE-{anio}-0001' in P.inner_text('h1')
        P.select_option('#cliente', index=1)
        P.fill('.line [data-f=concepto]', 'Embrague'); P.fill('.line [data-f=precio]', '400'); P.wait_for_timeout(4500)
        pres = drive.datos()['presupuestos']
        assert len(pres) == 1 and pres[0]['lineas'][0]['concepto'] == 'Embrague', 'lo escrito se sube solo'
        P.click('#ver'); assert 'PRESUPUESTO' in P.inner_text('#preview .doc-title').upper() and 'Válido hasta' in P.inner_text('#preview')
        P.click('#a-factura'); P.wait_for_selector('#emitir')
        assert P.input_value('.line [data-f=concepto]') == 'Embrague'
        P.click('#emitir'); P.wait_for_selector('.stamp:not(.draft)')
        P.goto(U + '#/presupuestos'); P.wait_for_selector('.list')
        assert 'Pasado a factura' in P.inner_text('.list')

        print('8. Si se pierde la sesión al guardar, se pide entrar y se guarda')
        P.evaluate("localStorage.removeItem('nube-token')")
        P.goto(U + '#/facturas')  # navegar sin sesión lleva a la pantalla de entrar
        P.wait_for_selector('#entrar:not([disabled])'); P.click('#entrar'); P.wait_for_selector('text=Nueva factura')
        nuevo_cliente(P, U, 'Cliente Sin Sesion', '00000000T')
        P.wait_for_selector('text=Cliente Sin Sesion'); P.click('text=Cliente Sin Sesion'); P.wait_for_selector('#nombre')
        P.evaluate("localStorage.removeItem('nube-token')")
        P.fill('#telefono', '600000000'); P.click('#form button[type=submit]')
        P.wait_for_selector('.modal #modal-entrar'); P.click('#modal-entrar'); P.wait_for_selector('.modal', state='detached')
        P.wait_for_timeout(500)
        c = [x for x in drive.datos()['clientes'] if x['nombre'] == 'Cliente Sin Sesion'][0]
        assert c.get('telefono') == '600000000', 'el cambio hecho sin sesión se guarda al volver a entrar'
        assert 'Guardado' in P.inner_text('#estado-guardado')

        print('9. Una copia manipulada no puede colar código en la página')
        malo = '<img src=x onerror="window.__xss=1">'
        trampa = {'app': 'facturas-offline', 'formato': 1, 'eliminados': {},
                  'clientes': [{'id': malo, 'nombre': 'Trampa', 'nif': '1', 'direccion': 'x'}],
                  'facturas': [{'id': 'f-1', 'estado': 'emitida', 'codigo': 'X-1', 'fecha': '2026-01-01', 'emitidaEn': '2026-01-01T00:00:00Z',
                                'lineas': [{'id': 'l1', 'concepto': 'a', 'cantidad': 1, 'precio': 1, 'iva': malo}],
                                'totales': {'desglose': [{'tipo': malo, 'base': 1, 'cuota': 0}], 'base': 1, 'cuota': 0, 'total': 1}}],
                  'presupuestos': [{'id': 'x" onmouseover="window.__xss=1', 'lineas': [], 'fecha': '2026-01-01', 'codigo': 'PRE'}]}
        ruta_mala = os.path.join(tempfile.mkdtemp(), 'trampa.json'); open(ruta_mala, 'w').write(json.dumps(trampa))
        P.goto(U + '#/ajustes'); P.wait_for_selector('#importar', state='attached')
        P.set_input_files('#importar', ruta_mala); P.wait_for_timeout(800)
        assert 'descartado 3 registros' in P.inner_text('#res-import'), P.inner_text('#res-import')
        P.goto(U + '#/facturas'); P.wait_for_timeout(300); P.goto(U + '#/clientes'); P.wait_for_timeout(300)
        assert P.evaluate('window.__xss') is None and 'Trampa' not in P.inner_text('#app')

        print('10. Cerrar sesión quita los datos del dispositivo; al volver a entrar se recuperan de Drive')
        P.goto(U + '#/ajustes'); P.wait_for_selector('#nube-salir'); P.click('#nube-salir'); P.wait_for_selector('#entrar')
        n = P.evaluate("""new Promise(r => { const q = indexedDB.open('facturas-db'); q.onsuccess = () => {
            const t = q.result.transaction(['clientes', 'facturas', 'presupuestos']); let n = 0, k = 3;
            for (const s of ['clientes', 'facturas', 'presupuestos']) t.objectStore(s).count().onsuccess = e => { n += e.target.result; if (!--k) r(n); }; }; })""")
        assert n == 0, f'quedan {n} registros en el dispositivo'
        P.wait_for_selector('#entrar:not([disabled])'); P.click('#entrar'); P.wait_for_selector('#nube-sync')
        P.goto(U + '#/clientes'); P.wait_for_selector('text=Cliente Sin Sesion')

        print('11. Al imprimir, una factura corta ocupa una hoja (Chromium y Safari)')
        global CARPETA_IMPRESION
        CARPETA_IMPRESION = comprobar_paginas(b, P, U)

        b.close()
    srv.shutdown()
    assert not errores, errores
    print('Todo correcto')
    if CARPETA_IMPRESION: print('PDF de la prueba de impresión en', CARPETA_IMPRESION)

if __name__ == '__main__':
    main()
