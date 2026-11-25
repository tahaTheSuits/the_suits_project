# Occupancy sync contract (the-suites-admin-dashboard ↔ warehouse API)

Two directions are supported, both feeding the same upsert pipeline:

* **Push** — the dashboard sends records to `POST /api/occupancy/sync`
  (sections below).
* **Pull** — the warehouse fetches records from the dashboard's
  `GET /api/integrations/warehouse/daily` (see *Pull from the dashboard* at the
  end). This is what the **Sync from Dashboard** button uses.

The admin dashboard provides one record per **business day** (hotel calendar
date). The warehouse stores exactly one document per date and combines it with
stock-out data in the *Consumption vs Occupancy* report.

## Endpoint

```
POST {WAREHOUSE_API}/api/occupancy/sync
Content-Type: application/json
Authorization: Bearer <OCCUPANCY_SYNC_TOKEN>     (or  X-Sync-Token: <token>)
```

* Call it **server-to-server** (from the dashboard backend or a scheduled job).
  The warehouse API only allows browser requests from its own frontend origin,
  so a browser call from the dashboard UI would be blocked by CORS.
* `OCCUPANCY_SYNC_TOKEN` is an environment variable on the warehouse API.
  When it is set, requests without the matching token get `401`. When it is
  not set the endpoint is open (a warning is logged) — set it in production.

## Request body

```json
{
  "records": [
    {
      "date": "2026-11-24",
      "totalApartments": 120,
      "occupiedApartments": 96,
      "vacantApartments": 24,
      "checkIns": 14,
      "checkOuts": 11,
      "servicedApartments": 80,
      "housekeepingCount": 92,
      "laundryCount": 40,
      "waterCount": 60,
      "note": "optional, max 500 chars",
      "updatedAt": "2026-11-24T21:05:00Z"
    }
  ],
  "force": false
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `date` | `"YYYY-MM-DD"` | yes | Business day **in the hotel's time zone** (not a UTC timestamp). Unique per request. |
| `totalApartments` | integer ≥ 0 or `null` | no | Apartments in inventory that day |
| `occupiedApartments` | integer ≥ 0 or `null` | no | Occupied apartment-nights for that day; must be ≤ total |
| `vacantApartments` | integer ≥ 0 or `null` | no | Optional; if total and occupied are known it is derived and must equal total − occupied |
| `checkIns`, `checkOuts` | integer ≥ 0 or `null` | no | Arrivals / departures |
| `servicedApartments` | integer ≥ 0 or `null` | no | Apartments serviced by housekeeping; ≤ total |
| `housekeepingCount` | integer ≥ 0 or `null` | no | Housekeeping tasks/visits |
| `laundryCount` | integer ≥ 0 or `null` | no | Laundry services |
| `waterCount` | integer ≥ 0 or `null` | no | Water deliveries/services |
| `note` | string or `null` | no | Free text |
| `updatedAt` | ISO-8601 datetime | recommended | When the dashboard last changed this day. Older updates than the stored one are skipped (`skipped_stale`). |
| `force` (top level) | boolean | no | `true` also overwrites days a warehouse user protected with a manual override |

Rules:

* **Upsert by date** — sending the same day again updates it; it never creates
  a duplicate. Re-sending an identical payload returns `unchanged`.
* **Partial updates** — omitted fields keep their stored value; `null` clears a
  field (= unknown). Unknown is never treated as 0 in calculations, so send
  `0` only when the true value is zero.
* At most **366 records** per request, each date at most once.
* Integers only (no decimals), 0–100000.

## Response (`200`)

```json
{
  "timeZone": "Asia/Riyadh",
  "summary": { "created": 1, "updated": 3, "unchanged": 2, "skipped_manual_override": 1 },
  "results": [
    { "date": "2026-11-24", "status": "updated" },
    { "date": "2026-11-25", "status": "invalid", "message": "occupiedApartments (130) cannot exceed totalApartments (120)." }
  ]
}
```

Per-record `status`: `created` · `updated` · `unchanged` ·
`skipped_manual_override` · `skipped_stale` · `invalid` (with `message`).
Invalid records do not stop the others. Request-level errors (no `records`
array, more than 366 records, duplicate dates) return `400`; a bad token
returns `401`.

## Recommended schedule

* Nightly after the business day closes: send yesterday (and the previous
  2–3 days to pick up late corrections — it is idempotent).
* Optionally intra-day for today; the last write wins (guarded by `updatedAt`).
* Backfill: send history in chunks of ≤ 366 days.

## Time zone

`date` must be the hotel's calendar day. The warehouse groups stock-out
movements into business days using its own process time zone, so set the
same zone on the warehouse API host, e.g. `TZ=Asia/Riyadh`. The `timeZone`
field in every response shows the zone in use — the dashboard should alert if
it differs from the hotel's.

## Manual entries in the warehouse

Warehouse users can add or edit a day in the UI (`PUT /api/occupancy/:date`).
By default that marks the day `manualOverride: true`, and syncs then skip it
(`skipped_manual_override`) unless `force: true` is sent or the user unticks
"Keep my values".

## Read endpoints (for checks)

* `GET /api/occupancy?from=YYYY-MM-DD&to=YYYY-MM-DD` — stored days
* `GET /api/occupancy/YYYY-MM-DD` — one day (`404` if none)
* `GET /api/reports/occupancy-consumption?from=…&to=…` — the combined report


## Pull from the dashboard (warehouse → dashboard)

The warehouse UI's **Sync from Dashboard** button (Consumption vs Occupancy
panel) calls the warehouse API, which then calls the dashboard. The browser
never sees the dashboard URL or key.

### What the dashboard must expose

```
GET {DASHBOARD_API_URL}/api/integrations/warehouse/daily?from=YYYY-MM-DD&to=YYYY-MM-DD
X-Api-Key: <key>
Authorization: Bearer <key>          (the same key is sent in both headers)
Accept: application/json
```

Response `200`:

```json
{
  "days": [
    {
      "date": "2026-11-24",
      "totalApartments": 120,
      "occupiedApartments": 96,
      "vacantApartments": 24,
      "checkIns": 14,
      "checkOuts": 11,
      "servicedApartments": 80,
      "housekeepingCount": 92,
      "laundryCount": 40,
      "waterCount": 60,
      "updatedAt": "2026-11-24T21:05:00Z"
    }
  ]
}
```

* Same field meanings and rules as the push contract above (integers ≥ 0 or
  `null`, `date` = hotel calendar day, omitted fields stay unchanged).
* Other properties on a day are ignored. Days outside `from..to`, duplicate
  dates and invalid dates are reported as `invalid` and skipped; the other
  days are still applied.
* Days in the range that the dashboard does not return are left unchanged
  (listed in `missingDays`).
* `401`/`403` → reported as "the dashboard rejected the API key"; any other
  non-2xx, non-JSON or a body without `days[]` → reported as a dashboard error.

### Warehouse endpoint

```
POST /api/occupancy/pull-dashboard
Content-Type: application/json

