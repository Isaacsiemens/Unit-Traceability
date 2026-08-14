/**
 * Switchframe — Integration API
 * ------------------------------------------------------------------
 * Firebase Cloud Functions. This is the backend layer that connects
 * Switchframe to the systems that own the source data.
 *
 * DATA OWNERSHIP
 *   M2M   -> serial number, job number
 *   SiEOPS -> customer, quantity, factory, due date, sales order number
 *   EQMS  -> in-line quality + traveler documents
 *   App   -> everything about production (station, status, times,
 *            operators, flags, rework, RMA, holds, critical)
 *
 * A daily sync updates SOURCE fields only. It never touches production
 * fields, so an import can't overwrite what the floor has recorded.
 *
 * STATUS: written and ready to deploy. Deploying requires the Firebase
 * Blaze plan plus API credentials for each source system.
 * ------------------------------------------------------------------
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/* ==================================================================
   CONFIG
   Credentials are set with the Firebase CLI, never committed to code:
     firebase functions:config:set siops.login_url="..." \
       siops.client_id="..." siops.client_secret="..." \
       m2m.base_url="..." m2m.api_key="..."
   ================================================================== */
// NOTE FOR IT: functions.config() is the 1st-gen approach and works with
// firebase-functions v4 (pinned in package.json). If you move to 2nd-gen
// functions, swap this for environment variables / Secret Manager —
// config() was removed there. Everything else carries over unchanged.
//
// NOTE FOR IT — SiEOPS single sign-on (SAML 2.0 / Microsoft Entra):
// The SiEOPS SSO endpoint provided by the team is:
//   https://login.microsoftonline.com/38ae3bcd-9579-4fd4-adda-b42e1495d55a/saml2
// The tenant ID is 38ae3bcd-9579-4fd4-adda-b42e1495d55a.
// This is a SAML/SSO login (interactive), which is different from the
// OAuth2 client-credentials flow used below for server-to-server sync.
// For an unattended backend like this, confirm with IT whether SiEOPS
// exposes an OAuth2 token endpoint (client-credentials or JWT-bearer) for
// service accounts. If SiEOPS only offers SAML SSO, the integration needs a
// service/API account with an OAuth2 grant, or a Salesforce Connected App.
// Set siops.login_url to whichever token endpoint IT provides.
const SIOPS_SAML_SSO = "https://login.microsoftonline.com/38ae3bcd-9579-4fd4-adda-b42e1495d55a/saml2";
const cfg = () => (functions.config() || {});

/* ==================================================================
   FIELD OWNERSHIP — the guardrail
   Only these fields may be written by a sync. Anything else on a unit
   belongs to the app and is left alone.
   ================================================================== */
const M2M_FIELDS = ["id", "order"];
// qty is stored for reference only — each row is already one physical unit.
const SIOPS_FIELDS = ["customer", "qty", "factory", "dueDate", "salesOrderNumber"];

function pickAllowed(obj, allowed) {
  const out = {};
  allowed.forEach((k) => {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") out[k] = obj[k];
  });
  return out;
}

/* ==================================================================
   SALESFORCE / SiEOPS CLIENT
   ================================================================== */
