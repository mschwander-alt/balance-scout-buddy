import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, AlertCircle, Upload, Download, Check } from 'lucide-react';
import { toast } from 'sonner';

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
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleDownload = () => {
    if (signedUrl) {
      const link = window.document.createElement('a');
      link.href = signedUrl;
      link.download = document.file_name;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error('Bitte wählen Sie eine Excel-Datei (.xlsx oder .xls)');
      return;
    }

    setUploading(true);
    try {
      // Create new file path with timestamp to avoid conflicts
      const timestamp = Date.now();
      const fileExtension = file.name.split('.').pop();
      const baseName = document.file_name.replace(/\.[^/.]+$/, "");
      const newFileName = `${baseName}_bearbeitet_${timestamp}.${fileExtension}`;
      const newFilePath = `${document.file_path.split('/')[0]}/${timestamp}_${newFileName}`;

      // Upload the new file
      const { error: uploadError } = await supabase.storage
        .from('account-evidence')
        .upload(newFilePath, file);

      if (uploadError) {
        throw uploadError;
      }

      // Update the document record with the new file
      const { error: updateError } = await supabase
        .from('account_evidence')
        .update({
          file_name: newFileName,
          file_path: newFilePath,
          file_size: file.size,
          updated_at: new Date().toISOString()
        })
        .eq('id', document.id);

      if (updateError) {
        throw updateError;
      }

      setUploadSuccess(true);
      toast.success('Bearbeitete Datei erfolgreich hochgeladen!');
      
      // Auto-reload the page after 2 seconds to show the updated file
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (err: any) {
      console.error('Error uploading file:', err);
      toast.error('Fehler beim Hochladen der Datei');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Lade Excel-Datei...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (uploadSuccess) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-green-50 p-8">
        <div className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          
          <div className="space-y-2">
            <h3 className="text-lg font-medium text-green-800">Erfolgreich hochgeladen!</h3>
            <p className="text-sm text-green-600">
              Die bearbeitete Datei wurde gespeichert.
            </p>
            <p className="text-xs text-green-500">
              Die Seite wird in Kürze aktualisiert...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center bg-muted/30 p-8">
      <div className="text-center space-y-6 max-w-md">
        <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        
        <div className="space-y-2">
          <h3 className="text-lg font-medium text-foreground">{document.file_name}</h3>
          <p className="text-sm text-muted-foreground">
            Excel-Datei ({Math.round(document.file_size / 1024)} KB)
          </p>
        </div>
        
        <div className="space-y-3">
          <button
            onClick={handleDownload}
            disabled={!signedUrl}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Datei herunterladen
          </button>
          
          <div className="relative">
            <button
              onClick={triggerFileUpload}
              disabled={uploading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Wird hochgeladen...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Bearbeitete Datei hochladen
                </>
              )}
            </button>
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>
        
        <div className="text-xs text-muted-foreground space-y-2">
          <p>
            <strong>Workflow:</strong>
          </p>
          <ol className="text-left space-y-1 list-decimal list-inside">
            <li>Datei herunterladen</li>
            <li>In Excel/LibreOffice bearbeiten</li>
            <li>Bearbeitete Version wieder hochladen</li>
          </ol>
          <p className="text-xs">
            Die bearbeitete Datei ersetzt automatisch die ursprüngliche Version.
          </p>
        </div>
      </div>
    </div>
  );
};