{ "from": "2026-11-18", "to": "2026-11-24", "force": false }
```

* `from`/`to` optional (default: the last 7 business days), at most 366 days.
* `force: true` also overwrites days protected by a manual override.
* One pull at a time per API process (`409 sync_in_progress` otherwise).

Response `200`:

```json
{
  "message": "Fetched 7 days from the dashboard: 2 created, 3 updated, 1 unchanged, 1 skipped (manual override).",
  "from": "2026-11-18", "to": "2026-11-24", "timeZone": "Asia/Riyadh", "force": false,
  "fetchedDays": 7,
  "summary": { "created": 2, "updated": 3, "unchanged": 1, "skipped_manual_override": 1 },
  "results": [ { "date": "2026-11-18", "status": "created" } ],
  "missingDays": []
}
```

Errors (JSON `{ message, code }`):

| HTTP | code | Meaning |
|---|---|---|
| 400 | `invalid_range` | Bad/reversed dates or more than 366 days |
| 409 | `sync_in_progress` | Another pull is running |
| 503 | `dashboard_not_configured` | `DASHBOARD_API_URL` missing or not an http(s) URL |
| 503 | `dashboard_key_missing` | No API key variable set |
| 502 | `dashboard_unreachable` | DNS/connection failure |
| 504 | `dashboard_timeout` | No answer within `DASHBOARD_TIMEOUT_MS` |
| 502 | `dashboard_auth_failed` | Dashboard answered 401/403 |
| 502 | `dashboard_error` | Dashboard answered another non-2xx status |
| 502 | `dashboard_bad_response` | Not JSON or no `days[]` array |

### Environment variables (warehouse API)

| Variable | Required | Purpose |
|---|---|---|
| `DASHBOARD_API_URL` | for pull | Dashboard base URL, e.g. `https://admin.example.com` (trailing `/` is fine; do not include `/api/integrations/...`) |
| `DASHBOARD_API_KEY` | for pull | Key sent to the dashboard as `X-Api-Key` and `Bearer` |
| `WAREHOUSE_API_KEY` | fallback | Used if `DASHBOARD_API_KEY` is not set |
| `OCCUPANCY_SYNC_TOKEN` | push; last fallback for pull | Token the dashboard must send to `POST /api/occupancy/sync`; also used as the pull key if neither variable above is set |
| `DASHBOARD_TIMEOUT_MS` | no | Pull timeout in ms (default `15000`) |
| `TZ` | recommended | Hotel time zone, e.g. `Asia/Riyadh` |

Keys are never logged or returned by the API.
