-- Create a table to store temporary matches for ungrouped accounts
CREATE TABLE IF NOT EXISTS public.temp_account_matches (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    trial_balance_id UUID NOT NULL,
    account_number TEXT NOT NULL,
    account_name TEXT NOT NULL,
    current_year_balance NUMERIC DEFAULT 0,
    previous_year_balance NUMERIC DEFAULT 0,
    match_status TEXT DEFAULT 'pending',
    confidence_score NUMERIC,
    matched_documents UUID[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.temp_account_matches ENABLE ROW LEVEL SECURITY;

-- Create policies for temp_account_matches
CREATE POLICY "Users can view their temp matches" 
ON public.temp_account_matches 
FOR SELECT 
USING (true);

CREATE POLICY "System can manage temp matches" 
ON public.temp_account_matches 
FOR ALL 
USING (true);

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_temp_account_matches_updated_at
BEFORE UPDATE ON public.temp_account_matches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();