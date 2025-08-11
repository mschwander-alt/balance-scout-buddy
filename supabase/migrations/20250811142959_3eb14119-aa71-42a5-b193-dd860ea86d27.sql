-- Drop existing pdf_annotations table and recreate with GPT-5's expected structure
DROP TABLE IF EXISTS public.pdf_annotations;

-- Create the table structure that GPT-5's code expects
CREATE TABLE public.pdf_annotations (
  doc_id UUID NOT NULL,
  user_id UUID NOT NULL,
  annotations JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, user_id)
);

-- Enable Row Level Security
ALTER TABLE public.pdf_annotations ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "own read" ON public.pdf_annotations 
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own write" ON public.pdf_annotations 
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own upsert" ON public.pdf_annotations 
FOR UPDATE USING (auth.uid() = user_id);