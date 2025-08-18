-- Remove file size limits for large uploads via TUS
-- Set file_size_limit to NULL (no limit) for the relevant buckets
update storage.buckets set file_size_limit = null where id in ('account-evidence', 'trial-balances');

-- Optionally ensure PDFs are allowed (no change if already null)
-- If allowed_mime_types is not null and doesn't include application/pdf, append it
update storage.buckets
set allowed_mime_types = case
  when allowed_mime_types is null then null
  when not ('application/pdf' = any(allowed_mime_types)) then allowed_mime_types || 'application/pdf'
  else allowed_mime_types
end
where id in ('account-evidence', 'trial-balances');