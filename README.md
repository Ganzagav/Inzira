# Inzira v2.2 - Rwanda real-time traffic & route planning

Fastest *suitable* route on **real OpenStreetMap roads**, with live congestion, closures and roadworks.
Public app in Kinyarwanda / English / Français / Kiswahili, plus **two separate login-protected portals**: traffic police (`/police/`) and administration (`/admin/`).

```
 Police portal (/police/, login) --\
 ESP32 police posts (device key) ---+--> Express API (Render) --> Neon PostgreSQL <-- OpenStreetMap (import once)
 ESP32 vehicle units (device key) --/            ^
 Web app users (opt-in anonymous speed) --------/            |  REST
                                  Public web app (Vercel, "/")  +  OLED vehicle unit
```

## Directory structure

```
kigali-route/
├── database/schema.sql            nodes, edges (with road geometry), places, users, devices, incidents, probes, trips, audit_log
├── backend/                       Node.js + Express
│   ├── .env.example
│   ├── scripts/
│   │   ├── initdb.js              create tables  (--reset drops everything)
│   │   ├── import-osm.js          download Kigali roads + places from OpenStreetMap into Neon
│   │   ├── create-admin.js        create the first admin account
│   │   ├── simulate.js            fake jam / closure / roadworks at coordinates
│   │   └── selftest.js            offline tests of OSM parsing + routing (npm test)
│   └── src/
│       ├── server.js, db.js, middleware.js (passwords, JWT, device keys, audit)
│       ├── osm.js                 Overpass JSON -> graph (intersections, geometry, surface, speed, oneway)
│       ├── graphcore.js           in-memory graph, spatial grid, road selection, live-condition overlay
│       ├── graph.js               loads graph from DB, refreshes live conditions every 8 s
│       ├── routing.js             A* search, fastest/shortest/alternative, merged turn-by-turn, fuel
│       ├── incidents.js
│       └── routes/  network.js (places, live map layer) | route.js | traffic.js (incidents, probes, trips) | auth.js (login, users, devices, audit)
├── frontend/                      React + Vite + Leaflet   (two pages)
│   ├── index.html  -> src/public/   public app: search, map, route, navigation, alerts
│   ├── police/index.html -> src/police/   Traffic police portal (role: officer): report incident, incidents, account
│   ├── admin/index.html  -> src/admin/    Administration portal (role: admin): overview, officers, devices, road network, audit log, account
│   ├── public/            logo.svg, logo-wordmark.svg, favicon.svg
│   └── src/portal/        shared by both portals: Login, SignedOut (sign-out page), Shell, AccountTab, ActivityTab, useSession
│   └── src/shared/ api.js, geo.js, i18n.js
└── iot/
    ├── vehicle_unit/   ESP32 + OLED: probes, ETA, alerts, trip log; simulated car follows the real route
    └── police_post/    ESP32 + OLED: fixed post, knob = length along road, 4 report buttons
```

## What changed from v1

| Before | Now |
|---|---|
| 12 hand-placed points joined by straight lines | **Real roads from OpenStreetMap**, drawn along the actual road geometry |
| Every road drawn on the map | Map shows **only your route (A to B), other route options, and live incidents**; traffic layer can be toggled |
| Pick from 12 places | **Search any place**, tap the map, or use **my location** |
| Shared API keys, form inside the public app | **Separate police portal** with officer accounts, roles, audit log |
| One shared device key | **One key per ESP32**, revocable from the portal |
| Report per hand-coded road | Officer **clicks the road on the map**, chooses how far along it applies |
| - | Live **navigation mode** (GPS follow, off-route re-plan, optional anonymous speed sharing), avoid-unpaved option, shareable links |

## 1. Upgrade steps (you already have v1 running)

