// The frame around a speech bubble, in page pixels: moved by hand in the reader, read again by the laptop.

export type Box = [number, number, number, number];
/** Which part of the frame is dragged: an edge, a corner, or `move` for the whole frame */
export type Grip = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** A frame smaller than this holds no readable text. */
export const MIN_FRAME = 12;

const within = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));

/** The frame in whole pixels inside the page; undefined when it is not a usable frame. */
export function clampFrame(box: unknown, w: number, h: number): Box | undefined {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return undefined;
  const [x1, y1, x2, y2] = box as number[];
  const frame: Box = [Math.round(within(x1, 0, w)), Math.round(within(y1, 0, h)), Math.round(within(x2, 0, w)), Math.round(within(y2, 0, h))];
  return frame[2] - frame[0] >= MIN_FRAME && frame[3] - frame[1] >= MIN_FRAME ? frame : undefined;
}

/** The frame after dragging `grip` by dx, dy: it stays on the page and never gets smaller than MIN_FRAME. */
export function dragFrame(box: Box, grip: Grip, dx: number, dy: number, w: number, h: number): Box {
  let [x1, y1, x2, y2] = box;
  if (grip === 'move') {
    const mx = within(dx, -x1, w - x2);
    const my = within(dy, -y1, h - y2);
    return [x1 + mx, y1 + my, x2 + mx, y2 + my];
  }
  if (grip.includes('w')) x1 = within(x1 + dx, 0, x2 - MIN_FRAME);
  if (grip.includes('e')) x2 = within(x2 + dx, x1 + MIN_FRAME, w);
  if (grip.includes('n')) y1 = within(y1 + dy, 0, y2 - MIN_FRAME);
  if (grip.includes('s')) y2 = within(y2 + dy, y1 + MIN_FRAME, h);
  return [x1, y1, x2, y2];
}

const holds = (outer: Box, inner: Box) => {
  const x = (inner[0] + inner[2]) / 2;
  const y = (inner[1] + inner[3]) / 2;
  return x >= outer[0] && x <= outer[2] && y >= outer[1] && y <= outer[3];
};

/** The blocks of a page read again, with the bubbles framed by hand kept: each replaces what was found in its place. */
export function keepFramed<T extends { box: Box; framed?: boolean }>(before: T[], after: T[]): T[] {
  const blocks = [...after];
  for (const framed of before.filter((b) => b.framed)) {
    const same = (b: T) => holds(framed.box, b.box) || holds(b.box, framed.box);
    const at = blocks.findIndex(same);
    const rest = blocks.filter((b) => !same(b));
    rest.splice(at < 0 ? rest.length : blocks.slice(0, at).filter((b) => !same(b)).length, 0, framed);
    blocks.splice(0, blocks.length, ...rest);
  }
  return blocks;
}
