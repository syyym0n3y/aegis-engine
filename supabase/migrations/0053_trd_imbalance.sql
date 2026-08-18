-- 0053 — closing-auction (MOC) imbalance store (Databento XNAS.ITCH). Directional-edge hunt: the published closing
-- imbalance may predict the close→next-open drift (Morand). imb_signed = +buy / −sell imbalance qty at the close.
create table if not exists trd_imbalance (
  symbol text not null, date date not null,
  imb_signed double precision, imb_side text, ref_price double precision,
  updated_at timestamptz not null default now(), primary key (symbol, date)
);
alter table trd_imbalance enable row level security;
