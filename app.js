'use strict';

const APP_VERSION = '1.7.0';

// Google Drive: pega aquí el ID de cliente OAuth de tu proyecto de Google Cloud (ver README).
// No es secreto: identifica la app ante Google, pero no da acceso a ningún dato.
const GOOGLE_CLIENT_ID = '1090950721739-uikb3jcqjfrj9qvvf0t8r8rggdltipvu.apps.googleusercontent.com';
const NUBE_SCOPE = 'https://www.googleapis.com/auth/drive.file'; // solo ve los archivos que crea esta app
const NUBE_NOMBRE = 'Facturas - datos (no borrar).json';
const NUBE_CARPETA = 'FACTURAS TALLER'; // carpeta del Drive donde va el archivo de datos
const CARPETA_MIME = 'application/vnd.google-apps.folder';
const GAPI = 'https://www.googleapis.com';
const FORMATO_COPIA = 'facturas-offline';
const IVA_TIPOS = [21, 10, 4, 0];
const ALMACENES = ['ajustes', 'clientes', 'facturas', 'presupuestos'];
const SERIE_PRESUPUESTOS = 'PRE';

/* ============================================================
   Base de datos local (IndexedDB)
   ============================================================ */
const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('facturas-db', 2);
        r.onupgradeneeded = e => {
          const db = r.result;
          if (e.oldVersion < 1) {
            db.createObjectStore('ajustes', { keyPath: 'clave' });
            db.createObjectStore('clientes', { keyPath: 'id' });
            db.createObjectStore('facturas', { keyPath: 'id' });
          }
          if (e.oldVersion < 2) db.createObjectStore('presupuestos', { keyPath: 'id' });
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
    async vaciar() { // quita todos los datos de este dispositivo (al cambiar de cuenta de Google)
      const db = await open();
      const t = db.transaction(ALMACENES, 'readwrite');
      for (const s of ALMACENES) t.objectStore(s).clear();
      return done(t);
    },
  };
})();

const getAjuste = async clave => (await DB.get('ajustes', clave))?.valor;
const setAjuste = (clave, valor) => DB.put('ajustes', { clave, valor });
// Serie de facturación común a todos los dispositivos de la cuenta. Viaja con los datos de Drive.
const getSerie = async () => (await getAjuste('serie'))?.serie || '';
async function migrarSerie() { // versiones anteriores guardaban una serie por dispositivo
  if (await getAjuste('serie')) return;
  const d = await getAjuste('dispositivo');
  if (d?.serie) await setAjuste('serie', { serie: d.serie, actualizado: '' }); // fecha vacía: la de Drive manda
}
async function marcarEliminado(id) {
  const e = (await getAjuste('eliminados')) || {};
  e[id] = new Date().toISOString();
  await setAjuste('eliminados', e);
}

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
const fmtFechaHora = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const eur = cents => fmtEur.format(cents / 100);
const fechaCorta = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
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
   Comparar datos: misma representación sea cual sea el orden de las claves
   ============================================================ */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}
const porEmision = (a, b) => (a.emitidaEn || '').localeCompare(b.emitidaEn || '') || a.codigo.localeCompare(b.codigo);

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
   Documento de factura en pantalla (el PDF se maqueta aparte, en pdfDocumento)
   ============================================================ */
