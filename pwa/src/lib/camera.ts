import { api, laptopUp } from './api.ts';
import { mineText } from './phone.ts';

// The camera: a photo of a sign, a menu, a pullover is read by the laptop (its text recognition), the lines
// become tappable on the picture, and a line can be mined with the photo as the card's picture.

export type PhotoLine = { text: string; box?: [number, number, number, number] };
export type Photo = { blob: Blob; url: string; w: number; h: number };

const MAX_SIDE = 1600;

/** Shrinks a photo from the camera (often 12 megapixels) before it is sent or kept; the phone's turn is applied. */
export async function preparePhoto(file: Blob): Promise<Photo> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older browsers: an <img> applies the turn by itself.
    const url = URL.createObjectURL(file);
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('This photo could not be opened.'));
      img.src = url;
    });
    URL.revokeObjectURL(url);
  }
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(source, 0, 0, w, h);
  if ('close' in source) source.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The photo could not be prepared.'))), 'image/jpeg', 0.85));
  return { blob, url: URL.createObjectURL(blob), w, h };
}

/** The lines of text on the photo, in reading order, with where they are. Needs the laptop. */
export async function readPhoto(photo: Photo): Promise<{ lines: PhotoLine[]; w: number; h: number; whole: boolean }> {
  if (!laptopUp()) throw new Error('Reading photos needs the laptop (its text recognition).');
  const res = await api.photoRead(photo.blob);
  return { lines: res.blocks.map((b) => ({ text: b.text, box: b.box })), w: res.w || photo.w, h: res.h || photo.h, whole: Boolean(res.whole) };
}

/** Reads the region the user framed (photo pixels): one word, a single character, handwriting. Needs the laptop. */
export async function readRegion(photo: Photo, box: [number, number, number, number]): Promise<PhotoLine | undefined> {
  if (!laptopUp()) throw new Error('Reading a frame needs the laptop (its text recognition).');
  const { text } = await api.photoRegion(photo.blob, box);
  return text.trim() ? { text: text.trim(), box } : undefined;
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Sends a line to the inbox: with the laptop the photo comes along as the card's picture, without it only
 * the text is kept on the phone. Returns where it went.
 */
export async function minePhotoLine(photo: Photo | undefined, line: PhotoLine, size: { w: number; h: number }, targetHint?: string): Promise<'inbox' | 'phone'> {
  if (laptopUp()) {
    try {
      await api.cameraMine({ image: photo ? await toBase64(photo.blob) : undefined, text: line.text, targetHint, box: line.box, w: size.w, h: size.h });
      return 'inbox';
    } catch {
      // the laptop went away: keep the text on the phone
    }
  }
  mineText(line.text, targetHint ?? '', 'Camera', 'Camera');
  return 'phone';
}
