-- Add is_global column to account_evidence table
ALTER TABLE public.account_evidence 
ADD COLUMN is_global boolean NOT NULL DEFAULT false;

-- Create index for better performance when querying global documents
CREATE INDEX idx_account_evidence_is_global ON public.account_evidence(is_global, trial_balance_id) WHERE is_global = true;