function lineasDireccion(o) {
  if (!o) return [];
  const loc = [o.cp, o.poblacion].filter(Boolean).join(' ') + (o.provincia ? ` (${o.provincia})` : '');
  return [o.direccion, loc, o.pais && o.pais !== 'España' ? o.pais : ''].filter(s => s && s.trim());
}
// La factura lleva la forma de pago si tiene marcada la casilla (las anteriores a la casilla, siempre) y hay IBAN
const llevaFormaPago = d => d.clase !== 'presupuesto' && d.formaPago !== false && !!d.emisor?.iban;
const datosParte = o => [`NIF ${o.nif}`, ...lineasDireccion(o), [o.email, o.telefono].filter(Boolean).join('  ·  ')].filter(Boolean);
const extrasValidos = ex => (ex || []).filter(x => String(x.clave || '').trim() && String(x.valor || '').trim());
// Importe de una línea con su IVA (solo para mostrar: los totales se calculan por tipo de IVA)
function lineaConIva(l) {
  const b = baseLinea(l);
  return Number.isNaN(b) ? NaN : b + r2(b * (Number(l.iva) || 0) / 100);
}
// Filas del recuadro de totales (sin el total): [etiqueta, importe]
function filasTotales(t) {
  const unTipo = t.desglose.length === 1;
  return [
    ...t.desglose.flatMap(x => [[`Base imponible${unTipo ? '' : ` al ${x.tipo} %`}`, eur(x.base)], [`IVA ${x.tipo} %`, eur(x.cuota)]]),
    ...(t.retencion ? [[`Retención IRPF ${fmtNum.format(t.retencionTipo)} %`, '−' + eur(t.retencion)]] : []),
  ];
}
// Misma composición que el PDF (pdfDocumento), adaptada a la pantalla
function docHtml(d) {
  const t = d.totales;
  const esPres = d.clase === 'presupuesto';
  const sello = esPres ? '' : d.borrador
    ? `<div class="stamp draft">Borrador</div>`
    : `<div class="stamp${d.fresca ? ' fresh' : ''}">Emitida</div>`;
  const extras = extrasValidos(d.extras);
  const e = d.emisor, c = d.cliente;
  const meta = [['Nº', d.codigo || 'Pendiente de emitir'], ['Fecha', fechaCorta(d.fecha)],
    ...(esPres && d.validoHasta ? [['Válido hasta', fechaCorta(d.validoHasta)]] : []),
    ...(d.fechaOperacion && d.fechaOperacion !== d.fecha ? [['Fecha de la operación', fechaCorta(d.fechaOperacion)]] : [])];
  return `<article class="doc">
    <header class="doc-cabecera">
      <div class="doc-emisor">${e ? `<div class="doc-emisor-nombre">${esc(e.nombre)}</div>
        ${datosParte(e).map(l => `<div>${esc(l)}</div>`).join('')}` : '<div class="doc-emisor-nombre">Faltan tus datos de facturador</div>'}</div>
      <div class="doc-meta">
        <p class="doc-title">${esPres ? 'Presupuesto' : d.tipo === 'R' ? 'Factura rectificativa' : 'Factura'}</p>
        <dl>${meta.map(([k, v], i) => `<dt>${esc(k)}</dt><dd${i ? '' : ' class="doc-codigo"'}>${esc(v)}</dd>`).join('')}</dl>
        ${sello}
      </div>
    </header>
    <div class="doc-partes">
      <div class="doc-cliente">
        <p class="doc-etiqueta">${esPres ? 'Cliente' : 'Facturar a'}</p>
        ${c ? `<div class="doc-cliente-nombre">${esc(c.nombre)}</div>${datosParte(c).map(l => `<div>${esc(l)}</div>`).join('')}` : '<p class="muted">Sin indicar</p>'}
      </div>
      ${extras.length ? `<div class="doc-extras">${extras.map(x => `<div><span class="doc-etiqueta">${esc(x.clave)}</span><strong>${esc(x.valor)}</strong></div>`).join('')}</div>` : ''}
    </div>
    ${d.tipo === 'R' ? `<p class="doc-rectifica">Rectifica la factura <strong>${esc(d.rectificaCodigo)}</strong> (rectificación por diferencias).${d.motivo ? ` Motivo: ${esc(d.motivo)}` : ''}</p>` : ''}
    <div class="tablewrap"><table class="doc-lineas">
      <thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio sin IVA</th><th class="num">IVA</th><th class="num">Total con IVA</th></tr></thead>
      <tbody>${d.lineas.map(l => {
        const ci = lineaConIva(l);
        return `<tr><td>${esc(l.concepto)}</td><td class="num">${fmtNum.format(parseNum(l.cantidad) || 0)}</td>
          <td class="num">${fmtPrecio.format(parseNum(l.precio) || 0)}</td><td class="num doc-gris">${esc(l.iva)} %</td>
          <td class="num"><b>${Number.isNaN(ci) ? '—' : eur(ci)}</b></td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="doc-pie">
      <div class="doc-izq">
        ${llevaFormaPago(d) ? `<p class="doc-etiqueta">Forma de pago</p><p>Transferencia bancaria<br><span class="doc-gris">IBAN</span> <b>${esc(e.iban)}</b></p>` : ''}
        ${d.notas ? `<p class="doc-etiqueta">Notas</p><p>${esc(d.notas).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
      <div class="doc-totals">
        <table><tbody>${filasTotales(t).map(([k, v]) => `<tr><th>${esc(k)}</th><td class="num">${esc(v)}</td></tr>`).join('')}</tbody></table>
        <div class="doc-total"><span>Total</span><span class="num">${eur(t.total)}</span></div>
      </div>
    </div>
  </article>`;
}
function datosDocEmitida(f, fresca = false) {
  return {
    tipo: f.tipo, codigo: f.codigo, fecha: f.fecha, fechaOperacion: f.fechaOperacion,
    emisor: f.emisorSnap, cliente: f.clienteSnap, lineas: f.lineas, totales: f.totales,
    extras: f.extras, notas: f.notas, rectificaCodigo: f.rectificaCodigo, motivo: f.motivo, formaPago: f.formaPago, fresca,
  };
}

/* ============================================================
   Factura y presupuesto en PDF. Se maquetan aquí con pdf.js, en puntos exactos sobre un A4, así que
   salen iguales en cualquier navegador y no se cortan al imprimir. Si no caben en una hoja, se reparten
   en varias: cada una repite la cabecera de la tabla y el recuadro de totales va al pie de la última.
   ============================================================ */
function pdfDocumento(d) {
  const { Documento, envolver, A4, mm } = PDF;
  const pdf = new Documento();
  const esPres = d.clase === 'presupuesto';
  const titulo = esPres ? 'PRESUPUESTO' : d.tipo === 'R' ? 'FACTURA RECTIFICATIVA' : 'FACTURA';
  // Un solo color de acento (el azul de la app), texto casi negro y grises para lo secundario.
  // Todo en Helvetica: limpia, legible y con todas las cifras del mismo ancho, así los importes cuadran.
  const ACENTO = [0.11, 0.17, 0.35], TEXTO = 0.1, SECUNDARIO = 0.4, LINEA = 0.8, FONDO = [0.93, 0.945, 0.965];
  const X = mm(18), DER = A4.ancho - mm(18), W = DER - X;
  const ARRIBA = mm(16), ABAJO = A4.alto - mm(22); // zona útil; debajo va el pie de página
  const t = d.totales, e = d.emisor || {}, cli = d.cliente;
  const extras = extrasValidos(d.extras);
  const etiqueta = (x, y, s, opc = {}) => pdf.texto(x, y, s, { fuente: 'sansNegrita', tamano: 7.5, espaciado: 0.8, color: SECUNDARIO, ...opc });
  // Escribe líneas a partir de la línea base y; devuelve dónde iría la siguiente
  const escribir = (x, y, lineas, { fuente = 'sans', tamano = 9.5, interlinea = 13, color = TEXTO, alinear } = {}) => {
    lineas.forEach((l, i) => pdf.texto(x, y + i * interlinea, l, { fuente, tamano, color, alinear }));
    return y + lineas.length * interlinea;
  };
  const partir = (lineas, fuente, tamano, max) => lineas.flatMap(l => envolver(l, fuente, tamano, max));
  let y = ARRIBA;

  // Membrete: el taller a la izquierda; tipo de documento, número y fechas a la derecha
  const anchoMembrete = W * 0.52;
  let yi = escribir(X, y + 15, envolver(e.nombre || '', 'sansNegrita', 15, anchoMembrete), { fuente: 'sansNegrita', tamano: 15, interlinea: 18 });
  yi = escribir(X, yi + 1, partir(datosParte(e), 'sans', 9, anchoMembrete), { tamano: 9, interlinea: 12, color: SECUNDARIO });
  pdf.texto(DER, y + 20, titulo, { fuente: 'sansNegrita', tamano: titulo.length > 12 ? 17 : 24, espaciado: 1.2, color: ACENTO, alinear: 'derecha' });
  const meta = [['Nº', d.codigo || 'Pendiente de emitir'], ['Fecha', fechaCorta(d.fecha)],
    ...(esPres && d.validoHasta ? [['Válido hasta', fechaCorta(d.validoHasta)]] : []),
    ...(d.fechaOperacion && d.fechaOperacion !== d.fecha ? [['Fecha de la operación', fechaCorta(d.fechaOperacion)]] : [])];
  let yd = y + 44;
  for (const [k, v] of meta) {
    etiqueta(DER - 175, yd, k.toUpperCase());
    pdf.texto(DER, yd, v, { fuente: 'sansNegrita', tamano: k === 'Nº' ? 12 : 10, alinear: 'derecha', color: TEXTO });
    yd += 17;
  }
  y = Math.max(yi, yd) + 6;
  pdf.linea(X, y, DER, y, { grosor: 2, color: ACENTO });
  y += 24;

  // Cliente a la izquierda; datos adicionales (matrícula…) en un recuadro a la derecha
  const anchoExtras = 190, xExtras = DER - anchoExtras;
  const anchoCliente = (extras.length ? xExtras - 20 : DER) - X;
  etiqueta(X, y, esPres ? 'CLIENTE' : 'FACTURAR A', { color: ACENTO });
  let yc = y + 18;
  if (cli) {
    yc = escribir(X, yc, envolver(cli.nombre, 'sansNegrita', 12, anchoCliente), { fuente: 'sansNegrita', tamano: 12, interlinea: 15 });
    yc = escribir(X, yc + 1, partir(datosParte(cli), 'sans', 9.5, anchoCliente), { interlinea: 13 });
  } else yc = escribir(X, yc, ['Sin indicar'], { color: SECUNDARIO });
  if (extras.length) {
    const filas = extras.map(x => ({ clave: x.clave.toUpperCase(), valor: envolver(x.valor, 'sansNegrita', 13, anchoExtras - 28) }));
    const alto = 12 + filas.reduce((s, f) => s + 12 + f.valor.length * 16, 0) + 4;
    const yb = y - 12;
    pdf.rect(xExtras, yb, anchoExtras, alto, { borde: TEXTO, grosor: 1.5, radio: 4 });
    let yy = yb + 12;
    for (const f of filas) {
      etiqueta(xExtras + 14, yy + 7, f.clave);
      yy = escribir(xExtras + 14, yy + 23, f.valor, { fuente: 'sansNegrita', tamano: 13, interlinea: 16 }) - 16 + 4 + 12;
    }
    yc = Math.max(yc, yb + alto + 10);
  }
  y = yc + 8;
  if (d.tipo === 'R') {
    const lineas = envolver(`Rectifica la factura ${d.rectificaCodigo} (rectificación por diferencias).${d.motivo ? ` Motivo: ${d.motivo}` : ''}`, 'sans', 9.5, W - 24);
    const alto = 14 + lineas.length * 13;
    pdf.rect(X, y, W, alto, { relleno: FONDO, radio: 3 });
    escribir(X + 12, y + 7 + 9, lineas);
    y += alto + 12;
  }

  // Tabla de conceptos
  const COL = { cant: DER - 245, precio: DER - 150, iva: DER - 98, total: DER - 10 }; // borde derecho de cada columna
  const anchoConcepto = COL.cant - 40 - (X + 10);
  const cabeceraTabla = () => {
    pdf.rect(X, y, W, 22, { relleno: FONDO, radio: 3 });
    const c = { fuente: 'sansNegrita', tamano: 7.5, espaciado: 0.6, color: ACENTO };
    pdf.texto(X + 10, y + 14.3, 'CONCEPTO', c);
    pdf.texto(COL.cant, y + 14.3, 'CANT.', { ...c, alinear: 'derecha' });
    pdf.texto(COL.precio, y + 14.3, 'PRECIO SIN IVA', { ...c, alinear: 'derecha' });
    pdf.texto(COL.iva, y + 14.3, 'IVA', { ...c, alinear: 'derecha' });
    pdf.texto(COL.total, y + 14.3, 'TOTAL CON IVA', { ...c, alinear: 'derecha' });
    y += 22;
  };
  const nuevaHoja = () => {
    pdf.nuevaPagina();
    y = ARRIBA;
    etiqueta(X, y + 8, `${titulo} ${d.codigo || ''}  ·  CONTINUACIÓN`, { color: ACENTO });
    y += 22;
  };
  cabeceraTabla();
  for (const l of d.lineas) {
    const lineas = envolver(l.concepto, 'sans', 9.5, anchoConcepto);
    const alto = 11 + lineas.length * 12.5;
    if (y + alto > ABAJO) { nuevaHoja(); cabeceraTabla(); }
    const base = y + 6 + 7.6;
    escribir(X + 10, base, lineas, { interlinea: 12.5 });
    const c = lineaConIva(l);
    pdf.texto(COL.cant, base, fmtNum.format(parseNum(l.cantidad) || 0), { tamano: 9.5, alinear: 'derecha', color: TEXTO });
    pdf.texto(COL.precio, base, fmtPrecio.format(parseNum(l.precio) || 0), { tamano: 9.5, alinear: 'derecha', color: TEXTO });
    pdf.texto(COL.iva, base, `${l.iva} %`, { tamano: 9.5, alinear: 'derecha', color: SECUNDARIO });
    pdf.texto(COL.total, base, Number.isNaN(c) ? '—' : eur(c), { fuente: 'sansNegrita', tamano: 9.5, alinear: 'derecha', color: TEXTO });
    y += alto;
    pdf.linea(X, y, DER, y, { grosor: 0.6, color: LINEA });
  }

  // Pie del documento, al final de la última hoja: forma de pago y notas a la izquierda, totales a la derecha
  const filas = filasTotales(t);
  const anchoTot = 232, xTot = DER - anchoTot;
  const altoTot = 14 + filas.length * 18 + 8 + 32 + 7;
  const anchoIzq = xTot - 24 - X;
  const iban = llevaFormaPago(d);
  const notas = d.notas ? envolver(d.notas, 'sans', 9.5, anchoIzq) : [];
  const altoIzq = (iban ? 52 : 0) + (notas.length ? 18 + notas.length * 13 + 6 : 0);
  const altoPie = Math.max(altoTot, altoIzq);
  if (y + 28 + altoPie > ABAJO) nuevaHoja();
  const yPie = ABAJO - altoPie;
  let yIzq = yPie + 8;
  if (iban) {
    etiqueta(X, yIzq, 'FORMA DE PAGO', { color: ACENTO });
    pdf.texto(X, yIzq + 16, 'Transferencia bancaria', { tamano: 9.5, color: TEXTO });
    const w = pdf.texto(X, yIzq + 30, 'IBAN ', { tamano: 9.5, color: SECUNDARIO });
    pdf.texto(X + w, yIzq + 30, e.iban, { fuente: 'sansNegrita', tamano: 9.5, color: TEXTO });
    yIzq += 52;
  }
  if (notas.length) {
    etiqueta(X, yIzq, 'NOTAS', { color: ACENTO });
    escribir(X, yIzq + 16, notas);
  }
  pdf.rect(xTot, yPie, anchoTot, altoTot, { borde: TEXTO, grosor: 1.5, radio: 4 });
  let yy = yPie + 14;
  for (const [k, v] of filas) {
    pdf.texto(xTot + 14, yy + 9, k, { fuente: 'sansNegrita', tamano: 9.5, color: TEXTO });
    pdf.texto(DER - 14, yy + 9, v, { tamano: 9.5, alinear: 'derecha', color: TEXTO });
    yy += 18;
  }
  yy += 8;
  pdf.rect(xTot + 7, yy, anchoTot - 14, 32, { relleno: ACENTO, radio: 3 });
  pdf.texto(xTot + 16, yy + 21, 'TOTAL', { fuente: 'sansNegrita', tamano: 13, espaciado: 1, color: 1 });
  pdf.texto(DER - 16, yy + 21.5, eur(t.total), { fuente: 'sansNegrita', tamano: 16, alinear: 'derecha', color: 1 });

  // Pie de página en todas las hojas: quién emite y número de hoja
  const n = pdf.paginas.length;
  for (let i = 1; i <= n; i++) {
    pdf.irAPagina(i);
    const yLinea = A4.alto - mm(15);
    pdf.linea(X, yLinea, DER, yLinea, { grosor: 0.6, color: LINEA });
    pdf.texto(X, yLinea + 13, [e.nombre, e.nif && `NIF ${e.nif}`].filter(Boolean).join('  ·  '), { tamano: 7.5, color: SECUNDARIO });
    pdf.texto(DER, yLinea + 13, `Página ${i} de ${n}`, { tamano: 7.5, color: SECUNDARIO, alinear: 'derecha' });
  }
  return pdf.generar(`${esPres ? 'Presupuesto' : 'Factura'} ${d.codigo || ''}`);
}

const archivoPdf = (datos, nombre) => new File([pdfDocumento(datos)], `${nombre}.pdf`, { type: 'application/pdf' });
// En el móvil abre el menú de compartir (imprimir, guardar en Archivos, enviar); en el ordenador, el visor de PDF
function abrirPdf(datos, nombre) {
  const archivo = archivoPdf(datos, nombre);
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [archivo] })) {
    navigator.share({ files: [archivo], title: nombre }).catch(e => { if (e.name !== 'AbortError') descargar(archivo); });
    return;
  }
  const url = URL.createObjectURL(archivo);
  if (!window.open(url, '_blank')) descargar(archivo);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const botonesPdf = `
      <button type="button" class="primary" id="pdf-abrir">Abrir PDF para imprimir</button>
      <button type="button" id="pdf-descargar">Descargar PDF</button>`;

