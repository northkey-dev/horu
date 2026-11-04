import { getSettings } from './config.ts';
import { jimakuClient } from '../../shared/jimaku.ts';

// The laptop's Jimaku client (shared/jimaku.ts) with the key from Settings.

const client = jimakuClient(() => getSettings().jimakuApiKey);

export const { searchEntries, listFiles, downloadCues } = client;
export { cuesFromUpload, matchesEpisode } from '../../shared/jimaku.ts';
