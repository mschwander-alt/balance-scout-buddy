import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, Circle, Rect, FabricText, FabricObject } from 'fabric';
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

interface PDFAnnotationCanvasProps {
  document: Document;
  assignmentId: string;
  trialBalanceId: string;
  documentUrl: string;
  onLoad?: () => void;
  onError?: (error: any) => void;
}

export const PDFAnnotationCanvas: React.FC<PDFAnnotationCanvasProps> = ({
  document,
  assignmentId,
  trialBalanceId,
  documentUrl,
  onLoad,
  onError
}) => {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeTool, setActiveTool] = useState<'select' | 'highlight' | 'note' | 'rectangle' | 'text'>('select');
  const [activeColor, setActiveColor] = useState('#ffff00');
  const [noteInput, setNoteInput] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [pendingNote, setPendingNote] = useState<{ x: number; y: number } | null>(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  // Initialize Fabric Canvas
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    // Wait for container to be sized
    const resizeObserver = new ResizeObserver(() => {
      if (!canvasRef.current || !containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      
      const canvas = new FabricCanvas(canvasRef.current, {
        width: rect.width,
        height: rect.height,
        backgroundColor: 'transparent',
        selection: activeTool === 'select',
      });

      // Handle mouse events for annotation creation
      canvas.on('mouse:down', (event) => {
        if (activeTool === 'note' && event.pointer) {
          setPendingNote({ x: event.pointer.x, y: event.pointer.y });
          setShowNoteInput(true);
        } else if (activeTool === 'highlight' && event.pointer) {
          createHighlight(event.pointer.x, event.pointer.y);
        } else if (activeTool === 'rectangle' && event.pointer) {
          createRectangle(event.pointer.x, event.pointer.y);
        } else if (activeTool === 'text' && event.pointer) {
          createText(event.pointer.x, event.pointer.y);
        }
      });

      setFabricCanvas(canvas);
      onLoad?.();

      return () => {
        canvas.dispose();
      };
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [activeTool]);

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
      renderAnnotationsOnCanvas(mappedAnnotations);
    } catch (error: any) {
      console.error('Error loading annotations:', error);
    }
  }, [document.id, assignmentId, user]);

  // Render annotations on canvas
  const renderAnnotationsOnCanvas = (annotations: Annotation[]) => {
    if (!fabricCanvas) return;

    fabricCanvas.clear();
    
    annotations.forEach(annotation => {
      const { coordinates, color, annotation_type, content } = annotation;
      
      let fabricObject: FabricObject;
      
      switch (annotation_type) {
        case 'highlight':
          fabricObject = new Rect({
            left: coordinates.x,
            top: coordinates.y,
            width: coordinates.width,
            height: coordinates.height,
            fill: color,
            opacity: 0.3,
            stroke: color,
            strokeWidth: 1,
            selectable: activeTool === 'select'
          });
          break;
          
        case 'rectangle':
          fabricObject = new Rect({
            left: coordinates.x,
            top: coordinates.y,
            width: coordinates.width,
            height: coordinates.height,
            fill: 'transparent',
            stroke: color,
            strokeWidth: 2,
            selectable: activeTool === 'select'
          });
          break;
          
        case 'note':
          fabricObject = new Circle({
            left: coordinates.x,
            top: coordinates.y,
            radius: 10,
            fill: color,
            stroke: '#000',
            strokeWidth: 1,
            selectable: activeTool === 'select'
          });
          break;
          
        case 'text':
          fabricObject = new FabricText(content || 'Text', {
            left: coordinates.x,
            top: coordinates.y,
            fontSize: 14,
            fill: color,
            selectable: activeTool === 'select'
          });
          break;
          
        default:
          return;
      }
      
      // Store annotation ID for deletion
      fabricObject.set('annotationId', annotation.id);
      fabricCanvas.add(fabricObject);
    });
    
    fabricCanvas.renderAll();
  };

  // Create highlight annotation
  const createHighlight = (x: number, y: number) => {
    const annotation: Omit<Annotation, 'id'> = {
      page_number: 1,
      coordinates: { x, y, width: 100, height: 20 },
      color: activeColor,
      annotation_type: 'highlight'
    };
    saveAnnotation(annotation);
  };

  // Create rectangle annotation
  const createRectangle = (x: number, y: number) => {
    const annotation: Omit<Annotation, 'id'> = {
      page_number: 1,
      coordinates: { x, y, width: 100, height: 100 },
      color: activeColor,
      annotation_type: 'rectangle'
    };
    saveAnnotation(annotation);
  };

  // Create text annotation
  const createText = (x: number, y: number) => {
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

  // Delete annotation
  const deleteSelectedAnnotation = async () => {
    if (!fabricCanvas) return;

    const activeObject = fabricCanvas.getActiveObject();
    if (!activeObject) return;

    const annotationId = activeObject.get('annotationId');
    if (!annotationId) return;

    try {
      const { error } = await supabase
        .from('pdf_annotations')
        .delete()
        .eq('id', annotationId);

      if (error) throw error;
      
      fabricCanvas.remove(activeObject);
      await loadAnnotations();
      toast.success('Annotation gelöscht');
    } catch (error: any) {
      console.error('Error deleting annotation:', error);
      toast.error('Fehler beim Löschen der Annotation');
    }
  };

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  return (
    <div className="h-full flex flex-col relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30 relative z-10">
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
          
          <Button
            variant="destructive"
            size="sm"
            onClick={deleteSelectedAnnotation}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden">
        {/* PDF Background */}
        <iframe
          src={`https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(documentUrl)}`}
          className="absolute inset-0 w-full h-full border-0"
          title={document.file_name}
          style={{ pointerEvents: activeTool === 'select' ? 'auto' : 'none' }}
        />
        
        {/* Annotation Canvas Overlay */}
        <div ref={containerRef} className="absolute inset-0 pointer-events-auto">
          <canvas ref={canvasRef} className="absolute inset-0" />
        </div>
        
        {/* Tool Instructions */}
        {activeTool !== 'select' && (
          <div className="absolute top-4 left-4 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm z-10">
            {activeTool === 'highlight' && 'Klicken zum Markieren'}
            {activeTool === 'note' && 'Klicken für Notiz'}
            {activeTool === 'rectangle' && 'Klicken für Rechteck'}
            {activeTool === 'text' && 'Klicken für Text'}
          </div>
        )}
        
        {/* Note Input Dialog */}
        {showNoteInput && (
          <Card className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 p-4 z-20 w-80">
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