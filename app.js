'use strict';

const APP_VERSION = '1.1.1';
const FORMATO_COPIA = 'facturas-offline';
const IVA_TIPOS = [21, 10, 4, 0];

/* ============================================================
   Base de datos local (IndexedDB)
   ============================================================ */
const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('facturas-db', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore('ajustes', { keyPath: 'clave' });
          db.createObjectStore('clientes', { keyPath: 'id' });
          db.createObjectStore('facturas', { keyPath: 'id' });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  return {
    async get(store, key) { const db = await open(); return req(db.transaction(store).objectStore(store).get(key)); },
    async all(store) { const db = await open(); return req(db.transaction(store).objectStore(store).getAll()); },
    async put(store, val) { const db = await open(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(val); return done(t); },
    async del(store, key) { const db = await open(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).delete(key); return done(t); },
    async putMany(map) {
      const db = await open();
      const stores = Object.keys(map).filter(s => map[s].length);
      if (!stores.length) return;
      const t = db.transaction(stores, 'readwrite');
      for (const s of stores) for (const v of map[s]) t.objectStore(s).put(v);
      return done(t);
    },
  };
})();

const getAjuste = async clave => (await DB.get('ajustes', clave))?.valor;
const setAjuste = (clave, valor) => DB.put('ajustes', { clave, valor });

/* ============================================================
   Utilidades
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const ahora = () => new Date().toISOString();
const hoy = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const r2 = x => Math.sign(x) * Math.round(Math.abs(x)); // redondeo simétrico

const fmtEur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmtPrecio = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtNum = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 });
const fmtFecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const eur = cents => fmtEur.format(cents / 100);
const fecha = iso => iso ? fmtFecha.format(new Date(iso.slice(0, 10) + 'T12:00:00')) : '';

function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const numTxt = n => String(n).replace('.', ',');

/* ============================================================
   NIF / NIE / CIF
   ============================================================ */
const normNif = v => String(v || '').toUpperCase().replace(/[\s.\-]/g, '');
function validarNif(raw) {
  const v = normNif(raw);
  if (!v) return { ok: false, msg: '' };
  const L = 'TRWAGMYFPDXBNJZSQVHLCKE';
  if (/^\d{8}[A-Z]$/.test(v)) return L[+v.slice(0, 8) % 23] === v[8] ? { ok: true, msg: 'DNI válido' } : { ok: false, msg: 'La letra no corresponde a ese DNI' };
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const n = 'XYZ'.indexOf(v[0]) + v.slice(1, 8);
    return L[+n % 23] === v[8] ? { ok: true, msg: 'NIE válido' } : { ok: false, msg: 'La letra no corresponde a ese NIE' };
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      let n = +v[i + 1];
      if (i % 2 === 0) { n *= 2; n = Math.floor(n / 10) + (n % 10); }
      sum += n;
    }
    const c = (10 - (sum % 10)) % 10;
    return (v[8] === String(c) || v[8] === 'JABCDEFGHI'[c]) ? { ok: true, msg: 'CIF válido' } : { ok: false, msg: 'El dígito de control no corresponde a ese CIF' };
  }
  return { ok: false, msg: 'Formato no reconocido. Si es un NIF extranjero, puedes guardarlo igualmente.' };
}

/* ============================================================
   Cálculos (todo en céntimos)
   ============================================================ */
function baseLinea(l) {
  const q = parseNum(l.cantidad), p = parseNum(l.precio);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return NaN;
  return r2(Number((q * p * 100).toFixed(6)));
}
function calcTotales(lineas, retencionTipo = 0) {
  const porIva = new Map();
  let valido = true;
  for (const l of lineas) {
    const b = baseLinea(l);
    if (Number.isNaN(b)) { valido = false; continue; }
    const t = Number(l.iva) || 0;
    porIva.set(t, (porIva.get(t) || 0) + b);
  }
  const desglose = [...porIva.entries()].sort((a, b) => b[0] - a[0])
    .map(([tipo, base]) => ({ tipo, base, cuota: r2(base * tipo / 100) }));
  const base = desglose.reduce((s, d) => s + d.base, 0);
  const cuota = desglose.reduce((s, d) => s + d.cuota, 0);
  const ret = parseNum(retencionTipo) || 0;
  const retencion = r2(base * ret / 100);
  return { desglose, base, cuota, retencionTipo: ret, retencion, total: base + cuota - retencion, valido };
}

/* ============================================================
   Huella encadenada (SHA-256) de las facturas emitidas
   ============================================================ */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function contenidoHash(f) {
  return {
    v: 1, codigo: f.codigo, serie: f.serieCodigo, anio: f.anio, numero: f.numero, tipo: f.tipo,
    fecha: f.fecha, fechaOperacion: f.fechaOperacion || '',
    emisor: f.emisorSnap, cliente: f.clienteSnap,
    lineas: f.lineas.map(l => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precio, iva: l.iva })),
    extras: f.extras?.length ? f.extras.map(x => ({ clave: x.clave, valor: x.valor })) : undefined,
    totales: f.totales, rectificaCodigo: f.rectificaCodigo || '', motivo: f.motivo || '', notas: f.notas || '',
    emitidaEn: f.emitidaEn, hashAnterior: f.hashAnterior || '',
  };
}
const ordenCadena = (a, b) => a.emitidaEn.localeCompare(b.emitidaEn) || a.codigo.localeCompare(b.codigo);

async function verificarRegistros() {
  const emitidas = (await DB.all('facturas')).filter(f => f.estado === 'emitida');
  const porSerie = new Map();
  for (const f of emitidas) { if (!porSerie.has(f.serie)) porSerie.set(f.serie, []); porSerie.get(f.serie).push(f); }
  const resultado = [];
  for (const [serie, lista] of [...porSerie.entries()].sort()) {
    lista.sort(ordenCadena);
    let prev = '';
    const problemas = [];
    for (const f of lista) {
      if ((f.hashAnterior || '') !== prev) problemas.push(`${f.codigo}: no enlaza con la factura emitida antes`);
      if (await sha256(canon(contenidoHash(f))) !== f.hash) problemas.push(`${f.codigo}: su contenido ha cambiado desde que se emitió`);
      prev = f.hash;
    }
    resultado.push({ serie, total: lista.length, problemas });
  }
  const vistos = new Map();
  for (const f of emitidas) {
    if (vistos.has(f.codigo)) resultado.push({ serie: f.serie, total: 0, problemas: [`El número ${f.codigo} está repetido. Dos dispositivos están usando la misma serie.`] });
    vistos.set(f.codigo, f.id);
  }
  return resultado;
}

