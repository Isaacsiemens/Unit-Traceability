# Switchframe — Long-Term Archive Plan

**Status:** Phase 2 (planned, not yet built)
**Purpose:** Keep the app fast over years of accumulating units, without ever losing history.

---

## Why we need it

Today the app loads **all units into the browser at once**. This keeps it simple and fast right now, but it has a ceiling:

| Units loaded | Performance |
|---|---|
| Hundreds | Instant |
| ~1,000 | Fine |
| ~5,000 | Noticeably slower |
| 20,000+ | Slow to load, laggy |

We are nowhere near this today (~240 units). But over several years of real production, shipped units accumulate. The archive is how we stay fast long-term.

**Storage is NOT the concern** — Firebase (Google infrastructure) can hold effectively unlimited units, photos, and documents. The only concern is loading too many into the browser *at once*. The archive solves exactly that.

---

## The core idea

Move **old shipped units** out of the everyday "live" working set into an **archive**. Nothing is ever deleted — units are just "put away" so the daily views stay quick.

- **Live set** = units on the line + recently shipped → loaded normally, dashboard stays fast
- **Archive** = older shipped units → stored safely, pulled up only when searched

Full traceability is preserved. Every archived unit is still complete — every sign-off, flag, comment, photo, and the "who worked on it" record stays intact.

---

## How it would work

### 1. What gets archived
- Only **shipped** units (never active, hold, rework, or RMA units).
- Only after a cutoff — for example, shipped more than **X months ago** (say 6 or 12 months; configurable by a manager).
- A unit's data does not change when archived — it just moves to the archive location.

### 2. Where archived units live
- A separate Firestore collection (e.g. `unitsArchive`) OR a flag on the unit (e.g. `archived: true`) that keeps it out of the default load.
- The cleanest approach is a separate collection so the main `units` query only ever pulls the live set.

### 3. The daily dashboard
- Loads only the **live set** (active + recently shipped). Fast no matter how many years of history exist.
- The dashboard, line view, analytics-by-default, and TV view all read the live set.

### 4. The Archive view (new section)
- A new **"Archive"** tab or a toggle in Reports.
- **Search-only** — you type a serial, job #, customer, or date range, and it fetches just those units from the archive. Nothing loads until you search (same pattern as the In-line/Travelers search).
- Clicking an archived unit opens the same detail panel it always had — traveler, flags, comments, who-worked-on-it, documents, everything.

### 5. How units get archived
Two options (can do both):
- **Automatic:** a scheduled job (in the API) runs periodically and moves shipped-over-X-months units into the archive.
- **Manual:** a manager button — "Archive shipped units older than [date]" — for control.

### 6. Analytics
- Default analytics use the live set (fast).
- A "include archived" option can pull historical archived data for long-range trend reports when needed (loads more, but only on request).

---

## What changes in the code (rough scope)

This is **not a rewrite** — it's a "load less at once, fetch older on demand" change.

1. **Main units query** → filter to live set only (exclude archived).
2. **New Archive collection or flag** → where old units go.
3. **New Archive search view** → search-only fetch from the archive.
4. **Archive action** → manual button + optional scheduled job in the API.
5. **Analytics** → optional "include archived" toggle for long-range reports.

**Estimated effort:** roughly 1–2 weeks, mostly testing to make sure nothing that reads the unit list breaks. Low conceptual risk (it's a well-understood pattern), but touches how units load, so it needs careful testing — which is exactly why it's a Phase 2 item, not a pre-presentation change.

---

## When to build it

- **Not now.** At ~240 units we don't need it, and it touches core loading logic — a bug risk right before the presentation with no current payoff.
- **Trigger point:** when the live unit count approaches **~2,000–3,000**, or after about a year of real accumulation.
- **Good roadmap line for leadership:** *"The system automatically archives old records to stay fast over years of use, while keeping full traceability on every unit ever built."*

---

## Summary

| | |
|---|---|
| **What** | Move old shipped units to a searchable archive |
| **Why** | Keep the app fast long-term as history grows |
| **Risk to history** | None — nothing is deleted, everything stays searchable |
| **Storage limit** | Not a concern — Firebase scales effectively unlimited |
| **Real limit today** | Browser loading all units at once (ceiling in the thousands) |
| **Effort** | ~1–2 weeks, mostly testing |
| **When** | Phase 2 — at ~2,000–3,000 units or ~1 year in |
