import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, AlertCircle } from 'lucide-react';

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

interface ExcelViewerProps {
  document: Document;
}

export const ExcelViewer: React.FC<ExcelViewerProps> = ({ document }) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getSignedUrl = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase.storage
          .from('account-evidence')
          .createSignedUrl(document.file_path, 3600); // 1 hour expiry

        if (error) throw error;

        setSignedUrl(data.signedUrl);
      } catch (err: any) {
        console.error('Error getting signed URL:', err);
        setError('Fehler beim Laden der Datei');
      } finally {
        setLoading(false);
      }
    };

    getSignedUrl();
  }, [document.file_path]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Lade Excel-Vorschau...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Keine URL verfügbar</p>
      </div>
    );
  }

  // Use Google Sheets viewer for Excel files
  const googleViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(signedUrl)}&embedded=true`;

  return (
    <div className="h-full w-full">
      <iframe
        src={googleViewerUrl}
        className="w-full h-full border-0"
        title={`Excel Viewer - ${document.file_name}`}
        onError={() => setError('Fehler beim Laden der Excel-Vorschau')}
      />
    </div>
  );
};