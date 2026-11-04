import test from 'node:test';
import assert from 'node:assert/strict';
import { bestGuess, matchEntry, parsePageText, textFromPath } from '../../shared/detect.ts';

// Page texts in the shapes sites use; the shows and sites are invented or generic.
const cases = [
  ['Berserk Episode 3 - SiteName', 'Berserk', 3],
  ['Watch Berserk Episode 3 English Subbed at SiteName', 'Berserk', 3],
  ['SiteName | Berserk Episode 3', 'Berserk', 3],
  ['Berserk - Episode 3 - SiteName', 'Berserk', 3],
  ['Berserk - Episode 03 | Watch Online Free', 'Berserk', 3],
  ['Berserk EP 3 English Sub - Watch Free', 'Berserk', 3],
  ['Berserk Ep.12 [1080p]', 'Berserk', 12],
  ['[Group] Berserk - 07 [1080p].mkv', 'Berserk', 7],
  ['Berserk S1E5 | Stream', 'Berserk', 5],
  ['Berserk S02E05', 'Berserk', 5],
  ['Berserk Season 2 Episode 5 - Free', 'Berserk', 5],
  ['ベルセルク 第3話', 'ベルセルク', 3],
  ['ベルセルク 3話 - サイト', 'ベルセルク', 3],
  ['Cowboy Bebop #12 - Watch', 'Cowboy Bebop', 12],
  ['Cowboy Bebop: Episode 26', 'Cowboy Bebop', 26],
  ['Cowboy Bebop - 26', 'Cowboy Bebop', 26],
  ['Cowboy Bebop (Dub) Episode 4', 'Cowboy Bebop', 4],
  ['Episode 7 - Frieren: Beyond Journey\'s End | SiteName', 'Frieren: Beyond Journey\'s End', 7],
  ['Mob Psycho 100 Episode 9', 'Mob Psycho 100', 9],
  ['86 Eighty-Six E11', '86 Eighty-Six', 11],
  ['Watch One Piece Episode 1100 Online', 'One Piece', 1100],
  ['SiteName - Watch Anime Online - Bleach Episode 5', 'Bleach', 5],
];

for (const [text, title, episode] of cases) {
  test(`reads "${text}"`, () => {
    const g = parsePageText(text);
    assert.ok(g, 'no guess');
    assert.equal(g.episode, episode, `episode of ${JSON.stringify(g)}`);
    assert.ok(g.titles.some((t) => t === title), `titles ${JSON.stringify(g.titles)} lack "${title}"`);
  });
}

test('a season is read and kept out of the title', () => {
  const g = parsePageText('Berserk 2nd Season Episode 5');
  assert.equal(g.season, 2);
  assert.equal(g.titles[0], 'Berserk');
  assert.equal(parsePageText('Berserk S2E5').season, 2);
  assert.equal(parsePageText('ベルセルク 第2期 第5話').season, 2);
});

test('texts without a show give nothing', () => {
  assert.equal(parsePageText(''), undefined);
  assert.equal(parsePageText('Episode 3'), undefined);
  assert.equal(parsePageText('www.example.com'), undefined);
  assert.equal(parsePageText('Watch Online Free'), undefined);
});

test('the address becomes readable text', () => {
  assert.equal(textFromPath('/watch/berserk-1997-episode-3/'), 'watch / berserk 1997 episode 3');
  assert.equal(textFromPath('/anime/cowboy-bebop-k3d9x7q2p1/ep-12'), 'anime / cowboy bebop / ep 12');
  assert.equal(textFromPath('/v/123456/'), '');
  assert.equal(textFromPath('/stream/s1e4/berserk'), 'stream / s1e4 / berserk');
});

test('texts vote: the show appears in most, the site in one', () => {
  const g = bestGuess([
    { text: 'AniSite - Berserk Episode 3', weight: 2 },
    { text: 'Berserk Episode 3', weight: 2 },
    { text: 'Berserk', weight: 2 },
    { text: textFromPath('/watch/berserk-episode-3'), weight: 1 },
  ]);
  assert.equal(g.titles[0], 'Berserk');
  assert.equal(g.episode, 3);
});

test('a site name first and no help from other texts: both readings are offered', () => {
  const g = bestGuess([{ text: 'AniSite - Berserk Episode 3', weight: 2 }]);
  assert.ok(g.titles.includes('Berserk'));
  assert.equal(g.episode, 3);
});

test('a spaced dash inside a title is kept whole as the first reading', () => {
  const g = bestGuess([{ text: 'Re:ZERO - Starting Life in Another World Episode 3 | SiteName', weight: 2 }]);
  assert.equal(g.titles[0], 'Re:ZERO - Starting Life in Another World');
});

test('the episode the texts agree on wins', () => {
  const g = bestGuess([
    { text: 'Berserk Episode 3', weight: 2 },
    { text: 'Berserk Episode 3 - Site', weight: 2 },
    { text: 'Related: Episode 9', weight: 1 },
  ]);
  assert.equal(g.episode, 3);
});

// ---- matching ----

const entry = (id, name, english, anilist) => ({ id, name, english_name: english, anilist_id: anilist ?? id });

test('an exact name is a confident match even next to longer ones', () => {
  const m = matchEntry('Bleach', [entry(1, 'Bleach', 'Bleach'), entry(2, 'Bleach: Sennen Kessen-hen', 'Bleach: Thousand-Year Blood War')]);
  assert.equal(m.entry.id, 1);
  assert.ok(m.confident);
});

test('English or romaji, either matches', () => {
  const list = [entry(1, 'Sousou no Frieren', 'Frieren: Beyond Journey\'s End'), entry(2, 'Kimetsu no Yaiba', 'Demon Slayer')];
  assert.equal(matchEntry('Frieren Beyond Journeys End', list).entry.id, 1);
  assert.equal(matchEntry('Demon Slayer', list).entry.id, 2);
  assert.equal(matchEntry('Kimetsu no Yaiba', list).entry.id, 2);
});

test('the season picks the right entry', () => {
  const list = [entry(1, 'Oshi no Ko', 'Oshi no Ko', 10), entry(2, 'Oshi no Ko 2nd Season', 'Oshi no Ko Season 2', 11)];
  assert.equal(matchEntry('Oshi no Ko', list, 2).entry.id, 2);
  assert.equal(matchEntry('Oshi no Ko', list, 1).entry.id, 1);
  assert.equal(matchEntry('Oshi no Ko', list).entry.id, 1);
});

test('unrelated names do not match', () => {
  assert.equal(matchEntry('Berserk', [entry(1, 'Naruto', 'Naruto'), entry(2, 'One Piece', 'One Piece')]), undefined);
});

test('two equally good entries are not confident', () => {
  const m = matchEntry('Gintama', [entry(1, 'Gintama (2006)', 'Gintama', 1), entry(2, 'Gintama (2015)', 'Gintama', 2)]);
  assert.equal(m.confident, false);
});
