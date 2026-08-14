# Switchframe — Integration API

Backend API layer connecting Switchframe to SiEOPS, M2M and EQMS.

**Status:** written and validated. Not yet deployed — deployment needs the Firebase Blaze plan and API credentials for each source system.

## What it does
- **dailySync** (5am PT) — pulls source fields from M2M (serial, job#) and SiEOPS (customer, qty, factory, due date, SO#). Only touches source fields; never overwrites production data recorded on the floor.
- **dailyPush** (6pm PT) — pushes production status back to SiEOPS (station, status, times, milestones) + the monthly shipping goal.
- **syncNow / pushNow** — manual manager-triggered versions (manager-only).
- **attachDocument** — attaches in-line/traveler docs (EQMS).
- **health** — lets IT confirm the API is live and configured.

## Data ownership
- **M2M** → serial number, job number
- **SiEOPS** → customer, quantity, factory, due date, sales order number
- **EQMS** → in-line quality + traveler documents
- **App** → everything about production (station, status, times, operators, flags, rework, RMA, holds, critical)

## NOTES FOR IT
- The Salesforce object/field API names in the code are placeholders — replace with the real SiEOPS schema.
- SiEOPS SSO endpoint provided by the team is a SAML 2.0 / Microsoft Entra login (tenant 38ae3bcd-9579-4fd4-adda-b42e1495d55a). That's an interactive human login. For this unattended backend, confirm whether SiEOPS exposes an OAuth2 token endpoint (client-credentials or JWT-bearer) or a Connected App for a service account.
- Set the M2M base URL + API key, and the SiEOPS token endpoint, via Firebase functions config.
- Deploying requires the Firebase Blaze plan (also unlocks Storage for photo/document uploads).

## To deploy (once billing + credentials are ready)
```
cd functions
npm install
firebase deploy --only functions
```
