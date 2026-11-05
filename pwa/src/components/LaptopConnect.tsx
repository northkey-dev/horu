import { useEffect, useRef, useState } from 'react';
import { laptopBase, parseLaptop, setLaptop } from '../lib/laptop.ts';
import { flash } from '../lib/hooks.ts';
import { connectionHint } from '../lib/api.ts';

// Settings → Laptop: connect the app to a laptop by scanning the QR code on its pairing page
// (tray icon → "Connect phone…") or by typing its Tailscale address.

export function LaptopConnect({ online }: { online: boolean }) {
  const [base, setBase] = useState(laptopBase);
  const [typed, setTyped] = useState('');
  const [scanning, setScanning] = useState(false);
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState<string>();

  useEffect(() => {
    const onChange = () => setBase(laptopBase());
    addEventListener('horu-laptop', onChange);
    return () => removeEventListener('horu-laptop', onChange);
  }, []);

  function connect(text: string) {
    const url = parseLaptop(text);
    if (!url) return setNote('That is not a laptop address. It looks like name.tail1234.ts.net.');
    setNote(undefined);
    setLaptop(url);
    setTyped('');
    setScanning(false);
    setChanging(false);
    flash('Laptop connected');
  }

  const sameOrigin = base === '';
  return (
    <>
      <div className="group">
        <div className="cell">
          <span className="grow">Laptop</span>
          <span className="value ellipsis">{base === undefined ? 'None' : sameOrigin ? 'This app comes from it' : new URL(base).hostname}</span>
        </div>
        {base && !changing && (
          <>
            <button className="list-item action-row" onClick={() => setChanging(true)}>
              Change laptop
            </button>
            <button className="list-item action-row" onClick={() => confirm('Disconnect from this laptop? What this phone saved stays.') && setLaptop(undefined)}>
              Disconnect
            </button>
          </>
        )}
        {!sameOrigin && (base === undefined || changing) && (
          <>
            <button className="list-item action-row" onClick={() => setScanning((s) => !s)}>
              {scanning ? 'Stop scanning' : 'Scan QR code'}
            </button>
            {scanning && <Scanner onCode={connect} onError={(m) => (setNote(m), setScanning(false))} />}
            <div className="cell">
              <input
                className="grow"
                placeholder="or type: name.tail1234.ts.net"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connect(typed)}
              />
              <button className="small primary" disabled={!typed.trim()} onClick={() => connect(typed)}>
                Connect
              </button>
            </div>
          </>
        )}
      </div>
      <p className="footnote">
        {note ??
          (base === undefined
            ? 'Horu works on this phone alone. A laptop adds audio and screenshots of what you watch, manga sources, Claude and Anki. On the laptop: tray icon → Connect phone…, then scan the code here. Both need Tailscale.'
            : online
              ? 'Connected. Without the laptop, Horu shows what this phone saved and sends changes when it is back.'
              : `Not reachable right now. ${connectionHint() || 'Is the laptop on, and Tailscale running on both?'}`)}
      </p>
    </>
  );
}

/** Camera view that reports the first QR code it sees. */
function Scanner({ onCode, onError }: { onCode: (text: string) => void; onError: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    (async () => {
      try {
        const [{ default: jsQR }, media] = await Promise.all([import('jsqr'), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })]);
        stream = media;
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (stopped) return;
          if (v.videoWidth) {
            // Half resolution is plenty for a QR code on a screen and keeps older phones fast.
            canvas.width = v.videoWidth / 2;
            canvas.height = v.videoHeight / 2;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
            if (code?.data) return onCode(code.data);
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        onError((e as Error).name === 'NotAllowedError' ? 'Camera access was blocked. Allow it for Horu in the phone settings, or type the address.' : `Camera: ${(e as Error).message}`);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <video ref={video} className="scanner" playsInline muted />;
}
