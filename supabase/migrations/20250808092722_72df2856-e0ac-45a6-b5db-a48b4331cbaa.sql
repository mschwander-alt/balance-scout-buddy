-- Create storage bucket for account evidence documents
INSERT INTO storage.buckets (id, name, public) VALUES ('account-evidence', 'account-evidence', false);

-- Create policies for account evidence storage
CREATE POLICY "Users can upload their own account evidence" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'account-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own account evidence" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'account-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own account evidence" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = 'account-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own account evidence" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'account-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create table for account evidence metadata
CREATE TABLE public.account_evidence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trial_balance_id UUID NOT NULL,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  file_type TEXT NOT NULL,
  account_group_id UUID,
  description TEXT,
  upload_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on account evidence table
ALTER TABLE public.account_evidence ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for account evidence table
CREATE POLICY "Users can view their own account evidence" 
ON public.account_evidence 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own account evidence" 
ON public.account_evidence 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own account evidence" 
ON public.account_evidence 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own account evidence" 
ON public.account_evidence 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_account_evidence_updated_at
BEFORE UPDATE ON public.account_evidence
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();