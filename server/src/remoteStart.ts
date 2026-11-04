import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';
import { extensionState } from './extensionHub.ts';
import { log } from './log.ts';

// Starting or stopping the Chrome extension's recording from the phone. Chrome lets an extension capture a tab
// only after a person acted on the laptop (a click on its icon, a keyboard shortcut), so the service presses the
// extension's "record" shortcut Ctrl+Shift+H itself: it brings the topmost Chrome window to the front and sends the keys.
// Windows only; the video's tab has to be the one open in that window.

/**
 * Virtual-key codes of the extension's "record" shortcut Ctrl+Shift+H (chrome://extensions/shortcuts).
 * Alt+Shift+H does not reach extensions in every Chrome, so the phone uses its own.
 */
export const SHORTCUT_KEYS = '0x11,0x10,0x48';

const SOURCE = String.raw`using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class HoruWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, int flags, IntPtr extra);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  static void Key(byte vk, bool up) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), up ? 2 : 0, IntPtr.Zero); System.Threading.Thread.Sleep(40); }
  // Windows lists top-level windows from front to back: the first Chrome browser window is the one used last.
  public static IntPtr TopChrome() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      if (cls.ToString() != "Chrome_WidgetWin_1") return true;
      var title = new StringBuilder(256); GetWindowText(h, title, 256);
      if (title.Length == 0 || title.ToString().StartsWith("DevTools")) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      try { if (Process.GetProcessById((int)pid).ProcessName != "chrome") return true; } catch { return true; }
      found = h; return false;
    }, IntPtr.Zero);
    return found;
  }
  // Windows only lets the program in front hand the focus on, so this process borrows its input thread for a moment.
  public static bool Front(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    if (GetForegroundWindow() != h) {
      uint pid; uint fore = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
      uint me = GetCurrentThreadId();
      AttachThreadInput(me, fore, true);
      BringWindowToTop(h);
      SetForegroundWindow(h);
      AttachThreadInput(me, fore, false);
      System.Threading.Thread.Sleep(250);
    }
    return GetForegroundWindow() == h;
  }
  // The shortcut as real key events, one after the other.
  public static void Press(byte[] keys) {
    foreach (var k in keys) Key(k, false);
    for (int i = keys.Length - 1; i >= 0; i--) Key(keys[i], true);
  }
}`;

// Compiling is slow when Windows has not done it for a while (10 s measured), and a remote start is exactly that. So
// it happens once: the result stays in the data folder, named after the source.
const DLL = path.join(DATA_DIR, `remote-keys-${createHash('sha256').update(SOURCE).digest('hex').slice(0, 10)}.dll`);
const PREPARE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  `$dll = '${DLL.replaceAll("'", "''")}'`,
  `if (-not (Test-Path $dll)) { Add-Type -OutputAssembly $dll -TypeDefinition @'\n${SOURCE}\n'@ }`,
].join('\n');

function powershell(script: string): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { timeout: 20_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim().split('\n')[0] || err.message));
      resolve(stdout);
    });
  });
}

/** At service start, so the first remote start of the evening has nothing to compile. */
export function prepareRemoteStart(): void {
  if (process.platform !== 'win32' || process.env.HORU_DOCKER || fs.existsSync(DLL)) return;
  powershell(PREPARE).catch((err: Error) => log.warn('Remote start: preparing failed', err.message));
}

let lastPress = 0;

export async function pressShortcut(keys = SHORTCUT_KEYS): Promise<'SENT' | 'NOCHROME' | 'NOFOCUS'> {
  const stdout = await powershell(`${PREPARE}
Add-Type -Path $dll
$w = [HoruWin]::TopChrome()
if ($w -eq [IntPtr]::Zero) { Write-Output 'NOCHROME'; exit 0 }
if (-not [HoruWin]::Front($w)) { Write-Output 'NOFOCUS'; exit 0 }
Start-Sleep -Milliseconds 200
[HoruWin]::Press([byte[]]@(${keys}))
Write-Output 'SENT'`);
  const out = stdout.trim().split(/\s+/).pop();
  return out === 'NOCHROME' || out === 'NOFOCUS' ? out : 'SENT';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Brings the extension's recording into the wanted state. Does nothing when it already is. */
export async function setRecording(want: boolean): Promise<{ recording: boolean; error?: string }> {
  if (extensionState().recording === want) return { recording: want };
  if (process.platform !== 'win32' || process.env.HORU_DOCKER) {
    return { recording: extensionState().recording, error: 'Starting the recording from the phone works on Windows only. On this computer press Ctrl+Shift+H in Chrome.' };
  }
  if (Date.now() - lastPress < 3000) return { recording: extensionState().recording, error: 'Just pressed. Wait a moment.' };
  lastPress = Date.now();
  try {
    const result = await pressShortcut();
    if (result === 'NOCHROME') return { recording: extensionState().recording, error: 'No Chrome window is open on the laptop.' };
    if (result === 'NOFOCUS') return { recording: extensionState().recording, error: 'Chrome could not be brought to the front. Click into the Chrome window once, then try again.' };
  } catch (err) {
    log.warn('Remote start failed', err);
    return { recording: extensionState().recording, error: `Could not press the shortcut: ${(err as Error).message}` };
  }
  for (let i = 0; i < 24 && extensionState().recording !== want; i++) await sleep(250);
  const recording = extensionState().recording;
  return recording === want
    ? { recording }
    : { recording, error: want ? 'The shortcut was sent, but Chrome did not start recording. Is the Horu extension (version 0.5 or newer) installed, its "Start/stop recording this tab" shortcut set to Ctrl+Shift+H at chrome://extensions/shortcuts, and the video tab open in front?' : 'The shortcut was sent, but the recording did not stop.' };
}
