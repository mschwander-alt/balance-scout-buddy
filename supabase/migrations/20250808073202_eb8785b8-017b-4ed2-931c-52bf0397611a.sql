-- Create storage bucket for trial balances
INSERT INTO storage.buckets (id, name, public) 
VALUES ('trial-balances', 'trial-balances', false);

-- Create storage policies for trial balance uploads
CREATE POLICY "Users can view their own trial balance files" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'trial-balances' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own trial balance files" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'trial-balances' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own trial balance files" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = 'trial-balances' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own trial balance files" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'trial-balances' AND auth.uid()::text = (storage.foldername(name))[1]);