/* ============================================================
   Vistas
   ============================================================ */
let guardarPendiente = null; // vacía el autoguardado al cambiar de pantalla

async function cambiosSinCopia() {
  const [ultima, facturas, clientes, presupuestos] = await Promise.all([getAjuste('ultimaCopia'), DB.all('facturas'), DB.all('clientes'), DB.all('presupuestos')]);
  const ultimoCambio = [...facturas.map(f => f.emitidaEn || f.actualizado || ''), ...[...clientes, ...presupuestos].map(c => c.actualizado || '')]
    .reduce((m, x) => (x > m ? x : m), '');
  return ultimoCambio && (!ultima || ultimoCambio > ultima);
}

async function vistaFacturas() {
  const [facturas, clientes, emisor, serie, sinCopia] = await Promise.all([
    DB.all('facturas'), DB.all('clientes'), getAjuste('emisor'), getSerie(), cambiosSinCopia()]);
  const cli = new Map(clientes.map(c => [c.id, c]));
  const borradores = facturas.filter(f => f.estado === 'borrador').sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
  const emitidas = facturas.filter(f => f.estado === 'emitida').sort((a, b) => b.fecha.localeCompare(a.fecha) || b.codigo.localeCompare(a.codigo));
  const listo = emisor && serie;

  const item = f => {
    const nombre = f.estado === 'emitida' ? f.clienteSnap?.nombre : cli.get(f.clienteId)?.nombre;
    const total = f.estado === 'emitida' ? f.totales.total : calcTotales(f.lineas, f.retencionTipo).total;
    const chip = f.estado === 'borrador' ? '<span class="chip draft">Borrador</span>' : (f.tipo === 'R' ? '<span class="chip rect">Rectificativa</span>' : '');
    return `<li><a class="item" href="#/factura/${esc(f.id)}" data-buscar="${esc([f.codigo, nombre, ...(f.extras || []).map(x => x.valor)].filter(Boolean).join(' ').toLowerCase())}">
      <span class="t">${esc(f.codigo || (f.tipo === 'R' ? 'Rectificativa sin emitir' : 'Factura sin emitir'))} ${chip}</span>
      <span class="num t">${eur(total)}</span>
      <span class="s">${esc(nombre || 'Sin cliente')}</span>
      <span class="s num">${esc(fecha(f.fecha))}</span></a></li>`;
  };

  app.innerHTML = `
    ${!listo ? `<div class="notice">Antes de facturar, rellena tus datos de facturador y elige la serie de facturación.<br><a class="btn primary" href="#/ajustes">Ir a ajustes</a></div>` : ''}
    ${sinCopia ? `<div class="notice">Hay cambios sin guardar en Google Drive.<br><button type="button" class="primary" id="sincronizar">Sincronizar</button></div>` : ''}
    <div class="head-row"><h1>Facturas</h1>
      ${listo ? `<a class="btn primary" href="#/factura/nueva">Nueva factura</a>` : ''}</div>
    ${serie ? `<p class="muted small">Serie de facturación: ${esc(serie)}.</p>` : ''}
    ${facturas.length ? `<input class="search" type="search" placeholder="Buscar por número o cliente" aria-label="Buscar facturas" id="buscar">` : ''}
    ${borradores.length ? `<h2>Borradores</h2><ul class="list">${borradores.map(item).join('')}</ul>` : ''}
    <h2>Emitidas</h2>
    ${emitidas.length ? `<ul class="list">${emitidas.map(item).join('')}</ul>` : `<p class="empty">Todavía no has emitido ninguna factura.</p>`}`;

  $('#sincronizar')?.addEventListener('click', e => {
    e.target.disabled = true; e.target.textContent = 'Sincronizando…';
    Nube.sincronizarConToque()
      .then(r => { toast(r.repetidos.length ? avisoRepetido(r.repetidos[0]) : 'Guardado en Google Drive'); router(); })
      .catch(err => { toast(err.message); e.target.disabled = false; e.target.textContent = 'Sincronizar'; });
  });
  $('#buscar')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $$('a.item', app).forEach(a => { a.parentElement.hidden = q && !a.dataset.buscar.includes(q); });
  });
}

const nuevaLinea = () => ({ id: uuid(), concepto: '', cantidad: '1', precio: '', iva: 21 });

const nuevoExtra = (clave = '', valor = '') => ({ id: uuid(), clave, valor });
async function clavesHabituales() {
  const ultima = (await DB.all('facturas')).filter(x => x.estado === 'emitida' && x.extras?.length).sort(porEmision).at(-1);
  return ultima ? ultima.extras.map(x => nuevoExtra(x.clave)) : [nuevoExtra('Matrícula')];
}
async function crearBorrador(extra = {}) {
  if (!extra.extras) extra.extras = await clavesHabituales();
  const f = {
    id: uuid(), estado: 'borrador', tipo: 'F', fecha: hoy(), fechaOperacion: '', clienteId: '',
    lineas: [nuevaLinea()], retencionTipo: '0', notas: '', motivo: '', creado: ahora(), actualizado: ahora(), ...extra,
  };
  await DB.put('facturas', f);
  Nube.guardar();
  location.replace('#/factura/' + f.id);
}

// Los presupuestos se numeran al crearlos (PRE-2026-0001). No son facturas: se pueden cambiar siempre.
async function crearPresupuesto(extra = {}) {
  app.innerHTML = '<p class="muted">Preparando el presupuesto…</p>';
  await Nube.guardar(); // trae lo último para no repetir número
  const anio = +hoy().slice(0, 4);
  const numero = (await DB.all('presupuestos')).filter(p => p.anio === anio).reduce((m, p) => Math.max(m, p.numero || 0), 0) + 1;
  const validez = new Date(); validez.setDate(validez.getDate() + 30);
  const p = {
    id: uuid(), anio, numero, codigo: `${SERIE_PRESUPUESTOS}-${anio}-${String(numero).padStart(4, '0')}`,
    fecha: hoy(), validoHasta: validez.toISOString().slice(0, 10), clienteId: '', extras: await clavesHabituales(),
    lineas: [nuevaLinea()], retencionTipo: '0', notas: '', creado: ahora(), actualizado: ahora(), ...extra,
  };
  await DB.put('presupuestos', p);
  Nube.guardar();
  location.replace('#/presupuesto/' + p.id);
}

async function vistaPresupuesto(id) {
  const p = await DB.get('presupuestos', id);
  if (!p) { app.innerHTML = `<h1>No encontrado</h1><p>Ese presupuesto no existe o se ha eliminado.</p><a class="btn" href="#/presupuestos">Volver a presupuestos</a>`; return; }
  return editorBorrador(p, true);
}

