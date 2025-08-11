-- Create table to store document analysis results
CREATE TABLE IF NOT EXISTS public.document_analysis (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES account_evidence(id) ON DELETE CASCADE,
    trial_balance_id UUID NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    extracted_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
    matched_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
    analysis_status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.document_analysis ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own document analysis" 
ON public.document_analysis 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own document analysis" 
ON public.document_analysis 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own document analysis" 
ON public.document_analysis 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own document analysis" 
ON public.document_analysis 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create index for better performance
CREATE INDEX idx_document_analysis_trial_balance ON public.document_analysis(trial_balance_id);
CREATE INDEX idx_document_analysis_document ON public.document_analysis(document_id);

-- Create trigger for updated_at
CREATE TRIGGER update_document_analysis_updated_at
BEFORE UPDATE ON public.document_analysis
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();