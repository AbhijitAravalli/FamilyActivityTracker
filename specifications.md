# Family Activity Tracker — Specifications

## 1. Purpose

Make the day-to-day work and activities performed by each family member visible,
without turning it into a competition. Family members log what they did, when,
for how long, and under what category — by typing, by a start/stop timer, or by
voice.

## 2. Original product vision (as requested)

The project began from a full product brief for a "Family Contribution &
Activity Tracker" covering: multi-family accounts, authentication, role-based
permissions (adult/child), a Postgres database, invitations, AI-assisted
insights, invisible-work grouping, and a native-feeling PWA. See
[Plan.md](Plan.md) for how that scope was deliberately narrowed into the demo
actually built, and why.

## 3. What this build actually implements (MVP scope)

A **single-admin, no-login, local demo app** — the real working requirement
that superseded the original multi-tenant brief:

- No authentication, no multi-family accounts. One shared family workspace.
- No database. All data lives in JSON files under `data/`, read/written
  directly by the Node server.
- Family members and categories are editable lists (Settings tab), not
  fixed values.

### Functional requirements

| Area | Requirement |
|---|---|
| Manual entry | Add an activity: name, member, category, date, start time, end time, notes. Duration is derived. |
| Timer | Start an activity now, Stop it later; duration and times are derived automatically. Multiple timers can run concurrently. |
| Edit / Delete | Any saved activity can be edited (repopulates the form) or deleted. |
| Voice input | Speak a sentence describing what was done; the app transcribes it (browser Web Speech API) and extracts a structured activity draft (name, category, start/end time, duration). The user must explicitly **Save** — nothing is auto-saved. If information is missing, the app asks a clarifying question instead of guessing. Multiple activities in one sentence ("I dropped the kids at the bus stop and then cleaned the kitchen for 20 minutes") are split and shown as separate drafts. |
| Categories | A default list is seeded; new categories can be added from Settings. |
| Dashboard | "Activity by Date" — the list of activities for a chosen day. "Consolidated Hours" — per-member and combined totals for that day. |
| Reports | This Week / This Month (or a custom range): total family time, activity count, average duration, a bar chart of time by member, a bar chart of time by category, and a line chart of the daily trend. |
| Timezone | All activity times are saved and displayed in **Atlantic Daylight Time (ADT, UTC-3)**, regardless of what timezone the server or browser's OS happens to be set to. |
| Data durability | Every write is flushed to disk immediately. Restarting the server does not lose data. Data is only removed through the app's own Delete actions — nothing clears files on startup. Concurrent requests (e.g. two browser tabs/sessions) are serialized server-side so a read-modify-write on a JSON file can't be interleaved and silently dropped. |

### Explicitly out of scope for this build

Authentication, multiple families/tenants, a real database, push
notifications, calendar integration, AI-generated insights, "invisible work"
grouping, native mobile apps. These remain documented as future directions in
[Plan.md](Plan.md) but were not built.

## 4. Non-functional requirements

- **Zero installs**: no `npm install`, no external services, no paid APIs.
  Node.js built-in modules (`http`, `fs`, `crypto`) only on the backend; plain
  HTML/CSS/JS on the frontend; the browser's native Web Speech API for voice
  transcription; a hand-written rule-based parser (no LLM call) for
  understanding the transcript.
- **Mobile-friendly**: usable on a phone-width screen, not just desktop.
- **Professional, elegant UI**: a dashboard-style layout (sidebar navigation +
  content panels), not a bare unstyled form.
- **Neutral language**: contribution is reported as recorded time per member,
  not framed as a ranking or competition.
