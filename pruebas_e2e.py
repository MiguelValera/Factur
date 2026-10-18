"""Pruebas de extremo a extremo de la app (Chromium sin interfaz).

Uso:  pip install playwright && playwright install chromium
      python3 pruebas_e2e.py

Levanta un servidor local, simula dos dispositivos y simula Google (no hace llamadas reales).
"""
import functools, http.server, json, os, re, socketserver, tempfile, threading
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.abspath(__file__))
CARPETA_PDF = None

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

def emitidas(pg, U):
    """Números de las facturas emitidas que muestra la lista"""
    pg.goto(U + '#/clientes'); pg.goto(U + '#/facturas'); pg.wait_for_selector('h1')
    return [t.split(' ')[0] for t in pg.eval_on_selector_all('a.item .t:first-child', 'es => es.map(e => e.textContent.trim())')]

# Lee un PDF generado por la app con un validador de Apple (PDFKit, el de Vista Previa y Safari), si hay swiftc
LEER_PDF_MAC = r"""
import PDFKit
let d = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
print(d.pageCount)
for i in 0..<d.pageCount { print("@@" + (d.page(at: i)!.string ?? "")) }
"""

def analizar_pdf(ruta):
    """Comprueba que el PDF está bien formado y devuelve sus páginas y los textos con su posición"""
    datos = open(ruta, 'rb').read()
    assert datos.startswith(b'%PDF-1.4') and datos.rstrip().endswith(b'%%EOF')
    xref = int(re.search(rb'startxref\s+(\d+)', datos).group(1))
    assert datos[xref:xref + 4] == b'xref', 'startxref no apunta a la tabla xref'
    entradas = re.findall(rb'(\d{10}) 00000 n ', datos[xref:])
    for k, desplazamiento in enumerate(entradas, 1):
        assert datos[int(desplazamiento):].startswith(f'{k} 0 obj'.encode()), f'el objeto {k} no está donde dice la tabla xref'
    paginas = []
    for m in re.finditer(rb'stream\n(.*?)\nendstream', datos, re.S):
        textos = [(float(x), 841.89 - float(y), t.decode('latin-1'))
                  for x, y, t in re.findall(rb'1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm \(((?:\\.|[^\\)])*)\) Tj', m.group(1))]
        paginas.append(textos)
    return paginas

def comprobar_pdf(b, pg, U):
    """Descarga el PDF de facturas de distintos tamaños y comprueba hojas, márgenes y que nada se corta"""
    import shutil, subprocess
    tmp = tempfile.mkdtemp()
    pg.goto(U + '#/ajustes'); pg.wait_for_selector('#e-nombre')
    for campo, valor in (('cp', '00000'), ('poblacion', 'Pueblo'), ('provincia', 'Provincia'), ('email', 'correo@example.com'),
                         ('telefono', '600000000'), ('iban', 'ES00 0000 0000 0000 0000 0000')):
        pg.fill(f'#e-{campo}', valor)
    pg.click('#f-emisor button[type=submit]'); pg.wait_for_timeout(300)
    lector = None
    if shutil.which('swiftc'):
        src, lector = os.path.join(tmp, 'leer.swift'), os.path.join(tmp, 'leer')
        open(src, 'w').write(LEER_PDF_MAC)
        subprocess.run(['swiftc', '-O', src, '-o', lector], check=True, capture_output=True)
    else:
        print('   (sin swiftc: no se lee el PDF con el validador de Apple)')
    for n, hojas in ((1, 1), (8, 1), (11, 1), (40, None)):
        pg.goto(U + '#/factura/nueva'); pg.wait_for_selector('#cliente'); pg.select_option('#cliente', index=1)
        pg.fill('.extra [data-e=valor]', '0000TST')
        for i in range(n):
            if i: pg.click('#anadir')
            l = pg.query_selector_all('.line')[i]
            l.query_selector('[data-f=concepto]').fill(f'Linea {i + 1} con una descripción algo larga para que ocupe dos líneas' if i % 5 == 4 else f'Linea {i + 1}')
            l.query_selector('[data-f=precio]').fill('10')
        pg.fill('#notas', 'Garantía de tres meses en mano de obra.')
        pg.wait_for_timeout(500); pg.click('#emitir'); pg.wait_for_selector('.stamp:not(.draft)')
        with pg.expect_download() as d: pg.click('#pdf-descargar')
        ruta = os.path.join(tmp, f'factura-{n}.pdf'); d.value.save_as(ruta)
        paginas = analizar_pdf(ruta)
        assert hojas is None or len(paginas) == hojas, f'factura de {n} conceptos: {len(paginas)} hojas'
        assert len(paginas) >= (2 if hojas is None else 1)
        for i, textos in enumerate(paginas, 1):
            for x, y, t in textos:  # nada fuera de la hoja ni pegado a los bordes: no se corta al imprimir
                assert 40 <= x <= 560 and 40 <= y <= 830, f'factura de {n} conceptos, hoja {i}: «{t}» en ({x:.0f}, {y:.0f})'
            if len(paginas) > 1: assert any(t == f'P\\341gina {i} de {len(paginas)}' for *_, t in textos), f'falta el número de página {i}'
        conceptos = sum(1 for p in paginas for *_, t in p if t.startswith('Linea '))
        assert conceptos == n, f'factura de {n} conceptos: salen {conceptos}'
        assert [t for *_, t in paginas[-1]].count('TOTAL') == 1 and all('TOTAL' not in [t for *_, t in p] for p in paginas[:-1])
        if lector:
            salida = subprocess.run([lector, ruta], check=True, capture_output=True, text=True, timeout=60).stdout
            assert int(salida.split('\n')[0]) == len(paginas), 'PDFKit lee otro número de hojas'
            assert 'TOTAL' in salida.split('@@')[-1] and 'FORMA DE PAGO' in salida.split('@@')[-1].upper()
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
        assert sorted(emitidas(A, U)) == [f'F-{anio}-0001', f'FR-{anio}-0001']
        assert len(drive.datos()['facturas']) == 2, 'cada factura emitida se sube a Drive en el acto'

        print('3. Otro dispositivo con la misma cuenta: misma serie y numeración seguida')
        B = dispositivo(b, U, errores, drive); entrar(B, U)
        B.goto(U + '#/ajustes'); B.wait_for_selector('#serie')
        assert B.input_value('#serie') == 'F' and B.input_value('#e-nombre'), 'la serie y el emisor vienen de Drive'
        assert f'F-{anio}-0002' in emitir(B, U, 'Frenos', '60')
        assert f'F-{anio}-0003' in emitir(A, U, 'Aceite', '30'), 'antes de numerar se trae lo último de Drive'
        B.goto(U + '#/ajustes'); B.wait_for_selector('#nube-sync'); B.click('#nube-sync'); B.wait_for_timeout(1000)
        v = sorted(emitidas(B, U))
        assert v == [f'F-{anio}-0001', f'F-{anio}-0002', f'F-{anio}-0003', f'FR-{anio}-0001'], v

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
        P.click('#ver'); assert 'PRESUPUESTO' in P.inner_text('#preview .doc-title').upper() and 'VÁLIDO HASTA' in P.inner_text('#preview').upper()
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

        print('11. PDF: una hoja si cabe, varias si no, y nada cortado (también leído con PDFKit de Apple)')
        global CARPETA_PDF
        CARPETA_PDF = comprobar_pdf(b, P, U)

        b.close()
    srv.shutdown()
    assert not errores, errores
    print('Todo correcto')
    if CARPETA_PDF: print('PDF de la prueba en', CARPETA_PDF)

if __name__ == '__main__':
    main()
