import { run } from './proc.ts';
import { log } from './log.ts';

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

/** Saves a crop of the page around the text block (with some panel context) as JPEG. */
export async function cropAround(src: string, page: { w: number; h: number }, box: number[] | undefined, out: string): Promise<boolean> {
  try {
    if (!box || !page.w) {
      await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=min(900\\,iw):-2', '-q:v', '4', out]);
      return true;
    }
    const [x1, y1, x2, y2] = box;
    const padX = Math.max(120, (x2 - x1) * 1.2);
    const padY = Math.max(120, (y2 - y1) * 0.6);
    const x = Math.max(0, Math.round(x1 - padX));
    const y = Math.max(0, Math.round(y1 - padY));
    const w = Math.min(page.w - x, Math.round(x2 - x1 + 2 * padX));
    const hgt = Math.min(page.h - y, Math.round(y2 - y1 + 2 * padY));
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-vf', `crop=${w}:${hgt}:${x}:${y},scale=min(700\\,iw):-2`, '-q:v', '4', out]);
    return true;
  } catch (err) {
    log.warn('Crop failed', err);
    return false;
  }
}
