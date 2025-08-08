import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PDFAnnotationCanvas } from './PDFAnnotationCanvas';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

interface AnnotatedPDFViewerProps {
  document: Document;
  assignmentId: string;
  trialBalanceId: string;
  onLoad?: () => void;
  onError?: (error: any) => void;
}

export const AnnotatedPDFViewer: React.FC<AnnotatedPDFViewerProps> = ({
  document,
  assignmentId,
  trialBalanceId,
  onLoad,
  onError
}) => {
  const [documentUrl, setDocumentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Load PDF URL
  const loadDocumentUrl = useCallback(async () => {
    try {
      const { data, error } = await supabase.storage
        .from('account-evidence')
        .createSignedUrl(document.file_path, 3600);

      if (error) throw error;
      setDocumentUrl(data.signedUrl);
      onLoad?.();
    } catch (error: any) {
      console.error('Error loading document:', error);
      onError?.(error);
      toast.error('Fehler beim Laden des Dokuments');
    } finally {
      setLoading(false);
    }
  }, [document.file_path, onLoad, onError]);

  useEffect(() => {
    loadDocumentUrl();
  }, [loadDocumentUrl]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Lade PDF...</p>
        </div>
      </div>
    );
  }

  if (!documentUrl) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Dokument konnte nicht geladen werden</p>
        </div>
      </div>
    );
  }

  return (
    <PDFAnnotationCanvas
      document={document}
      assignmentId={assignmentId}
      trialBalanceId={trialBalanceId}
      documentUrl={documentUrl}
      onLoad={onLoad}
      onError={onError}
    />
  );
};