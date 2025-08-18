-- Remove existing file size limits and set to NULL (unlimited)
UPDATE storage.buckets 
SET file_size_limit = NULL
WHERE id IN ('account-evidence', 'trial-balances');

-- Create or update storage policies to handle large files
-- First, drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload their own account evidence" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own account evidence" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own account evidence" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own account evidence" ON storage.objects;

DROP POLICY IF EXISTS "Users can upload their own trial balances" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own trial balances" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own trial balances" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own trial balances" ON storage.objects;

-- Create comprehensive storage policies for account-evidence bucket
CREATE POLICY "Users can upload their own account evidence" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'account-evidence' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own account evidence" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'account-evidence' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own account evidence" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'account-evidence' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own account evidence" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'account-evidence' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Create comprehensive storage policies for trial-balances bucket
CREATE POLICY "Users can upload their own trial balances" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'trial-balances' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own trial balances" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'trial-balances' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own trial balances" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'trial-balances' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own trial balances" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'trial-balances' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);