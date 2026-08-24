-- 0089 (D-520): attribution becomes a TIME SERIES (history of explanation), not a single snapshot.
alter table trd_attribution drop constraint trd_attribution_pkey;
alter table trd_attribution add primary key (symbol, asof);
notify pgrst, 'reload schema';
