// Prepara a imagem no aparelho antes de enviar: aplica a rotação da foto, reduz para no
// máximo 1600 px no lado maior e gera um arquivo novo. O arquivo novo não carrega os
// metadados da foto (EXIF com a localização do GPS, modelo do celular, data). O servidor
// remove de novo, para quem envia por outro caminho.
export const MAX_SIDE = 1600;
export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export async function prepareImage(file) {
  if (!ACCEPTED.includes(file.type)) throw new Error('Escolha uma imagem JPEG, PNG ou WebP.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  // PNG continua PNG (pode ter transparência); o resto vira JPEG, bem menor.
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não deu para preparar a imagem.'))), type, 0.85));
  return { blob, width, height };
}
