// The Horu Anki note type. The laptop creates it through AnkiConnect; the phone writes the same one into
// .apkg files and the AnkiConnect of an Android phone, so cards look the same whichever way they were made.

export const MODEL_NAME = 'Horu Sentence';
export const FIELDS = [
  'Sentence',
  'SentenceFurigana',
  'Target',
  'TargetReading',
  'TargetMeaning',
  'Translation',
  'Explanation',
  'Context',
  'Audio',
  'Image',
  'Source',
];

export const CSS = `
.card { font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif; font-size: 20px;
  text-align: center; color: #1d1d1f; background: #fafafa; line-height: 1.6; padding: 12px; }
.nightMode.card, .night_mode .card { color: #eee; background: #1e1e1e; }
.sentence { font-size: 30px; line-height: 2.1; margin: 16px 0; }
.sentence b { color: #d9480f; font-weight: 700; }
.nightMode .sentence b, .night_mode .sentence b { color: #ff922b; }
.sentence.front ruby rt { visibility: hidden; }
.sentence button.rb { all: unset; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.sentence.front ruby { cursor: pointer; border-bottom: 1px dotted rgba(127,127,127,.35); }
.sentence.front ruby.show rt { visibility: visible; }
.target { font-size: 24px; margin: 10px 0; }
.target .reading { color: #868e96; }
.target .meaning { display: block; font-size: 18px; }
.translation { font-size: 18px; margin: 14px auto; max-width: 640px; font-style: italic; }
.explanation { font-size: 16px; text-align: left; margin: 14px auto; max-width: 640px; opacity: .9; }
.context { font-size: 15px; color: #868e96; margin: 10px auto; max-width: 640px; white-space: pre-line; }
.image img { max-width: 100%; max-height: 320px; border-radius: 8px; margin-top: 10px; }
.source { font-size: 12px; color: #868e96; margin-top: 10px; }
.hint { font-size: 12px; color: #adb5bd; }
`;

export const FRONT = `<div class="sentence front" id="horu-sentence">{{SentenceFurigana}}</div>
{{Audio}}
<div class="hint">Tap a word for its reading</div>
<script>
(function () {
  var s = document.getElementById('horu-sentence');
  if (!s) return;
  s.querySelectorAll('ruby').forEach(function (r) {
    // AnkiMobile (iPhone) turns every tap on the card into "show answer", except taps on buttons and links
    // (its documentation says so). So each word sits in a real button; on the desktop it looks like plain text.
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rb tappable';
    r.parentNode.insertBefore(b, r);
    b.appendChild(r);
    b.addEventListener('click', function (e) {
      e.preventDefault();
      r.classList.toggle('show');
    });
  });
})();
</script>`;

export const BACK = `{{FrontSide}}
<hr id="answer">
<div class="target">{{Target}} <span class="reading">【{{TargetReading}}】</span><span class="meaning">{{TargetMeaning}}</span></div>
<div class="translation">{{Translation}}</div>
<div class="explanation">{{Explanation}}</div>
{{#Context}}<div class="context">{{Context}}</div>{{/Context}}
<div class="image">{{Image}}</div>
<div class="source">{{Source}}</div>
<script>
(function () {
  var s = document.getElementById('horu-sentence');
  if (s) s.classList.remove('front');
  var h = document.querySelector('.hint');
  if (h) h.style.display = 'none';
})();
</script>`;
