// Leitura de imagens sem bibliotecas nativas: reconhece o formato pelos bytes, lê as
// dimensões e REMOVE os metadados (EXIF com a localização do GPS, XMP, IPTC, comentários
// e textos embutidos). Não decodifica nem redimensiona: o app já reduz a imagem no
// aparelho antes de enviar; aqui é a garantia para quem manda direto pela API.

export class ImageError extends Error {}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** 'image/jpeg' | 'image/png' | 'image/webp' | null, pelos primeiros bytes (nunca pelo cabeçalho HTTP). */
export function sniffType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * JPEG: copia os segmentos até o início da imagem (SOS), mantendo só APP0 (JFIF), APP2 com
 * perfil de cor (ICC) e APP14 (Adobe). Saem APP1 (EXIF/XMP), APP13 (IPTC), COM e os demais.
 */
function cleanJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2, width = 0, height = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new ImageError('JPEG corrompido');
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // bytes de preenchimento
    if (marker === 0xd9) { out.push(buf.subarray(i, i + 2)); break; }
    if (marker >= 0xd0 && marker <= 0xd7) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > buf.length) throw new ImageError('JPEG incompleto');
    const len = buf.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (len < 2 || end > buf.length) throw new ImageError('JPEG corrompido');
    const seg = buf.subarray(i, end);
    if (JPEG_SOF.has(marker)) { height = buf.readUInt16BE(i + 5); width = buf.readUInt16BE(i + 7); }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keepApp = marker === 0xe0 || marker === 0xee || (marker === 0xe2 && buf.toString('latin1', i + 4, i + 15) === 'ICC_PROFILE');
    if ((!isApp || keepApp) && marker !== 0xfe) out.push(seg);
    if (marker === 0xda) { out.push(buf.subarray(end)); break; } // dados da imagem até o fim
    i = end;
  }
  if (!width || !height) throw new ImageError('JPEG sem dimensões');
  return { bytes: Buffer.concat(out), width, height };
}

/** PNG: fica o que desenha a imagem; saem textos (tEXt, zTXt, iTXt), eXIf, tIME e animação. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD']);
function cleanPng(buf) {
  const out = [buf.subarray(0, 8)];
  let i = 8, width = 0, height = 0;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw new ImageError('PNG corrompido');
    if (type === 'IHDR') { width = buf.readUInt32BE(i + 8); height = buf.readUInt32BE(i + 12); }
    if (PNG_KEEP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  if (!width || !height) throw new ImageError('PNG sem dimensões');
  return { bytes: Buffer.concat(out), width, height };
}

/** WebP: saem os blocos EXIF e XMP (e as marcas deles no VP8X). Animação não é aceita. */
function cleanWebp(buf) {
  const chunks = [];
  let i = 12, width = 0, height = 0;
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > buf.length) throw new ImageError('WebP corrompido');
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'ANIM' || type === 'ANMF') throw new ImageError('WebP animado não é aceito');
    if (type === 'VP8X') { width = data.readUIntLE(4, 3) + 1; height = data.readUIntLE(7, 3) + 1; }
    if (type === 'VP8 ' && !width) { width = data.readUInt16LE(6) & 0x3fff; height = data.readUInt16LE(8) & 0x3fff; }
    if (type === 'VP8L' && !width) { const b = data.readUInt32LE(1); width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1; }
    if (type !== 'EXIF' && type !== 'XMP ') {
      let chunk = Buffer.from(buf.subarray(i, end));
      if (type === 'VP8X') chunk[8] &= ~(0x08 | 0x04); // sem as marcas de EXIF e XMP
      chunks.push(chunk);
    }
    i = end;
  }
  if (!width || !height) throw new ImageError('WebP sem dimensões');
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { bytes: Buffer.concat([header, body]), width, height };
}

/** Confere e limpa: devolve { type, bytes, width, height } ou lança ImageError com o motivo. */
export function cleanImage(buf) {
  const type = sniffType(buf);
  if (!type) throw new ImageError('Envie uma imagem JPEG, PNG ou WebP');
  try {
    const r = type === 'image/jpeg' ? cleanJpeg(buf) : type === 'image/png' ? cleanPng(buf) : cleanWebp(buf);
    return { type, ...r };
  } catch (err) {
    if (err instanceof ImageError) throw err;
    throw new ImageError('Imagem corrompida');
  }
}
