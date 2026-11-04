import { getSettings } from './config.ts';
import { jimakuClient } from '../../shared/jimaku.ts';

// The laptop's Jimaku client (shared/jimaku.ts) with the key from Settings. HORU_JIMAKU_URL points it at a test double.

const client = jimakuClient(() => getSettings().jimakuApiKey, process.env.HORU_JIMAKU_URL || undefined);

export const { searchEntries, listFiles, downloadCues } = client;
export { cuesFromUpload, matchesEpisode } from '../../shared/jimaku.ts';
