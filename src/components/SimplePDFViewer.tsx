import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

interface SimplePDFViewerProps {
  document: Document;
}

export const SimplePDFViewer: React.FC<SimplePDFViewerProps> = ({ document }) => {
  const [documentUrl, setDocumentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDocumentUrl = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const { data, error } = await supabase.storage
          .from('account-evidence')
          .createSignedUrl(document.file_path, 3600);

        if (error) throw error;
        setDocumentUrl(data.signedUrl);
      } catch (error: any) {
        console.error('Error loading document URL:', error);
        setError('Fehler beim Laden des Dokuments');
        toast.error('Fehler beim Laden des Dokuments');
      } finally {
        setLoading(false);
      }
    };

    loadDocumentUrl();
  }, [document.file_path]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/10">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">Dokument wird geladen...</p>
        </div>
      </div>
    );
  }

  if (error || !documentUrl) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/10">
        <div className="text-center">
          <p className="text-sm text-red-500">{error || 'Dokument konnte nicht geladen werden'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Document Header */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <h4 className="font-medium text-sm">{document.file_name}</h4>
        <span className="text-xs text-muted-foreground">
          {(document.file_size / 1024 / 1024).toFixed(1)} MB
        </span>
      </div>
      
      {/* PDF Viewer */}
      <div className="flex-1 overflow-hidden">
        <iframe
          src={`https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(documentUrl)}`}
          className="w-full h-full border-0"
          title={document.file_name}
        />
      </div>
    </div>
  );
};