// "Check everything" in Settings: each part Horu depends on, green or red, with what to do about it.

export type Check = { name: string; state: 'ok' | 'warn' | 'bad'; detail: string; fix?: string };

const GB = 1024 ** 3;

export function diskCheck(freeBytes: number | undefined): Check {
  if (freeBytes === undefined) return { name: 'Disk space', state: 'warn', detail: 'Could not be read.' };
  const gb = freeBytes / GB;
  const detail = `${gb.toFixed(1)} GB free where Horu keeps its data`;
  if (gb < 1) return { name: 'Disk space', state: 'bad', detail, fix: 'Free some space: Horu cannot save audio, manga or backups without it.' };
  if (gb < 5) return { name: 'Disk space', state: 'warn', detail, fix: 'Getting low. Settings → Keep days can be lowered to clear old media sooner.' };
  return { name: 'Disk space', state: 'ok', detail };
}

/** `days` are the backup folders (YYYY-MM-DD), `today` is YYYY-MM-DD. */
export function backupCheck(days: string[], today: string): Check {
  const newest = [...days].sort().pop();
  if (!newest) return { name: 'Daily backup', state: 'bad', detail: 'No backup yet.', fix: 'Settings → Backup → Back up now.' };
  const age = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${newest}T12:00:00Z`)) / 86_400_000);
  if (age >= 3) return { name: 'Daily backup', state: 'warn', detail: `Last backup ${newest} (${age} days ago)`, fix: 'Horu writes one when it runs for a few minutes on a new day. Is it running every day?' };
  return { name: 'Daily backup', state: 'ok', detail: `Last backup ${newest} · ${days.length} kept` };
}

/** `value` is the command in Windows' Run key for Horu, if there is one. */
export function autostartCheck(platform: string, value: string | undefined, docker: boolean): Check | undefined {
  if (docker || platform !== 'win32') return undefined;
  if (value) return { name: 'Starts with Windows', state: 'ok', detail: 'Horu starts when you log in, and restarts itself if it stops.' };
  return { name: 'Starts with Windows', state: 'warn', detail: 'Horu does not start by itself.', fix: 'Run scripts\\install.ps1 -Autostart once, or put Horu.exe in the Startup folder.' };
}
