-- Tabelle für PDF-Annotationen (Markierungen, Highlights, etc.)
CREATE TABLE public.pdf_annotations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  trial_balance_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  document_id UUID NOT NULL,
  annotation_type TEXT NOT NULL DEFAULT 'highlight', -- highlight, note, drawing, etc.
  page_number INTEGER NOT NULL,
  coordinates JSONB NOT NULL, -- Position und Größe der Annotation
  content TEXT, -- Text-Inhalt der Annotation (für Notizen)
  color TEXT DEFAULT '#ffff00', -- Farbe der Annotation
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabelle für persistente Kommentare pro Konto
CREATE TABLE public.account_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  trial_balance_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS Policies für pdf_annotations
ALTER TABLE public.pdf_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own PDF annotations" 
ON public.pdf_annotations 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own PDF annotations" 
ON public.pdf_annotations 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own PDF annotations" 
ON public.pdf_annotations 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own PDF annotations" 
ON public.pdf_annotations 
FOR DELETE 
USING (auth.uid() = user_id);

-- RLS Policies für account_comments
ALTER TABLE public.account_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own account comments" 
ON public.account_comments 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own account comments" 
ON public.account_comments 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own account comments" 
ON public.account_comments 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own account comments" 
ON public.account_comments 
FOR DELETE 
USING (auth.uid() = user_id);

-- Trigger für automatic timestamps
CREATE TRIGGER update_pdf_annotations_updated_at
BEFORE UPDATE ON public.pdf_annotations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_account_comments_updated_at
BEFORE UPDATE ON public.account_comments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Indizes für bessere Performance
CREATE INDEX idx_pdf_annotations_user_assignment ON public.pdf_annotations(user_id, assignment_id);
CREATE INDEX idx_pdf_annotations_document ON public.pdf_annotations(document_id);
CREATE INDEX idx_account_comments_user_assignment ON public.account_comments(user_id, assignment_id);