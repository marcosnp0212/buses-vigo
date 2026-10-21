-- one alert per device (id = hash of its push endpoint)
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  stop INTEGER NOT NULL,
  line TEXT NOT NULL,
  lead INTEGER NOT NULL,
  until INTEGER NOT NULL,
  stop_name TEXT,
  message TEXT
);
CREATE INDEX IF NOT EXISTS alerts_until ON alerts (until);