async function siopsToken() {
  const c = cfg().siops || {};
  if (!c.login_url || !c.client_id || !c.client_secret) {
    throw new Error("SiEOPS credentials are not configured.");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: c.client_id,
    client_secret: c.client_secret,
  });
  const res = await fetch(`${c.login_url}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`SiEOPS auth failed (${res.status})`);
  const json = await res.json();
  return { token: json.access_token, instance: json.instance_url };
}

/**
 * Run a SOQL query and follow Salesforce's pagination to the end.
 *
 * Salesforce returns results in pages and hands back a nextRecordsUrl for
 * the remainder. Reading only the first page would silently drop records,
 * so this keeps following the trail until Salesforce says it is done.
 */
async function siopsQuery(soql) {
  const { token, instance } = await siopsToken();
  const headers = { Authorization: `Bearer ${token}` };
  let url = `${instance}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`;
  const all = [];
  let pages = 0;

  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`SiEOPS query failed (${res.status})`);
    const json = await res.json();
    if (Array.isArray(json.records)) all.push(...json.records);

    // Salesforce sets done=false and gives a relative nextRecordsUrl when more remain.
    url = json.done === false && json.nextRecordsUrl ? `${instance}${json.nextRecordsUrl}` : null;

    if (++pages > 200) {                       // safety valve against a runaway loop
      console.warn("SiEOPS query stopped after 200 pages.");
      break;
    }
  }
  console.log(`SiEOPS query returned ${all.length} record(s) over ${pages} page(s).`);
  return all;
}

/**
 * Pull the SiEOPS-owned fields.
 * NOTE FOR IT: object and field API names below are placeholders. Replace
 * them with the real SiEOPS schema — that is the only change needed here.
 */
async function fetchFromSiops() {
  const soql = `
    SELECT Serial_Number__c, Customer__c, Quantity__c,
           Factory__c, Due_Date__c, Sales_Order_Number__c
    FROM Production_Unit__c
    WHERE Status__c != 'Closed'
  `;
  const records = await siopsQuery(soql);
  return records.map((r) => ({
    id: String(r.Serial_Number__c || "").trim(),
    customer: r.Customer__c || "",
    qty: r.Quantity__c || null,
    factory: r.Factory__c || "",
    dueDate: normDate(r.Due_Date__c),
    salesOrderNumber: r.Sales_Order_Number__c || "",
  }));
}

/* ==================================================================
   M2M CLIENT — serial number + job number
   ================================================================== */
/**
 * Pull serial and job numbers from M2M.
 *
 * NOTE FOR IT: this assumes a single JSON response. If M2M paginates
 * (page/offset params, or a next link), this needs the same page-following
 * treatment as siopsQuery above. Confirm the response shape before going live.
 */
async function fetchFromM2m() {
  const c = cfg().m2m || {};
  if (!c.base_url || !c.api_key) throw new Error("M2M credentials are not configured.");
  const res = await fetch(`${c.base_url}/units`, {
    headers: { Authorization: `Bearer ${c.api_key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`M2M request failed (${res.status})`);
  const json = await res.json();
  const rows = Array.isArray(json) ? json : json.data || [];
  return rows.map((r) => ({
    id: String(r.serialNumber || r.serial_number || "").trim(),
    order: String(r.jobNumber || r.job_number || "").trim(),
  }));
}

/* ==================================================================
   HELPERS
   ================================================================== */
function normDate(v) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Merge source rows by serial number so each unit is written once. */
function mergeBySerial(...lists) {
  const map = new Map();
  lists.forEach((list) => {
    (list || []).forEach((row) => {
      if (!row.id) return;
      const key = row.id.toLowerCase();
      map.set(key, Object.assign({}, map.get(key) || {}, row));
    });
  });
  return Array.from(map.values());
}

/* ==================================================================
   THE SYNC — pull from M2M + SiEOPS, write source fields only

   ONE ROW = ONE UNIT. Each physical unit arrives with its own serial
   number, so a job with quantity 5 comes through as 5 separate rows.
   The sync never expands a quantity into multiple units.

   NO DUPLICATES. The serial number is the Firestore document ID, so a
   serial can only exist once. Re-running the sync updates in place.
   ================================================================== */
