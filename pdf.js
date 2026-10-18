'use strict';

/* ============================================================
   Generador de PDF propio, sin librerías.
   El PDF se maqueta aquí, en milímetros exactos, y no lo maqueta el navegador al imprimir: así sale
   igual en Safari, Chrome, el iPhone o cualquier visor, y al imprimirlo desde el visor no se corta.
   Usa las cuatro fuentes estándar de PDF (Times y Helvetica), que traen todos los visores, con la
   codificación WinAnsi, que cubre el español y el símbolo €. Los anchos de cada letra son los de las
   tablas oficiales de Adobe (AFM), para alinear a la derecha y partir líneas con exactitud.
   Coordenadas en puntos (1 mm = 2,835 pt) con el origen arriba a la izquierda, como en pantalla.
   ============================================================ */
const PDF = (() => {
  // Ancho de los códigos WinAnsi 32 a 255, en milésimas del tamaño de letra
  const ANCHOS = {
    'Times-Roman': [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,250,500,250,333,500,444,1000,500,500,333,1000,556,333,889,250,611,250,250,333,333,444,444,350,500,1000,333,980,389,333,722,250,444,722,250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,333,400,564,300,300,333,500,453,250,333,300,310,500,750,750,750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,564,500,500,500,500,500,500,500,500],
    'Times-Bold': [250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,250,500,250,333,500,500,1000,500,500,333,1000,556,333,1000,250,667,250,250,333,333,500,500,350,500,1000,333,1000,389,333,722,250,444,722,250,333,500,500,500,500,220,500,333,747,300,500,570,333,747,333,400,570,300,300,333,556,540,250,333,300,330,500,750,750,750,500,722,722,722,722,722,722,1000,722,667,667,667,667,389,389,389,389,722,722,778,778,778,778,778,570,778,722,722,722,722,722,611,556,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,500,556,500],
    'Helvetica': [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,278,556,278,222,556,333,1000,556,556,333,1000,667,333,1000,278,611,278,278,222,222,333,333,350,556,1000,333,1000,500,333,944,278,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],
    'Helvetica-Bold': [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,278,556,278,278,556,500,1000,556,556,333,1000,667,333,1000,278,611,278,278,278,278,500,500,350,556,1000,333,1000,556,333,944,278,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556],
  };
  const FUENTES = { serif: 'Times-Roman', serifNegrita: 'Times-Bold', sans: 'Helvetica', sansNegrita: 'Helvetica-Bold' };
  const CLAVES = { serif: 'F1', serifNegrita: 'F2', sans: 'F3', sansNegrita: 'F4' };
  const A4 = { ancho: 595.28, alto: 841.89 };
  const mm = n => n * 72 / 25.4;

  // Caracteres de WinAnsi fuera de Latin-1, y equivalencias de los que no existen en esa codificación
  const WIN_ANSI = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
    0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
    0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
    0x00A0: 0x20, 0x202F: 0x20, 0x2009: 0x20, 0x2212: 0x2D, 0x2010: 0x2D, 0x2011: 0x2D,
  };
  // Texto Unicode -> códigos WinAnsi. Lo que no existe en WinAnsi sale como «?».
  function codigos(texto) {
    const res = [];
    for (const ch of String(texto ?? '').normalize('NFC')) {
      const u = ch.codePointAt(0);
      if (u === 9) res.push(32);
      else if ((u >= 32 && u < 127) || (u >= 0xA1 && u <= 0xFF)) res.push(u);
      else res.push(WIN_ANSI[u] ?? 63);
    }
    return res;
  }
  function ancho(texto, fuente = 'serif', tamano = 10, espaciado = 0) {
    const tabla = ANCHOS[FUENTES[fuente]];
    const cs = codigos(texto);
    return cs.reduce((s, c) => s + tabla[c - 32], 0) * tamano / 1000 + espaciado * cs.length;
  }
  // Parte un texto en líneas que no pasen de «max» puntos (respeta los saltos de línea)
  function envolver(texto, fuente, tamano, max) {
    const mide = s => ancho(s, fuente, tamano);
    const lineas = [];
    for (const parrafo of String(texto ?? '').split('\n')) {
      let linea = '';
      for (let palabra of parrafo.split(/ +/)) {
        while (mide(palabra) > max) { // palabra más larga que la línea: se parte por letras
          let i = palabra.length;
          while (i > 1 && mide(palabra.slice(0, i)) > max) i--;
          if (linea) { lineas.push(linea); linea = ''; }
          lineas.push(palabra.slice(0, i));
          palabra = palabra.slice(i);
        }
        const prueba = linea ? `${linea} ${palabra}` : palabra;
        if (mide(prueba) <= max) linea = prueba;
        else { lineas.push(linea); linea = palabra; }
      }
      lineas.push(linea);
    }
    return lineas;
  }

  const num = v => String(Math.round(v * 100) / 100);
  const cadena = texto => codigos(texto).map(c =>
    c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c)
      : c >= 32 && c < 127 ? String.fromCharCode(c) : '\\' + c.toString(8).padStart(3, '0')).join('');
  // Texto para metadatos (título): UTF-16BE, admite cualquier carácter
  const textoMeta = s => '<FEFF' + [...String(s)].map(ch => {
    const u = ch.codePointAt(0);
    const unidades = u > 0xFFFF ? [0xD800 + ((u - 0x10000) >> 10), 0xDC00 + ((u - 0x10000) & 0x3FF)] : [u];
    return unidades.map(x => x.toString(16).padStart(4, '0')).join('');
  }).join('').toUpperCase() + '>';

  // Color: un número es gris (0 negro, 1 blanco); un array [r, g, b] es color, cada valor de 0 a 1
  const pintura = (c, trazo) => Array.isArray(c) ? `${c.map(num).join(' ')} ${trazo ? 'RG' : 'rg'}` : `${num(c)} ${trazo ? 'G' : 'g'}`;

  class Documento {
    constructor() { this.paginas = []; this.nuevaPagina(); }
    nuevaPagina() { this.ops = []; this.paginas.push(this.ops); return this.paginas.length; }
    irAPagina(n) { this.ops = this.paginas[n - 1]; }
    // y es la línea base del texto, medida desde arriba. Devuelve el ancho del texto.
    texto(x, y, s, { fuente = 'sans', tamano = 10, alinear = 'izquierda', espaciado = 0, color = 0 } = {}) {
      const w = ancho(s, fuente, tamano, espaciado);
      const x0 = alinear === 'derecha' ? x - w : alinear === 'centro' ? x - w / 2 : x;
      this.ops.push(`BT ${pintura(color)} /${CLAVES[fuente]} ${num(tamano)} Tf ${num(espaciado)} Tc 1 0 0 1 ${num(x0)} ${num(A4.alto - y)} Tm (${cadena(s)}) Tj ET`);
      return w;
    }
    linea(x1, y1, x2, y2, { grosor = 0.5, color = 0 } = {}) {
      this.ops.push(`${pintura(color, true)} ${num(grosor)} w ${num(x1)} ${num(A4.alto - y1)} m ${num(x2)} ${num(A4.alto - y2)} l S`);
    }
    // Rectángulo (y = borde superior) con esquinas redondeadas opcionales, relleno, borde o ambos
    rect(x, y, w, h, { radio = 0, relleno = null, borde = null, grosor = 1 } = {}) {
      const r = Math.min(radio, w / 2, h / 2), k = r * 0.5523;
      const [x1, x2, y1, y2] = [x, x + w, A4.alto - y, A4.alto - y - h];
      const p = [`${num(x1 + r)} ${num(y1)} m`, `${num(x2 - r)} ${num(y1)} l`,
        `${num(x2 - r + k)} ${num(y1)} ${num(x2)} ${num(y1 - r + k)} ${num(x2)} ${num(y1 - r)} c`, `${num(x2)} ${num(y2 + r)} l`,
        `${num(x2)} ${num(y2 + r - k)} ${num(x2 - r + k)} ${num(y2)} ${num(x2 - r)} ${num(y2)} c`, `${num(x1 + r)} ${num(y2)} l`,
        `${num(x1 + r - k)} ${num(y2)} ${num(x1)} ${num(y2 + r - k)} ${num(x1)} ${num(y2 + r)} c`, `${num(x1)} ${num(y1 - r)} l`,
        `${num(x1)} ${num(y1 - r + k)} ${num(x1 + r - k)} ${num(y1)} ${num(x1 + r)} ${num(y1)} c`];
      const estilo = [relleno !== null ? pintura(relleno) : '', borde !== null ? `${pintura(borde, true)} ${num(grosor)} w` : ''].filter(Boolean).join(' ');
      const pinta = relleno !== null && borde !== null ? 'B' : relleno !== null ? 'f' : 'S';
      this.ops.push(`${estilo} ${p.join(' ')} h ${pinta}`);
    }
    // Devuelve el archivo PDF (Blob). Todo el contenido es ASCII: cada carácter es un byte.
    generar(titulo = '') {
      const objetos = [];
      const fuentes = Object.keys(CLAVES).map(f => `<< /Type /Font /Subtype /Type1 /BaseFont /${FUENTES[f]} /Encoding /WinAnsiEncoding >>`);
      const n = this.paginas.length, primeraPagina = 3 + fuentes.length + 1;
      const kids = this.paginas.map((_, i) => `${primeraPagina + i * 2} 0 R`).join(' ');
      objetos.push('<< /Type /Catalog /Pages 2 0 R >>');
      objetos.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
      objetos.push(...fuentes);
      const d = new Date(), dos = v => String(v).padStart(2, '0');
      const fechaPdf = `D:${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
      objetos.push(`<< /Title ${textoMeta(titulo)} /Producer (Facturas) /CreationDate (${fechaPdf}) >>`);
      const recursos = '<< /Font << ' + Object.values(CLAVES).map((c, i) => `/${c} ${3 + i} 0 R`).join(' ') + ' >> >>';
      this.paginas.forEach((ops, i) => {
        const contenido = ops.join('\n');
        objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.ancho} ${A4.alto}] /Resources ${recursos} /Contents ${primeraPagina + i * 2 + 1} 0 R >>`);
        objetos.push(`<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`);
      });
      let pdf = '%PDF-1.4\n%âãÏÓ\n';
      const posiciones = objetos.map((o, i) => { const p = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
      const xref = pdf.length;
      pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n` + posiciones.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
      pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info ${3 + fuentes.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(pdf.length);
      for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i);
      return new Blob([bytes], { type: 'application/pdf' });
    }
  }

  return { Documento, ancho, envolver, A4, mm };
})();
