# Plan & Development Log

## Constraints

Two constraints shaped every technical decision in this project:

1. **No installs.** A standing rule on this machine: never download or
   install an external package, jar, plugin, library, CDN script, or font
   without asking first. In practice this meant choosing Node's built-in
   `http`/`fs` modules and plain HTML/CSS/JS over any framework, ORM, or
   chart library — see [ARCHITECTURE.md](ARCHITECTURE.md) for what that
   produced.
2. **Demo first, not the full product.** The original ask (prompt 1 below)
   described a full multi-tenant SaaS product. Early in the conversation
   that was explicitly narrowed down to: no auth, no database, single admin,
   JSON-file storage, "I just want a working model for the demo." Every
   phase below builds on that narrowed scope, not the original brief.

## How the scope narrowed (original brief vs. what got built)

The original prompt asked for: user registration/login, multi-family
accounts with invite codes, adult/child roles and permissions, a normalized
PostgreSQL schema, a Next.js/PWA frontend, pluggable STT + LLM providers,
AI-generated insights, "invisible work" grouping, native mobile support, and
a full roadmap through to production deployment.

Before any of that was built, the very next message replaced it with:
_"Lets create an app which doesn't need any authentication or multiple
profiles. Just admin app which will take activity info and save it in a file
within the repo so there is no DB... I just want a working model for the
demo."_ That became the actual spec. [specifications.md](specifications.md)
documents the narrowed scope that was actually implemented; this file
documents how it got built, phase by phase.

## Phases actually implemented

| Phase | What shipped |
|---|---|
| 1 | Project scaffold: Node `http` server, static file serving, `data/*.json` seed files, manual Add Activity form, today's activity list, per-member/family totals. |
| 2 | Start/Stop timer: `data/timers.json`, `/api/timers/*` routes, live elapsed-time ticking in the UI. |
| 3 | Edit activity: ✎ button repopulates the Add Activity form in an "update" mode using the existing `PUT /api/activities/:id`. |
| 4 | Reports: `GET /api/reports`, This Week/This Month presets + custom range, summary tiles, three hand-rolled `<canvas>` charts (member totals, category totals, daily trend). |
| 5 | Voice input: browser Web Speech API for transcription + `lib/voiceParser.js` (rule-based, no AI API) for extraction, confirmation-card flow (Save/Edit/Cancel per draft), `data/voiceInteractions.json` audit log, "Add category" button, and a server-side request queue (`serialize()` in `server.js`) so concurrent sessions can't corrupt a JSON file via an interleaved read-modify-write. |
| 6 | Dashboard redesign: left sidebar (Today/Reports/Settings) + two-column content per tab, verified responsive down to a 375px mobile width, all without changing any element `id` so `app.js` needed zero logic changes. |
| 7 | Renames + visual polish pass 1: "Today's Activities" → "Activity by Date", "Family Today" → "Consolidated Hours"; icon badges added to every card header; gradients/shadows/hover states added. |
| 8 | Pushed to GitHub (`AbhijitAravalli/FamilyActivityTracker`), no AI attribution in the commit message, per explicit instruction. |
| 9 | **Timezone correctness**: every saved/displayed activity time pinned to Atlantic Daylight Time (ADT, UTC-3) regardless of the host OS's actual timezone — see [ARCHITECTURE.md §5](ARCHITECTURE.md#5-timezone-handling-adt). Visual polish pass 2: replaced the plain white/cool-grey palette with a warmer cream/plum/gold elegant theme. |
| 10 | This documentation set (`Plan.md`, `specifications.md`, `ARCHITECTURE.md`). |

## Prompt history (condensed, in order)

This is the sequence of user requests that actually drove the build, each
summarized to what it asked for:

1. **Full product brief** — a 25-section spec for a multi-tenant "Family
   Contribution & Activity Tracker": auth, families/invites, Postgres,
   Next.js/PWA, voice via pluggable STT+LLM, AI insights, reporting,
   security model, implementation roadmap. Asked for architecture +
   tech-decision docs before any code.
2. **Scope reset** — "do this phase wise... no auth, no DB, no multiple
   profiles, just an admin app, save to a file (JSON/flat file), I just want
   a working model for the demo." This replaced prompt 1 as the real spec.
3. Clarification on project location (new sibling folder vs. reusing the
   existing empty `FamilyTracker` folder) and on the package-install
   question — resolved to: plain Node `http`/`fs`, zero npm installs.
4. **"Can voice input work without any software installs?"** — led to the
   Web Speech API + rule-based parser design (no AI API key, no install),
   confirmed before building it.
5. **"Can we go phase wise? ... Phase 2 to Phase 4"** — timer, inline edit,
   weekly/monthly reports with charts. No voice yet.
6. **"Let's do phase 5 (voice)"** confirmation, followed immediately (mid-turn)
   by: **"add a button to add a new category"** and **"the data stored in
   the json should not be deleted even when restarted or accessed by
   multiple sessions... hope that's already taken care"** — this is what
   prompted the request-serialization fix and an explicit restart test.
7. **"Make the UI look like a dashboard"** — left sidebar nav
   (Today/Reports/Settings), middle/right content split, mobile-friendly,
   add a header/icon, keep functionality identical.
8. **Renames + more elegance** — "Today's Activities" → "Activity by Date",
   "Family Today" → "Consolidated hours", reduce the plain-white look, "push
   the changes to this repo without any mention to author details as
   Claude" (→ `github.com/AbhijitAravalli/FamilyActivityTracker`).
9. **"the activity saved time zone should be ADT time zone"** + **"replace
   white color background with some elegant light looking color"** — the
   ADT timezone fix and the warm color-palette pass in this same work
   session.
10. **"also add Plan.md, specifications.md, technical or architecture
    details md files including all the prompts lead to this development"**
    — this document set.

## Future directions (not built, out of scope for the demo)

Carried over from the original brief, for if/when this grows beyond a
single-family local demo: user accounts and multi-family tenancy, a real
database (PostgreSQL) with migrations, role-based permissions (adult/child),
an LLM-based voice parser swapped in behind the existing
`parseVoiceTranscript` interface, AI-generated insights ("invisible work"
grouping, trend callouts), push notifications, calendar integration, and a
native/PWA mobile build.
