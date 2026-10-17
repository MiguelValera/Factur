"""Pruebas de extremo a extremo de la app (Chromium sin interfaz).

Uso:  pip install playwright && playwright install chromium
      python3 pruebas_e2e.py

Levanta un servidor local, simula dos dispositivos y simula Google (no hace llamadas reales).
"""
import functools, http.server, json, os, re, socketserver, tempfile, threading
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.abspath(__file__))

def servidor():
    class Silencioso(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Silencioso, directory=RAIZ)
    srv = socketserver.TCPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://localhost:{srv.server_address[1]}/'

GIS = """window.google={accounts:{oauth2:{initTokenClient(c){return{requestAccessToken(){setTimeout(()=>c.callback({access_token:'tok',expires_in:3600}),30)}}},revoke(t,cb){cb&&cb()}}}};"""

class DriveFalso:
    def __init__(self): self.archivos = {}
    def __call__(self, route):
        r, u = route.request, route.request.url
        assert r.headers.get('authorization') == 'Bearer tok'
        if '/about' in u: return route.fulfill(json={'user': {'emailAddress': 'taller@gmail.com', 'displayName': 'Taller'}})
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

def dispositivo(b, U, errores, drive=None):
    pg = b.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True).new_page()
    pg.on('dialog', lambda d: d.accept())
    pg.on('pageerror', lambda e: errores.append(str(e)))
    if drive:
        def app_js(route):  # activa Google con un ID de prueba sin tocar el archivo
            body = route.fetch().text().replace("const GOOGLE_CLIENT_ID = '';", "const GOOGLE_CLIENT_ID = 'prueba';")
            route.fulfill(body=body, content_type='application/javascript')
        pg.route('**/app.js', app_js)
        pg.route('https://accounts.google.com/**', lambda r: r.fulfill(body=GIS, content_type='application/javascript'))
        pg.route('https://www.googleapis.com/**', drive)
    return pg

def configurar(pg, U, serie):
    pg.goto(U + '#/ajustes'); pg.wait_for_selector('#serie')
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

def main():
    srv, U = servidor()
    errores = []
    with sync_playwright() as p:
        b = p.chromium.launch()

        print('1. Factura, IVA mixto, datos adicionales y rectificativa')
        A = dispositivo(b, U, errores); configurar(A, U, 'M'); nuevo_cliente(A, U)
        A.goto(U + '#/factura/nueva'); A.wait_for_selector('#cliente'); A.select_option('#cliente', index=1)
        A.fill('.extra [data-e=valor]', '0000TST')
        A.fill('.line [data-f=concepto]', 'Pieza'); A.fill('.line [data-f=cantidad]', '2'); A.fill('.line [data-f=precio]', '19,99')
        A.click('#anadir'); l2 = A.query_selector_all('.line')[1]
        l2.query_selector('[data-f=concepto]').fill('Manual'); l2.query_selector('[data-f=precio]').fill('10'); l2.query_selector('[data-f=iva]').select_option('4')
        A.wait_for_timeout(500)
        assert '58,78' in A.inner_text('#totales'), A.inner_text('#totales')
        A.click('#emitir'); A.wait_for_selector('.stamp:not(.draft)')
        assert 'M-' in A.inner_text('h1') and '0000TST' in A.inner_text('.doc-extras')
        A.click('text=Crear rectificativa'); A.wait_for_selector('#motivo'); A.fill('#motivo', 'Devolución')
        A.wait_for_timeout(500); A.click('#emitir'); A.wait_for_selector('.stamp:not(.draft)')
        assert A.inner_text('h1').startswith('Rectificativa MR-')
        assert '2 facturas correctas' in verificar(A, U)

        print('2. Copia manual e importación en otro dispositivo')
        with A.expect_download() as d: A.click('#exportar')
        ruta = os.path.join(tempfile.mkdtemp(), 'copia.json'); d.value.save_as(ruta)
        B = dispositivo(b, U, errores)
        B.on('dialog', lambda d: None)
        B.goto(U + '#/ajustes'); B.wait_for_selector('#importar', state='attached')
        B.set_input_files('#importar', ruta); B.wait_for_timeout(800)
        assert '2 facturas nuevas' in B.inner_text('#res-import')
        configurar(B, U, 'P')
        assert 'P-' in emitir(B, U, 'Pieza', '15')

        print('3. Sincronización con Google Drive (simulado)')
        drive = DriveFalso()
        C = dispositivo(b, U, errores, drive); configurar(C, U, 'C')
        C.goto(U + '#/ajustes'); C.wait_for_selector('#nube-conectar'); C.click('#nube-conectar'); C.wait_for_selector('#nube-sync')
        nuevo_cliente(C, U); emitir(C, U, 'Revisión', '100', '1111AAA'); C.wait_for_timeout(2500)
        assert len(json.loads(drive.archivos['F1'])['facturas']) == 1
        D = dispositivo(b, U, errores, drive)
        D.goto(U + '#/ajustes'); D.wait_for_selector('#nube-conectar'); D.click('#nube-conectar'); D.wait_for_selector('#nube-sync')
        configurar(D, U, 'D'); emitir(D, U, 'Frenos', '60'); D.wait_for_timeout(2500)
        C.goto(U + '#/ajustes'); C.wait_for_selector('#nube-sync'); C.click('#nube-sync'); C.wait_for_timeout(1000)
        v = verificar(C, U)
        assert 'Serie C: 1' in v and 'Serie D: 1' in v, v

        b.close()
    srv.shutdown()
    assert not errores, errores
    print('Todo correcto')

if __name__ == '__main__':
    main()
