// Reader options kept on this phone (no laptop needed).

const KEY = 'horu-reader';

export type ReaderPrefs = {
  /** Tint speech bubbles by how many words in them are new to you */
  bubbleTint: boolean;
};

export function readerPrefs(): ReaderPrefs {
  try {
    return { bubbleTint: false, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ReaderPrefs>) };
  } catch {
    return { bubbleTint: false };
  }
}

export function setReaderPrefs(patch: Partial<ReaderPrefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readerPrefs(), ...patch }));
  } catch {
    // storage blocked
  }
  dispatchEvent(new Event('horu-reader'));
}

const EDITS = 'horu-bubble-edits';

/** Text corrected by hand for a speech bubble (the text recognition is not perfect), kept per bubble. */
export function bubbleEdits(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(EDITS) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveBubbleEdit(key: string, text: string | undefined): Record<string, string> {
  const edits = bubbleEdits();
  if (text === undefined) delete edits[key];
  else edits[key] = text;
  try {
    localStorage.setItem(EDITS, JSON.stringify(edits));
  } catch {
    // storage blocked
  }
  return edits;
}
