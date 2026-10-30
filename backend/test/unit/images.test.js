import { describe, expect, it } from 'vitest';
import { cleanImage, ImageError, sniffType } from '../../src/lib/images.js';
import { encodePng, pngChunk } from '../../src/lib/png.js';

const seg = (marker, payload) => {
  const b = Buffer.alloc(4);
  b[0] = 0xff; b[1] = marker; b.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([b, payload]);
};
// JPEG sintético: o leitor não decodifica a imagem, só percorre os segmentos.
function fakeJpeg({ exif = true } = {}) {
  const sof = Buffer.from([8, 0x01, 0x2c, 0x02, 0x58, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]); // 600 × 300
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    ...(exif ? [seg(0xe1, Buffer.from('Exif\0\0GPSLatitude -23.5505 GPSLongitude -46.6333', 'latin1'))] : []),
    seg(0xed, Buffer.from('Photoshop 3.0\0IPTC cidade: São Paulo', 'latin1')),
    seg(0xfe, Buffer.from('comentário com nome do autor', 'latin1')),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]),
  ]);
}

describe('imagens: tipo pelos bytes, dimensões e metadados', () => {
  it('reconhece o tipo pelos bytes, não pelo nome nem pelo cabeçalho', () => {
    expect(sniffType(fakeJpeg())).toBe('image/jpeg');
    expect(sniffType(encodePng(2, 2, () => [0, 0, 0]))).toBe('image/png');
    expect(sniffType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(sniffType(Buffer.from('<svg onload="alert(1)">'))).toBeNull();
    expect(sniffType(Buffer.from('GIF89a'))).toBeNull();
  });

  it('JPEG: sai EXIF (com GPS), IPTC e comentário; ficam JFIF e a imagem', () => {
    const r = cleanImage(fakeJpeg());
    expect(r).toMatchObject({ type: 'image/jpeg', width: 600, height: 300 });
    const s = r.bytes.toString('latin1');
    expect(s).not.toMatch(/Exif|GPS|IPTC|São Paulo|comentário/);
    expect(s).toContain('JFIF');
    expect(r.bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(r.bytes.length).toBeLessThan(fakeJpeg().length);
  });

  it('PNG: saem textos e eXIf, e a imagem continua igual', () => {
    const clean = encodePng(4, 3, (x, y) => [x * 60, y * 80, 200]);
    const dirty = encodePng(4, 3, (x, y) => [x * 60, y * 80, 200], [
      pngChunk('tEXt', Buffer.from('Author\0Fulana de Tal', 'latin1')),
      pngChunk('eXIf', Buffer.from('MM\0*GPS -23.55', 'latin1')),
      pngChunk('tIME', Buffer.from([7, 234, 10, 30, 12, 0, 0])),
    ]);
    const r = cleanImage(dirty);
    expect(r).toMatchObject({ type: 'image/png', width: 4, height: 3 });
    expect(r.bytes.toString('latin1')).not.toMatch(/Fulana|GPS|tEXt|eXIf|tIME/);
    expect(r.bytes.equals(clean)).toBe(true);
  });

  it('WebP: saem EXIF e XMP, e as marcas no VP8X são apagadas', () => {
    const chunk = (type, data) => { const h = Buffer.alloc(8); h.write(type, 0, 'latin1'); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
    const vp8x = Buffer.alloc(10); vp8x[0] = 0x08 | 0x04; vp8x.writeUIntLE(799, 4, 3); vp8x.writeUIntLE(399, 7, 3);
    const body = Buffer.concat([chunk('VP8X', vp8x), chunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])), chunk('EXIF', Buffer.from('GPS -23.55')), chunk('XMP ', Buffer.from('<x:creator>Fulana</x:creator>'))]);
    const head = Buffer.alloc(12); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'latin1');
    const r = cleanImage(Buffer.concat([head, body]));
    expect(r).toMatchObject({ type: 'image/webp', width: 800, height: 400 });
    expect(r.bytes.toString('latin1')).not.toMatch(/GPS|Fulana|EXIF|XMP/);
    expect(r.bytes[20] & 0x0c).toBe(0);
    expect(r.bytes.readUInt32LE(4)).toBe(r.bytes.length - 8);
  });

  it('recusa o que não é imagem e arquivo truncado', () => {
    expect(() => cleanImage(Buffer.from('<svg/>'))).toThrow(ImageError);
    expect(() => cleanImage(fakeJpeg().subarray(0, 30))).toThrow(/JPEG/);
    expect(() => cleanImage(encodePng(2, 2, () => [0, 0, 0]).subarray(0, 20))).toThrow(ImageError);
  });
});
