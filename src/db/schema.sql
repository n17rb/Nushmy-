-- ==========================================================
-- نشمي — مخطط قاعدة البيانات
-- صيغة SQL محايدة تعمل على PostgreSQL و SQLite معاً.
--   * المعرّفات TEXT (UUID)
--   * الأوقات TEXT بصيغة ISO-8601 UTC
--   * المبالغ INTEGER بوحدة "فلس" (1 دينار = 1000 فلس) — لا أرقام عشرية للأموال
--   * القيم المنطقية INTEGER 0/1
-- ==========================================================

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  value_type  TEXT NOT NULL DEFAULT 'string',
  label_ar    TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS cities (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name_ar     TEXT NOT NULL,
  name_en     TEXT,
  center_lat  REAL NOT NULL,
  center_lng  REAL NOT NULL,
  radius_km   REAL NOT NULL DEFAULT 25,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
  id           TEXT PRIMARY KEY,
  city_id      TEXT NOT NULL REFERENCES cities(id),
  name_ar      TEXT NOT NULL,
  polygon_json TEXT,
  demand_level TEXT NOT NULL DEFAULT 'LOW',
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zones_city ON zones(city_id);

CREATE TABLE IF NOT EXISTS vehicle_types (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name_ar     TEXT NOT NULL,
  desc_ar     TEXT,
  capacity    INTEGER NOT NULL DEFAULT 4,
  icon        TEXT NOT NULL DEFAULT 'car',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing_rules (
  id                    TEXT PRIMARY KEY,
  city_id               TEXT REFERENCES cities(id),
  zone_id               TEXT REFERENCES zones(id),
  vehicle_type_id       TEXT REFERENCES vehicle_types(id),
  base_fare_fils        INTEGER NOT NULL,
  per_km_fils           INTEGER NOT NULL,
  per_min_fils          INTEGER NOT NULL DEFAULT 0,
  min_fare_fils         INTEGER NOT NULL,
  waiting_per_min_fils  INTEGER NOT NULL DEFAULT 0,
  free_waiting_sec      INTEGER NOT NULL DEFAULT 180,
  cancellation_fee_fils INTEGER NOT NULL DEFAULT 0,
  peak_multiplier_bp    INTEGER NOT NULL DEFAULT 10000,
  priority              INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pricing_lookup ON pricing_rules(is_active, city_id, vehicle_type_id);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL DEFAULT 'customer',
  phone_e164    TEXT NOT NULL UNIQUE,
  name          TEXT,
  email         TEXT,
  photo_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  language      TEXT NOT NULL DEFAULT 'ar',
  theme         TEXT NOT NULL DEFAULT 'system',
  city_id       TEXT REFERENCES cities(id),
  is_verified   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_e164);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          TEXT PRIMARY KEY,
  phone_e164  TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'login',
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone_e164, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  ip           TEXT,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS saved_places (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL DEFAULT 'custom',
  label      TEXT NOT NULL,
  address    TEXT,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_places_user ON saved_places(user_id);

CREATE TABLE IF NOT EXISTS recent_places (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  label      TEXT NOT NULL,
  address    TEXT,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  used_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recent_user ON recent_places(user_id, used_at);

CREATE TABLE IF NOT EXISTS captains (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL UNIQUE REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'PENDING',
  is_online       INTEGER NOT NULL DEFAULT 0,
  rating_sum      INTEGER NOT NULL DEFAULT 0,
  rating_count    INTEGER NOT NULL DEFAULT 0,
  trips_completed INTEGER NOT NULL DEFAULT 0,
  offers_sent     INTEGER NOT NULL DEFAULT 0,
  offers_accepted INTEGER NOT NULL DEFAULT 0,
  cancellations   INTEGER NOT NULL DEFAULT 0,
  city_id         TEXT REFERENCES cities(id),
  approved_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id              TEXT PRIMARY KEY,
  captain_id      TEXT NOT NULL REFERENCES captains(id),
  vehicle_type_id TEXT NOT NULL REFERENCES vehicle_types(id),
  make            TEXT,
  model           TEXT,
  color           TEXT,
  year            INTEGER,
  plate_number    TEXT NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicles_captain ON vehicles(captain_id);

-- الملفات (صور الحسابات، الوثائق، إشعارات التحويل) محفوظة بقاعدة البيانات
-- لأن قرص Render المجاني يُمسح عند كل إعادة تشغيل
CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id),
  kind          TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  data_base64   TEXT NOT NULL,
  is_private    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_user_id);

-- وثائق الكابتن (رخصة، هوية، ترخيص مركبة) — لا تُعرض للعامة
CREATE TABLE IF NOT EXISTS captain_documents (
  id          TEXT PRIMARY KEY,
  captain_id  TEXT NOT NULL REFERENCES captains(id),
  kind        TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PENDING',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_captain ON captain_documents(captain_id, kind);

CREATE TABLE IF NOT EXISTS driver_locations (
  captain_id  TEXT PRIMARY KEY REFERENCES captains(id),
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  heading     REAL,
  speed       REAL,
  accuracy    REAL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  customer_id           TEXT NOT NULL REFERENCES users(id),
  captain_id            TEXT REFERENCES captains(id),
  vehicle_type_id       TEXT NOT NULL REFERENCES vehicle_types(id),
  city_id               TEXT REFERENCES cities(id),
  status                TEXT NOT NULL,
  pickup_lat            REAL NOT NULL,
  pickup_lng            REAL NOT NULL,
  pickup_address        TEXT,
  dest_lat              REAL NOT NULL,
  dest_lng              REAL NOT NULL,
  dest_address          TEXT,
  est_distance_m        INTEGER NOT NULL DEFAULT 0,
  est_duration_s        INTEGER NOT NULL DEFAULT 0,
  est_fare_fils         INTEGER NOT NULL DEFAULT 0,
  final_distance_m      INTEGER,
  final_duration_s      INTEGER,
  gross_fare_fils       INTEGER,
  discount_fils         INTEGER NOT NULL DEFAULT 0,
  commission_fils       INTEGER,
  captain_earnings_fils INTEGER,
  cancellation_fee_fils INTEGER NOT NULL DEFAULT 0,
  payment_method        TEXT NOT NULL DEFAULT 'CASH',
  pricing_rule_id       TEXT REFERENCES pricing_rules(id),
  cancel_reason         TEXT,
  cancelled_by          TEXT,
  requested_at          TEXT NOT NULL,
  assigned_at           TEXT,
  arrived_at            TEXT,
  started_at            TEXT,
  completed_at          TEXT,
  cancelled_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trips_customer ON trips(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_captain ON trips(captain_id, status);

CREATE TABLE IF NOT EXISTS trip_stops (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips(id),
  seq        INTEGER NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  address    TEXT,
  reached_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stops_trip ON trip_stops(trip_id, seq);

CREATE TABLE IF NOT EXISTS trip_status_history (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tsh_trip ON trip_status_history(trip_id, created_at);

CREATE TABLE IF NOT EXISTS trip_offers (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id),
  captain_id   TEXT NOT NULL REFERENCES captains(id),
  score        REAL NOT NULL DEFAULT 0,
  eta_s        INTEGER,
  distance_m   INTEGER,
  status       TEXT NOT NULL DEFAULT 'SENT',  -- SENT | ACCEPTED | REJECTED | EXPIRED | SUPERSEDED
  sent_at      TEXT NOT NULL,
  responded_at TEXT,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offers_trip ON trip_offers(trip_id, status);

CREATE TABLE IF NOT EXISTS ratings (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips(id),
  rater_id   TEXT NOT NULL REFERENCES users(id),
  ratee_id   TEXT REFERENCES users(id),
  direction  TEXT NOT NULL,
  stars      INTEGER NOT NULL,
  tags       TEXT,
  comment    TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (trip_id, direction)
);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id),
  sender_id    TEXT NOT NULL REFERENCES users(id),
  body         TEXT NOT NULL,
  delivered_at TEXT,
  read_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_trip ON messages(trip_id, created_at);

CREATE TABLE IF NOT EXISTS complaints (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT REFERENCES trips(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  category   TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  data_json  TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS wallets (
  id           TEXT PRIMARY KEY,
  captain_id   TEXT NOT NULL UNIQUE REFERENCES captains(id),
  balance_fils INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id               TEXT PRIMARY KEY,
  wallet_id        TEXT NOT NULL REFERENCES wallets(id),
  captain_id       TEXT NOT NULL REFERENCES captains(id),
  transaction_type TEXT NOT NULL,
  amount_fils      INTEGER NOT NULL,
  balance_before   INTEGER NOT NULL,
  balance_after    INTEGER NOT NULL,
  reference_id     TEXT,
  idempotency_key  TEXT UNIQUE,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'POSTED',
  created_by       TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wtx_wallet ON wallet_transactions(wallet_id, created_at);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id            TEXT PRIMARY KEY,
  captain_id    TEXT NOT NULL REFERENCES captains(id),
  amount_fils   INTEGER NOT NULL,
  proof_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  reject_reason TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  discount_type     TEXT NOT NULL DEFAULT 'PERCENT',
  discount_value    INTEGER NOT NULL,
  max_discount_fils INTEGER,
  min_fare_fils     INTEGER NOT NULL DEFAULT 0,
  usage_limit       INTEGER,
  per_user_limit    INTEGER NOT NULL DEFAULT 1,
  used_count        INTEGER NOT NULL DEFAULT 0,
  starts_at         TEXT,
  ends_at           TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_scores (
  user_id       TEXT PRIMARY KEY REFERENCES users(id),
  score         INTEGER NOT NULL DEFAULT 0,
  level         TEXT NOT NULL DEFAULT 'NORMAL',
  cancellations INTEGER NOT NULL DEFAULT 0,
  trips         INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  before_json TEXT,
  after_json  TEXT,
  reason      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id, created_at);
