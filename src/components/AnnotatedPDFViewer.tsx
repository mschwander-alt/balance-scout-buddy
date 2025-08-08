import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Highlighter, MousePointer, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Document {
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
  const { user } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<'highlight' | 'note'>('highlight');
  const [documentUrl, setDocumentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  // Lade PDF-URL
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

  // Lade gespeicherte Annotationen
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

  // Speichere Annotation in Datenbank
  const saveAnnotation = async (annotation: Omit<Annotation, 'id'>) => {
    if (!user) return;

    try {
      const { error } = await supabase
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
        });

      if (error) throw error;
      
      await loadAnnotations();
      setUnsavedChanges(false);
      toast.success('Annotation gespeichert');
    } catch (error: any) {
      console.error('Error saving annotation:', error);
      toast.error('Fehler beim Speichern der Annotation');
    }
  };

  // Lösche Annotation
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

  // Simuliere Annotation-Tool (vereinfacht für Demo)
  const handleDocumentClick = (event: React.MouseEvent) => {
    if (!isAnnotating) return;

    // Vereinfachte Annotation-Erstellung
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const newAnnotation: Omit<Annotation, 'id'> = {
      page_number: 1, // Vereinfacht - normalerweise würde man die aktuelle Seite ermitteln
      coordinates: {
        x: x,
        y: y,
        width: 100,
        height: 20
      },
      content: annotationTool === 'note' ? 'Neue Notiz' : '',
      color: '#ffff00',
      annotation_type: annotationTool
    };

    saveAnnotation(newAnnotation);
    setUnsavedChanges(true);
  };

  useEffect(() => {
    loadDocumentUrl();
    loadAnnotations();
  }, [loadDocumentUrl, loadAnnotations]);

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

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-sm">{document.file_name}</h4>
          <Badge variant="secondary" className="text-xs">
            {annotations.length} Annotationen
          </Badge>
          {unsavedChanges && (
            <Badge variant="destructive" className="text-xs">
              Ungespeichert
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant={isAnnotating && annotationTool === 'highlight' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setAnnotationTool('highlight');
              setIsAnnotating(!isAnnotating || annotationTool !== 'highlight');
            }}
          >
            <Highlighter className="h-3 w-3 mr-1" />
            Markieren
          </Button>
          
          <Button
            variant={isAnnotating && annotationTool === 'note' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setAnnotationTool('note');
              setIsAnnotating(!isAnnotating || annotationTool !== 'note');
            }}
          >
            <MousePointer className="h-3 w-3 mr-1" />
            Notiz
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsAnnotating(false)}
            disabled={!isAnnotating}
          >
            Fertig
          </Button>
        </div>
      </div>

      {/* PDF Viewer */}
      <div 
        className="flex-1 relative"
        onClick={handleDocumentClick}
        style={{ cursor: isAnnotating ? 'crosshair' : 'default' }}
      >
        {documentUrl && (
          <iframe
            ref={iframeRef}
            src={`https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(documentUrl)}`}
            className="w-full h-full border-0"
            title={document.file_name}
          />
        )}
        
        {/* Annotation Overlays (vereinfacht) */}
        {annotations.map((annotation) => (
          <div
            key={annotation.id}
            className="absolute border-2 border-yellow-400 bg-yellow-200 bg-opacity-30 cursor-pointer group"
            style={{
              left: annotation.coordinates.x,
              top: annotation.coordinates.y,
              width: annotation.coordinates.width,
              height: annotation.coordinates.height,
              borderColor: annotation.color
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
          </div>
        ))}
        
        {isAnnotating && (
          <div className="absolute top-4 left-4 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm">
            {annotationTool === 'highlight' ? 'Klicken zum Markieren' : 'Klicken für Notiz'}
          </div>
        )}
      </div>

      {/* Status */}
      {annotations.length > 0 && (
        <div className="p-2 border-t bg-muted/20">
          <p className="text-xs text-muted-foreground text-center">
            {annotations.length} Annotation(en) gespeichert • 
            {annotations.filter(a => a.annotation_type === 'highlight').length} Markierungen • 
            {annotations.filter(a => a.annotation_type === 'note').length} Notizen
          </p>
        </div>
      )}
    </div>
  );
};