async function vistaPresupuestos() {
  const [presupuestos, clientes] = await Promise.all([DB.all('presupuestos'), DB.all('clientes')]);
  const cli = new Map(clientes.map(c => [c.id, c]));
  presupuestos.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.codigo.localeCompare(a.codigo));
  app.innerHTML = `
    <div class="head-row"><h1>Presupuestos</h1><a class="btn primary" href="#/presupuesto/nuevo">Nuevo presupuesto</a></div>
    ${presupuestos.length ? `<input class="search" type="search" placeholder="Buscar por número, cliente o matrícula" aria-label="Buscar presupuestos" id="buscar">
      <ul class="list">${presupuestos.map(p => {
        const nombre = cli.get(p.clienteId)?.nombre;
        return `<li><a class="item" href="#/presupuesto/${esc(p.id)}" data-buscar="${esc([p.codigo, nombre, ...(p.extras || []).map(x => x.valor)].filter(Boolean).join(' ').toLowerCase())}">
          <span class="t">${esc(p.codigo)} ${p.facturaId ? '<span class="chip">Pasado a factura</span>' : ''}</span>
          <span class="num t">${eur(calcTotales(p.lineas, p.retencionTipo).total)}</span>
          <span class="s">${esc(nombre || 'Sin cliente')}</span>
          <span class="s num">${esc(fecha(p.fecha))}</span></a></li>`;
      }).join('')}</ul>`
      : `<p class="empty">Todavía no has hecho ningún presupuesto.</p>`}`;
  $('#buscar')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $$('a.item', app).forEach(a => { a.parentElement.hidden = q && !a.dataset.buscar.includes(q); });
  });
}

async function vistaFactura(id, accion) {
  const f = await DB.get('facturas', id);
  if (!f) { app.innerHTML = `<h1>No encontrada</h1><p>Esa factura no existe en este dispositivo.</p><a class="btn" href="#/facturas">Volver a facturas</a>`; return; }

  if (accion === 'rectificar' && f.estado === 'emitida' && f.tipo === 'F') {
    return crearBorrador({
      tipo: 'R', rectificaId: f.id, rectificaCodigo: f.codigo, clienteId: f.clienteId, extras: (f.extras || []).map(x => nuevoExtra(x.clave, x.valor)),
      retencionTipo: numTxt(f.totales.retencionTipo || 0), formaPago: f.formaPago,
      lineas: f.lineas.map(l => ({ id: uuid(), concepto: l.concepto, cantidad: numTxt(-parseNum(l.cantidad)), precio: numTxt(l.precio), iva: l.iva })),
    });
  }
  if (accion === 'duplicar') {
    return crearBorrador({
      clienteId: f.clienteId, extras: (f.extras || []).map(x => nuevoExtra(x.clave, x.valor)),
      retencionTipo: numTxt(f.totales?.retencionTipo ?? parseNum(f.retencionTipo) ?? 0), notas: f.notas || '', formaPago: f.formaPago,
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
      ${botonesPdf}
      ${f.tipo === 'F' ? `<a class="btn" href="#/factura/${esc(f.id)}/rectificar">Crear rectificativa</a>` : ''}
      <a class="btn" href="#/factura/${esc(f.id)}/duplicar">Duplicar como borrador</a>
    </div>
    ${rects.length ? `<h2>Rectificativas de esta factura</h2><ul class="list">${rects.map(r =>
      `<li><a class="item" href="#/factura/${esc(r.id)}"><span class="t">${esc(r.codigo || 'Sin emitir')}</span><span class="num">${r.totales ? eur(r.totales.total) : ''}</span></a></li>`).join('')}</ul>` : ''}
    <p class="muted small" style="margin-top:20px">Una factura emitida no se puede modificar. Para corregirla, crea una rectificativa.</p>`;
  $('#pdf-abrir').onclick = () => abrirPdf(datosDocEmitida(f), f.codigo);
  $('#pdf-descargar').onclick = () => descargar(archivoPdf(datosDocEmitida(f), f.codigo));
}

// Editor de borradores de factura y de presupuestos (esPres). Se guarda solo mientras se escribe.
async function editorBorrador(f, esPres = false) {
  const almacen = esPres ? 'presupuestos' : 'facturas';
  const [clientes, emisor, serie, todas] = await Promise.all([DB.all('clientes'), getAjuste('emisor'), getSerie(), DB.all('facturas')]);
  clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Conceptos ya usados, para autocompletar precio e IVA
  const conocidos = new Map();
  todas.filter(x => x.estado === 'emitida').sort(porEmision)
    .forEach(x => x.lineas.forEach(l => { if (l.concepto && parseNum(l.cantidad) > 0) conocidos.set(l.concepto, l); }));

  f.extras ||= [];
  const emitidas = todas.filter(x => x.estado === 'emitida');
  const claves = [...new Set(['Matrícula', 'Vehículo', 'Kilómetros', ...emitidas.flatMap(x => (x.extras || []).map(e => e.clave))])];
  const valoresCliente = () => [...new Set(emitidas.filter(x => x.clienteId === f.clienteId)
    .flatMap(x => (x.extras || []).map(e => e.valor)).filter(Boolean))];
  const extraHtml = x => `
    <div class="extra" data-id="${esc(x.id)}">
      <div><label for="k-${esc(x.id)}">Dato</label><input id="k-${esc(x.id)}" data-e="clave" list="claves-extra" value="${esc(x.clave)}" placeholder="Matrícula" autocomplete="off"></div>
      <div><label for="v-${esc(x.id)}">Valor</label><input id="v-${esc(x.id)}" data-e="valor" list="valores-extra" value="${esc(x.valor)}" placeholder="6363HJU" autocomplete="off"></div>
      <button type="button" class="ghost" data-quitar-extra aria-label="Quitar este dato">Quitar</button>
    </div>`;
  const pintarValores = () => { $('#valores-extra').innerHTML = valoresCliente().map(v => `<option value="${esc(v)}">`).join(''); };

  const lineaHtml = l => `
    <div class="line" data-id="${esc(l.id)}">
      <div class="c"><label for="c-${esc(l.id)}">Concepto</label><input id="c-${esc(l.id)}" data-f="concepto" list="conceptos" value="${esc(l.concepto)}" autocomplete="off"></div>
      <div class="q"><label for="q-${esc(l.id)}">Cantidad</label><input id="q-${esc(l.id)}" data-f="cantidad" inputmode="decimal" value="${esc(l.cantidad)}"></div>
      <div class="p"><label for="p-${esc(l.id)}">Precio sin IVA</label><input id="p-${esc(l.id)}" data-f="precio" inputmode="decimal" placeholder="0,00" value="${esc(l.precio)}"></div>
      <div class="i"><label for="i-${esc(l.id)}">IVA</label><select id="i-${esc(l.id)}" data-f="iva">${IVA_TIPOS.map(t => `<option value="${t}"${+l.iva === t ? ' selected' : ''}>${t} %</option>`).join('')}</select></div>
      <div class="b num" data-base></div>
      <div class="x"><button type="button" class="ghost" data-quitar aria-label="Quitar este concepto">Quitar</button></div>
    </div>`;

  app.innerHTML = `
    <div class="head-row"><h1>${esPres ? `Presupuesto ${esc(f.codigo)}` : f.tipo === 'R' ? 'Rectificativa' : 'Nueva factura'}</h1></div>
    ${!emisor || (!serie && !esPres) ? `<div class="notice">Faltan tus datos de facturador${esPres ? '' : ' o la serie de facturación'}. <a href="#/ajustes">Complétalos en ajustes</a>.</div>` : ''}
    ${esPres && f.facturaId ? `<div class="notice">Este presupuesto ya se pasó a factura. <a href="#/factura/${esc(f.facturaId)}">Ver la factura</a></div>` : ''}
    <p class="muted">Lo que escribes se guarda solo.</p>
    <form id="form" class="stack" autocomplete="off">
      ${f.tipo === 'R' ? `
        <p>Rectifica la factura <strong>${esc(f.rectificaCodigo)}</strong>. Se han copiado sus conceptos en negativo: deja solo lo que corrige.</p>
        <div><label for="motivo">Motivo de la rectificación</label><textarea id="motivo" data-g="motivo" required>${esc(f.motivo)}</textarea></div>` : ''}
      <div>
        <label for="cliente">Cliente</label>
        <select id="cliente" data-g="clienteId">
          <option value="">Elige un cliente</option>
          ${clientes.map(c => `<option value="${esc(c.id)}"${c.id === f.clienteId ? ' selected' : ''}>${esc(c.nombre)} (${esc(c.nif)})</option>`).join('')}
        </select>
        <div class="hint"><a href="#/cliente/nuevo?volver=${esc(f.id)}${esPres ? '&tipo=presupuesto' : ''}">Añadir un cliente nuevo</a></div>
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
        <div><label for="fecha">Fecha ${esPres ? 'del presupuesto' : 'de la factura'}</label><input id="fecha" type="date" data-g="fecha" value="${esc(f.fecha)}"></div>
        ${esPres
          ? `<div><label for="validez">Válido hasta</label><input id="validez" type="date" data-g="validoHasta" value="${esc(f.validoHasta)}"></div>`
          : `<div><label for="fop">Fecha de la operación</label><input id="fop" type="date" data-g="fechaOperacion" value="${esc(f.fechaOperacion)}"><div class="hint">Solo si es distinta</div></div>`}
        <div><label for="ret">Retención IRPF %</label><input id="ret" inputmode="decimal" data-g="retencionTipo" value="${esc(f.retencionTipo)}"></div>
      </div>
      <h2>Conceptos</h2>
      <div class="lines" id="lineas">${f.lineas.map(lineaHtml).join('')}</div>
      <datalist id="conceptos">${[...conocidos.keys()].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <button type="button" id="anadir">Añadir concepto</button>
      <div><label for="notas">Notas ${esPres ? 'en el presupuesto' : 'en la factura'}</label><textarea id="notas" data-g="notas" placeholder="Por ejemplo, la causa de exención si usas IVA 0 %">${esc(f.notas)}</textarea></div>
      ${esPres ? '' : emisor?.iban
        ? `<label class="check"><input type="checkbox" id="forma-pago"${f.formaPago !== false ? ' checked' : ''}>
            <span>Poner la forma de pago: transferencia a <b>${esc(emisor.iban)}</b></span></label>`
        : `<p class="hint">Para poner la forma de pago en la factura, añade tu IBAN en <a href="#/ajustes">Ajustes</a>.</p>`}
    </form>
    <table class="doc-totals" id="totales" aria-live="polite"></table>
    ${esPres ? `
    <div class="acciones">
      ${botonesPdf}
      ${f.facturaId ? '' : `<button type="button" id="a-factura">Pasar a factura</button>`}
      <button type="button" id="ver">Ver cómo queda</button>
    </div>
    <div class="zona-peligro"><button type="button" class="danger" id="borrar">Eliminar presupuesto</button></div>` : `
    <div class="acciones">
      <button type="button" class="primary" id="emitir">Emitir factura</button>
      <button type="button" id="ver">Ver cómo queda</button>
    </div>
    <div class="zona-peligro"><button type="button" class="danger" id="borrar">Eliminar borrador</button></div>`}
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
      const c = l ? lineaConIva(l) : 0;
      $('[data-base]', el).innerHTML = Number.isNaN(b) ? '<span class="badline">Número no válido</span>'
        : `<span class="muted">Sin IVA ${eur(b)}</span><br>Con IVA <strong>${eur(c)}</strong>`;
    });
  };

  let timer;
  const guardar = async () => { clearTimeout(timer); guardarPendiente = null; f.actualizado = ahora(); await DB.put(almacen, f); };
  // En el dispositivo al momento; en Google Drive cuando se deja de escribir unos segundos
  const programar = () => { clearTimeout(timer); guardarPendiente = guardar; timer = setTimeout(guardar, 400); Nube.programar(); };

  const form = $('#form');
  form.addEventListener('submit', e => e.preventDefault()); // Intro en un campo no debe enviar nada
  form.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.g) f[el.dataset.g] = el.value;
    if (el.id === 'forma-pago') f.formaPago = el.checked;
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
    $(`#k-${esc(x.id)}`).focus();
    programar();
  };
  pintarValores();
  $('#anadir').onclick = () => {
    const l = nuevaLinea();
    f.lineas.push(l);
    $('#lineas').insertAdjacentHTML('beforeend', lineaHtml(l));
    $(`#c-${esc(l.id)}`).focus();
    pintarTotales(); programar();
  };
  const datosDoc = () => ({ ...f, emisor, cliente: clientes.find(c => c.id === f.clienteId),
    totales: calcTotales(f.lineas, f.retencionTipo), borrador: !esPres, clase: esPres ? 'presupuesto' : 'factura' });
  $('#ver').onclick = async () => {
    $('#preview').innerHTML = docHtml(datosDoc());
    $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('#borrar').onclick = async () => {
    if (!confirm(esPres ? `¿Eliminar el presupuesto ${f.codigo}? No se puede deshacer.` : '¿Eliminar este borrador? No se puede deshacer.')) return;
    clearTimeout(timer); guardarPendiente = null;
    await DB.del(almacen, f.id);
    await marcarEliminado(f.id);
    Nube.guardar();
    toast(esPres ? 'Presupuesto eliminado' : 'Borrador eliminado');
    location.hash = esPres ? '#/presupuestos' : '#/facturas';
  };
  if (esPres) {
    const conCliente = () => { if (!f.clienteId) toast('Elige un cliente antes de sacar el PDF.'); return !!f.clienteId; };
    $('#pdf-abrir').onclick = () => { if (conCliente()) { guardar(); abrirPdf(datosDoc(), f.codigo); } };
    $('#pdf-descargar').onclick = () => { if (conCliente()) { guardar(); descargar(archivoPdf(datosDoc(), f.codigo)); } };
    $('#a-factura')?.addEventListener('click', async () => {
      if (!confirm('Se creará una factura con los mismos datos. Podrás revisarla antes de emitirla. ¿Continuar?')) return;
      const facturaId = uuid();
      f.facturaId = facturaId;
      await guardar();
      await crearBorrador({
        id: facturaId, presupuestoId: f.id, clienteId: f.clienteId, notas: f.notas || '', retencionTipo: f.retencionTipo,
        extras: (f.extras || []).map(x => nuevoExtra(x.clave, x.valor)),
        lineas: f.lineas.map(l => ({ ...l, id: uuid() })),
      });
    });
    pintarTotales();
    return;
  }
  $('#emitir').onclick = async e => {
    const permiso = Nube.asegurarPermiso(); // en el mismo toque, para que Safari deje abrir Google si hace falta
    const boton = e.target;
    boton.disabled = true; boton.textContent = 'Comprobando la numeración…';
    try {
      await guardar();
      // Antes de numerar, trae lo último de Drive para no repetir un número emitido en otro dispositivo
      await permiso; await Nube.sincronizar();
      const error = await emitir(f);
      if (error) toast(error);
    } catch (err) {
      toast(err.message);
    } finally {
      if (boton.isConnected) { boton.disabled = false; boton.textContent = 'Emitir factura'; }
    }
  };
  pintarTotales();
}

