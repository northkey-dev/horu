// Builds JMdict and KANJIDIC into the data folder, so an app build without a laptop service ships them.
// Used by the "Publish app" workflow.

import fs from 'node:fs';
import { DICT_GZ, ensureDictionary } from '../server/src/dict.ts';
import { KANJI_GZ, loadKanjidic } from '../server/src/kanji.ts';

await ensureDictionary();
await loadKanjidic();
for (const file of [DICT_GZ, KANJI_GZ]) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  console.log(`${file}: ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}
process.exit(0);
