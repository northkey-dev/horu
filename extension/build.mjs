import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
cpSync('static', 'dist', { recursive: true });
await build({
  entryPoints: ['src/background.ts', 'src/offscreen.ts', 'src/content.ts', 'src/worklet.ts', 'src/words.ts', 'src/options.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  logLevel: 'info',
});
