# Switchframe — Multi-Product Vision & Plan

**Status:** Phase 2 (planned, not yet built)
**Today:** The app runs one product line — the Padmount Oil Dielectric RMU.
**End goal:** One connected system that carries every product line, with a switcher to move between them.

---

## The vision (in one sentence)

**One dashboard, all products, one switch.** Instead of separate tools for each product, Switchframe becomes a single connected system where you pick a product from a dropdown at the top and the entire dashboard — line, units, analytics, everything — becomes that product's view.

---

## What it looks like

At the top of the dashboard there is a **product switcher** (the dropdown now shown in the app is a preview of this). Pick a product and:

- The **production line / stations** change to that product's stations and cycle times
- The **units** shown are only that product's units
- The **analytics** recalculate for that product
- **Scanning, sign-offs, flags, timers, the whole workflow** stay identical — they just operate on the selected product

Same app, same login, same floor experience — you're just switching which product you're looking at.

> The dropdown currently in the app is a **visual preview only**. It shows the RMU line as active and lists future product lines as "coming soon." It does not switch anything yet — it's there to communicate the vision.

---

## Why one connected system (not separate dashboards)

- **One place to look** — leadership and the floor see everything in a single tool.
- **Consistent workflow** — workers learn one system, not five.
- **Shared features** — every product automatically gets scanning, traceability, analytics, flags, QR, documents, the works.
- **Easier to maintain** — one codebase, one deployment, one source of truth.

---

## What has to change to build it

The app was deliberately built to make this possible **without a rewrite**. Everything already reads from a single station list (`STATIONS`) rather than having product logic hardcoded across the app. Three real changes turn "one product" into "many products":

1. **Per-product station lists.** Today there is one global `STATIONS` list (the RMU line). This becomes a `products` collection, where each product has its own stations, cycle times, and sequence. The app loads the selected product's stations instead of one fixed list.

2. **A product field on every unit.** Each unit gets tagged with which product it is (e.g. `product: "rmu"`). The dashboard filters to the selected product's units.

3. **The product switcher.** The dropdown becomes functional — selecting a product sets the "active product," and the whole dashboard filters and re-renders for it. (Station access / employee IDs also become per-product.)

---

## What does NOT change

- The entire workflow — scanning, timers, sign-offs, work ownership, flags, rework, RMA, holds, green tag, shipping.
- Analytics logic — it already reads from the station list, so it recalculates per product automatically.
- The API structure — it already reads the published station list rather than hardcoding it.
- Documents, QR codes, announcements, messaging — all product-agnostic already.

This is why it's an extension, not a rebuild: the hard architectural work was done up front.

---

## Rough scope & effort

- **Effort:** approximately 1–2 weeks of focused work, most of it careful testing.
- **Risk:** this is the highest-touch change in the project — it affects ~100 places where the app reads the station list. Low *conceptual* risk (well-understood pattern), but it must be tested thoroughly because so much reads from that one list.
- **Not a rewrite** — the foundation already supports it.

---

## When to build it

**Two conditions should be met first:**

1. **After the presentation.** This change touches the core; building it now risks introducing a bug into an app that currently works and demos well. Not worth it before the pitch.

2. **After the other products' station lines are known.** Building the switcher is only meaningful once we have the real stations and cycle times for the other product lines. Otherwise we'd be building against guesses. When those lines are finalized, adding a product is mostly: drop in its station list, tag its units.

**Good roadmap line for leadership:**
> *"Today it runs the RMU line. It's architected so the other product lines are a straightforward extension — one connected dashboard with a product switcher — not a rebuild. That's Phase 2, once we finalize each product's stations."*

---

## Honest framing for the presentation

- ✅ Say: *"It's built to carry all our products — one connected dashboard, switch between them. Here's a preview of the switcher."*
- ✅ Show: the dropdown as the vision.
- ❌ Don't say: *"It already handles all products today."* It runs one product (RMU) today; the switcher is a preview. Overclaiming risks a tough question from someone technical.

The strong, true story: **the foundation is done, the vision is clear, and adding products is an extension — not a rewrite.**

---

## Summary

| | |
|---|---|
| **Vision** | One connected dashboard for all products, with a switcher |
| **Today** | Runs one product (RMU); switcher is a visual preview |
| **3 changes to build** | Per-product station lists · product field on units · working switcher |
| **What stays the same** | The entire workflow + analytics (they read from the station list) |
| **Effort** | ~1–2 weeks, mostly testing |
| **Risk** | Highest-touch change in the project — test thoroughly |
| **When** | Phase 2 — after the presentation AND after other product lines are known |
