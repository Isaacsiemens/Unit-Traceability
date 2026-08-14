# Switchframe — Project Files

RMU production-tracking web app (Trayer Switchgear / Siemens).
Live at: https://switchframe-app.web.app

## Files

### The app
- **index.html** — the entire app (current version). This is what's deployed.
- **firebase.js** — Firebase config (database, storage, auth connection)
- **firebase.json** — Firebase hosting + Firestore rules config
- **firestore.rules** — database security rules (apply with: firebase deploy --only firestore:rules)
- **404.html** — fallback page

### The integration API (not deployed — needs Blaze billing + IT credentials)
- **functions/index.js** — Cloud Functions API connecting SiEOPS + M2M + EQMS
- **functions/package.json** — API dependencies
- **functions/README.md** — API notes

### Planning docs (Phase 2 roadmap)
- **multiproduct-plan.md** — vision for one connected dashboard across all products
- **archive-plan.md** — long-term archive plan for scale

### Utility tools (run once, then remove from live site)
- **seed-units.html** — creates 120 current demo units
- **seed-history.html** — adds historical shipped units (2024 + 2025)
- **fix-factory.html** — updates factory values on existing units
- **health-check.html** — standalone read-only data health scan

## Recent additions
- Error log: the app records problems as they happen to users; managers review under Tools -> Error log.
- Product switcher (preview) on the dashboard for the multi-product vision.
- Shipped-count year filter, improvement donut, comment/flag photos, who-worked-on-it tracking.
- Firestore security rules written (apply after testing).

## To deploy the app
```
cd (this folder)
firebase deploy
```

## To deploy the security rules (after testing)
```
firebase deploy --only firestore:rules
```

## Notes
- Manager account: isaac.nawabi@siemens.com
- Shared floor account: floor@trayer.com (do NOT delete — used for scan-to-enter)
- The API is a reference/blueprint until Firebase billing (Blaze) is enabled and IT provides SiEOPS/M2M credentials.
