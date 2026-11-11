import { CREDITS, REPO } from '../lib/credits.ts';

// Settings → About: version, licence and the licences of what Horu is built on (JMdict and KANJIDIC2 require
// this notice, CC BY-SA 4.0).

const GROUPS = [
  ['app', 'In the app'],
  ['laptop', 'On the laptop'],
  ['service', 'Services and programs you connect'],
] as const;

export function About() {
  return (
    <>
      <h2>Horu</h2>
      <div className="group">
        <div className="cell">
          <span className="grow">Version</span>
          <span className="value">{__APP_VERSION__}</span>
        </div>
        <div className="cell">
          <span className="grow">Licence</span>
          <span className="value">GPL-3.0-or-later</span>
        </div>
        <a className="list-item action-row" href={REPO} target="_blank" rel="noreferrer">
          Source code and issues
        </a>
        <a className="list-item action-row" href={`${REPO}/issues/new/choose`} target="_blank" rel="noreferrer">
          Report a problem
        </a>
        <a className="list-item action-row" href="https://ko-fi.com/northkeydev" target="_blank" rel="noreferrer">
          Support Horu on Ko-fi
        </a>
      </div>
      <p className="footnote">
        Horu ships no anime, manga, subtitles or audio. It works on what you bring, and you are responsible for where it comes from and for the terms of the services you use. It has no account, no analytics and no server of ours.
      </p>

      {GROUPS.map(([where, title]) => (
        <section key={where}>
          <h2>{title}</h2>
          <div className="group">
            {CREDITS.filter((c) => c.where === where).map((c) => (
              <a key={c.name} className="list-item credit" href={c.url} target="_blank" rel="noreferrer">
                <span className="grow">
                  <b>{c.name}</b>
                  <span className="hint">
                    {c.what}. {c.licence}.
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>
      ))}
      <p className="footnote">
        The dictionary data (JMdict, KANJIDIC2) is the property of the Electronic Dictionary Research and Development Group and used under their licence (CC BY-SA 4.0, <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">edrdg.org/edrdg/licence.html</a>). Full list with versions: THIRD-PARTY.md in the repository.
      </p>
    </>
  );
}
