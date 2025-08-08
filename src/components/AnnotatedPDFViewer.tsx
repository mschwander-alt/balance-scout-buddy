import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Highlighter, MousePointer, Type, Square, Save, Trash2, X } from 'lucide-react';
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
  annotation_type: 'highlight' | 'note' | 'rectangle' | 'text';
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeTool, setActiveTool] = useState<'select' | 'highlight' | 'note' | 'rectangle' | 'text'>('select');
  const [activeColor, setActiveColor] = useState('#ffff00');
  const [noteInput, setNoteInput] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [pendingNote, setPendingNote] = useState<{ x: number; y: number } | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [unsavedChanges, setUnsavedChanges] = useState(false);

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
        annotation_type: ann.annotation_type as 'highlight' | 'note' | 'rectangle' | 'text'
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

  // Handle overlay click for annotation creation
  const handleOverlayClick = (event: React.MouseEvent) => {
    if (activeTool === 'select') return;

    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (activeTool === 'note') {
      setPendingNote({ x, y });
      setShowNoteInput(true);
    } else if (activeTool === 'highlight') {
      const annotation: Omit<Annotation, 'id'> = {
        page_number: 1,
        coordinates: { x, y, width: 100, height: 20 },
        color: activeColor,
        annotation_type: 'highlight'
      };
      saveAnnotation(annotation);
    } else if (activeTool === 'rectangle') {
      const annotation: Omit<Annotation, 'id'> = {
        page_number: 1,
        coordinates: { x, y, width: 100, height: 100 },
        color: activeColor,
        annotation_type: 'rectangle'
      };
      saveAnnotation(annotation);
    } else if (activeTool === 'text') {
      const text = prompt('Text eingeben:');
      if (!text) return;
      
      const annotation: Omit<Annotation, 'id'> = {
        page_number: 1,
        coordinates: { x, y, width: text.length * 8, height: 20 },
        content: text,
        color: activeColor,
        annotation_type: 'text'
      };
      saveAnnotation(annotation);
    }
  };

  // Handle note creation
  const handleCreateNote = () => {
    if (!pendingNote || !noteInput.trim()) return;

    const annotation: Omit<Annotation, 'id'> = {
      page_number: 1,
      coordinates: { x: pendingNote.x, y: pendingNote.y, width: 20, height: 20 },
      content: noteInput,
      color: activeColor,
      annotation_type: 'note'
    };

    saveAnnotation(annotation);
    setNoteInput('');
    setShowNoteInput(false);
    setPendingNote(null);
  };

  // Delete annotation
  const deleteAnnotation = async (annotationId: string) => {
    try {
      const { error } = await supabase
        .from('pdf_annotations')
        .delete()
        .eq('id', annotationId);

      if (error) throw error;
      
      await loadAnnotations();
      toast.success('Annotation gelöscht');
    } catch (error: any) {
      console.error('Error deleting annotation:', error);
      toast.error('Fehler beim Löschen der Annotation');
    }
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
            variant={activeTool === 'select' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTool('select')}
          >
            <MousePointer className="h-3 w-3 mr-1" />
            Auswählen
          </Button>
          
          <Button
            variant={activeTool === 'highlight' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTool('highlight')}
          >
            <Highlighter className="h-3 w-3 mr-1" />
            Markieren
          </Button>
          
          <Button
            variant={activeTool === 'note' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTool('note')}
          >
            <MousePointer className="h-3 w-3 mr-1" />
            Notiz
          </Button>
          
          <Button
            variant={activeTool === 'rectangle' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTool('rectangle')}
          >
            <Square className="h-3 w-3 mr-1" />
            Rechteck
          </Button>
          
          <Button
            variant={activeTool === 'text' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTool('text')}
          >
            <Type className="h-3 w-3 mr-1" />
            Text
          </Button>
          
          <input
            type="color"
            value={activeColor}
            onChange={(e) => setActiveColor(e.target.value)}
            className="w-8 h-8 rounded border"
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative">
        {/* PDF Background */}
        <iframe
          src={`https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(documentUrl)}`}
          className="w-full h-full border-0"
          title={document.file_name}
        />
        
        {/* Transparent Overlay for Annotations */}
        <div 
          ref={overlayRef}
          className="absolute inset-0 w-full h-full"
          style={{ 
            cursor: activeTool !== 'select' ? 'crosshair' : 'default',
            pointerEvents: activeTool === 'select' ? 'none' : 'auto'
          }}
          onClick={handleOverlayClick}
        >
          {/* Render existing annotations */}
          {annotations.map((annotation) => (
            <div
              key={annotation.id}
              className="absolute group cursor-pointer"
              style={{
                left: annotation.coordinates.x,
                top: annotation.coordinates.y,
                width: annotation.coordinates.width,
                height: annotation.coordinates.height,
              }}
            >
              {annotation.annotation_type === 'highlight' && (
                <div 
                  className="w-full h-full opacity-30 border-2"
                  style={{ 
                    backgroundColor: annotation.color,
                    borderColor: annotation.color
                  }}
                />
              )}
              
              {annotation.annotation_type === 'rectangle' && (
                <div 
                  className="w-full h-full border-2 bg-transparent"
                  style={{ borderColor: annotation.color }}
                />
              )}
              
              {annotation.annotation_type === 'note' && (
                <div 
                  className="w-5 h-5 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: annotation.color }}
                  title={annotation.content}
                >
                  N
                </div>
              )}
              
              {annotation.annotation_type === 'text' && (
                <div 
                  className="text-sm font-medium px-1"
                  style={{ color: annotation.color }}
                >
                  {annotation.content}
                </div>
              )}
              
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
        </div>
        
        {/* Tool Instructions */}
        {activeTool !== 'select' && (
          <div className="absolute top-4 left-4 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm z-10 pointer-events-none">
            {activeTool === 'highlight' && 'Klicken zum Markieren'}
            {activeTool === 'note' && 'Klicken für Notiz'}
            {activeTool === 'rectangle' && 'Klicken für Rechteck'}
            {activeTool === 'text' && 'Klicken für Text'}
          </div>
        )}
        
        {/* Note Input Dialog */}
        {showNoteInput && (
          <Card className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 p-4 z-20 w-80 pointer-events-auto">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h5 className="font-medium">Notiz hinzufügen</h5>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowNoteInput(false);
                    setPendingNote(null);
                    setNoteInput('');
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Input
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Notiz eingeben..."
                autoFocus
                onKeyPress={(e) => e.key === 'Enter' && handleCreateNote()}
              />
              <div className="flex gap-2">
                <Button onClick={handleCreateNote} disabled={!noteInput.trim()}>
                  <Save className="h-3 w-3 mr-1" />
                  Speichern
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowNoteInput(false);
                    setPendingNote(null);
                    setNoteInput('');
                  }}
                >
                  Abbrechen
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Status */}
      {annotations.length > 0 && (
        <div className="p-2 border-t bg-muted/20">
          <p className="text-xs text-muted-foreground text-center">
            {annotations.length} Annotation(en) • 
            {annotations.filter(a => a.annotation_type === 'highlight').length} Markierungen • 
            {annotations.filter(a => a.annotation_type === 'note').length} Notizen • 
            {annotations.filter(a => a.annotation_type === 'rectangle').length} Rechtecke • 
            {annotations.filter(a => a.annotation_type === 'text').length} Texte
          </p>
        </div>
      )}
    </div>
  );
};