# Security

## Reporting a problem

Please do not open a public issue for a security problem. Use GitHub's **Report a vulnerability** (Security tab of this repository). Include what you did, what happened and which version (*Settings → About*). You will get an answer within a few days.

## How Horu is meant to be used

- Horu runs on **your** laptop or Raspberry Pi and serves **your** phone. It has no cloud part.
- The service on the laptop is protected by: a check of the host name (own names only), CORS limited to the app address and the extension, and an access token for anything that does not come through your Tailscale connection (`tailscale serve`) or from the laptop itself.
- Keep Tailscale between laptop and phone. A plain `http://<ip>:7317` address works only with the token and has no encryption: use it on your home network only, never through port forwarding or the open internet.
- API keys saved on the laptop stay there (the app sees only their last four characters). Keys typed on the phone stay on the phone. The extra backup folder and the phone backup file leave keys out. The `data/` folder holds the keys and the access token: do not share or sync it.
- The Chrome extension asks for broad permissions (all sites, tab audio, network requests) because it records the audio and subtitles of the tab you start it on. It sends data only to your own Horu address.
- Manga sources and extension repositories are third-party code that you add yourself. Add only what you trust.

## What was checked

A security review of the service (host-name check, file-path handling, origin checks, key masking) was done and fixed in 0.9.1–0.9.3; `npm run smoke` tests these cases on every push. `npm audit` reports no known vulnerability in the dependencies at release time.
