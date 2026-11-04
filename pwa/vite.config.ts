import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);

/** The tokenizer dictionary and JMdict ship with the app, so they work on a phone that never saw the laptop. */
function kuromojiDict(): Plugin {
  return {
    name: 'horu-kuromoji-dict',
    apply: 'build',
    closeBundle() {
      const from = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
      fs.cpSync(from, path.resolve(import.meta.dirname, 'dist/dict/kuromoji'), { recursive: true });
      // JMdict (built by the laptop service, server/src/dict.ts) for phones without a laptop.
      const jmdict = path.resolve(import.meta.dirname, '..', process.env.HORU_DATA ?? 'data', 'dict', 'jmdict.json.gz');
      if (fs.existsSync(jmdict)) fs.copyFileSync(jmdict, path.resolve(import.meta.dirname, 'dist/dict/jmdict.json.gz'));
      else this.warn('data/dict/jmdict.json.gz missing: the app will need a laptop for dictionary lookups (run the service once to build it)');
      // KANJIDIC (server/src/kanji.ts): meanings and furigana when JMdict has no word.
      const kanjidic = path.resolve(path.dirname(jmdict), 'kanjidic.json.gz');
      if (fs.existsSync(kanjidic)) fs.copyFileSync(kanjidic, path.resolve(import.meta.dirname, 'dist/dict/kanjidic.json.gz'));
    },
  };
}

/** Tells the service worker what this build consists of (see BUILD and ASSETS in public/sw.js). */
function shellList(): Plugin {
  return {
    name: 'horu-shell-list',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve(import.meta.dirname, 'dist');
      const assets = fs.readdirSync(path.join(dist, 'assets')).sort().map((f) => `assets/${f}`);
      const build = createHash('sha256').update(assets.join()).digest('hex').slice(0, 10);
      const sw = path.join(dist, 'sw.js');
      fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace("const BUILD = 'dev';", `const BUILD = '${build}';`).replace('const ASSETS = [];', `const ASSETS = ${JSON.stringify(assets)};`));
    },
  };
}

export default defineConfig({
  // Relative, so the same build runs on GitHub Pages (/horu/) and from the laptop (/).
  base: './',
  plugins: [react(), kuromojiDict(), shellList()],
  // Shown in Settings next to the laptop's, to see whether both run the newest code.
  define: { __APP_VERSION__: JSON.stringify((JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }).version) },
  server: {
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:7317',
      '/dict': 'http://127.0.0.1:7317',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
