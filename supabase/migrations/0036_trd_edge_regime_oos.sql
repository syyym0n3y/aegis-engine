-- D-270: OOS columns for the regime matrix — each favourable bucket must hold its vs-random edge in BOTH time
-- halves (guards against in-sample regime mining). Populated by scoreByRegime.
alter table trd_edge_regime add column if not exists h1_edge double precision;
alter table trd_edge_regime add column if not exists h2_edge double precision;
alter table trd_edge_regime add column if not exists holds_both boolean;