/* ============================================================
   Avisos
   ============================================================ */
let toastTimer;
function toast(msg, accion, alPulsar, fijo = false) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (accion ? ` <button type="button">${esc(accion)}</button>` : '');
  if (accion) $('button', t).onclick = () => { t.classList.remove('show'); alPulsar(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  if (!fijo) toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ============================================================
   Documento de factura (pantalla e impresión)
   ============================================================ */
function lineasDireccion(o) {
  if (!o) return [];
  const loc = [o.cp, o.poblacion].filter(Boolean).join(' ') + (o.provincia ? ` (${o.provincia})` : '');
  return [o.direccion, loc, o.pais && o.pais !== 'España' ? o.pais : ''].filter(s => s && s.trim());
}
function bloqueParte(titulo, o) {
  if (!o) return `<div><h3>${titulo}</h3><p class="muted">Sin indicar</p></div>`;
  const extra = [o.email, o.telefono].filter(Boolean).join('  ·  ');
  return `<div><h3>${titulo}</h3>
    <div><strong>${esc(o.nombre)}</strong></div>
    <div>NIF ${esc(o.nif)}</div>
    ${lineasDireccion(o).map(l => `<div>${esc(l)}</div>`).join('')}
    ${extra ? `<div>${esc(extra)}</div>` : ''}</div>`;
}
const extrasValidos = ex => (ex || []).filter(x => String(x.clave || '').trim() && String(x.valor || '').trim());
function docHtml(d) {
  const t = d.totales;
  const unTipo = t.desglose.length === 1;
  const filasIva = t.desglose.map(x => `
    <tr><td>Base imponible${unTipo ? '' : ` al ${x.tipo} %`}</td><td class="num">${eur(x.base)}</td></tr>
    <tr><td>IVA ${x.tipo} %</td><td class="num">${eur(x.cuota)}</td></tr>`).join('');
  const sello = d.borrador
    ? `<div class="stamp draft">Borrador</div>`
    : `<div class="stamp${d.fresca ? ' fresh' : ''}">Emitida</div>`;
  return `<article class="doc has-stamp">
    ${sello}
    <div class="doc-head">
      <p class="doc-title">${d.tipo === 'R' ? 'Factura rectificativa' : 'Factura'}</p>
      <div>Nº <strong>${esc(d.codigo || 'pendiente de emitir')}</strong></div>
      <div>Fecha: ${esc(fecha(d.fecha))}</div>
      ${d.fechaOperacion && d.fechaOperacion !== d.fecha ? `<div>Fecha de la operación: ${esc(fecha(d.fechaOperacion))}</div>` : ''}
    </div>
    <div class="doc-parties">${bloqueParte('Emisor', d.emisor)}${bloqueParte('Cliente', d.cliente)}</div>
    ${extrasValidos(d.extras).length ? `<div class="doc-extras">${extrasValidos(d.extras).map(x => `<div>${esc(x.clave)}: ${esc(x.valor)}</div>`).join('')}</div>` : ''}
    ${d.tipo === 'R' ? `<p>Rectifica la factura <strong>${esc(d.rectificaCodigo)}</strong> (rectificación por diferencias).${d.motivo ? ` Motivo: ${esc(d.motivo)}` : ''}</p>` : ''}
    <div class="tablewrap"><table>
      <thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">IVA</th><th class="num">Importe</th></tr></thead>
      <tbody>${d.lineas.map(l => {
        const b = baseLinea(l);
        return `<tr><td>${esc(l.concepto)}</td><td class="num">${fmtNum.format(parseNum(l.cantidad) || 0)}</td>
          <td class="num">${fmtPrecio.format(parseNum(l.precio) || 0)}</td><td class="num">${l.iva} %</td>
          <td class="num">${Number.isNaN(b) ? '—' : eur(b)}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <table class="doc-totals"><tbody>
      ${filasIva}
      ${t.retencion ? `<tr><td>Retención IRPF ${fmtNum.format(t.retencionTipo)} %</td><td class="num">−${eur(t.retencion)}</td></tr>` : ''}
      <tr class="total"><td>Total</td><td class="num">${eur(t.total)}</td></tr>
    </tbody></table>
    ${d.notas ? `<p style="margin-top:16px">${esc(d.notas).replace(/\n/g, '<br>')}</p>` : ''}
    ${d.emisor?.iban ? `<p>Forma de pago: transferencia a ${esc(d.emisor.iban)}</p>` : ''}
    ${d.emisor?.pie ? `<p class="small">${esc(d.emisor.pie).replace(/\n/g, '<br>')}</p>` : ''}
    ${d.hash ? `<div class="doc-foot">Huella del registro: ${esc(d.hash)}</div>` : ''}
  </article>`;
}
function datosDocEmitida(f, fresca = false) {
  return {
    tipo: f.tipo, codigo: f.codigo, fecha: f.fecha, fechaOperacion: f.fechaOperacion,
    emisor: f.emisorSnap, cliente: f.clienteSnap, lineas: f.lineas, totales: f.totales,
    extras: f.extras, notas: f.notas, rectificaCodigo: f.rectificaCodigo, motivo: f.motivo, hash: f.hash, fresca,
  };
}
function imprimir(html, titulo) {
  $('#print-area').innerHTML = html;
  const anterior = document.title;
  document.title = titulo; // nombre sugerido al guardar como PDF
  window.addEventListener('afterprint', () => { document.title = anterior; }, { once: true });
  window.print();
}

/* ============================================================
   Vistas
   ============================================================ */
let guardarPendiente = null; // vacía el autoguardado al cambiar de pantalla

async function cambiosSinCopia() {
  const [ultima, facturas, clientes] = await Promise.all([getAjuste('ultimaCopia'), DB.all('facturas'), DB.all('clientes')]);
  const ultimoCambio = [...facturas.map(f => f.emitidaEn || f.actualizado || ''), ...clientes.map(c => c.actualizado || '')]
    .reduce((m, x) => (x > m ? x : m), '');
  return ultimoCambio && (!ultima || ultimoCambio > ultima);
}

async function vistaFacturas() {
  const [facturas, clientes, emisor, disp, sinCopia] = await Promise.all([
    DB.all('facturas'), DB.all('clientes'), getAjuste('emisor'), getAjuste('dispositivo'), cambiosSinCopia()]);
  const cli = new Map(clientes.map(c => [c.id, c]));
  const borradores = facturas.filter(f => f.estado === 'borrador').sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
  const emitidas = facturas.filter(f => f.estado === 'emitida').sort((a, b) => b.fecha.localeCompare(a.fecha) || b.codigo.localeCompare(a.codigo));
  const listo = emisor && disp;

  const item = f => {
    const nombre = f.estado === 'emitida' ? f.clienteSnap?.nombre : cli.get(f.clienteId)?.nombre;
    const total = f.estado === 'emitida' ? f.totales.total : calcTotales(f.lineas, f.retencionTipo).total;
    const chip = f.estado === 'borrador' ? '<span class="chip draft">Borrador</span>' : (f.tipo === 'R' ? '<span class="chip rect">Rectificativa</span>' : '');
    return `<li><a class="item" href="#/factura/${f.id}" data-buscar="${esc([f.codigo, nombre, ...(f.extras || []).map(x => x.valor)].filter(Boolean).join(' ').toLowerCase())}">
      <span class="t">${esc(f.codigo || (f.tipo === 'R' ? 'Rectificativa sin emitir' : 'Factura sin emitir'))} ${chip}</span>
      <span class="num t">${eur(total)}</span>
      <span class="s">${esc(nombre || 'Sin cliente')}</span>
      <span class="s num">${esc(fecha(f.fecha))}</span></a></li>`;
  };

  app.innerHTML = `
    ${!listo ? `<div class="notice">Antes de facturar, rellena tus datos de facturador y elige la serie de este dispositivo.<br><a class="btn primary" href="#/ajustes">Ir a ajustes</a></div>` : ''}
    ${listo && sinCopia ? `<div class="notice">Hay cambios que aún no están en ninguna copia de seguridad.<br><button type="button" class="primary" id="copiar">Exportar copia</button></div>` : ''}
    <div class="head-row"><h1>Facturas</h1>
      ${listo ? `<a class="btn primary" href="#/factura/nueva">Nueva factura</a>` : ''}</div>
    ${disp ? `<p class="muted small">Este dispositivo emite con la serie ${esc(disp.serie)}.</p>` : ''}
    ${facturas.length ? `<input class="search" type="search" placeholder="Buscar por número o cliente" aria-label="Buscar facturas" id="buscar">` : ''}
    ${borradores.length ? `<h2>Borradores</h2><ul class="list">${borradores.map(item).join('')}</ul>` : ''}
    <h2>Emitidas</h2>
    ${emitidas.length ? `<ul class="list">${emitidas.map(item).join('')}</ul>` : `<p class="empty">Todavía no has emitido ninguna factura.</p>`}`;

  $('#copiar')?.addEventListener('click', exportarCopia);
  $('#buscar')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $$('a.item', app).forEach(a => { a.parentElement.hidden = q && !a.dataset.buscar.includes(q); });
  });
}

const nuevaLinea = () => ({ id: uuid(), concepto: '', cantidad: '1', precio: '', iva: 21 });

const nuevoExtra = (clave = '', valor = '') => ({ id: uuid(), clave, valor });
async function clavesHabituales() {
  const ultima = (await DB.all('facturas')).filter(x => x.estado === 'emitida' && x.extras?.length).sort(ordenCadena).at(-1);
  return ultima ? ultima.extras.map(x => nuevoExtra(x.clave)) : [nuevoExtra('Matrícula')];
}
async function crearBorrador(extra = {}) {
  if (!extra.extras) extra.extras = await clavesHabituales();
  const f = {
    id: uuid(), estado: 'borrador', tipo: 'F', fecha: hoy(), fechaOperacion: '', clienteId: '',
    lineas: [nuevaLinea()], retencionTipo: '0', notas: '', motivo: '', creado: ahora(), actualizado: ahora(), ...extra,
  };
  await DB.put('facturas', f);
  location.replace('#/factura/' + f.id);
}

async function vistaFactura(id, accion) {
  const f = await DB.get('facturas', id);
  if (!f) { app.innerHTML = `<h1>No encontrada</h1><p>Esa factura no existe en este dispositivo.</p><a class="btn" href="#/facturas">Volver a facturas</a>`; return; }

  if (accion === 'rectificar' && f.estado === 'emitida' && f.tipo === 'F') {
    return crearBorrador({
      tipo: 'R', rectificaId: f.id, rectificaCodigo: f.codigo, clienteId: f.clienteId, extras: (f.extras || []).map(x => nuevoExtra(x.clave, x.valor)),
      retencionTipo: numTxt(f.totales.retencionTipo || 0),
      lineas: f.lineas.map(l => ({ id: uuid(), concepto: l.concepto, cantidad: numTxt(-parseNum(l.cantidad)), precio: numTxt(l.precio), iva: l.iva })),
    });
  }
  if (accion === 'duplicar') {
    return crearBorrador({
      clienteId: f.clienteId, extras: (f.extras || []).map(x => nuevoExtra(x.clave, x.valor)),
      retencionTipo: numTxt(f.totales?.retencionTipo ?? parseNum(f.retencionTipo) ?? 0), notas: f.notas || '',
      lineas: f.lineas.map(l => ({ id: uuid(), concepto: l.concepto, cantidad: numTxt(l.cantidad), precio: numTxt(l.precio), iva: l.iva })),
    });
  }
  return f.estado === 'emitida' ? vistaEmitida(f) : editorBorrador(f);
}

async function vistaEmitida(f) {
  const fresca = sessionStorage.getItem('recienEmitida') === f.id;
  sessionStorage.removeItem('recienEmitida');
  const todas = await DB.all('facturas');
  const rects = todas.filter(x => x.rectificaId === f.id);
  const html = docHtml(datosDocEmitida(f, fresca));
  app.innerHTML = `
    <div class="head-row"><h1>${f.tipo === 'R' ? 'Rectificativa' : 'Factura'} ${esc(f.codigo)}</h1></div>
    ${html}
    <div class="row">
      <button type="button" class="primary" id="imprimir">Imprimir o guardar PDF</button>
      ${f.tipo === 'F' ? `<a class="btn" href="#/factura/${f.id}/rectificar">Crear rectificativa</a>` : ''}
      <a class="btn" href="#/factura/${f.id}/duplicar">Duplicar como borrador</a>
    </div>
    ${rects.length ? `<h2>Rectificativas de esta factura</h2><ul class="list">${rects.map(r =>
      `<li><a class="item" href="#/factura/${r.id}"><span class="t">${esc(r.codigo || 'Sin emitir')}</span><span class="num">${r.totales ? eur(r.totales.total) : ''}</span></a></li>`).join('')}</ul>` : ''}
    <p class="muted small" style="margin-top:20px">Una factura emitida no se puede modificar. Para corregirla, crea una rectificativa.</p>`;
  $('#imprimir').onclick = () => imprimir(docHtml(datosDocEmitida(f)), f.codigo);
}

async function editorBorrador(f) {
  const [clientes, emisor, disp, todas] = await Promise.all([DB.all('clientes'), getAjuste('emisor'), getAjuste('dispositivo'), DB.all('facturas')]);
  clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Conceptos ya usados, para autocompletar precio e IVA
  const conocidos = new Map();
  todas.filter(x => x.estado === 'emitida').sort(ordenCadena)
    .forEach(x => x.lineas.forEach(l => { if (l.concepto && parseNum(l.cantidad) > 0) conocidos.set(l.concepto, l); }));

  f.extras ||= [];
  const emitidas = todas.filter(x => x.estado === 'emitida');
  const claves = [...new Set(['Matrícula', 'Vehículo', 'Kilómetros', ...emitidas.flatMap(x => (x.extras || []).map(e => e.clave))])];
  const valoresCliente = () => [...new Set(emitidas.filter(x => x.clienteId === f.clienteId)
    .flatMap(x => (x.extras || []).map(e => e.valor)).filter(Boolean))];
  const extraHtml = x => `
    <div class="extra" data-id="${x.id}">
      <div><label for="k-${x.id}">Dato</label><input id="k-${x.id}" data-e="clave" list="claves-extra" value="${esc(x.clave)}" placeholder="Matrícula" autocomplete="off"></div>
      <div><label for="v-${x.id}">Valor</label><input id="v-${x.id}" data-e="valor" list="valores-extra" value="${esc(x.valor)}" placeholder="6363HJU" autocomplete="off"></div>
      <button type="button" class="ghost" data-quitar-extra aria-label="Quitar este dato">Quitar</button>
    </div>`;
  const pintarValores = () => { $('#valores-extra').innerHTML = valoresCliente().map(v => `<option value="${esc(v)}">`).join(''); };

  const lineaHtml = l => `
    <div class="line" data-id="${l.id}">
      <div class="c"><label for="c-${l.id}">Concepto</label><input id="c-${l.id}" data-f="concepto" list="conceptos" value="${esc(l.concepto)}" autocomplete="off"></div>
      <div class="q"><label for="q-${l.id}">Cantidad</label><input id="q-${l.id}" data-f="cantidad" inputmode="decimal" value="${esc(l.cantidad)}"></div>
      <div class="p"><label for="p-${l.id}">Precio sin IVA</label><input id="p-${l.id}" data-f="precio" inputmode="decimal" placeholder="0,00" value="${esc(l.precio)}"></div>
      <div class="i"><label for="i-${l.id}">IVA</label><select id="i-${l.id}" data-f="iva">${IVA_TIPOS.map(t => `<option value="${t}"${+l.iva === t ? ' selected' : ''}>${t} %</option>`).join('')}</select></div>
      <div class="b num" data-base></div>
      <div class="x"><button type="button" class="ghost" data-quitar aria-label="Quitar este concepto">Quitar</button></div>
    </div>`;

  app.innerHTML = `
    <div class="head-row"><h1>${f.tipo === 'R' ? 'Rectificativa' : 'Nueva factura'}</h1></div>
    ${!emisor || !disp ? `<div class="notice">Faltan tus datos de facturador o la serie de este dispositivo. <a href="#/ajustes">Complétalos en ajustes</a>.</div>` : ''}
    <form id="form" class="stack" autocomplete="off" onsubmit="return false">
      ${f.tipo === 'R' ? `
        <p>Rectifica la factura <strong>${esc(f.rectificaCodigo)}</strong>. Se han copiado sus conceptos en negativo: deja solo lo que corrige.</p>
        <div><label for="motivo">Motivo de la rectificación</label><textarea id="motivo" data-g="motivo" required>${esc(f.motivo)}</textarea></div>` : ''}
      <div>
        <label for="cliente">Cliente</label>
        <select id="cliente" data-g="clienteId">
          <option value="">Elige un cliente</option>
          ${clientes.map(c => `<option value="${c.id}"${c.id === f.clienteId ? ' selected' : ''}>${esc(c.nombre)} (${esc(c.nif)})</option>`).join('')}
        </select>
        <div class="hint"><a href="#/cliente/nuevo?volver=${f.id}">Añadir un cliente nuevo</a></div>
      </div>
      <div>
        <h2>Datos adicionales</h2>
        <p class="hint" style="margin-top:-6px">Salen debajo del cliente, centrados y en negrita.</p>
        <div class="extras" id="extras">${f.extras.map(extraHtml).join('')}</div>
        <datalist id="claves-extra">${claves.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <datalist id="valores-extra"></datalist>
        <button type="button" id="anadir-extra" style="margin-top:8px">Añadir dato</button>
      </div>
      <div class="grid three">
        <div><label for="fecha">Fecha de la factura</label><input id="fecha" type="date" data-g="fecha" value="${esc(f.fecha)}"></div>
        <div><label for="fop">Fecha de la operación</label><input id="fop" type="date" data-g="fechaOperacion" value="${esc(f.fechaOperacion)}"><div class="hint">Solo si es distinta</div></div>
        <div><label for="ret">Retención IRPF %</label><input id="ret" inputmode="decimal" data-g="retencionTipo" value="${esc(f.retencionTipo)}"></div>
      </div>
      <h2>Conceptos</h2>
      <div class="lines" id="lineas">${f.lineas.map(lineaHtml).join('')}</div>
      <datalist id="conceptos">${[...conocidos.keys()].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <button type="button" id="anadir">Añadir concepto</button>
      <div><label for="notas">Notas en la factura</label><textarea id="notas" data-g="notas" placeholder="Por ejemplo, la causa de exención si usas IVA 0 %">${esc(f.notas)}</textarea></div>
    </form>
    <table class="doc-totals" id="totales" aria-live="polite"></table>
    <div class="row" style="margin-top:20px">
      <button type="button" class="primary" id="emitir">Emitir factura</button>
      <button type="button" id="ver">Vista previa</button>
      <button type="button" class="danger" id="borrar">Eliminar borrador</button>
    </div>
    <div id="preview"></div>`;

  const pintarTotales = () => {
    const t = calcTotales(f.lineas, f.retencionTipo);
    $('#totales').innerHTML = `<tbody>
      ${t.desglose.map(d => `<tr><td>Base ${d.tipo} %</td><td class="num">${eur(d.base)}</td></tr><tr><td>IVA ${d.tipo} %</td><td class="num">${eur(d.cuota)}</td></tr>`).join('')}
      ${t.retencion ? `<tr><td>Retención ${fmtNum.format(t.retencionTipo)} %</td><td class="num">−${eur(t.retencion)}</td></tr>` : ''}
      <tr class="total"><td>Total</td><td class="num">${eur(t.total)}</td></tr></tbody>`;
    $$('.line', app).forEach(el => {
      const l = f.lineas.find(x => x.id === el.dataset.id);
      const b = l ? baseLinea(l) : 0;
      $('[data-base]', el).textContent = Number.isNaN(b) ? 'Número no válido' : eur(b);
    });
  };

  let timer;
  const guardar = async () => { clearTimeout(timer); guardarPendiente = null; f.actualizado = ahora(); await DB.put('facturas', f); };
  const programar = () => { clearTimeout(timer); guardarPendiente = guardar; timer = setTimeout(guardar, 400); };

  const form = $('#form');
  form.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.g) f[el.dataset.g] = el.value;
    if (el.dataset.g === 'clienteId') pintarValores();
    const filaExtra = el.closest('.extra');
    if (filaExtra && el.dataset.e) f.extras.find(x => x.id === filaExtra.dataset.id)[el.dataset.e] = el.value;
    const fila = el.closest('.line');
    if (fila && el.dataset.f) {
      const l = f.lineas.find(x => x.id === fila.dataset.id);
      l[el.dataset.f] = el.dataset.f === 'iva' ? +el.value : el.value;
    }
    pintarTotales(); programar();
  });
  form.addEventListener('change', e => { // al elegir un concepto conocido, propone su precio e IVA
    const el = e.target;
    if (el.dataset.f !== 'concepto') return;
    const fila = el.closest('.line');
    const l = f.lineas.find(x => x.id === fila.dataset.id);
    const k = conocidos.get(el.value);
    if (k && !String(l.precio).trim()) {
      l.precio = numTxt(k.precio); l.iva = k.iva;
      $('[data-f="precio"]', fila).value = l.precio; $('[data-f="iva"]', fila).value = String(k.iva);
      pintarTotales(); programar();
    }
  });
  $('#lineas').addEventListener('click', e => {
    if (!e.target.matches('[data-quitar]')) return;
    const fila = e.target.closest('.line');
    f.lineas = f.lineas.filter(x => x.id !== fila.dataset.id);
    if (!f.lineas.length) f.lineas.push(nuevaLinea());
    $('#lineas').innerHTML = f.lineas.map(lineaHtml).join('');
    pintarTotales(); programar();
  });
  $('#extras').addEventListener('click', e => {
    if (!e.target.matches('[data-quitar-extra]')) return;
    const id = e.target.closest('.extra').dataset.id;
    f.extras = f.extras.filter(x => x.id !== id);
    e.target.closest('.extra').remove();
    programar();
  });
  $('#anadir-extra').onclick = () => {
    const x = nuevoExtra();
    f.extras.push(x);
    $('#extras').insertAdjacentHTML('beforeend', extraHtml(x));
    $(`#k-${x.id}`).focus();
    programar();
  };
  pintarValores();
  $('#anadir').onclick = () => {
    const l = nuevaLinea();
    f.lineas.push(l);
    $('#lineas').insertAdjacentHTML('beforeend', lineaHtml(l));
    $(`#c-${l.id}`).focus();
    pintarTotales(); programar();
  };
  $('#ver').onclick = async () => {
    const cliente = clientes.find(c => c.id === f.clienteId);
    $('#preview').innerHTML = docHtml({ ...f, emisor, cliente, totales: calcTotales(f.lineas, f.retencionTipo), borrador: true });
    $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('#borrar').onclick = async () => {
    if (!confirm('¿Eliminar este borrador? No se puede deshacer.')) return;
    clearTimeout(timer); guardarPendiente = null;
    await DB.del('facturas', f.id);
    location.hash = '#/facturas';
  };
  $('#emitir').onclick = async () => {
    await guardar();
    const error = await emitir(f);
    if (error) { toast(error); return; }
  };
  pintarTotales();
}

async function emitir(f) {
  const [emisor, disp] = await Promise.all([getAjuste('emisor'), getAjuste('dispositivo')]);
  if (!emisor) return 'Faltan tus datos de facturador. Rellénalos en ajustes.';
  if (!disp?.serie) return 'Falta elegir la serie de este dispositivo en ajustes.';
  const cliente = f.clienteId && await DB.get('clientes', f.clienteId);
  if (!cliente) return 'Elige un cliente.';
  if (!cliente.nif || !cliente.nombre || !cliente.direccion) return 'Al cliente le falta el NIF, el nombre o la dirección.';
  if (f.tipo === 'R' && !f.motivo.trim()) return 'Escribe el motivo de la rectificación.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) return 'La fecha de la factura no es válida.';

  const lineas = f.lineas.filter(l => l.concepto.trim() || String(l.precio).trim())
    .map(l => ({ id: l.id, concepto: l.concepto.trim(), cantidad: parseNum(l.cantidad), precio: parseNum(l.precio), iva: +l.iva }));
  if (!lineas.length) return 'Añade al menos un concepto.';
  if (lineas.some(l => !l.concepto)) return 'Hay un concepto sin descripción.';
  if (lineas.some(l => !Number.isFinite(l.cantidad) || !Number.isFinite(l.precio))) return 'Hay una cantidad o un precio que no es un número.';
  const extras = (f.extras || []).map(x => ({ id: x.id, clave: String(x.clave || '').trim(), valor: String(x.valor || '').trim() }))
    .filter(x => x.valor); // un dato sin valor (p. ej. Matrícula vacía) simplemente no se imprime
  if (extras.some(x => !x.clave)) return 'Hay un dato adicional con valor pero sin nombre (por ejemplo, Matrícula).';
  const ret = parseNum(f.retencionTipo);
  if (!Number.isFinite(ret) || ret < 0 || ret > 100) return 'La retención no es válida.';

  const serieCodigo = disp.serie + (f.tipo === 'R' ? 'R' : '');
  const anio = +f.fecha.slice(0, 4);
  const emitidas = (await DB.all('facturas')).filter(x => x.estado === 'emitida');
  const mismaSerie = emitidas.filter(x => x.serieCodigo === serieCodigo && x.anio === anio);
  const numero = mismaSerie.reduce((m, x) => Math.max(m, x.numero), 0) + 1;
  const ultimaFecha = mismaSerie.reduce((m, x) => (x.fecha > m ? x.fecha : m), '');
  if (f.fecha < ultimaFecha) return `La fecha no puede ser anterior a la última factura de la serie ${serieCodigo} (${fecha(ultimaFecha)}).`;

  const codigo = `${serieCodigo}-${anio}-${String(numero).padStart(4, '0')}`;
  if (!confirm(`Se emitirá con el número ${codigo}. Después no podrás modificarla. ¿Emitir?`)) return null;

  const cadena = emitidas.filter(x => x.serie === disp.serie).sort(ordenCadena);
  const totales = calcTotales(lineas, ret); delete totales.valido;
  const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k] || '']));
  const g = {
    ...f, estado: 'emitida', serie: disp.serie, serieCodigo, anio, numero, codigo, lineas, extras,
    retencionTipo: ret, totales,
    emisorSnap: pick(emisor, ['nombre', 'nif', 'direccion', 'cp', 'poblacion', 'provincia', 'email', 'telefono', 'iban', 'pie']),
    clienteSnap: pick(cliente, ['nombre', 'nif', 'direccion', 'cp', 'poblacion', 'provincia', 'pais', 'email', 'telefono']),
    emitidaEn: ahora(), hashAnterior: cadena.at(-1)?.hash || '',
  };
  g.hash = await sha256(canon(contenidoHash(g)));
  g.actualizado = g.emitidaEn;
  await DB.put('facturas', g);
  sessionStorage.setItem('recienEmitida', g.id);
  toast(`Factura ${codigo} emitida`);
  router();
  return null;
}

