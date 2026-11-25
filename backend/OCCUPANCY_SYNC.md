# Occupancy sync contract (the-suites-admin-dashboard → warehouse API)

The admin dashboard pushes one record per **business day** (hotel calendar
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
