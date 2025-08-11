import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { FileText, Download, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface DocumentViewerProps {
  document?: {
    id: string;
    file_name: string;
    file_path: string;
    file_type: string;
    file_size: number;
  };
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ 
  document, 
  onLoad, 
  onError 
}) => {
  // Early return if document is not provided
  if (!document) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-60" />
          <h3 className="text-lg font-medium mb-2">Kein Dokument ausgewählt</h3>
          <p className="text-sm text-muted-foreground">
            Bitte wählen Sie ein Dokument aus, um es anzuzeigen.
          </p>
        </div>
      </div>
    );
  }
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [excelData, setExcelData] = useState<any[][]>([]);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDocument();
  }, [document]);

  const loadDocument = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Loading document:', document.file_name);
      
      // Always get a fresh signed URL to avoid JWT expiration issues
      const { data, error: urlError } = await supabase.storage
        .from('account-evidence')
        .createSignedUrl(document.file_path, 3600);
      
      if (urlError) throw urlError;
      
      if (data?.signedUrl) {
        console.log('Got fresh signed URL for:', document.file_name);
        // Convert relative URL to absolute URL
        const fullUrl = data.signedUrl.startsWith('http') 
          ? data.signedUrl 
          : `https://szrpyhwjqftwxhaagcds.supabase.co/storage/v1${data.signedUrl}`;
        setFileUrl(fullUrl);
        
        // Handle Excel files
        if (document.file_type.includes('spreadsheet') || 
            document.file_type.includes('excel') ||
            document.file_name.endsWith('.xlsx') ||
            document.file_name.endsWith('.xls')) {
          await loadExcelData(fullUrl);
        }
        
        onLoad?.();
      }
    } catch (err: any) {
      console.error('Error loading document:', err);
      setError(err.message);
      onError?.(err);
    } finally {
      setLoading(false);
    }
  };

  const loadExcelData = async (url: string) => {
    try {
      console.log('Loading Excel data from:', url);
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      const sheetNames = workbook.SheetNames;
      setExcelSheets(sheetNames);
      
      if (sheetNames.length > 0) {
        const firstSheet = sheetNames[0];
        setActiveSheet(firstSheet);
        const worksheet = workbook.Sheets[firstSheet];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        setExcelData(jsonData as any[][]);
      }
    } catch (err) {
      console.error('Error loading Excel data:', err);
      throw new Error('Excel-Datei konnte nicht gelesen werden');
    }
  };

  const handleExcelSheetChange = (sheetName: string) => {
    if (!fileUrl) return;
    
    fetch(fileUrl)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => {
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        setExcelData(jsonData as any[][]);
        setActiveSheet(sheetName);
      });
  };

  const downloadDocument = () => {
    if (!fileUrl) return;
    
    const link = window.document.createElement('a');
    link.href = fileUrl;
    link.download = document.file_name;
    link.click();
  };

  const openInNewTab = () => {
    if (!fileUrl) return;
    window.open(fileUrl, '_blank');
  };

  const isPDF = document.file_type === 'application/pdf';
  const isExcel = document.file_type.includes('spreadsheet') || 
                  document.file_type.includes('excel') ||
                  document.file_name.endsWith('.xlsx') ||
                  document.file_name.endsWith('.xls');

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Dokument wird geladen...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FileText className="h-16 w-16 mx-auto mb-4 text-destructive opacity-60" />
          <h3 className="text-lg font-medium mb-2">Fehler beim Laden</h3>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <div className="flex gap-2 justify-center">
            <Button onClick={loadDocument} variant="outline">
              Erneut versuchen
            </Button>
            {isPDF && (
              <Button onClick={openInNewTab} variant="outline">
                In neuem Tab öffnen
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex-1">
          <h5 className="font-medium truncate">{document.file_name}</h5>
          <p className="text-sm text-muted-foreground">
            {Math.round(document.file_size / 1024)} KB
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {isPDF ? 'PDF' : isExcel ? 'Excel' : 'Dokument'}
          </Badge>
          {isPDF && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={openInNewTab}
              className="flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
          <Button 
            size="sm" 
            variant="outline" 
            onClick={downloadDocument}
            className="flex items-center gap-1"
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Document Content */}
      <div className="flex-1 overflow-hidden">
        {isPDF && fileUrl ? (
          <div className="h-full w-full">
            <iframe
              src={`https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(fileUrl)}`}
              className="w-full h-full border-0"
              title={document.file_name}
              allow="cross-origin-isolated"
            />
          </div>
        ) : isExcel ? (
          <div className="flex flex-col h-full">
            {/* Excel Sheet Tabs */}
            {excelSheets.length > 1 && (
              <div className="flex items-center gap-1 p-2 border-b bg-background overflow-x-auto">
                {excelSheets.map((sheetName) => (
                  <Button
                    key={sheetName}
                    size="sm"
                    variant={activeSheet === sheetName ? "default" : "outline"}
                    onClick={() => handleExcelSheetChange(sheetName)}
                    className="whitespace-nowrap"
                  >
                    {sheetName}
                  </Button>
                ))}
              </div>
            )}

            {/* Excel Table */}
            <div className="flex-1 overflow-auto p-4">
              {excelData.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {excelData.slice(0, 100).map((row, rowIndex) => (
                        <tr key={rowIndex} className={rowIndex === 0 ? "bg-muted font-medium" : ""}>
                          {Array.isArray(row) && row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className="border-r border-b px-2 py-1 text-left max-w-[200px] truncate"
                              title={String(cell || '')}
                            >
                              {String(cell || '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {excelData.length > 100 && (
                    <div className="p-2 text-center text-sm text-muted-foreground bg-muted">
                      ... und {excelData.length - 100} weitere Zeilen
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Keine Daten in diesem Sheet gefunden</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-60" />
              <h3 className="text-lg font-medium mb-2">Nicht unterstütztes Format</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Dieser Dateityp kann nicht in der Vorschau angezeigt werden.
              </p>
              <Button onClick={downloadDocument} variant="outline">
                Herunterladen
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};