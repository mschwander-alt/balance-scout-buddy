-- Remove file size limits for the buckets used by "Kontoblätter hochladen"
update storage.buckets set file_size_limit = null where id in ('account-evidence');
-- Also lift for trial-balances to keep consistency
update storage.buckets set file_size_limit = null where id in ('trial-balances');