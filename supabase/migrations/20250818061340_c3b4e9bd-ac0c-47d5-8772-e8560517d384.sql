-- Update storage bucket file size limits to allow larger files (up to 2GB)
UPDATE storage.buckets 
SET file_size_limit = 2147483648  -- 2GB in bytes
WHERE id IN ('account-evidence', 'trial-balances');

-- If buckets don't exist yet, create them with appropriate limits
INSERT INTO storage.buckets (id, name, public, file_size_limit) 
VALUES 
  ('account-evidence', 'account-evidence', false, 2147483648),
  ('trial-balances', 'trial-balances', false, 2147483648)
ON CONFLICT (id) DO UPDATE SET file_size_limit = 2147483648;