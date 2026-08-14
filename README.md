# Switchframe — Project Files

The RMU production-tracking web app (Trayer Switchgear / Siemens).
Live at: https://switchframe-app.web.app

## Files

### The app
- **index.html** — the entire app (current version, v163). This is what's deployed.
- **firebase.js** — Firebase config (database, storage, auth connection)
- **firebase.json** — Firebase hosting/deploy config
- **404.html** — fallback page

### The integration API (not deployed yet — needs Blaze billing + IT credentials)
- **functions/index.js** — the Cloud Functions API that connects to SiEOPS + M2M + EQMS
- **functions/package.json** — API dependencies
- **functions/README.md** — API notes

### Planning docs (Phase 2 roadmap)
- **multiproduct-plan.md** — the vision for one connected dashboard across all products
- **archive-plan.md** — the long-term archive plan for scale
- security plan 

### Utility tools (run once, then remove from live site)
- **seed-units.html** — creates 120 current demo units
- **seed-history.html** — adds historical shipped units for 2024 + 2025
- **fix-factory.html** — updates factory values on existing units

## To deploy
```
cd (this folder)
firebase deploy
```

## Notes
- Manager account: isaac.nawabi@siemens.com
- Shared floor account: floor@trayer.com (do NOT delete — used for scan-to-enter)
- The API is a reference/blueprint until Firebase billing (Blaze) is enabled and IT provides SiEOPS/M2M credentials.