```bash
cd ~/Kigali-route/kigali-route/backend          # (after replacing the project files with this version)
npm install

# .env: keep DATABASE_URL, then add/replace these lines
#   JWT_SECRET=<output of: openssl rand -hex 32>
#   PROBE_SALT=<any random string>
#   CORS_ORIGIN=http://localhost:5173
# (POLICE_API_KEY / DEVICE_API_KEY are no longer used)

npm test                    # offline self-test, should end with "All self-tests passed."
npm run db:reset            # DROPS the old demo tables, creates the v2 schema
npm run import:osm          # downloads real Kigali roads (1-5 min). Needs internet
npm run create-admin -- admin 'ChooseAStrongPassword' "Your Name"
npm run dev                 # http://localhost:4000
```
```bash
cd ../frontend && npm install && npm run dev
#  public app:   http://localhost:5173/
#  police portal: http://localhost:5173/police/
```

**Import tips.** The default area is central Kigali (`OSM_BBOX=-2.02,30.00,-1.88,30.16`).
- Overpass busy or timing out: the script retries 3 mirrors. You can also run `npm run import:osm -- --main-only` (only primary/secondary/tertiary roads: small and fast), or a smaller `--bbox=S,W,N,E`.
- Save the download once with `--save=kigali.json`, re-import later with `--file=kigali.json`.
- The import **replaces** roads/places and clears incidents + probes. Users and devices are kept.
- Neon free tier has 0.5 GB: the full Kigali import is well under that.

**No roads yet? ("Road data has not been imported yet")** Either run `npm run import:osm` in `backend/`, or sign in to the portal as an admin ->
*Administration -> Road network -> Import roads now*. The running server picks up the new roads within seconds (no restart).
Free hosting has little memory: tick *Main roads only* there, or import from your own computer (the database is shared).

## 2. Using it

**Public app**: type a place in *From* / *To* (or tap `⌖` then the map, or `◎` for your location). The route appears
automatically. Click a grey line to switch to that option. *Start navigation* follows your GPS and re-plans if you leave the route.

**Sign out**: both portals have a *Sign out* button; it shows a "You have been signed out" page that opens the public route planner (automatically after 8 s, or with one click).

**Two portals**: officers sign in at `/police/`, administrators at `/admin/`. Each accepts only its own role (the other gets a link to the right portal) and keeps its own session, so both can be open in one browser. Admins create officers in *Admin -> Officers*. The first admin is created with `npm run create-admin`.

**Police portal** (`/police/`): sign in, click the road on the map, choose *Heavy traffic / Accident / Road closed / Roadworks / Cleared*,
how long it applies, and publish. Drivers' routes change within ~10 seconds. *Incidents & stats* lists active reports (cancel your own;
admins can cancel any) and the estimated-vs-actual evaluation table. *Administration* (admins): create officers, reset passwords,
register ESP32 devices (the key is shown once), read the audit log.

**Demo without hardware**: `SIM_USER=admin SIM_PASS='...' npm run simulate -- jam` (in `backend/`) puts a jam around Kimironko;
`event` closes a road; `works` adds roadworks. Then search a route through that area and watch it divert.

## 3. ESP32 devices (Wokwi)

1. Portal -> Administration -> *Register device*: create one **Police post** and one **Vehicle unit**; copy each key.
2. https://wokwi.com -> New ESP32 project. Paste `.ino`, `diagram.json`, `libraries.txt` of `iot/vehicle_unit` (repeat for `police_post` in a second project).
3. Edit CONFIG: `API_BASE` = your **Render URL** (Wokwi cannot reach `localhost`) and `DEVICE_KEY`. Press Play.
4. Vehicle unit: the simulated car drives the real route to the chosen destination. **Turn the potentiometer to ~5 km/h**: after a few probes that road turns red on the public map and routes divert. Button 1 changes destination, button 2 language. On arrival it logs estimated vs actual time.
5. Police post: set `POST_LAT/POST_LNG` to the junction where the post stands, turn the knob for the length, press HEAVY / BLOCKED / CLEAR. The incident appears in the portal as "Post <name>".

Tinkercad cannot do WiFi/HTTP on an ESP32, so use Wokwi. Pin table (if a wire is rejected in Wokwi): OLED SDA/SCL 21/22; pot SIG 34;
vehicle buttons 18 & 19, LED 4, buzzer 5; police buttons 18/19/23/25, LED 2, buzzer 5 (buttons: other leg to GND).
Real hardware: ESP32 + SSD1306 + NEO-6M GPS (TX->16, RX->17), set `USE_SIM_GPS 0`.

