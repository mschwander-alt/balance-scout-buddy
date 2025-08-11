-- Create PDF annotations table for storing annotations per document and user
CREATE TABLE IF NOT EXISTS pdf_annotations (
  doc_id UUID NOT NULL,
  user_id UUID NOT NULL,
  annotations JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, user_id)
);

-- Enable RLS
ALTER TABLE pdf_annotations ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "own read" ON pdf_annotations 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "own write" ON pdf_annotations 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own upsert" ON pdf_annotations 
FOR UPDATE 
USING (auth.uid() = user_id);