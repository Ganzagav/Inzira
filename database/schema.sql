-- Inzira schema v2 (plain PostgreSQL, works on Neon). Safe to re-run: uses IF NOT EXISTS.
-- To wipe everything and start fresh: npm run db:reset (in /backend)

-- ---- Road network (imported from OpenStreetMap by scripts/import-osm.js) ----
CREATE TABLE IF NOT EXISTS nodes (          -- intersections / road ends (id = OSM node id)
  id  BIGINT PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (          -- road segment between two intersections
  id            SERIAL PRIMARY KEY,
  way_id        BIGINT,                     -- OSM way id
  name          TEXT NOT NULL DEFAULT '',
  highway       TEXT NOT NULL,              -- primary, secondary, residential...
  from_node     BIGINT NOT NULL REFERENCES nodes(id),
  to_node       BIGINT NOT NULL REFERENCES nodes(id),
  length_m      DOUBLE PRECISION NOT NULL,
  road_type     TEXT NOT NULL CHECK (road_type IN ('tarmac','stone','dirt')),
  is_major      BOOLEAN NOT NULL DEFAULT false,
  free_flow_kmh INT NOT NULL DEFAULT 30,
  oneway        BOOLEAN NOT NULL DEFAULT false,
  geom          JSONB NOT NULL              -- [[lat,lng],...] from from_node to to_node
);
CREATE INDEX IF NOT EXISTS idx_edges_way ON edges (way_id);

CREATE TABLE IF NOT EXISTS places (         -- searchable names (suburbs, markets, hospitals...)
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  lat  DOUBLE PRECISION NOT NULL,
  lng  DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_places_name ON places (lower(name) text_pattern_ops);

-- ---- Accounts ----
CREATE TABLE IF NOT EXISTS users (          -- traffic police officers and admins
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  station       TEXT,
  role          TEXT NOT NULL CHECK (role IN ('officer','admin')),
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devices (        -- ESP32 police posts and vehicle units (one key each)
  id         SERIAL PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('police_post','vehicle')),
  key_hash   TEXT UNIQUE NOT NULL,          -- sha256 of the key; the key itself is shown once
  active     BOOLEAN NOT NULL DEFAULT true,
  last_seen  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Live conditions ----
CREATE TABLE IF NOT EXISTS incidents (      -- one row per affected edge; rows of one report share group_id
  id          BIGSERIAL PRIMARY KEY,
  group_id    UUID NOT NULL,
  edge_id     INT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('congestion','accident','clear','closure','roadworks')),
  cause       TEXT,                         -- closure cause: event, security, construction, accident, other
  level       SMALLINT NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 4),
  note        TEXT,
  road_name   TEXT,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  radius_m    INT,
  created_by  TEXT NOT NULL,                -- display name
  created_ref TEXT NOT NULL,                -- user:ID or device:ID
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_incidents_group  ON incidents (group_id);
CREATE INDEX IF NOT EXISTS idx_incidents_active ON incidents (ends_at) WHERE cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS probes (         -- anonymous vehicle samples (auto-deleted after 24 h)
  id          BIGSERIAL PRIMARY KEY,
  device_hash TEXT NOT NULL,
  src         TEXT NOT NULL DEFAULT 'device',
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  speed_kmh   REAL,
  heading     REAL,
  edge_id     INT REFERENCES edges(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_probes_recent ON probes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_probes_edge   ON probes (edge_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trips (          -- estimated vs actual travel time (evaluation)
  id          SERIAL PRIMARY KEY,
  device_hash TEXT,
  mode        TEXT NOT NULL CHECK (mode IN ('fastest','shortest','alternative','other')),
  from_label  TEXT,
  to_label    TEXT,
  estimated_s INT NOT NULL,
  actual_s    INT NOT NULL,
  distance_m  INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
