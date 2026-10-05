# Architecture & Technical Design

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js, built-in `http`/`fs`/`crypto`/`url` modules only | Zero `npm install` (standing constraint — see [Plan.md](Plan.md#constraints)). No framework needed for this endpoint count. |
| Frontend | Plain HTML + CSS + vanilla JS (`public/`) | Same zero-install constraint. No build step, no bundler. |
| Storage | JSON files under `data/` | No database available/approved for this demo. Simple enough for single-family, low-concurrency use. |
| Charts | Hand-written `<canvas>` drawing in `app.js` | No charting library install. |
| Voice transcription | Browser's native `SpeechRecognition` / `webkitSpeechRecognition` (Web Speech API) | Built into Chrome/Edge, no install, no API key. Audio never leaves the browser's own recognition engine; only the resulting text is sent to the server. |
| Voice understanding | Rule-based parser, `lib/voiceParser.js` | No LLM/AI API call, no key, no cost, works fully offline. Deliberately built behind a swappable function signature (`parseVoiceTranscript(transcript, { date, nowIso })`) so an LLM-based implementation could replace it later without touching the API route or frontend. |

## 2. Process model

A single `node server.js` process serves both the static frontend
(`public/`) and the JSON API (`/api/*`) from one HTTP server
(`http.createServer`). There is no separate build or dev-server step.

### Request serialization

All `/api/*` requests are funneled through a single in-memory promise queue
(`serialize()` in `server.js`) before they touch any JSON file:

```js
let apiQueue = Promise.resolve();
function serialize(fn) {
  const run = apiQueue.then(fn, fn);
  apiQueue = run.then(() => {}, () => {});
  return run;
}
```

This guarantees that a read-modify-write cycle on a data file (read the
array, mutate it, write it back) can never interleave with another request's
read-modify-write on the same file — even if two browser tabs or two people
hit the server at the same instant. The cost is that all API requests are
effectively processed one at a time, which is irrelevant at the scale this
app is built for (one family, a handful of concurrent tabs).

## 3. Data model

Flat JSON arrays, one file per resource, under `data/`:

| File | Shape |
|---|---|
| `members.json` | `{ id, name }[]` |
| `categories.json` | `string[]` |
| `activities.json` | `{ id, memberId, name, category, date, startAt, endAt, durationMinutes, notes, inputMethod, createdAt, updatedAt }[]` |
| `timers.json` | `{ id, memberId, name, category, notes, startAt }[]` — only *running* timers; a stopped timer is removed from here and appended to `activities.json`. |
| `voiceInteractions.json` | `{ id, transcript, extracted, status, createdAt }[]` — an audit log of every voice parse request and what was extracted from it (no raw audio is ever stored). |

`date` is always a plain `YYYY-MM-DD` string in **ADT** (see §5) and is the
field used for all date-range filtering/grouping — `startAt`/`endAt` are full
ISO-8601 UTC instants used for duration math and display formatting.

## 4. API surface

```
GET    /api/members
POST   /api/members                 { name }

GET    /api/categories
POST   /api/categories              { name }

GET    /api/activities?date=YYYY-MM-DD
POST   /api/activities              { memberId, name, category, date, startAt, endAt, notes?, inputMethod? }
PUT    /api/activities/:id
DELETE /api/activities/:id

GET    /api/timers
POST   /api/timers/start            { memberId, name, category, notes? }
POST   /api/timers/:id/stop         -> creates the completed activity
DELETE /api/timers/:id              -> cancel without saving

POST   /api/voice/parse             { transcript, date? } -> { activities: [...], clarification }

GET    /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
         -> { totalMinutes, activityCount, avgDurationMinutes,
              memberTotals[], categoryTotals[], dailyTotals[] }
```

Every mutating endpoint validates its input (`validateActivityInput`, inline
checks) and returns `400` with a message on failure; unknown routes return
`404`; unexpected errors return `500`.

## 5. Timezone handling (ADT)

All activity times are saved and displayed in **Atlantic Daylight Time
(ADT = UTC-3, fixed offset)**, independent of whatever timezone the actual
server OS or browser happens to be running in. This matters because the app
may be demoed/deployed on machines in different timezones, and times spoken
or typed by a user should map to the same wall-clock meaning everywhere.

Two parallel (duplicated, since there's no shared module system between
Node and a plain `<script>` tag) implementations exist:

- **Server**: `lib/timezone.js` — `adtToIso(dateStr, hour24, minute)`,
  `isoToAdtDateStr(iso)`, `isoToAdtParts(iso)`, `nowAdtDateStr()`. Used by
  `lib/voiceParser.js` (interpreting spoken times like "at 7:30" or "from
  6:10 to 7 PM") and by `server.js` (the calendar date a stopped timer gets
  filed under; the default date for a voice-parse request with no explicit
  date).
- **Client**: the same four functions, duplicated near the top of
  `public/app.js`. Used for every date/time the user types into the manual
  form, every date/time rendered back (`formatTime`, `isoToTimeInput`), and
  the "This Week"/"This Month" report range calculation.

The technique: take the UTC instant, shift it by the fixed `-3h` offset,
then read/write the wall-clock fields using the `getUTC*`/`Date.UTC(...)`
accessors (never the host's own local-time accessors like `getHours()` or
`toLocaleTimeString()`, which depend on the OS timezone). This makes the
conversion deterministic no matter where the code runs.

`server.js`'s report endpoint also iterates calendar dates between `from`
and `to` using `setUTCDate`/`getUTCDate` rather than the local-time
equivalents, for the same reason — it's iterating plain calendar dates, not
caring about any timezone, and must not drift based on the host's own OS
setting.

## 6. Voice pipeline

```
tap mic (public/app.js: setupVoice)
  -> Web Speech API transcribes speech to text, client-side
  -> POST /api/voice/parse { transcript, date }
  -> lib/voiceParser.js: parseVoiceTranscript(transcript, { date, nowIso })
       - splits on "and then" / "then" / ", and" into clauses (multi-activity support)
       - per clause: infer category by keyword match, extract duration
         ("for 25 minutes"), extract a time range ("from 6:10 to 7 PM") or a
         single point-in-time ("at 7:30"), strip filler phrases to get the
         activity name
       - if a clause is missing a name or a time/duration, it is NOT guessed;
         a clarification question is returned instead
  -> server.js logs { transcript, extracted, status } to voiceInteractions.json
  -> response: { activities: [...drafts], clarification }
  -> frontend renders one confirmation card per draft (Save / Edit / Cancel) —
     nothing is written to activities.json until the user presses Save
```

## 7. Frontend structure

- `public/index.html` — a fixed sidebar (Today / Reports / Settings) +
  content area; each tab is a two-column `<div class="two-col">` of cards.
  Every element referenced by `app.js` keeps a stable `id` regardless of
  visual restyling, so layout/CSS changes never require JS changes.
- `public/app.js` — no framework, no modules; a `state` object, a set of
  `render*()` functions that re-render from `state`, and `setup*()` functions
  that wire up event listeners once at startup. Canvas charts
  (`drawBarChart`, `drawLineChart`) are hand-rolled with no library.
- `public/style.css` — CSS custom properties (`:root { --primary, --bg,
  --card-bg, ... }`) drive the whole palette from one place; a dark
  sidebar + warm cream content area with icon-badged card headers.

## 8. Known limitations (by design, for a demo)

- JSON-file storage does not scale past light, single-family use — there's
  no row-level locking, just a single global request queue.
- The rule-based voice parser handles the phrasing patterns it was built and
  tested against; it is not a general NLU system. It was built behind a
  stable interface so a real LLM-based parser could be substituted later.
- No authentication — anyone who can reach the server can read/write all
  data. Acceptable for a local single-family demo; would need addressing
  before any shared/public deployment.
