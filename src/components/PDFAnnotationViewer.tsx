import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Highlighter, 
  MessageSquare, 
  MousePointer, 
  Save, 
  Trash2, 
  ZoomIn, 
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// Set worker source for PDF.js using CDN
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface DocumentProps {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

interface Annotation {
  id: string;
  page_number: number;
  coordinates: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  content?: string;
  color: string;
  annotation_type: 'highlight' | 'note' | 'drawing';
}

interface PDFAnnotationViewerProps {
  document: DocumentProps;
  assignmentId: string;
  trialBalanceId: string;
  onLoad?: () => void;
  onError?: (error: any) => void;
}

export const PDFAnnotationViewer: React.FC<PDFAnnotationViewerProps> = ({
  document,
  assignmentId,
  trialBalanceId,
  onLoad,
  onError
}) => {
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [documentUrl, setDocumentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationMode, setAnnotationMode] = useState<'select' | 'highlight' | 'note'>('select');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [showNoteDialog, setShowNoteDialog] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [pendingAnnotation, setPendingAnnotation] = useState<Omit<Annotation, 'id' | 'content'> | null>(null);

  // Load PDF URL
  const loadDocumentUrl = useCallback(async () => {
    try {
      const { data, error } = await supabase.storage
        .from('account-evidence')
        .createSignedUrl(document.file_path, 3600);

      if (error) throw error;
      
      // Ensure we have a full URL
      const fullUrl = data.signedUrl.startsWith('http') 
        ? data.signedUrl 
        : `https://szrpyhwjqftwxhaagcds.supabase.co/storage/v1${data.signedUrl}`;
      
      console.log('PDF URL loaded:', fullUrl);
      setDocumentUrl(fullUrl);
      onLoad?.();
    } catch (error: any) {
      console.error('Error loading document:', error);
      onError?.(error);
      toast.error('Fehler beim Laden des PDFs');
    }
  }, [document.file_path, onLoad, onError]);

  // Load annotations from database
  const loadAnnotations = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('pdf_annotations')
        .select('*')
        .eq('document_id', document.id)
        .eq('assignment_id', assignmentId)
        .eq('user_id', user.id);

      if (error) throw error;

      const mappedAnnotations: Annotation[] = data.map(ann => ({
        id: ann.id,
        page_number: ann.page_number,
        coordinates: ann.coordinates as any,
        content: ann.content || '',
        color: ann.color || '#ffff00',
        annotation_type: ann.annotation_type as 'highlight' | 'note' | 'drawing'
      }));

      setAnnotations(mappedAnnotations);
    } catch (error: any) {
      console.error('Error loading annotations:', error);
    }
  }, [document.id, assignmentId, user]);

  // Save annotation to database
  const saveAnnotation = async (annotation: Omit<Annotation, 'id'>) => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('pdf_annotations')
        .insert({
          user_id: user.id,
          trial_balance_id: trialBalanceId,
          assignment_id: assignmentId,
          document_id: document.id,
          annotation_type: annotation.annotation_type,
          page_number: annotation.page_number,
          coordinates: annotation.coordinates,
          content: annotation.content,
          color: annotation.color
        })
        .select()
        .single();

      if (error) throw error;
      
      await loadAnnotations();
      toast.success('Annotation gespeichert');
    } catch (error: any) {
      console.error('Error saving annotation:', error);
      toast.error('Fehler beim Speichern der Annotation');
    }
  };

  // Delete annotation
  const deleteAnnotation = async (annotationId: string) => {
    try {
      const { error } = await supabase
        .from('pdf_annotations')
        .delete()
        .eq('id', annotationId);

      if (error) throw error;
      
      setAnnotations(prev => prev.filter(ann => ann.id !== annotationId));
      toast.success('Annotation gelöscht');
    } catch (error: any) {
      console.error('Error deleting annotation:', error);
      toast.error('Fehler beim Löschen der Annotation');
    }
  };

  // Handle mouse events for annotations
  const handleMouseDown = (event: React.MouseEvent) => {
    if (annotationMode === 'select') return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    setDrawStart({ x, y });
    setIsDrawing(true);
    event.preventDefault();
  };

  const handleMouseUp = (event: React.MouseEvent) => {
    if (!isDrawing || !drawStart || annotationMode === 'select') return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const width = Math.abs(x - drawStart.x);
    const height = Math.abs(y - drawStart.y);
    
    // Minimum size check
    if (width < 10 || height < 10) {
      setIsDrawing(false);
      setDrawStart(null);
      return;
    }

    const annotation: Omit<Annotation, 'id' | 'content'> = {
      page_number: currentPage,
      coordinates: {
        x: Math.min(drawStart.x, x),
        y: Math.min(drawStart.y, y),
        width,
        height
      },
      color: annotationMode === 'highlight' ? '#ffff0080' : '#ff000080',
      annotation_type: annotationMode as 'highlight' | 'note'
    };

    if (annotationMode === 'note') {
      setPendingAnnotation(annotation);
      setShowNoteDialog(true);
    } else {
      saveAnnotation({ ...annotation, content: '' });
    }

    setIsDrawing(false);
    setDrawStart(null);
  };

  const handleNoteSubmit = () => {
    if (pendingAnnotation) {
      saveAnnotation({ ...pendingAnnotation, content: noteText });
      setPendingAnnotation(null);
      setNoteText('');
      setShowNoteDialog(false);
    }
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    console.log('PDF loaded successfully, pages:', numPages);
    setNumPages(numPages);
    setLoading(false);
  };

  const onDocumentLoadError = (error: any) => {
    console.error('PDF load error:', error);
    setLoading(false);
    onError?.(error);
    toast.error('Fehler beim Laden des PDFs: ' + (error.message || 'Unbekannter Fehler'));
  };

  useEffect(() => {
    loadDocumentUrl();
    loadAnnotations();
  }, [loadDocumentUrl, loadAnnotations]);

  if (loading || !documentUrl) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">PDF wird geladen...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-sm">{document.file_name}</h4>
          <Badge variant="secondary" className="text-xs">
            {annotations.filter(a => a.page_number === currentPage).length} Annotationen
          </Badge>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Annotation Tools */}
          <Button
            variant={annotationMode === 'select' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAnnotationMode('select')}
          >
            <MousePointer className="h-3 w-3 mr-1" />
            Auswählen
          </Button>
          
          <Button
            variant={annotationMode === 'highlight' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAnnotationMode('highlight')}
          >
            <Highlighter className="h-3 w-3 mr-1" />
            Markieren
          </Button>
          
          <Button
            variant={annotationMode === 'note' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAnnotationMode('note')}
          >
            <MessageSquare className="h-3 w-3 mr-1" />
            Notiz
          </Button>
          
          {/* Zoom Controls */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale(prev => Math.max(0.5, prev - 0.2))}
          >
            <ZoomOut className="h-3 w-3" />
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale(prev => Math.min(3, prev + 0.2))}
          >
            <ZoomIn className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* PDF Viewer */}
      <div className="flex-1 overflow-auto">
        <div className="flex justify-center p-4">
          <div 
            ref={containerRef}
            className="relative"
            style={{ cursor: annotationMode !== 'select' ? 'crosshair' : 'default' }}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
          >
            {documentUrl ? (
              <Document
                file={documentUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                options={{
                  cMapUrl: 'https://unpkg.com/pdfjs-dist@4.0.379/cmaps/',
                  cMapPacked: true,
                  standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@4.0.379/standard_fonts/',
                }}
                loading={
                  <div className="flex items-center justify-center h-96">
                    <div className="text-center">
                      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
                      <p className="text-sm text-muted-foreground">PDF wird geladen...</p>
                    </div>
                  </div>
                }
                error={
                  <div className="flex items-center justify-center h-96 p-4">
                    <div className="text-center">
                      <p className="text-sm text-destructive mb-2">Fehler beim Laden des PDFs</p>
                      <p className="text-xs text-muted-foreground">Möglicherweise ist das PDF beschädigt oder nicht zugänglich.</p>
                    </div>
                  </div>
                }
              >
                <Page
                  pageNumber={currentPage}
                  scale={scale}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={
                    <div className="flex items-center justify-center h-96">
                      <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
                    </div>
                  }
                />
              </Document>
            ) : (
              <div className="flex items-center justify-center h-96">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Keine PDF-URL verfügbar</p>
                </div>
              </div>
            )}
            
            {/* Annotation Overlays */}
            {annotations
              .filter(annotation => annotation.page_number === currentPage)
              .map((annotation) => (
                <div
                  key={annotation.id}
                  className="absolute border-2 cursor-pointer group"
                  style={{
                    left: annotation.coordinates.x * scale,
                    top: annotation.coordinates.y * scale,
                    width: annotation.coordinates.width * scale,
                    height: annotation.coordinates.height * scale,
                    backgroundColor: annotation.color,
                    borderColor: annotation.annotation_type === 'highlight' ? '#ffff00' : '#ff0000'
                  }}
                  title={annotation.content || 'Annotation'}
                >
                  <Button
                    variant="destructive"
                    size="sm"
                    className="absolute -top-2 -right-2 h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAnnotation(annotation.id);
                    }}
                  >
                    <Trash2 className="h-2 w-2" />
                  </Button>
                  {annotation.content && (
                    <div className="absolute top-full left-0 mt-1 bg-black text-white text-xs p-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {annotation.content}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Page Navigation */}
      <div className="flex items-center justify-between p-3 border-t bg-muted/30">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-3 w-3" />
            Zurück
          </Button>
          
          <span className="text-sm text-muted-foreground">
            Seite {currentPage} von {numPages}
          </span>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.min(numPages, prev + 1))}
            disabled={currentPage >= numPages}
          >
            Weiter
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
        
        <div className="text-xs text-muted-foreground">
          Zoom: {Math.round(scale * 100)}%
        </div>
      </div>

      {/* Note Dialog */}
      <Dialog open={showNoteDialog} onOpenChange={setShowNoteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notiz hinzufügen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Notiz eingeben..."
              rows={4}
            />
            <div className="flex gap-2">
              <Button onClick={handleNoteSubmit}>
                <Save className="h-4 w-4 mr-2" />
                Speichern
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowNoteDialog(false);
                  setPendingAnnotation(null);
                  setNoteText('');
                }}
              >
                Abbrechen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};