async function vistaClientes() {
  const [clientes, facturas] = await Promise.all([DB.all('clientes'), DB.all('facturas')]);
  clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const n = new Map();
  facturas.filter(f => f.estado === 'emitida').forEach(f => n.set(f.clienteId, (n.get(f.clienteId) || 0) + 1));
  app.innerHTML = `
    <div class="head-row"><h1>Clientes</h1><a class="btn primary" href="#/cliente/nuevo">Nuevo cliente</a></div>
    ${clientes.length ? `<input class="search" type="search" placeholder="Buscar por nombre o NIF" aria-label="Buscar clientes" id="buscar">
      <ul class="list">${clientes.map(c => `<li><a class="item" href="#/cliente/${c.id}" data-buscar="${esc((c.nombre + ' ' + c.nif).toLowerCase())}">
        <span class="t">${esc(c.nombre)}</span><span class="s">${n.get(c.id) || 0} facturas</span>
        <span class="s">NIF ${esc(c.nif)}</span><span class="s">${esc(c.poblacion || '')}</span></a></li>`).join('')}</ul>`
      : `<p class="empty">Aún no hay clientes. Añade el primero para poder facturarle.</p>`}`;
  $('#buscar')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $$('a.item', app).forEach(a => { a.parentElement.hidden = q && !a.dataset.buscar.includes(q); });
  });
}