async function runSync() {
  const results = { created: 0, updated: 0, skipped: 0, errors: [] };

  let m2mRows = [];
  let siopsRows = [];
  try { m2mRows = await fetchFromM2m(); }
  catch (e) { results.errors.push(`M2M: ${e.message}`); }
  try { siopsRows = await fetchFromSiops(); }
  catch (e) { results.errors.push(`SiEOPS: ${e.message}`); }

  const rows = mergeBySerial(m2mRows, siopsRows);
  if (!rows.length) {
    results.errors.push("No rows returned from any source.");
    return results;
  }

  // Read every existing serial ONCE, rather than one lookup per row.
  // A per-row read would mean hundreds of round trips and risks a timeout.
  const existing = new Set();
  const allUnits = await db.collection("units").select().get();  // IDs only — cheap
  allUnits.forEach((d) => existing.add(d.id));

  // Batched writes, 400 per batch (Firestore's limit is 500).
  let batch = db.batch();
  let inBatch = 0;

  for (const row of rows) {
    if (!row.id) { results.skipped++; continue; }
    const ref = db.collection("units").doc(row.id);
    const alreadyThere = existing.has(row.id);

    const sourceFields = Object.assign(
      {},
      pickAllowed(row, M2M_FIELDS.filter((f) => f !== "id")),
      pickAllowed(row, SIOPS_FIELDS)
    );

    if (!alreadyThere) {
      // New unit — starts at the first station with empty production data.
      batch.set(ref, Object.assign({
        id: row.id,
        model: "",
        stamps: {},
        sheet: { factory: row.factory || "" },
        createdAt: new Date().toISOString(),
        createdBy: "Integration sync",
      }, sourceFields));
      results.created++;
    } else {
      // Existing unit — source fields only. Production data is untouched.
      if (Object.keys(sourceFields).length) {
        batch.update(ref, sourceFields);
        results.updated++;
      } else {
        results.skipped++;
      }
    }

    if (++inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
  }
  if (inBatch > 0) await batch.commit();

  await db.collection("syncLog").add({
    at: new Date().toISOString(),
    created: results.created,
    updated: results.updated,
    skipped: results.skipped,
    errors: results.errors,
  });

  return results;
}

/* ==================================================================
   OUTBOUND — push production data back to SiEOPS
   ================================================================== */
/**
 * STATION LIST — read from the database, not hardcoded.
 *
 * The app is the single source of truth. It publishes its station list
 * to config/stations whenever a manager opens it, so changing a cycle
 * time in the app automatically flows through to here. The list below
 * is only a fallback for the first run, before the app has published.
 */
const FALLBACK_STATIONS = [
  { key: "bparts", name: "B parts", cycleMinutes: null },
  { key: "laser", name: "Laser", cycleMinutes: null },
  { key: "weld1a", name: "Weld 1A", cycleMinutes: 151 },
  { key: "weld1b", name: "Weld 1B", cycleMinutes: 119 },
  { key: "weld1c", name: "Weld 1C", cycleMinutes: 69 },
  { key: "bussa", name: "Bussing A (wiring)", cycleMinutes: 61 },
  { key: "bussb", name: "Bussing B (install)", cycleMinutes: 50 },
  { key: "bussc", name: "Bussing C (testing)", cycleMinutes: 12 },
  { key: "weld2a", name: "Weld 2A", cycleMinutes: 64 },
  { key: "weld2b", name: "Weld 2B", cycleMinutes: 89 },
  { key: "leak", name: "Leak Test", cycleMinutes: 33 },
  { key: "hood", name: "Hood Fabrication", cycleMinutes: 108 },
  { key: "basea", name: "Base Fabrication A", cycleMinutes: 68 },
  { key: "baseb", name: "Base Fabrication B", cycleMinutes: 89 },
  { key: "basec", name: "Base Fabrication C", cycleMinutes: 105 },
  { key: "cab", name: "Cabinetry Install", cycleMinutes: 81 },
  { key: "paint", name: "Paint", cycleMinutes: null },
  { key: "fa1", name: "Final Assembly 1", cycleMinutes: 97 },
  { key: "ftest", name: "Final Test", cycleMinutes: 45 },
  { key: "fa2", name: "Final Assembly 2", cycleMinutes: 22 },
  { key: "ship", name: "Shipping", cycleMinutes: null }
];

/** Fetch the published station list once per function run. */
/* Confirms the signed-in caller is a manager (not a worker).
   Reads their users/{uid} doc; a doc with role "worker" is rejected.
   Anyone else who is signed in (managers, whose docs either say manager
   or don't set role) is allowed — matching how the app assigns roles. */
async function requireManager(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
  }
  const uid = context.auth.uid;
  let role = null;
  try {
    const snap = await db.collection("users").doc(uid).get();
    if (snap.exists) role = (snap.data() || {}).role || null;
  } catch (e) {
    // if we can't read the role, fail closed
    throw new functions.https.HttpsError("permission-denied", "Could not verify your access.");
  }
  if (role === "worker") {
    throw new functions.https.HttpsError("permission-denied", "Managers only.");
  }
}

async function getStations() {
  try {
    const snap = await db.collection("config").doc("stations").get();
    if (snap.exists) {
      const data = snap.data();
      if (Array.isArray(data.stations) && data.stations.length) return data.stations;
    }
  } catch (e) {
    console.warn("Couldn't read config/stations, using fallback:", e.message);
  }
  return FALLBACK_STATIONS;
}

function plannedHoursFor(stations) {
  const mins = stations.reduce((t, s) => t + (s.cycleMinutes || 0), 0);
  return Math.round((mins / 60) * 100) / 100;
}

/**
 * Work out where a unit is and what its status is.
 *
 * IMPORTANT: the app does NOT store "current station" or "status" as
 * fields — it calculates them from the stamps object every time it
 * renders. So the API has to do the same calculation, using the same
 * rules. This mirrors unitState() in the app.
 */
