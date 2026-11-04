// Horu end-to-end test: simulates a real evening.
// Phone (emulated iPhone) + laptop tab with the real Chrome extension, real
// Whisper, real Claude Code, real Anki (test deck), real Suwayomi + OCR.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

// Runs from a working copy of tests/e2e (with puppeteer-core installed next to it), see README.
const SP = import.meta.dirname.replaceAll('\\', '/');
const ROOT = process.env.HORU_ROOT;
if (!ROOT) throw new Error('Set HORU_ROOT to the repo folder, see README.');
const EXT = `${ROOT}/extension/dist`;
const EXT_ID = 'mndgnojkakdnnkkjenpokckpjbpgdjpg';
const APP = 'http://localhost:7317';
const DECK = 'Horu E2E Test';
const SHOTS = `${SP}/e2e-shots`;
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let stepNo = 0;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
async function step(name, fn) {
  stepNo++;
  const start = Date.now();
  try {
    await fn();
    results.push({ step: stepNo, name, ok: true, s: ((Date.now() - start) / 1000).toFixed(1) });
    log(`✔ ${stepNo}. ${name}`);
  } catch (err) {
    results.push({ step: stepNo, name, ok: false, s: ((Date.now() - start) / 1000).toFixed(1), error: err.message });
    log(`✘ ${stepNo}. ${name}: ${err.message}`);
    await phone?.screenshot({ path: `${SHOTS}/FAIL-${stepNo}.png` }).catch(() => {});
    throw err;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 30000, every = 500, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(every);
  }
  throw new Error(`timeout waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
}
const api = async (path, opts = {}) => {
  const res = await fetch(APP + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
  return res.json();
};
const anki = async (action, params = {}) => {
  const res = await fetch('http://127.0.0.1:8765', { method: 'POST', body: JSON.stringify({ action, version: 6, params }) });
  const data = await res.json();
  if (data.error) throw new Error(`anki ${action}: ${data.error}`);
  return data.result;
};
async function tap(page, selector, text) {
  const handle = await until(
    async () => {
      const els = await page.$$(selector);
      for (const el of els) {
        const t = await el.evaluate((e) => e.textContent ?? '');
        const disabled = await el.evaluate((e) => e.disabled === true);
        if ((!text || t.includes(text)) && !disabled) return el;
      }
      return null;
    },
    { what: `${selector} ${text ?? ''}`, timeout: 20000 },
  );
  await centerTap(handle);
  return handle;
}
/** Like a finger: scroll the element to the middle of the screen first, then tap it. */
async function centerTap(handle) {
  await handle.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }));
  await sleep(150);
  await handle.tap();
}
const textOf = (page) => page.evaluate(() => document.body.innerText);
let phone;

// ------------------------------------------------------------------ setup

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  // Headful: Chrome only feeds tab audio into the capture when it has a real audio output.
  headless: false,
  pipe: true,
  enableExtensions: [EXT],
  args: [`--allowlisted-extension-id=${EXT_ID}`, '--autoplay-policy=no-user-gesture-required', '--window-size=1280,860'],
});

try {
  // The phone gets its own window (context) so it stays visible while the laptop tab plays.
  const phoneContext = await browser.createBrowserContext();
  phone = await phoneContext.newPage();
  await phone.emulate({
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  phone.on('pageerror', (e) => log('phone pageerror:', e.message));
  const shot = (name) => phone.screenshot({ path: `${SHOTS}/${String(stepNo).padStart(2, '0')}-${name}.png` });

  // ------------------------------------------------------------ settings

  // Fresh state for repeatable runs.
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ deckName: 'Anime Mining', kanjiCards: false, animeScreenshot: true }) });
  await api('/api/sessions/end', { method: 'POST' });

  await step('Phone opens Horu, laptop status is green', async () => {
    await phone.goto(`${APP}/#/settings`, { waitUntil: 'networkidle0' });
    await until(async () => /Laptop\s+v\d/.test(await textOf(phone)), { what: 'status chip' });
    await shot('settings');
  });

  await step('Settings: test deck + kanji cards, saved', async () => {
    await phone.evaluate((deck) => {
      const input = [...document.querySelectorAll('label.field')].find((l) => l.textContent.includes('Anki deck')).querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, deck);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, DECK);
    await phone.evaluate(() => {
      const box = [...document.querySelectorAll('label.toggle')].find((l) => l.textContent.includes('Kanji cards')).querySelector('input');
      if (!box.checked) box.click();
    });
    await tap(phone, '.action-bar button', 'Save');
    await until(async () => (await api('/api/settings')).deckName === DECK, { what: 'deck saved' });
    assert((await api('/api/settings')).kanjiCards === true, 'kanji cards not saved');
  });

  // ------------------------------------------------------------ anime evening

  await step('Phone: start "E2E Anime" episode 1 without Jimaku', async () => {
    await phone.goto(`${APP}/#/watch`, { waitUntil: 'networkidle0' });
    await phone.waitForSelector('input[placeholder="Title"]');
    await phone.type('input[placeholder="Title"]', 'E2E Anime');
    await tap(phone, 'button', 'Start');
    await phone.waitForSelector('.mark-btn', { timeout: 10000 });
    await shot('session');
  });

  await step('Phone: upload Japanese subtitles (.srt)', async () => {
    const input = await phone.$('input[type=file]');
    await input.uploadFile(`${SP}/media/ep.srt`);
    await until(async () => /Subtitles\s+3 lines/.test(await textOf(phone)), { what: 'subs loaded' });
  });

  const laptop = await browser.newPage();
  await laptop.setViewport({ width: 1200, height: 760 });
  await step('Laptop: open anime site, video plays inside a cross-origin player', async () => {
    await laptop.goto('http://localhost:8098/index.html', { waitUntil: 'networkidle0' });
    await laptop.bringToFront();
    const frame = await until(() => laptop.frames().find((f) => f.url().includes('player.html')), { what: 'player frame' });
    await frame.waitForSelector('video');
    await frame.evaluate(() => {
      const v = document.querySelector('video');
      v.currentTime = 0;
      v.pause();
    });
  });

  await step('Laptop: click the Horu icon → recording starts, phone turns green', async () => {
    const extensions = await browser.extensions();
    const ext = extensions.get(EXT_ID) ?? [...extensions.values()][0];
    assert(ext, 'extension not loaded');
    await laptop.triggerExtensionAction(ext);
    await until(async () => (await api('/api/status')).extensionRecording, { what: 'recording', timeout: 15000 });
    await until(async () => /Chrome\s+Recording/.test(await textOf(phone)), { what: 'phone recording chip' });
    await shot('recording');
  });

  const frame = laptop.frames().find((f) => f.url().includes('player.html'));
  const videoTime = () => frame.evaluate(() => document.querySelector('video').currentTime);
  await step('Laptop: episode plays (with sound into the tab capture)', async () => {
    await frame.evaluate(() => document.querySelector('video').play());
    await until(async () => (await videoTime()) > 1, { what: 'playback' });
  });

  await step('Phone: tap Mark right after line 2 (no pausing)', async () => {
    await until(async () => (await videoTime()) >= 10.3, { what: 'video at 10.3 s', every: 100, timeout: 20000 });
    await tap(phone, '.mark-btn');
    await until(async () => (await api('/api/status')).sessionMarks === 1, { what: 'mark 1' });
  });

  await step('Phone: tap Mark after line 3, then once by accident + Undo', async () => {
    await until(async () => (await videoTime()) >= 15.6, { what: 'video at 15.6 s', every: 100, timeout: 20000 });
    await tap(phone, '.mark-btn');
    await until(async () => (await api('/api/status')).sessionMarks === 2, { what: 'mark 2' });
    await sleep(800);
    await tap(phone, '.mark-btn');
    await until(async () => (await api('/api/status')).sessionMarks === 3, { what: 'mark 3' });
    await tap(phone, 'button', 'Undo');
    await until(async () => (await api('/api/status')).sessionMarks === 2, { what: 'undo' });
    assert((await frame.evaluate(() => document.querySelector('video').paused)) === false, 'video must never pause');
    await shot('marked');
  });

  await step('Moments captured: audio, screenshot, the right subtitle candidates', async () => {
    const inbox = await until(
      async () => {
        const list = (await api('/api/inbox')).filter((m) => m.title === 'E2E Anime');
        return list.length === 2 && list.every((m) => m.status === 'ready') && list;
      },
      { what: 'moments ready', timeout: 30000 },
    );
    for (const m of inbox) {
      assert(m.hasAudio, 'no audio');
      assert(m.hasImage, 'no screenshot');
      assert(m.candidates.length >= 2, 'too few candidates');
    }
    const older = inbox[1];
    assert(Math.abs(older.videoTime - 10.3) < 1.5, `video time off: ${older.videoTime}`);
    assert(older.candidates.some((c) => c.text.includes('言ってんのかよ')), 'line 2 missing');
  });

  await step('Whisper listened and matched the spoken line by ear', async () => {
    const matched = await until(
      async () => {
        const list = (await api('/api/inbox')).filter((m) => m.title === 'E2E Anime');
        return list.every((m) => m.matchedIndex !== undefined) && list;
      },
      { what: 'whisper match', timeout: 180000, every: 2000 },
    );
    const [newer, older] = matched;
    assert(older.candidates[older.matchedIndex].text.includes('言ってんのかよ'), `older matched: ${older.candidates[older.matchedIndex].text}`);
    assert(newer.candidates[newer.matchedIndex].text.includes('うるさい'), `newer matched: ${newer.candidates[newer.matchedIndex].text}`);
  });

  // ------------------------------------------------------------ inbox

  let olderId;
  await step('Phone: inbox shows both moments with a badge', async () => {
    await phone.goto(`${APP}/#/inbox`, { waitUntil: 'networkidle0' });
    await until(async () => (await phone.$$('.list-item')).length >= 2, { what: 'inbox rows' });
    const badge = await phone.$eval('.tabbar .badge', (e) => e.textContent);
    assert(Number(badge) >= 2, 'badge');
    olderId = (await api('/api/inbox')).filter((m) => m.title === 'E2E Anime')[1].id;
    await shot('inbox');
  });

  await step('Phone: open moment, line preselected by ear, listen to the clip', async () => {
    await phone.goto(`${APP}/#/inbox/${olderId}`, { waitUntil: 'networkidle0' });
    await until(async () => (await phone.$eval('.cand.sel', (e) => e.textContent)).includes('言ってんのかよ'), { what: 'preselected line' });
    assert((await textOf(phone)).includes('matched by ear'), 'matched label');
    await tap(phone, 'button', 'This line');
    await until(() => phone.evaluate(() => !document.querySelector('audio').paused || document.querySelector('audio').currentTime > 0), { what: 'audio plays' });
    await shot('item');
  });

  await step('Phone: tap 言っ → dictionary popup (offline JMdict) → use as target', async () => {
    await until(async () => (await phone.$$('.tok')).length > 5, { what: 'tokens' });
    const toks = await phone.$$('.tok');
    let target;
    for (const t of toks) if ((await t.evaluate((e) => e.textContent)) === '言っ') target = t;
    assert(target, 'token 言っ not found');
    await centerTap(target);
    await phone.waitForSelector('.sheet .entry', { timeout: 15000 });
    const sheet = await phone.$eval('.sheet', (e) => e.innerText);
    assert(/to say/i.test(sheet), `dictionary has no "to say": ${sheet.slice(0, 200)}`);
    await shot('dictionary');
    // Pull the sheet down by its handle, like a finger: it must close.
    const grab = await (await phone.$('.sheet .grabber')).boundingBox();
    await phone.touchscreen.touchStart(grab.x + grab.width / 2, grab.y + 6);
    for (const dy of [30, 80, 140, 200]) {
      await phone.touchscreen.touchMove(grab.x + grab.width / 2, grab.y + 6 + dy);
      await sleep(40);
    }
    await phone.touchscreen.touchEnd();
    await until(async () => !(await phone.$('.sheet')), { what: 'sheet dismissed by pulling down' });
    await centerTap(target);
    await phone.waitForSelector('.sheet .entry', { timeout: 15000 });
    await tap(phone, '.sheet button', 'Use as target');
    await until(async () => (await phone.$eval('.target-line', (e) => e.innerText)).includes('言う'), { what: 'target set' });
  });

  await step('Phone: Create card (Claude explanation) → jumps to next moment', async () => {
    await tap(phone, '.action-bar button', 'Create card');
    await until(() => phone.evaluate((id) => !location.hash.includes(id), olderId), { what: 'navigated to next', timeout: 15000 });
  });

  await step('Phone: second moment → suggested target → card without AI', async () => {
    await until(async () => (await phone.$$('.cand')).length > 0, { what: 'second item' });
    await until(async () => (await phone.$eval('.target-line', (e) => e.innerText)).includes('suggested'), { what: 'suggestion' });
    await tap(phone, '.action-bar button', 'No AI');
    await until(() => phone.evaluate(() => location.hash === '#/inbox' || location.hash.startsWith('#/inbox/')), { what: 'back to inbox' });
  });

  await step('Anki: both notes exist with audio, image, furigana, explanation (+ kanji card)', async () => {
    await until(
      async () => (await api('/api/moments?limit=50')).filter((m) => m.title === 'E2E Anime' && m.status === 'done').length === 2,
      { what: 'cards done', timeout: 240000, every: 2000 },
    );
    const ids = await anki('findNotes', { query: `"deck:${DECK}" note:"Horu Sentence"` });
    assert(ids.length === 2, `notes: ${ids.length}`);
    const notes = await anki('notesInfo', { notes: ids });
    const withAi = notes.find((n) => n.fields.Explanation.value.length > 40);
    assert(withAi, 'no explanation');
    for (const n of notes) {
      assert(n.fields.Audio.value.startsWith('[sound:horu_'), 'audio field');
      assert(n.fields.Image.value.includes('<img'), 'image field');
      assert(n.fields.SentenceFurigana.value.includes('<ruby>') || !/[一-龯]/.test(n.fields.Sentence.value), 'furigana');
      const media = n.fields.Audio.value.match(/\[sound:(.+)\]/)[1];
      assert(await anki('retrieveMediaFile', { filename: media }), 'media missing in Anki');
    }
    assert(withAi.fields.Target.value === '言う', `target: ${withAi.fields.Target.value}`);
    // The card audio is the cut-out line, not the whole 25 s buffer.
    for (const n of notes) {
      const file = n.fields.Audio.value.match(/\[sound:(.+)\]/)[1];
      const mp3 = `${SHOTS}/${file}`;
      fs.writeFileSync(mp3, Buffer.from(await anki('retrieveMediaFile', { filename: file }), 'base64'));
      const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString());
      assert(seconds > 1 && seconds < 9, `card audio is ${seconds} s long`);
    }
    const done = (await api('/api/moments?limit=50')).filter((m) => m.title === 'E2E Anime' && m.status === 'done');
    for (const m of done) assert(m.syncOffset > -3.5 && m.syncOffset < -1.5, `sync offset ${m.syncOffset} (subs are 2.5 s late)`);
    assert(withAi.fields.Translation.value.length > 5, 'translation');
    const kanji = await anki('findNotes', { query: `"deck:${DECK}::Kanji"` });
    assert(kanji.length >= 1, 'kanji card missing');
    fs.writeFileSync(`${SHOTS}/note.json`, JSON.stringify(withAi.fields, null, 2));
  });

  await step('History lists everything; a finished moment can be put back, and a discarded one keeps its audio', async () => {
    await phone.goto(`${APP}/#/history`, { waitUntil: 'networkidle0' });
    await until(async () => (await phone.$$('.list-item')).length >= 2, { what: 'history rows' });
    assert(((await textOf(phone)).match(/\bCard\b/g) ?? []).length >= 2, 'history shows the cards');
    const m = (await api('/api/moments?limit=50')).find((x) => x.title === 'E2E Anime' && x.status === 'done');
    await phone.goto(`${APP}/#/inbox/${m.id}`, { waitUntil: 'networkidle0' });
    await tap(phone, 'button', 'Put back in inbox');
    await until(async () => (await api('/api/inbox')).some((x) => x.id === m.id && x.status === 'ready'), { what: 'restored' });
    await api(`/api/moments/${m.id}/discard`, { method: 'POST' });
    const audio = await fetch(`${APP}/api/moments/${m.id}/audio`);
    assert(audio.ok, 'audio of a discarded moment must stay available');
    await shot('history');
  });

  await step('Laptop: click icon again → recording stops', async () => {
    const ext = [...(await browser.extensions()).values()][0];
    await laptop.triggerExtensionAction(ext);
    await until(async () => !(await api('/api/status')).extensionRecording, { what: 'stopped' });
  });

  await step('Phone: end the episode → "Continue" offers episode 2', async () => {
    await phone.goto(`${APP}/#/watch`, { waitUntil: 'networkidle0' });
    await tap(phone, 'button', 'End');
    await until(async () => (await textOf(phone)).includes('Episode 2'), { what: 'continue ep 2' });
    await shot('continue');
  });

  // ------------------------------------------------------------ manga

  await step('Phone: Manga → Find → install a Japanese source (Jump Rookie!)', async () => {
    await phone.goto(`${APP}/#/manga/browse`, { waitUntil: 'networkidle0' });
    // The source list opens by itself when no source is installed yet, so wait until loading is over.
    await until(async () => !(await textOf(phone)).includes('Starting the manga server'), { what: 'browse', timeout: 120000 });
    await sleep(500);
    const sources = await api('/api/manga/sources');
    if (!sources.some((s) => s.name.includes('Jump Rookie'))) {
      if (!(await textOf(phone)).includes('Hide sources')) await tap(phone, 'button', 'Manage sources');
      await phone.waitForSelector('input[placeholder="Filter"]', { timeout: 60000 });
      await phone.type('input[placeholder="Filter"]', 'Jump Rookie');
      await tap(phone, 'button', 'Install');
      await until(async () => (await api('/api/manga/sources')).some((s) => s.name.includes('Jump Rookie')), { what: 'source installed', timeout: 90000 });
      await phone.reload({ waitUntil: 'networkidle0' });
    }
    await until(() => phone.$('select'), { what: 'source select', timeout: 30000 });
  });

  let mangaId;
  await step('Phone: search (popular) → open a manga → Start reading', async () => {
    const sources = await api('/api/manga/sources');
    const rookie = sources.find((s) => s.name.includes('Jump Rookie'));
    await phone.select('select', rookie.id);
    await tap(phone, 'button', 'Search');
    await until(async () => (await phone.$$('.grid-item')).length > 0, { what: 'results', timeout: 60000 });
    await shot('results');
    await centerTap(await phone.$('.grid-item'));
    await until(() => phone.evaluate(() => location.hash.includes('manga/remote/')), { what: 'detail' });
    mangaId = Number(await phone.evaluate(() => location.hash.split('/').pop()));
    await tap(phone, 'button', 'Start reading');
    await until(async () => (await api('/api/manga/library')).some((m) => m.key === `s${mangaId}`), { what: 'in library' });
    await shot('detail');
  });

  await step('Laptop prepares the first chapter (download + OCR)', async () => {
    await until(
      async () => {
        const ch = await api(`/api/manga/library/s${mangaId}/chapters`);
        return ch.some((c) => c.status === 'ready') && ch;
      },
      { what: 'chapter ready', timeout: 600000, every: 5000 },
    );
  });

  let chapterKey;
  await step('Phone: open chapter in the reader, tap a speech bubble → text + dictionary', async () => {
    chapterKey = (await api(`/api/manga/library/s${mangaId}/chapters`)).find((c) => c.status === 'ready').key;
    await phone.goto(`${APP}/#/manga/read/${chapterKey}`, { waitUntil: 'networkidle0' });
    // Find a page with text blocks.
    for (let i = 0; i < 8 && (await phone.$$('.block')).length === 0; i++) {
      await phone.evaluate(() => document.querySelector('.reader-bottom button')?.click());
      await sleep(700);
    }
    const blocks = await phone.$$('.block');
    assert(blocks.length > 0, 'no OCR blocks on first pages');
    await blocks[0].tap();
    await phone.waitForSelector('.reader-sheet .tok', { timeout: 15000 });
    await sleep(500); // let the sheet finish sliding up, or the tap lands below the word
    await (await phone.$('.reader-sheet .tok')).tap();
    await phone.waitForSelector('.sheet .entry, .sheet p', { timeout: 15000 });
    await shot('reader-lookup');
    await phone.mouse.click(195, 100); // close the word sheet via backdrop
    await sleep(300);
  });

  await step('Phone: "Mine this line" → manga line lands in the inbox', async () => {
    const before = (await api('/api/inbox')).filter((m) => m.kind === 'manga').length;
    await tap(phone, '.reader-sheet button', 'Mine this line');
    await until(async () => (await textOf(phone)).includes('Added to inbox'), { what: 'toast' });
    await until(async () => (await api('/api/inbox')).filter((m) => m.kind === 'manga').length === before + 1, { what: 'manga moment' });
  });

  await step('Phone: Sync saves chapters for offline reading', async () => {
    await phone.goto(`${APP}/#/manga`, { waitUntil: 'networkidle0' });
    await tap(phone, 'button', 'Sync');
    await until(async () => /chapter\(s\) saved|already on this phone/.test(await textOf(phone)), { what: 'sync done', timeout: 180000 });
    const count = await phone.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('horu-offline-chapters') ?? '{}')).length);
    assert(count >= 1, 'nothing cached');
    await shot('synced');
  });

  await step('Offline (laptop unreachable): read the chapter, look up a word, mine a line', async () => {
    await phone.setOfflineMode(true);
    await phone.goto(`${APP}/#/manga/read/${chapterKey}`).catch(() => {});
    await phone.waitForSelector('.reader-page img', { timeout: 20000 });
    await until(() => phone.evaluate(() => document.querySelector('.reader-page img')?.naturalWidth > 0), { what: 'page image from cache' });
    for (let i = 0; i < 8 && (await phone.$$('.block')).length === 0; i++) {
      await phone.evaluate(() => document.querySelector('.reader-bottom button')?.click());
      await sleep(700);
    }
    await (await phone.$('.block')).tap();
    await phone.waitForSelector('.reader-sheet .tok', { timeout: 15000 });
    await sleep(500);
    await tap(phone, '.reader-sheet button', 'Mine this line');
    await until(async () => (await textOf(phone)).includes('goes to the inbox'), { what: 'offline toast' });
    await shot('offline');
  });

  await step('Back online: the queued line reaches the inbox', async () => {
    const before = (await api('/api/inbox')).filter((m) => m.kind === 'manga').length;
    await phone.setOfflineMode(false);
    await phone.goto(`${APP}/#/manga`, { waitUntil: 'networkidle0' });
    await until(async () => (await api('/api/inbox')).filter((m) => m.kind === 'manga').length === before + 1, { what: 'flushed', timeout: 20000 });
  });

  await step('Phone: manga moment → card in Anki with the cropped panel', async () => {
    const m = (await api('/api/inbox')).find((x) => x.kind === 'manga');
    await phone.goto(`${APP}/#/inbox/${m.id}`, { waitUntil: 'networkidle0' });
    await until(async () => (await phone.$$('.tok')).length > 0, { what: 'tokens' });
    await until(async () => (await phone.$eval('.target-line', (e) => e.innerText)).length > 0, { what: 'target line' });
    await shot('manga-item');
    await tap(phone, '.action-bar button', 'No AI');
    await until(async () => (await api(`/api/moments/${m.id}`)).status === 'done', { what: 'manga card', timeout: 60000 });
    const ids = await anki('findNotes', { query: `"deck:${DECK}" tag:manga` });
    assert(ids.length >= 1, 'manga note missing');
    const [note] = await anki('notesInfo', { notes: ids });
    assert(note.fields.Image.value.includes('<img'), 'manga crop missing');
  });

  // ------------------------------------------------------------ extras

  await step('Insights: streak, goal ring, calendar, vocabulary, achievements; Anki and Mining tabs', async () => {
    await phone.goto(`${APP}/#/insights`, { waitUntil: 'networkidle0' });
    await until(async () => (await phone.$$('.hero')).length === 1, { what: 'overview' });
    const text = await textOf(phone);
    assert(/streak/i.test(text) && /words you probably know/.test(text) && /achievements/i.test(text), 'overview text');
    assert((await phone.$$('.chart .col')).length === 30, 'xp chart');
    assert((await phone.$$('.heat .hm')).length >= 26 * 7 - 6, 'calendar');
    assert((await phone.$$('.ach-item')).length === 8, 'achievements');
    await shot('insights');
    await tap(phone, '.tabs button', 'Mining');
    await until(async () => (await phone.$$('.tile')).length === 4, { what: 'mining tiles' });
    assert(/moments marked/i.test(await textOf(phone)), 'mining text');
    await shot('insights-mining');
    await tap(phone, '.tabs button', 'Anki');
    // Anki is running during the test, so its history is read (or, on a fresh machine, the empty state shows).
    await until(async () => /study time/i.test(await textOf(phone)) || /no anki history yet/i.test(await textOf(phone)), { what: 'anki tab' });
    await shot('insights-anki');
  });

  await step('Back-Tap endpoint: screenshot → text, readings, new words', async () => {
    const page = fs.readdirSync(`${ROOT}/data-e2e/manga/${chapterKey}`).find((f) => /^00[0-3]\./.test(f));
    const img = fs.readFileSync(`${ROOT}/data-e2e/manga/${chapterKey}/${page}`);
    const res = await fetch(`${APP}/api/screen?format=text`, { method: 'POST', body: img });
    const text = await res.text();
    assert(text.includes('Saved to the Horu inbox') || text.startsWith('Horu: No Japanese text'), `screen: ${text.slice(0, 200)}`);
    fs.writeFileSync(`${SHOTS}/screen.txt`, text);
  });

  await step('Card design: render the Anki note (front + back) for review', async () => {
    const fields = JSON.parse(fs.readFileSync(`${SHOTS}/note.json`, 'utf8'));
    const templates = await anki('modelTemplates', { modelName: 'Horu Sentence' });
    const { css } = await anki('modelStyling', { modelName: 'Horu Sentence' });
    const fill = (tpl) =>
      tpl
        .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, inner) => (fields[k]?.value ? inner : ''))
        .replace(/\{\{(\w+)\}\}/g, (_, k) => (k === 'Audio' ? '<div style="opacity:.6">▶ audio</div>' : fields[k]?.value ?? ''))
        .replace(/src="(horu_[^"]+)"/g, (_, f) => `src="__IMG__${f}"`);
    const front = fill(templates.Sentence.Front);
    let back = fill(templates.Sentence.Back.replace('{{FrontSide}}', templates.Sentence.Front));
    const imgName = /__IMG__([^"]+)/.exec(back)?.[1];
    if (imgName) back = back.replace(`__IMG__${imgName}`, `data:image/jpeg;base64,${await anki('retrieveMediaFile', { filename: imgName })}`);
    const card = await browser.newPage();
    await card.setViewport({ width: 400, height: 760, deviceScaleFactor: 2 });
    for (const [name, html] of [['front', front], ['back', back]]) {
      await card.setContent(`<html><head><style>${css}</style></head><body class="card nightMode">${html}</body></html>`);
      await sleep(300);
      await card.screenshot({ path: `${SHOTS}/card-${name}.png` });
    }
    await card.close();
  });
} finally {
  console.log('\n==== RESULTS ====');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${String(r.step).padStart(2)}. ${r.name}  (${r.s}s)${r.error ? '  → ' + r.error : ''}`);
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