async function vistaCliente(id, params) {
  const nuevo = id === 'nuevo';
  const c = nuevo ? { id: uuid(), nombre: '', nif: '', direccion: '', cp: '', poblacion: '', provincia: '', pais: 'España', email: '', telefono: '' } : await DB.get('clientes', id);
  if (!c) { app.innerHTML = `<h1>No encontrado</h1><a class="btn" href="#/clientes">Volver a clientes</a>`; return; }
  const usado = !nuevo && (await DB.all('facturas')).some(f => f.clienteId === c.id);
  const volver = params.get('volver');
  const campo = (k, etiqueta, extra = '') => `<div ${extra.includes('span-2') ? 'class="span-2"' : ''}><label for="${k}">${etiqueta}</label><input id="${k}" name="${k}" value="${esc(c[k])}" ${extra.replace('span-2', '')}></div>`;

  app.innerHTML = `
    <h1>${nuevo ? 'Nuevo cliente' : esc(c.nombre)}</h1>
    <form id="form" class="stack" novalidate>
      <div class="grid two">
        ${campo('nombre', 'Nombre completo o razón social', 'span-2 required autocomplete="name"')}
        <div><label for="nif">DNI, NIE o CIF</label><input id="nif" name="nif" value="${esc(c.nif)}" autocapitalize="characters" required><div class="hint" id="nif-hint"></div></div>
        ${campo('telefono', 'Teléfono', 'type="tel" autocomplete="tel"')}
        ${campo('direccion', 'Dirección (calle, número, piso)', 'span-2 required autocomplete="street-address"')}
        ${campo('cp', 'Código postal', 'inputmode="numeric" autocomplete="postal-code"')}
        ${campo('poblacion', 'Población', 'autocomplete="address-level2"')}
        ${campo('provincia', 'Provincia', 'autocomplete="address-level1"')}
        ${campo('pais', 'País', 'autocomplete="country-name"')}
        ${campo('email', 'Email', 'span-2 type="email" autocomplete="email"')}
      </div>
      <div class="row">
        <button type="submit" class="primary">Guardar cliente</button>
        <a class="btn" href="${volver ? '#/factura/' + esc(volver) : '#/clientes'}">Cancelar</a>
        ${!nuevo ? `<a class="btn" href="#/factura/nueva?cliente=${c.id}">Facturar a este cliente</a>` : ''}
        ${!nuevo && !usado ? `<button type="button" class="danger" id="borrar">Eliminar cliente</button>` : ''}
      </div>
      ${usado ? `<p class="muted small">Este cliente tiene facturas, así que no se puede eliminar. Los cambios que hagas no alteran las facturas ya emitidas.</p>` : ''}
    </form>`;

  const hint = () => {
    const r = validarNif($('#nif').value);
    $('#nif-hint').textContent = r.msg;
    $('#nif-hint').className = 'hint' + (r.msg && !r.ok ? ' bad' : '');
  };
  $('#nif').addEventListener('input', hint); hint();

  $('#form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    for (const [k, v] of fd) c[k] = String(v).trim();
    c.nif = normNif(c.nif);
    if (!c.nombre || !c.nif || !c.direccion) { toast('Nombre, NIF y dirección son obligatorios para facturar.'); return; }
    const r = validarNif(c.nif);
    if (!r.ok && !confirm(`${r.msg} ¿Guardar de todas formas?`)) return;
    c.creado ||= ahora(); c.actualizado = ahora();
    await DB.put('clientes', c);
    if (volver) {
      const f = await DB.get('facturas', volver);
      if (f && f.estado === 'borrador') { f.clienteId = c.id; f.actualizado = ahora(); await DB.put('facturas', f); }
      location.hash = '#/factura/' + volver;
    } else {
      toast('Cliente guardado');
      location.hash = '#/clientes';
    }
  };
  $('#borrar')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar a ${c.nombre}?`)) return;
    await DB.del('clientes', c.id);
    location.hash = '#/clientes';
  });
}

async function vistaAjustes() {
  const [emisor = {}, disp, ultima, persistente] = await Promise.all([
    getAjuste('emisor'), getAjuste('dispositivo'), getAjuste('ultimaCopia'),
    navigator.storage?.persisted ? navigator.storage.persisted() : Promise.resolve(null)]);
  const campo = (k, etiqueta, extra = '') => `<div ${extra.includes('span-2') ? 'class="span-2"' : ''}><label for="e-${k}">${etiqueta}</label><input id="e-${k}" name="${k}" value="${esc(emisor[k])}" ${extra.replace('span-2', '')}></div>`;

  app.innerHTML = `
    <h1>Ajustes</h1>

    <h2>Serie de este dispositivo</h2>
    <form id="f-serie" class="stack">
      <p class="muted small">Cada dispositivo numera con su propia serie para que nunca se repitan números. Usa una distinta en cada uno, por ejemplo M en el móvil y P en el portátil. Las rectificativas añaden una R (MR, PR).</p>
      <div class="row">
        <input id="serie" name="serie" value="${esc(disp?.serie || '')}" maxlength="4" autocapitalize="characters" style="max-width:120px" aria-label="Serie" placeholder="M">
        <button type="submit" class="primary">Guardar serie</button>
      </div>
      <p class="hint">Si este dispositivo sustituye a uno roto, importa primero su copia y usa su misma serie para seguir la numeración.</p>
    </form>

    <h2>Tus datos de facturador</h2>
    <form id="f-emisor" class="stack">
      <div class="grid two">
        ${campo('nombre', 'Nombre completo o razón social', 'span-2 required')}
        <div><label for="e-nif">NIF</label><input id="e-nif" name="nif" value="${esc(emisor.nif)}" autocapitalize="characters" required><div class="hint" id="nif-hint"></div></div>
        ${campo('telefono', 'Teléfono', 'type="tel"')}
        ${campo('direccion', 'Dirección', 'span-2 required')}
        ${campo('cp', 'Código postal', 'inputmode="numeric"')}
        ${campo('poblacion', 'Población')}
        ${campo('provincia', 'Provincia')}
        ${campo('email', 'Email', 'type="email"')}
        ${campo('iban', 'IBAN para transferencias (opcional)', 'span-2')}
        <div class="span-2"><label for="e-pie">Texto al pie de las facturas (opcional)</label><textarea id="e-pie" name="pie">${esc(emisor.pie)}</textarea></div>
      </div>
      <button type="submit" class="primary">Guardar datos</button>
      <p class="hint">Aparecen igual en todas las facturas nuevas. Las ya emitidas conservan los datos que tenían.</p>
    </form>

    <h2>Copia de seguridad</h2>
    <p>${ultima ? `Última copia exportada el ${esc(fecha(ultima))}.` : 'Todavía no has exportado ninguna copia.'}</p>
    <p class="muted small">La copia es un archivo con todos los clientes y facturas. Guárdalo en Google Drive o iCloud. Para pasar datos a otro dispositivo, impórtalo allí: se suman sin duplicar nada.</p>
    <div class="row">
      <button type="button" class="primary" id="exportar">Exportar copia</button>
      <label class="btn" style="margin:0;color:var(--text)">Importar copia<input type="file" id="importar" accept="application/json,.json" hidden></label>
    </div>
    <div id="res-import" class="small" style="margin-top:10px"></div>

    <h2>Registro de facturas</h2>
    <p class="muted small">Cada factura emitida guarda una huella que la encadena con la anterior. Si alguien alterase una factura, la comprobación lo detectaría.</p>
    <button type="button" id="verificar">Comprobar registro</button>
    <div id="res-verif" class="small" style="margin-top:10px"></div>

    <h2>Almacenamiento</h2>
    <p class="small">${persistente === true ? 'El navegador ha marcado los datos como persistentes.' :
      'El navegador podría borrar los datos si le falta espacio. Instala la app en la pantalla de inicio y exporta copias con frecuencia.'}</p>
    <p class="muted small">Versión ${APP_VERSION}</p>`;

  const hint = () => {
    const r = validarNif($('#e-nif').value);
    $('#nif-hint').textContent = r.msg;
    $('#nif-hint').className = 'hint' + (r.msg && !r.ok ? ' bad' : '');
  };
  $('#e-nif').addEventListener('input', hint); hint();

  $('#f-serie').onsubmit = async e => {
    e.preventDefault();
    const s = $('#serie').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(s)) { toast('La serie debe tener de 1 a 4 letras o números.'); return; }
    if (s.endsWith('R')) { toast('La serie no puede terminar en R: esa letra se reserva para las rectificativas.'); return; }
    if (disp?.serie && disp.serie !== s && !confirm(`Las próximas facturas de este dispositivo usarán la serie ${s} en lugar de ${disp.serie}. ¿Continuar?`)) return;
    await setAjuste('dispositivo', { serie: s, desde: disp?.desde || ahora() });
    toast(`Serie ${s} guardada`);
  };
  $('#f-emisor').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, String(v).trim()]));
    d.nif = normNif(d.nif);
    d.iban = d.iban.toUpperCase().replace(/\s+/g, ' ');
    if (!d.nombre || !d.nif || !d.direccion) { toast('Nombre, NIF y dirección son obligatorios.'); return; }
    await setAjuste('emisor', d);
    toast('Datos guardados');
  };
  $('#exportar').onclick = exportarCopia;
  $('#importar').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = await importarCopia(file);
      $('#res-import').innerHTML = r;
    } catch (err) {
      $('#res-import').innerHTML = `<span class="badline">${esc(err.message)}</span>`;
    }
  };
  $('#verificar').onclick = async () => {
    const res = await verificarRegistros();
    if (!res.length) { $('#res-verif').textContent = 'No hay facturas emitidas.'; return; }
    $('#res-verif').innerHTML = res.map(r => r.problemas.length
      ? r.problemas.map(p => `<div class="badline">${esc(p)}</div>`).join('')
      : `<div class="okline">Serie ${esc(r.serie)}: ${r.total} facturas correctas.</div>`).join('');
  };
}

/* ============================================================
   Copias de seguridad
   ============================================================ */
async function exportarCopia() {
  const [emisor, disp, clientes, facturas] = await Promise.all([getAjuste('emisor'), getAjuste('dispositivo'), DB.all('clientes'), DB.all('facturas')]);
  const datos = { app: FORMATO_COPIA, formato: 1, version: APP_VERSION, exportado: ahora(), serieDispositivo: disp?.serie || '', emisor: emisor || null, clientes, facturas };
  const nombre = `facturas-copia-${hoy()}-${disp?.serie || 'sin-serie'}.json`;
  const file = new File([JSON.stringify(datos, null, 1)], nombre, { type: 'application/json' });
  const tactil = matchMedia('(pointer: coarse)').matches;
  if (tactil && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: nombre });
    } catch (e) {
      if (e.name === 'AbortError') return;
      descargar(file);
    }
  } else {
    descargar(file);
  }
  await setAjuste('ultimaCopia', ahora());
  toast('Copia exportada. Guárdala en Drive o iCloud.');
  if (location.hash.startsWith('#/facturas') || location.hash === '' || location.hash.startsWith('#/ajustes')) router();
}
function descargar(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importarCopia(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch { throw new Error('El archivo no es una copia válida.'); }
  if (d?.app !== FORMATO_COPIA || !Array.isArray(d.clientes) || !Array.isArray(d.facturas)) throw new Error('El archivo no es una copia de esta app.');

  const [locClientes, locFacturas, emisor, disp] = await Promise.all([DB.all('clientes'), DB.all('facturas'), getAjuste('emisor'), getAjuste('dispositivo')]);
  const locC = new Map(locClientes.map(c => [c.id, c]));
  const locF = new Map(locFacturas.map(f => [f.id, f]));
  const putC = [], putF = [], conflictos = [];
  let nC = 0, aC = 0, nF = 0, aF = 0;

  for (const c of d.clientes) {
    if (!c?.id || !c.nombre) continue;
    const l = locC.get(c.id);
    if (!l) { putC.push(c); nC++; } else if ((c.actualizado || '') > (l.actualizado || '')) { putC.push(c); aC++; }
  }
  for (const f of d.facturas) {
    if (!f?.id || !Array.isArray(f.lineas)) continue;
    const l = locF.get(f.id);
    if (!l) { putF.push(f); nF++; continue; }
    if (l.estado === 'borrador' && f.estado === 'emitida') { putF.push(f); aF++; }
    else if (l.estado === 'borrador' && f.estado === 'borrador' && (f.actualizado || '') > (l.actualizado || '')) { putF.push(f); aF++; }
    else if (l.estado === 'emitida' && f.estado === 'emitida' && l.hash !== f.hash) conflictos.push(l.codigo);
  }

  // Números repetidos con facturas distintas: dos dispositivos con la misma serie
  const final = new Map(locF); putF.forEach(f => final.set(f.id, f));
  const porCodigo = new Map(), repetidos = new Set();
  for (const f of final.values()) {
    if (f.estado !== 'emitida') continue;
    if (porCodigo.has(f.codigo)) repetidos.add(f.codigo);
    porCodigo.set(f.codigo, f.id);
  }

  if (d.emisor) {
    if (!emisor) await setAjuste('emisor', d.emisor);
    else if (canon(emisor) !== canon(d.emisor) && confirm('La copia trae datos de facturador distintos a los de este dispositivo. ¿Usar los de la copia?')) await setAjuste('emisor', d.emisor);
  }
  if (!disp && d.serieDispositivo && confirm(`¿Este dispositivo sustituye al que usaba la serie ${d.serieDispositivo}? Si aceptas, seguirá su numeración. Si es un dispositivo adicional, cancela y elige otra serie.`)) {
    await setAjuste('dispositivo', { serie: d.serieDispositivo, desde: ahora() });
  }

  await DB.putMany({ clientes: putC, facturas: putF });
  const lineas = [
    `<div class="okline">Importado: ${nC} clientes nuevos, ${aC} actualizados, ${nF} facturas nuevas, ${aF} actualizadas.</div>`,
    ...conflictos.map(c => `<div class="badline">La factura ${esc(c)} es distinta en la copia y en este dispositivo. Se ha mantenido la de este dispositivo.</div>`),
    ...[...repetidos].map(c => `<div class="badline">El número ${esc(c)} aparece en dos facturas distintas. Revisa que cada dispositivo tenga su propia serie.</div>`),
  ];
  return lineas.join('');
}

/* ============================================================
   Navegación
   ============================================================ */
async function router() {
  if (guardarPendiente) await guardarPendiente();
  const [ruta, query] = (location.hash || '#/facturas').slice(1).split('?');
  const partes = ruta.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  const seccion = { factura: 'facturas', cliente: 'clientes' }[partes[0]] || partes[0] || 'facturas';
  $$('.tabs a').forEach(a => { if (a.dataset.tab === seccion) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

  try {
    switch (partes[0]) {
      case 'factura':
        if (partes[1] === 'nueva') return await crearBorrador({ clienteId: params.get('cliente') || '' });
        await vistaFactura(partes[1], partes[2]); break;
      case 'clientes': await vistaClientes(); break;
      case 'cliente': await vistaCliente(partes[1], params); break;
      case 'ajustes': await vistaAjustes(); break;
      default: await vistaFacturas();
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<h1>Algo ha fallado</h1><p>${esc(err.message)}</p><a class="btn" href="#/facturas">Volver a facturas</a>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', router);
window.addEventListener('pagehide', () => { guardarPendiente?.(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') guardarPendiente?.(); });

if (!window.isSecureContext || !crypto.subtle) {
  app.innerHTML = `<h1>Abre la app desde su dirección web</h1><p>Esta app necesita abrirse por https (por ejemplo, desde GitHub Pages) o desde localhost. Abriendo el archivo directamente no puede guardar datos ni funcionar sin conexión.</p>`;
} else {
  navigator.storage?.persist?.().catch(() => {});
  router();
}

/* ============================================================
   Funcionamiento sin conexión (service worker)
   ============================================================ */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', async () => {
    const habiaVersion = !!navigator.serviceWorker.controller; // en la primera visita no hay que recargar
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const avisar = w => toast('Hay una versión nueva de la app.', 'Actualizar', () => w.postMessage('activar'), true);
      if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) avisar(w); });
      });
      let recargando = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (recargando || !habiaVersion) return;
        recargando = true;
        location.reload();
      });
    } catch (e) {
      console.warn('No se pudo activar el modo sin conexión', e);
    }
  });
}
