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
        P.click('#ver'); assert 'Presupuesto' in P.inner_text('#preview .doc-title') and 'Válido hasta' in P.inner_text('#preview')
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

        b.close()
    srv.shutdown()
    assert not errores, errores
    print('Todo correcto')

if __name__ == '__main__':
    main()