function unitState(u, STATIONS) {
  const N = STATIONS.length;
  const stamps = u.stamps || {};
  let lastDone = -1, activeIdx = -1, holdIdx = -1;

  STATIONS.forEach((s, i) => {
    const st = stamps[s.key];
    if (!st) return;
    if (st.hold) holdIdx = i;
    else if (st.active) activeIdx = i;
    else lastDone = i;
  });

  const lastKey = STATIONS[N - 1].key;
  const shipped = stamps[lastKey] && !stamps[lastKey].active && !stamps[lastKey].hold;

  let current, status;
  if (u.rework) {
    current = typeof u.reworkStation === "number" ? u.reworkStation : Math.max(0, lastDone);
    status = "rework";
  } else if (u.scrapped) {
    current = typeof u.scrapStation === "number" ? u.scrapStation : Math.max(0, lastDone);
    status = "scrapped";
  } else if (holdIdx >= 0) {
    current = holdIdx; status = "hold";
  } else if (shipped) {
    current = N - 1; status = "shipped";
  } else if (activeIdx >= 0) {
    current = activeIdx; status = "active";
  } else {
    current = Math.min(lastDone + 1, N - 1); status = "active";
  }
  return { current, status };
}

/** Plain-English status for SiEOPS, rather than the app's internal words. */
function statusLabel(status) {
  switch (status) {
    case "shipped":  return "Shipped";
    case "hold":     return "On hold";
    case "rework":   return "In rework";
    case "scrapped": return "Scrapped";
    default:         return "In production";
  }
}

function buildOutboundPayload(unit, STATIONS, plannedHours) {
  const N = STATIONS.length;
  const stamps = unit.stamps || {};
  let actualMinutes = 0;
  let firstStart = null;
  let lastFinish = null;

  Object.keys(stamps).forEach((k) => {
    const st = stamps[k] || {};
    if (typeof st.actualMin === "number") actualMinutes += st.actualMin;
    if (st.arrived && (!firstStart || st.arrived < firstStart)) firstStart = st.arrived;
    if (st.time && (!lastFinish || st.time > lastFinish)) lastFinish = st.time;
  });

  const state = unitState(unit, STATIONS);
  const station = STATIONS[state.current];
  const isDone = state.status === "shipped";

  return {
    // identity
    jobNumber: unit.order || "",
    serialNumber: unit.id,
    salesOrderNumber: unit.salesOrderNumber || "",

    // production task — where the unit is on the line
    currentStation: station ? station.name : "",
    stationNumber: state.current + 1,      // 1-21, easier to read in SiEOPS
    totalStations: N,
    status: statusLabel(state.status),

    // hours
    plannedHours: plannedHours,
    actualHours: Math.round((actualMinutes / 60) * 100) / 100,

    // milestones
    startedAt: firstStart,
    completedAt: isDone ? lastFinish : null,   // only set once the unit ships

    // dates
    dueDateProduction: unit.dueDate || "",
    dueDateCustomer: unit.customerDueDate || "",
  };
}

/* ------------------------------------------------------------------
   MONTHLY SHIPPING GOAL — pushed out as a milestone.

   Unlike the per-unit payloads above, the monthly goal is a single
   plant-level milestone: "this month we aim to ship N units, and so far
   we've shipped M." Managers set it in the app (stored at config/goals
   as a map like { "2026-08": 40 }). It flows OUT to SiEOPS as a milestone
   so leadership can track target vs actual for the whole line.

   NOTE FOR IT: this is a milestone-type record, NOT a production task.
   Point it at whatever SiEOPS object holds plant/line milestones
   (e.g. Production_Milestone__c) — see the endpoint in pushMonthlyGoal().
   ------------------------------------------------------------------ */
function monthKeyNow() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function shipMonthOf(unit) {
  const evs = unit.events || [];
  for (let i = evs.length - 1; i >= 0; i--) {
    if (evs[i].type === "ship" && evs[i].date) return String(evs[i].date).slice(0, 7);
  }
  return null;
}

async function buildMonthlyGoalMilestone(STATIONS) {
  const monthKey = monthKeyNow();

  // read the goal for this month
  let goal = null;
  try {
    const gsnap = await db.collection("config").doc("goals").get();
    if (gsnap.exists) {
      const goals = gsnap.data() || {};
      if (goals[monthKey] != null) goal = goals[monthKey];
    }
  } catch (e) {
    console.log("Could not read monthly goal:", e.message);
  }
  if (goal == null) return null; // no goal set this month — nothing to push

  // count units actually shipped this month
  let shipped = 0;
  const snap = await db.collection("units").get();
  snap.forEach((d) => {
    const u = d.data();
    if (unitState(u, STATIONS).status === "shipped" && shipMonthOf(u) === monthKey) shipped++;
  });

  return {
    milestoneType: "monthlyShippingGoal",
    month: monthKey,                 // "YYYY-MM"
    goalUnits: goal,                 // target set by managers
    shippedUnits: shipped,           // actual shipped so far this month
    metGoal: shipped >= goal,
    asOf: new Date().toISOString(),
  };
}

