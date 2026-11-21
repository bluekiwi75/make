CREATE TABLE market_connection (
  owner_id TEXT NOT NULL,
  business TEXT NOT NULL CHECK (business IN ('1', '2')),
  market TEXT NOT NULL CHECK (market IN ('coupang', 'naver')),
  seller_hash TEXT NOT NULL,
  sealed TEXT NOT NULL,
  last_sync TEXT,
  PRIMARY KEY (owner_id, business, market),
  UNIQUE (owner_id, market, seller_hash)
);