async function emitir(f) {
  const [emisor, serie] = await Promise.all([getAjuste('emisor'), getSerie()]);
  if (!emisor) return 'Faltan tus datos de facturador. Rellénalos en ajustes.';
  if (!serie) return 'Falta elegir la serie de facturación en ajustes.';
  const borrador = await DB.get('facturas', f.id);
  if (borrador?.estado === 'emitida') { router(); return `Esta factura ya se emitió en otro dispositivo (${borrador.codigo}).`; }
  if (!borrador) return 'Este borrador se ha eliminado en otro dispositivo.';
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

  const serieCodigo = serie + (f.tipo === 'R' ? 'R' : '');
  const anio = +f.fecha.slice(0, 4);
  const emitidas = (await DB.all('facturas')).filter(x => x.estado === 'emitida');
  const mismaSerie = emitidas.filter(x => x.serieCodigo === serieCodigo && x.anio === anio);
  const numero = mismaSerie.reduce((m, x) => Math.max(m, x.numero), 0) + 1;
  const ultimaFecha = mismaSerie.reduce((m, x) => (x.fecha > m ? x.fecha : m), '');
  if (f.fecha < ultimaFecha) return `La fecha no puede ser anterior a la última factura de la serie ${serieCodigo} (${fecha(ultimaFecha)}).`;

  const codigo = `${serieCodigo}-${anio}-${String(numero).padStart(4, '0')}`;
  if (!confirm(`Se emitirá con el número ${codigo}. Después no podrás modificarla. ¿Emitir?`)) return null;

  const totales = calcTotales(lineas, ret); delete totales.valido;
  const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k] || '']));
  const g = {
    ...f, estado: 'emitida', serie, serieCodigo, anio, numero, codigo, lineas, extras,
    retencionTipo: ret, totales,
    emisorSnap: pick(emisor, ['nombre', 'nif', 'direccion', 'cp', 'poblacion', 'provincia', 'email', 'telefono', 'iban']),
    clienteSnap: pick(cliente, ['nombre', 'nif', 'direccion', 'cp', 'poblacion', 'provincia', 'pais', 'email', 'telefono']),
    emitidaEn: ahora(),
  };
  g.actualizado = g.emitidaEn;
  await DB.put('facturas', g);
  sessionStorage.setItem('recienEmitida', g.id);
  router();
  // Se sube en el acto para que los demás dispositivos sigan la numeración
  if (await Nube.guardar()) toast(`Factura ${codigo} emitida y guardada`);
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
      <ul class="list">${clientes.map(c => `<li><a class="item" href="#/cliente/${esc(c.id)}" data-buscar="${esc((c.nombre + ' ' + c.nif).toLowerCase())}">
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
  const usado = !nuevo && [...await DB.all('facturas'), ...await DB.all('presupuestos')].some(f => f.clienteId === c.id);
  const volver = params.get('volver');
  const volverA = params.get('tipo') === 'presupuesto' ? 'presupuestos' : 'facturas';
  const rutaVolver = volver && (volverA === 'presupuestos' ? '#/presupuesto/' : '#/factura/') + volver;
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
        <a class="btn" href="${volver ? esc(rutaVolver) : '#/clientes'}">Cancelar</a>
        ${!nuevo ? `<a class="btn" href="#/factura/nueva?cliente=${esc(c.id)}">Hacerle una factura</a><a class="btn" href="#/presupuesto/nuevo?cliente=${esc(c.id)}">Hacerle un presupuesto</a>` : ''}
        ${!nuevo && !usado ? `<button type="button" class="danger" id="borrar">Eliminar cliente</button>` : ''}
      </div>
      ${usado ? `<p class="muted small">Este cliente tiene facturas o presupuestos, así que no se puede eliminar. Los cambios que hagas no alteran las facturas ya emitidas.</p>` : ''}
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
      const f = await DB.get(volverA, volver);
      if (f && f.estado !== 'emitida') { f.clienteId = c.id; f.actualizado = ahora(); await DB.put(volverA, f); }
    }
    Nube.guardar();
    if (volver) {
      location.hash = rutaVolver;
    } else {
      toast('Cliente guardado');
      location.hash = '#/clientes';
    }
  };
  $('#borrar')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar a ${c.nombre}?`)) return;
    await DB.del('clientes', c.id);
    await marcarEliminado(c.id);
    Nube.guardar();
    toast('Cliente eliminado');
    location.hash = '#/clientes';
  });
}

