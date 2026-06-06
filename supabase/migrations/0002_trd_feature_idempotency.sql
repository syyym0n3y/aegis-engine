-- 0002_trd_feature_idempotency.sql — make the point-in-time feature store
-- idempotent. A feature value for a given (key, symbol, effective_date) is
-- deterministic from append-only data disclosed on/before that date, so a unique
-- key + ON CONFLICT DO NOTHING makes re-derivation a no-op (no duplicate rows).
create unique index if not exists trd_features_pit_uk
  on trd_features (feature_key, symbol, effective_date);
