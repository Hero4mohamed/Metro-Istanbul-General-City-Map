-- The relay's whole memory. Apply with:  npx wrangler d1 execute turkmaps-relay --remote --file schema.sql
-- wanted: the bus lines someone has open (the line code and when it was last asked for; nothing about who asked)
CREATE TABLE IF NOT EXISTS wanted (line TEXT PRIMARY KEY, at INTEGER NOT NULL);
-- snap: the feeder's last answer for a line (ok = 0 when İETT did not answer the feeder)
CREATE TABLE IF NOT EXISTS snap (line TEXT PRIMARY KEY, at INTEGER NOT NULL, ok INTEGER NOT NULL, body TEXT NOT NULL);
-- meta: one row, when the feeder was last heard from
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