async function vistaAjustes() {
  const [emisor = {}, serie, nube, facturas] = await Promise.all([
    getAjuste('emisor'), getSerie(), getAjuste('nube'), DB.all('facturas')]);
  const campo = (k, etiqueta, extra = '') => `<div ${extra.includes('span-2') ? 'class="span-2"' : ''}><label for="e-${k}">${etiqueta}</label><input id="e-${k}" name="${k}" value="${esc(emisor[k])}" ${extra.replace('span-2', '')}></div>`;

  app.innerHTML = `
    <h1>Ajustes</h1>

    <h2>Cuenta de Google</h2>
    <p>Sesión iniciada con <strong>${esc(nube?.email || '')}</strong>.${nube?.ultimaSync ? ` Última sincronización: ${esc(fmtFechaHora.format(new Date(nube.ultimaSync)))}.` : ''}</p>
    <p class="muted small">Los clientes y las facturas se guardan en el archivo «${esc(NUBE_NOMBRE)}», dentro de la carpeta «${esc(NUBE_CARPETA)}» del Google Drive de esta cuenta, y son los mismos en todos los dispositivos que entren con ella. Los datos van directamente de este dispositivo a ese Drive, sin pasar por ningún otro sitio.</p>
    <div class="row"><button type="button" class="primary" id="nube-sync">Sincronizar ahora</button><button type="button" id="nube-salir">Cerrar sesión</button></div>
    <div id="res-nube" class="small" style="margin-top:10px"></div>

    <h2>Serie de facturación</h2>
    <form id="f-serie" class="stack">
      <p class="muted small">Todas las facturas se numeran con esta serie, desde cualquier dispositivo: ${esc(serie || 'F')}-${new Date().getFullYear()}-0001, 0002… Las rectificativas añaden una R (${esc(serie || 'F')}R).</p>
      <div class="row">
        <input id="serie" name="serie" value="${esc(serie)}" maxlength="4" autocapitalize="characters" style="max-width:120px" aria-label="Serie" placeholder="F">
        <button type="submit" class="primary">Guardar serie</button>
      </div>
      ${(() => { const usadas = [...new Set(facturas.filter(f => f.estado === 'emitida').map(f => f.serie))].sort();
        return usadas.length ? `<p class="hint">Series que ya aparecen en las facturas: ${usadas.map(esc).join(', ')}.</p>` : ''; })()}
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
      </div>
      <button type="submit" class="primary">Guardar datos</button>
      <p class="hint">Aparecen igual en todas las facturas nuevas. Las ya emitidas conservan los datos que tenían.</p>
    </form>

    <h2>Copia de seguridad manual</h2>
    <p class="muted small">Los datos ya se guardan solos en Google Drive. Si además quieres un archivo aparte con todos los clientes y facturas, expórtalo aquí. Al importar una copia, sus datos se suman a los de la cuenta sin duplicar nada.</p>
    <div class="row">
      <button type="button" class="primary" id="exportar">Exportar copia</button>
      <label class="btn" style="margin:0;color:var(--text)">Importar copia<input type="file" id="importar" accept="application/json,.json" hidden></label>
    </div>
    <div id="res-import" class="small" style="margin-top:10px"></div>

    <p class="muted small" style="margin-top:28px">Versión ${APP_VERSION}</p>`;

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
    if (serie && serie !== s && !confirm(`Las próximas facturas, desde todos los dispositivos, usarán la serie ${s} en lugar de ${serie}. ¿Continuar?`)) return;
    await setAjuste('serie', { serie: s, actualizado: ahora() });
    Nube.guardar();
    toast(`Serie ${s} guardada`);
  };
  $('#f-emisor').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, String(v).trim()]));
    d.nif = normNif(d.nif);
    d.iban = d.iban.toUpperCase().replace(/\s+/g, ' ');
    if (!d.nombre || !d.nif || !d.direccion) { toast('Nombre, NIF y dirección son obligatorios.'); return; }
    d.actualizado = ahora();
    await setAjuste('emisor', d);
    Nube.guardar();
    toast('Datos guardados');
  };
  $('#exportar').onclick = exportarCopia;
  $('#nube-sync').addEventListener('click', e => {
    const boton = e.target; boton.disabled = true; boton.textContent = 'Sincronizando…';
    Nube.sincronizarConToque().then(r => {
      toast(r.repetidos?.length ? avisoRepetido(r.repetidos[0]) : 'Sincronizado con Google Drive');
      router();
    }).catch(err => {
      $('#res-nube').innerHTML = `<span class="badline">${esc(err.message)}</span>`;
      boton.disabled = false; boton.textContent = 'Sincronizar ahora';
    });
  });
  $('#nube-salir').addEventListener('click', async () => {
    if (!confirm('Se quitarán los datos de este dispositivo (siguen guardados en Google Drive). Para volver a usar la app tendrás que entrar otra vez con Google. ¿Cerrar sesión?')) return;
    try { await Nube.sincronizar(); } catch { // si no se pudo subir lo último, mejor no borrarlo de aquí
      if (!confirm('No se han podido guardar en Google Drive los últimos cambios. Si cierras la sesión ahora, se perderán. ¿Cerrar de todas formas?')) return;
    }
    await Nube.cerrarSesion();
    router();
  });
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
}

/* ============================================================
   Copias de seguridad
   ============================================================ */
async function datosCopia() {
  const [emisor, serie, clientes, facturas, presupuestos, eliminados] = await Promise.all([
    getAjuste('emisor'), getAjuste('serie'), DB.all('clientes'), DB.all('facturas'), DB.all('presupuestos'), getAjuste('eliminados')]);
  return { app: FORMATO_COPIA, formato: 1, version: APP_VERSION, exportado: ahora(), serie: serie || null,
    emisor: emisor || null, clientes, facturas, presupuestos, eliminados: eliminados || {} };
}
async function exportarCopia() {
  const datos = await datosCopia();
  const nombre = `facturas-copia-${hoy()}.json`;
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
  toast('Copia exportada.');
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
  const r = await fusionar(d, true);
  Nube.guardar();
  return r.html;
}

// Lo que llega de una copia o de Drive se comprueba antes de guardarlo: un archivo manipulado
// no debe poder colar código en la página a través de identificadores o tipos de IVA raros.
const idOk = v => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v);
const idOpcionalOk = v => v === undefined || v === null || v === '' || idOk(v);
const lineasOk = ls => Array.isArray(ls) && ls.every(l => l && typeof l === 'object' && idOpcionalOk(l.id)
  && typeof l.iva === 'number' && IVA_TIPOS.includes(l.iva));
const extrasOk = ex => ex === undefined || (Array.isArray(ex) && ex.every(x => x && typeof x === 'object' && idOpcionalOk(x.id)));
const totalesOk = t => t === undefined || (t && Array.isArray(t.desglose) && t.desglose.every(d => typeof d.tipo === 'number'));
const documentoOk = d => d && typeof d === 'object' && idOk(d.id) && lineasOk(d.lineas) && extrasOk(d.extras) && totalesOk(d.totales)
  && ['clienteId', 'rectificaId', 'facturaId', 'presupuestoId'].every(k => idOpcionalOk(d[k]));

const avisoRepetido = codigo => `Atención: el número ${codigo} está en dos facturas distintas, emitidas a la vez en dos dispositivos. Consúltalo con tu gestor.`;

// Mezcla una copia con los datos de este dispositivo sin duplicar nada.
// interactivo = true cuando la importa una persona (puede preguntar); false al sincronizar solo.
async function fusionar(d, interactivo) {
  if (d?.app !== FORMATO_COPIA || !Array.isArray(d.clientes) || !Array.isArray(d.facturas)) throw new Error('El archivo no es una copia de esta app.');

  const [locClientes, locFacturas, locPresupuestos, emisor, serie, locElim] = await Promise.all([
    DB.all('clientes'), DB.all('facturas'), DB.all('presupuestos'), getAjuste('emisor'), getAjuste('serie'), getAjuste('eliminados')]);
  const remElim = d.eliminados || {};
  const eliminados = { ...(locElim || {}), ...remElim };
  const locC = new Map(locClientes.map(c => [c.id, c]));
  const locF = new Map(locFacturas.map(f => [f.id, f]));
  const locP = new Map(locPresupuestos.map(p => [p.id, p]));
  const putC = [], putF = [], putP = [], conflictos = [];
  let nC = 0, aC = 0, nF = 0, aF = 0, nP = 0, aP = 0;

  let descartados = 0;
  for (const c of d.clientes) {
    if (!c || !idOk(c.id) || !c.nombre) { descartados++; continue; }
    if (eliminados[c.id]) continue;
    const l = locC.get(c.id);
    if (!l) { putC.push(c); nC++; } else if ((c.actualizado || '') > (l.actualizado || '')) { putC.push(c); aC++; }
  }
  for (const f of d.facturas) {
    if (!documentoOk(f)) { descartados++; continue; }
    if (eliminados[f.id] && f.estado !== 'emitida') continue;
    const l = locF.get(f.id);
    if (!l) { putF.push(f); nF++; continue; }
    if (l.estado === 'borrador' && f.estado === 'emitida') { putF.push(f); aF++; }
    else if (l.estado === 'borrador' && f.estado === 'borrador' && (f.actualizado || '') > (l.actualizado || '')) { putF.push(f); aF++; }
    else if (l.estado === 'emitida' && f.estado === 'emitida' && canon(l) !== canon(f)) conflictos.push(l.codigo);
  }

  for (const p of d.presupuestos || []) { // las copias de versiones anteriores no traen presupuestos
    if (!documentoOk(p)) { descartados++; continue; }
    if (eliminados[p.id]) continue;
    const l = locP.get(p.id);
    if (!l) { putP.push(p); nP++; } else if ((p.actualizado || '') > (l.actualizado || '')) { putP.push(p); aP++; }
  }

  // Lo que se eliminó en otro dispositivo: borradores, presupuestos y clientes sin facturas
  const final = new Map(locF); putF.forEach(f => final.set(f.id, f));
  const borrarP = locPresupuestos.filter(p => remElim[p.id]).map(p => p.id);
  const presFinal = new Map(locP); putP.forEach(p => presFinal.set(p.id, p)); borrarP.forEach(id => presFinal.delete(id));
  const conFacturas = new Set([...[...final.values()].filter(f => f.estado === 'emitida'), ...presFinal.values()].map(f => f.clienteId));
  const borrarF = locFacturas.filter(f => remElim[f.id] && f.estado === 'borrador').map(f => f.id);
  const borrarC = locClientes.filter(c => remElim[c.id] && !conFacturas.has(c.id)).map(c => c.id);
  borrarF.forEach(id => final.delete(id));

  // Números repetidos con facturas distintas: dos dispositivos emitieron a la vez sin ver la del otro
  const porCodigo = new Map(), repetidos = new Set();
  for (const f of final.values()) {
    if (f.estado !== 'emitida') continue;
    if (porCodigo.has(f.codigo)) repetidos.add(f.codigo);
    porCodigo.set(f.codigo, f.id);
  }

  if (d.emisor) {
    const sinFecha = o => { const { actualizado, ...r } = o || {}; return canon(r); };
    if (!emisor) await setAjuste('emisor', d.emisor);
    else if (sinFecha(emisor) !== sinFecha(d.emisor)) {
      if (interactivo) {
        if (confirm('La copia trae datos de facturador distintos a los de este dispositivo. ¿Usar los de la copia?')) await setAjuste('emisor', d.emisor);
      } else if ((d.emisor.actualizado || '') > (emisor.actualizado || '')) await setAjuste('emisor', d.emisor);
    }
  }
  if (typeof d.serie?.serie === 'string' && /^[A-Z0-9]{1,4}$/.test(d.serie.serie) && (!serie || (d.serie.actualizado || '') > (serie.actualizado || ''))) await setAjuste('serie', d.serie);

  if (canon(eliminados) !== canon(locElim || {})) await setAjuste('eliminados', eliminados);
  await DB.putMany({ clientes: putC, facturas: putF, presupuestos: putP });
  for (const id of borrarF) await DB.del('facturas', id);
  for (const id of borrarP) await DB.del('presupuestos', id);
  for (const id of borrarC) await DB.del('clientes', id);

  const html = [
    `<div class="okline">Importado: ${nC} clientes nuevos, ${aC} actualizados, ${nF} facturas nuevas, ${aF} actualizadas, ${nP} presupuestos nuevos, ${aP} actualizados.</div>`,
    ...(descartados ? [`<div class="badline">Se han descartado ${descartados} registros que no tenían un formato válido.</div>`] : []),
    ...conflictos.map(c => `<div class="badline">La factura ${esc(c)} es distinta en la copia y en este dispositivo. Se ha mantenido la de este dispositivo.</div>`),
    ...[...repetidos].map(c => `<div class="badline">${esc(avisoRepetido(c))}</div>`),
  ].join('');
  return { html, cambios: nC + aC + nF + aF + nP + aP + borrarF.length + borrarC.length + borrarP.length, repetidos: [...repetidos] };
}