## 4. Deploy

**Render (API)**: Root Directory `backend`, build `npm install`, start `npm start`. Env vars: `DATABASE_URL`, `JWT_SECRET`, `PROBE_SALT`,
`PROBE_MIN_VEHICLES` (use 3+ in production), `CORS_ORIGIN=https://your-app.vercel.app`. Free tier sleeps: first request can take ~30 s.
**Vercel (web)**: Root Directory `frontend`, framework Vite, env `VITE_API_URL=https://your-api.onrender.com`. Police portal: `https://your-app.vercel.app/police/`.

## 5. How it decides

- **Time per road segment** = length / (free-flow speed x surface x congestion). Surface: tarmac 1.0, stone/cobble/gravel 0.7, dirt 0.5. Congestion levels 0-4 = x1.0, 0.75, 0.5, 0.25, 0.1. Roadworks x0.4. Closed roads are never used.
- **Congestion sources**: police/post reports (expire automatically; "Cleared" overrides) and vehicle speeds averaged over 5 min (needs `PROBE_MIN_VEHICLES` distinct vehicles on that road).
- **Search**: A* over the road graph (tens of ms). *Shortest* ignores traffic; *Fastest* minimises time with a small penalty for unpaved roads (x4 if "avoid unpaved"); *Alternative* re-runs with the fastest route's roads penalised and is shown only if it is genuinely different.
- OSM data: surface/maxspeed tags where mapped; unmapped roads are assumed tarmac with class-based speed (no invented "unpaved" warnings).

## 6. API summary

| Endpoint | Auth | Purpose |
|---|---|---|
| GET `/api/meta`, `/api/places/search?q=`, `/api/places/near` | - | Coverage, autocomplete, label a clicked point |
| GET `/api/route?from_lat&from_lng&to_lat&to_lng[&avoid_unpaved=1]` | - | Fastest / shortest / alternative with geometry and steps |
| GET `/api/route/lite?...[&pts=1]` | - | Compact ASCII answer (+ sampled path) for ESP32 |
| GET `/api/network` | - | Live layer: abnormal road segments, incidents, alerts |
| POST `/api/auth/login`, GET `/api/auth/me`, POST `/api/auth/password` | - / Bearer | Officer sessions (JWT, 8 h) |
| GET `/api/roads/select`, POST/GET/DELETE `/api/incidents` | Bearer (officer, admin) | Report, list, cancel. POST also accepts a police-post device key |
| POST `/api/probes`, `/api/trips` | device key (vehicle) | Anonymous speed samples; estimated vs actual time |
| POST `/api/probes/public` | - (rate limited, opt-in) | Anonymous speed from the web app |
| `/api/admin/users`, `/devices`, `/audit` | Bearer (admin) | Accounts, device keys, audit log |

## 7. Security notes and honest limitations

- Passwords: scrypt. Logins rate-limited (10 / 15 min / IP), failures audited, deactivated accounts lose access immediately. Device keys are stored hashed and revocable.
- Not yet done: two-factor login, password-reset by email, HTTPS-only cookies (token lives in sessionStorage), stronger anti-spoofing for public probes. Do a proper security review and data-sharing agreement with Rwanda National Police before any pilot.
- Routing snaps start/end to the nearest intersection (can be a few hundred metres off on long blocks; a dotted line shows it). Turn-by-turn is by road name, without lane/roundabout detail. No turn restrictions or signal timing (OSM turn restrictions are a good next step).
- Congestion is only as good as the reports/probes; with no data every road is free-flow. Speed limits/surfaces come from OSM and may be missing: improving OSM in Kigali directly improves Inzira.
- Fuel is a simple model (8.5 L/100 km x congestion factor), not measured.
- Kinyarwanda/Kiswahili strings need native-speaker review. The police portal is English only.
- Next: OSRM/GraphHopper with live weights for national scale, PostGIS, offline map tiles, traffic prediction from stored history, Raspberry Pi kiosk for older vehicles.