async function pushMonthlyGoal(token, instance, STATIONS) {
  const milestone = await buildMonthlyGoalMilestone(STATIONS);
  if (!milestone) {
    console.log("No monthly goal set — skipping goal milestone push.");
    return { pushedGoal: false };
  }

  // NOTE FOR IT: replace with the real SiEOPS endpoint for plant/line milestones.
  const url = `${instance}/services/apexrest/switchframe/monthlyGoal`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [milestone] }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Monthly goal push failed (${res.status}) ${detail.slice(0, 200)}`);
  }
  console.log(`Pushed monthly goal milestone: ${milestone.shippedUnits}/${milestone.goalUnits} for ${milestone.month}.`);
  return { pushedGoal: true, milestone };
}

async function pushToSiops() {
  const { token, instance } = await siopsToken();
  const stations = await getStations();
  const plannedHours = plannedHoursFor(stations);

  const snap = await db.collection("units").get();
  const payloads = [];
  snap.forEach((d) => {
    const u = d.data();
    if (u && u.order) payloads.push(buildOutboundPayload(u, stations, plannedHours));
  });

  if (!payloads.length) {
    console.log("Nothing to push — no units with a job number.");
    return { pushed: 0, batches: 0 };
  }

  // NOTE FOR IT: replace with the real SiEOPS endpoint for production tasks.
  const url = `${instance}/services/apexrest/switchframe/productionTasks`;

  // Send in chunks. Salesforce REST caps a request body at roughly 6MB, and one
  // giant payload would fail outright on a large line. 200 records per call is
  // comfortably inside the limit and matches Salesforce's usual batch size.
  const CHUNK = 200;
  let pushed = 0;
  let batches = 0;

  for (let i = 0; i < payloads.length; i += CHUNK) {
    const slice = payloads.slice(i, i + CHUNK);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: slice }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`SiEOPS push failed on batch ${batches + 1} (${res.status}) ${detail.slice(0, 200)}`);
    }
    pushed += slice.length;
    batches++;
  }

  console.log(`Pushed ${pushed} record(s) to SiEOPS over ${batches} batch(es).`);

  // Also push the monthly shipping goal as a plant-level milestone.
  let goalResult = { pushedGoal: false };
  try {
    goalResult = await pushMonthlyGoal(token, instance, stations);
  } catch (e) {
    // don't fail the whole push if only the goal milestone errors
    console.log("Monthly goal milestone push failed:", e.message);
  }

  return { pushed, batches, ...goalResult };
}

/* ==================================================================
   SCHEDULED JOBS — daily, 5am Pacific
   ================================================================== */
exports.dailySync = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("0 5 * * *")
  .timeZone("America/Los_Angeles")
  .onRun(async () => {
    const r = await runSync();
    console.log("Daily sync:", JSON.stringify(r));
    return null;
  });

exports.dailyPush = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("0 18 * * *")
  .timeZone("America/Los_Angeles")
  .onRun(async () => {
    const r = await pushToSiops();
    console.log("Daily push:", JSON.stringify(r));
    return null;
  });

/* ==================================================================
   MANUAL TRIGGERS — for a manager to run a sync on demand.
   Callable functions require an authenticated app user.
   ================================================================== */
// Same generous timeout as the scheduled jobs — a full sync can take minutes.
// Without this they would default to 60 seconds and cut out mid-run.
exports.syncNow = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    await requireManager(context);
    return await runSync();
  });

exports.pushNow = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    await requireManager(context);
    return await pushToSiops();
  });

/* ==================================================================
   EQMS — attach an in-line or traveler document to a unit.
   Accepts a link (works today) or a stored file path (needs Storage).
   ================================================================== */
exports.attachDocument = functions.https.onCall(async (data, context) => {
  await requireManager(context);
  const { unitId, kind, url, name } = data || {};
  if (!unitId || !kind || !url) {
    throw new functions.https.HttpsError("invalid-argument", "unitId, kind and url are required.");
  }
  if (kind !== "inlineDoc" && kind !== "travelerDoc") {
    throw new functions.https.HttpsError("invalid-argument", "kind must be inlineDoc or travelerDoc.");
  }
  await db.collection("units").doc(unitId).update({
    [kind]: { url, name: name || "Document", at: new Date().toISOString(), source: "EQMS" },
  });
  return { ok: true };
});

/* ==================================================================
   HEALTH CHECK — lets IT confirm the API is live and configured.
   ================================================================== */
exports.health = functions.https.onRequest(async (req, res) => {
  const c = cfg();
  res.json({
    service: "Switchframe Integration API",
    time: new Date().toISOString(),
    configured: {
      siops: Boolean(c.siops && c.siops.client_id),
      m2m: Boolean(c.m2m && c.m2m.api_key),
    },
  });
});