/* ============================================================
   Google Drive: los datos van del dispositivo al Drive del usuario, sin servidor intermedio
   ============================================================ */
const Nube = (() => {
  let cliente = null, esperando = null, timer = null, hint = '', cargandoGis = null;
  const configurada = () => !!GOOGLE_CLIENT_ID;

  // El permiso de Google dura una hora y se queda solo en este dispositivo
  const leerToken = () => {
    try { const t = JSON.parse(localStorage.getItem('nube-token') || 'null'); return t && t.expira > Date.now() + 60000 ? t.token : null; } catch { return null; }
  };
  const guardarToken = (token, seg) => { try { localStorage.setItem('nube-token', JSON.stringify({ token, expira: Date.now() + seg * 1000 })); } catch {} };
  const borrarToken = () => { try { localStorage.removeItem('nube-token'); } catch {} };

  function cargarGis() { // una sola vez, aunque lo pidan a la vez el arranque y la pantalla de entrar
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return cargandoGis ||= new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
      sc.onload = res;
      sc.onerror = () => { sc.remove(); cargandoGis = null; rej(new Error('No se pudo contactar con Google. ¿Hay conexión?')); };
      document.head.append(sc);
    });
  }
  async function prepararCliente() {
    if (!configurada() || cliente) return;
    await cargarGis();
    cliente = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: NUBE_SCOPE,
      callback: r => {
        const p = esperando; esperando = null;
        if (r.error) p?.rej(new Error('Google no ha dado permiso.'));
        else { guardarToken(r.access_token, Number(r.expires_in) || 3600); p?.res(r.access_token); }
      },
      error_callback: e => {
        const p = esperando; esperando = null;
        p?.rej(new Error(e?.type === 'popup_closed' ? 'Se cerró la ventana de Google antes de terminar.' : 'No se pudo abrir la ventana de Google.'));
      },
    });
  }
  // Tiene que llamarse en el mismo toque del usuario: si no, Safari bloquea la ventana de Google
  function pedirToken(primeraVez) {
    return new Promise((res, rej) => {
      if (!cliente) { rej(new Error('Preparando el acceso a Google. Vuelve a tocar en un momento.')); prepararCliente().catch(() => {}); return; }
      esperando = { res, rej };
      cliente.requestAccessToken({ prompt: primeraVez ? 'consent' : '', ...(hint ? { login_hint: hint } : {}) });
    });
  }

  async function api(token, url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    if (r.status === 401) { borrarToken(); throw Object.assign(new Error('La sesión de Google ha caducado. Vuelve a entrar.'), { caducado: true }); }
    if (!r.ok) throw Object.assign(new Error(`Google Drive ha respondido con un error (${r.status}).`), { status: r.status });
    return r;
  }

  // Las sincronizaciones van en fila: un cambio hecho mientras otra está en curso se sube en la siguiente
  let cola = Promise.resolve(), enFila = 0;
  function sincronizar(token) {
    if (enFila > 1) return cola; // ya hay una esperando, que incluirá este cambio
    enFila++;
    const p = cola.catch(() => {}).then(() => sincronizarUna(token || leerToken())).finally(() => { enFila--; });
    cola = p;
    return p;
  }
  // La carpeta FACTURAS TALLER: la de antes si sigue ahí, si no la busca y, si no hay, la crea.
  // Con el permiso drive.file la app solo ve las carpetas que ha creado ella.
  async function carpetaDatos(token, est) {
    if (est.carpetaId) {
      try {
        const c = await (await api(token, `${GAPI}/drive/v3/files/${est.carpetaId}?fields=id,trashed`)).json();
        if (!c.trashed) return c.id;
      } catch (e) { if (e.status !== 404) throw e; }
    }
    const q = encodeURIComponent(`name = '${NUBE_CARPETA}' and mimeType = '${CARPETA_MIME}' and trashed = false`);
    const l = await (await api(token, `${GAPI}/drive/v3/files?q=${q}&orderBy=createdTime&fields=files(id)&spaces=drive`)).json();
    if (l.files?.[0]) return l.files[0].id;
    return (await (await api(token, `${GAPI}/drive/v3/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: NUBE_CARPETA, mimeType: CARPETA_MIME }),
    })).json()).id;
  }
  // Mete en la carpeta el archivo de datos si aún no está (los de versiones anteriores están en la raíz del Drive)
  async function moverACarpeta(token, id, carpetaId) {
    const { parents = [] } = await (await api(token, `${GAPI}/drive/v3/files/${id}?fields=parents`)).json();
    if (parents.includes(carpetaId)) return;
    const quitar = parents.length ? `&removeParents=${parents.join(',')}` : '';
    await api(token, `${GAPI}/drive/v3/files/${id}?addParents=${carpetaId}${quitar}&fields=id`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  }

  async function sincronizarUna(token) {
    if (!token) throw Object.assign(new Error('La sesión de Google ha caducado. Vuelve a entrar.'), { caducado: true });
    const est = (await getAjuste('nube')) || {};
    let id = est.fileId || null, remoto = null;
    if (id) {
      try { remoto = await (await api(token, `${GAPI}/drive/v3/files/${id}?alt=media`)).json(); }
      catch (e) { if (e.status === 404) id = null; else throw e; }
    }
    if (!id) {
      const q = encodeURIComponent(`name = '${NUBE_NOMBRE}' and trashed = false`);
      const l = await (await api(token, `${GAPI}/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id)&spaces=drive`)).json();
      id = l.files?.[0]?.id || null;
      if (id) remoto = await (await api(token, `${GAPI}/drive/v3/files/${id}?alt=media`)).json();
    }
    const resultado = remoto ? await fusionar(remoto, false) : { cambios: 0, repetidos: [] };
    let { carpetaId, enCarpeta } = est;
    if (!id || enCarpeta !== id) carpetaId = await carpetaDatos(token, est); // solo la primera vez para cada archivo
    if (id && enCarpeta !== id) { await moverACarpeta(token, id, carpetaId); enCarpeta = id; }
    const marca = ahora(); // lo cambiado después de este momento quedará pendiente para la próxima vez
    const cuerpo = JSON.stringify(await datosCopia());
    if (id) {
      await api(token, `${GAPI}/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: cuerpo });
    } else {
      const b = 'facturas' + uuid().replace(/-/g, '');
      const meta = JSON.stringify({ name: NUBE_NOMBRE, mimeType: 'application/json', parents: [carpetaId] });
      const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${cuerpo}\r\n--${b}--`;
      id = (await (await api(token, `${GAPI}/upload/drive/v3/files?uploadType=multipart&fields=id`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body })).json()).id;
      enCarpeta = id;
    }
    await setAjuste('nube', { ...est, fileId: id, carpetaId, enCarpeta, ultimaSync: marca });
    await setAjuste('ultimaCopia', marca);
    return resultado;
  }

  // Entrar con Google (desde un toque): comprueba la cuenta, carga los datos de su Drive y sube lo que falte
  function entrar() {
    return cargarCuenta(pedirToken(!hint)); // pedir el permiso antes de cualquier espera, o Safari bloquea la ventana de Google
  }
  async function cargarCuenta(pidiendo) {
    const token = await pidiendo;
    const est = (await getAjuste('nube')) || {};
    const u = (await (await api(token, `${GAPI}/drive/v3/about?fields=user(emailAddress,displayName)`)).json()).user || {};
    const email = u.emailAddress || '';
    if (est.email && email && est.email !== email) {
      // Los datos de este dispositivo son los de la otra cuenta: siguen en su Drive, aquí se quitan para no mezclarlos
      if (!confirm(`Este dispositivo tenía los datos de ${est.email}. Se quitarán de aquí (siguen en el Drive de esa cuenta) y se cargarán los de ${email}. ¿Continuar?`)) {
        borrarToken(); throw new Error('No se ha cambiado de cuenta.');
      }
      await DB.vaciar();
    }
    hint = email;
    await setAjuste('nube', { ...(est.email === email ? est : {}), email, nombre: u.displayName || '' });
    const r = await sincronizar(token);
    return { ...r, cambioCuenta: !!est.email && est.email !== email };
  }
  async function sincronizarConToque() { // desde un toque
    const token = leerToken() || await pedirToken(false);
    return sincronizar(token);
  }
  // Llamar al principio de un toque: si el permiso ha caducado, abre Google antes de que Safari pierda el toque
  const asegurarPermiso = () => (leerToken() ? Promise.resolve() : pedirToken(false));
  // Al cerrar sesión no se deja nada en el dispositivo: los datos siguen en Google Drive
  async function cerrarSesion() {
    const t = leerToken();
    if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
    borrarToken();
    hint = '';
    await DB.vaciar();
  }
  // Sin cuenta conectada y permiso vigente no se puede usar la app
  const sesionActiva = async () => configurada() && !!leerToken() && !!(await getAjuste('nube'))?.email;

  const enLista = () => ['', '#/facturas', '#/presupuestos', '#/clientes'].includes(location.hash);

  /* ---- Guardar en Drive después de cada cambio ---- */
  let estado = 'guardado';
  function pintarEstado(e) {
    estado = e;
    const el = $('#estado-guardado');
    if (!el) return;
    el.dataset.estado = e;
    el.textContent = { guardando: 'Guardando…', guardado: 'Guardado ✓', pendiente: 'Guardando…', error: 'Sin guardar' }[e];
  }
  // Llamar tras cada cambio (cliente, factura, presupuesto, ajustes). Si la sesión ha caducado, la pide antes de seguir.
  async function guardar() {
    clearTimeout(timer);
    pintarEstado('guardando');
    try {
      const r = leerToken() ? await sincronizar() : await pedirSesion();
      pintarEstado('guardado');
      if (r?.repetidos?.length) toast(avisoRepetido(r.repetidos[0]), 'Entendido', () => {}, true);
      return r;
    } catch (e) {
      console.warn(e);
      if (e.caducado) return guardar(); // al volver a sincronizar sin permiso, se pedirá la sesión
      pintarEstado('error');
      toast('No se ha podido guardar en Google Drive. Revisa la conexión a internet.', 'Reintentar', () => guardar(), true);
      return null;
    }
  }
  // Para lo que se escribe poco a poco (un borrador): guarda cuando se deja de escribir unos segundos
  function programar() {
    pintarEstado('pendiente');
    clearTimeout(timer);
    timer = setTimeout(guardar, 3000);
  }
  const hayCambiosSinGuardar = () => estado !== 'guardado';

  // Ventana que bloquea la app hasta volver a entrar con Google
  let sesionPedida = null;
  function pedirSesion() {
    if (sesionPedida) return sesionPedida;
    sesionPedida = new Promise(res => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'modal-titulo');
      m.innerHTML = `<div class="modal-caja">
        <h2 id="modal-titulo">Vuelve a entrar para guardar</h2>
        <p>Por seguridad, Google pide entrar otra vez cada hora. Lo que estabas haciendo no se ha perdido: toca el botón y se guardará.</p>
        <button type="button" class="primary grande" id="modal-entrar">Entrar con Google</button>
        <div class="res small" style="margin-top:12px"></div></div>`;
      document.body.append(m);
      const boton = $('#modal-entrar', m);
      boton.focus();
      prepararCliente().catch(err => { $('.res', m).innerHTML = `<span class="badline">${esc(err.message)}</span>`; });
      boton.onclick = () => {
        const entrando = entrar(); // en el mismo toque, para que Safari deje abrir la ventana de Google
        boton.disabled = true; boton.textContent = 'Entrando…';
        entrando.then(r => {
          m.remove(); sesionPedida = null; pintarEstado('guardado');
          toast('Sesión renovada. Todo guardado.');
          res(r);
          if (r.cambioCuenta || enLista()) router(); // en un formulario abierto no se repinta, para no perder lo escrito
        }).catch(err => {
          $('.res', m).innerHTML = `<span class="badline">${esc(err.message)}</span>`;
          boton.disabled = false; boton.textContent = 'Entrar con Google';
        });
      };
    });
    return sesionPedida;
  }

  // Al abrir la app con sesión: trae lo último de Drive
  async function iniciar() {
    const est = await getAjuste('nube');
    hint = est?.email || '';
    if (!configurada() || !navigator.onLine) return;
    prepararCliente().catch(() => {});
    if (!leerToken()) return;
    try { const r = await sincronizar(); pintarEstado('guardado'); if (r.cambios && enLista()) router(); }
    catch (e) { console.warn(e); if (e.caducado) router(); }
  }
  window.addEventListener('online', () => { if (estado === 'error') guardar(); else iniciar(); });
  // El permiso dura una hora: cuando caduca, se pide entrar otra vez sin perder la pantalla en la que se estaba
  setInterval(async () => { if (!$('#entrar') && !sesionPedida && !(await sesionActiva())) pedirSesion(); }, 30000);
  // Avisa si se cierra la app con algo sin subir
  window.addEventListener('beforeunload', e => { if (hayCambiosSinGuardar()) e.preventDefault(); });

  return { configurada, entrar, sincronizar, sincronizarConToque, asegurarPermiso, cerrarSesion, sesionActiva, guardar, programar, pintarEstado, iniciar, prepararCliente };
})();

async function vistaEntrar() {
  const est = await getAjuste('nube');
  document.body.classList.add('sin-sesion');
  app.innerHTML = `
    <div class="login">
      <h1>Facturas</h1>
      ${!Nube.configurada() ? `<p>Falta configurar el acceso a Google (el ID de cliente en <code>app.js</code>).</p>` : `
      <p>${est?.email ? `Tu sesión ha caducado. Entra otra vez con <strong>${esc(est.email)}</strong> para seguir.`
        : 'Entra con la cuenta de Google del negocio. Los clientes y las facturas se guardan en su Google Drive y son los mismos en todos los dispositivos.'}</p>
      <button type="button" class="primary" id="entrar" disabled>Entrar con Google</button>
      <div id="res-entrar" class="small" style="margin-top:10px"></div>`}
    </div>`;
  if (!Nube.configurada()) return;
  const boton = $('#entrar'), res = $('#res-entrar');
  const listo = () => { boton.disabled = false; res.textContent = ''; };
  if (!navigator.onLine) res.innerHTML = '<span class="badline">Necesitas conexión a internet para entrar.</span>';
  Nube.prepararCliente().then(listo).catch(err => { res.innerHTML = `<span class="badline">${esc(err.message)}</span>`; });
  window.addEventListener('online', () => Nube.prepararCliente().then(listo).catch(() => {}), { once: true });
  boton.onclick = () => {
    const entrando = Nube.entrar(); // en el mismo toque, para que Safari deje abrir la ventana de Google
    boton.disabled = true; boton.textContent = 'Cargando tus datos…';
    entrando.then(r => {
      if (r.repetidos?.length) toast(avisoRepetido(r.repetidos[0]), 'Entendido', () => {}, true);
      router();
    }).catch(err => {
      res.innerHTML = `<span class="badline">${esc(err.message)}</span>`;
      boton.disabled = false; boton.textContent = 'Entrar con Google';
    });
  };
}

/* ============================================================
   Navegación
   ============================================================ */
async function router() {
  if (guardarPendiente) await guardarPendiente();
  const [ruta, query] = (location.hash || '#/facturas').slice(1).split('?');
  const partes = ruta.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  if (!(await Nube.sesionActiva())) { await vistaEntrar(); window.scrollTo(0, 0); return; }
  document.body.classList.remove('sin-sesion');
  const seccion = { factura: 'facturas', presupuesto: 'presupuestos', cliente: 'clientes' }[partes[0]] || partes[0] || 'facturas';
  $$('.tabs a').forEach(a => { if (a.dataset.tab === seccion) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

  try {
    switch (partes[0]) {
      case 'factura':
        if (partes[1] === 'nueva') return await crearBorrador({ clienteId: params.get('cliente') || '' });
        await vistaFactura(partes[1], partes[2]); break;
      case 'presupuesto':
        if (partes[1] === 'nuevo') return await crearPresupuesto({ clienteId: params.get('cliente') || '' });
        await vistaPresupuesto(partes[1]); break;
      case 'presupuestos': await vistaPresupuestos(); break;
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

if (!window.isSecureContext) {
  app.innerHTML = `<h1>Abre la app desde su dirección web</h1><p>Esta app necesita abrirse por https (por ejemplo, desde GitHub Pages) o desde localhost. Abriendo el archivo directamente no puede guardar datos ni funcionar sin conexión.</p>`;
} else {
  navigator.storage?.persist?.().catch(() => {});
  migrarSerie().catch(() => {}).finally(() => { router(); Nube.iniciar(); });
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
