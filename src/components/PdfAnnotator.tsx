import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { nanoid } from 'nanoid';
import * as pdfjsLib from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Highlighter, Type, MousePointer, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface Annotation {
  id: string;
  page_number: number;
  annotation_type: 'highlight' | 'freetext';
  coordinates: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    rects?: Array<{ x: number; y: number; w: number; h: number }>;
  };
  content?: string;
  color: string;
}

interface PdfAnnotatorProps {
  documentUrl: string;
  documentId: string;
  assignmentId: string;
  trialBalanceId: string;
  initialScale?: number;
}

export const PdfAnnotator: React.FC<PdfAnnotatorProps> = ({
  documentUrl,
  documentId,
  assignmentId,
  trialBalanceId,
  initialScale = 1.2,
}) => {
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [pages, setPages] = useState<number>(0);
  const [scale, setScale] = useState(initialScale);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [mode, setMode] = useState<'none' | 'highlight' | 'freetext'>('none');
  const [loading, setLoading] = useState(true);

  // Load PDF
  useEffect(() => {
    let cancelled = false;
    
    const loadPdf = async () => {
      try {
        setLoading(true);
        const task = pdfjsLib.getDocument({ url: documentUrl });
        const doc = await task.promise;
        
        if (!cancelled) {
          setPdf(doc);
          setPages(doc.numPages);
        }
      } catch (error) {
        console.error('Error loading PDF:', error);
        toast.error('Fehler beim Laden des PDFs');
      } finally {
        setLoading(false);
      }
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [documentUrl]);

  // Load existing annotations
  const loadAnnotations = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('pdf_annotations')
        .select('*')
        .eq('document_id', documentId)
        .eq('assignment_id', assignmentId)
        .eq('trial_balance_id', trialBalanceId);

      if (error) throw error;

      if (data) {
        setAnnotations(data);
      }
    } catch (error) {
      console.error('Error loading annotations:', error);
    }
  }, [documentId, assignmentId, trialBalanceId]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  // Save annotation to database
  const saveAnnotation = async (annotation: Omit<Annotation, 'id'>) => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('pdf_annotations')
        .insert({
          document_id: documentId,
          assignment_id: assignmentId,
          trial_balance_id: trialBalanceId,
          user_id: user.id,
          page_number: annotation.page_number,
          annotation_type: annotation.annotation_type,
          coordinates: annotation.coordinates,
          content: annotation.content || '',
          color: annotation.color,
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setAnnotations(prev => [...prev, data]);
      }
    } catch (error) {
      console.error('Error saving annotation:', error);
      toast.error('Fehler beim Speichern der Annotation');
    }
  };

  // Update annotation
  const updateAnnotation = async (id: string, updates: any) => {
    try {
      const { error } = await supabase
        .from('pdf_annotations')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      setAnnotations(prev => 
        prev.map(ann => ann.id === id ? { ...ann, ...updates } : ann)
      );
    } catch (error) {
      console.error('Error updating annotation:', error);
      toast.error('Fehler beim Aktualisieren der Annotation');
    }
  };

  // Delete annotation
  const deleteAnnotation = async (id: string) => {
    try {
      const { error } = await supabase
        .from('pdf_annotations')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setAnnotations(prev => prev.filter(ann => ann.id !== id));
    } catch (error) {
      console.error('Error deleting annotation:', error);
      toast.error('Fehler beim Löschen der Annotation');
    }
  };

  // Page component
  const Page = ({ pageNumber }: { pageNumber: number }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const pageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!pdf) return;

      const renderPage = async () => {
        try {
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale });

          // Render canvas
          const canvas = canvasRef.current!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d')!;
          await page.render({ canvasContext: ctx, viewport }).promise;

          // Render text layer
          const textContent = await page.getTextContent();
          const textLayerDiv = textRef.current!;
          textLayerDiv.innerHTML = '';
          
          const textLayer = new (pdfjsLib as any).TextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport,
            enhanceTextSelection: true,
          });
          textLayer.render();
        } catch (error) {
          console.error('Error rendering page:', error);
        }
      };

      renderPage();
    }, [pdf, pageNumber, scale]);

    // Handle text selection for highlights
    const handleMouseUp = () => {
      if (mode !== 'highlight') return;
      
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      
      const range = selection.getRangeAt(0);
      if (!pageRef.current?.contains(range.commonAncestorContainer as any)) return;

      const rects = Array.from(range.getClientRects());
      if (!rects.length) return;

      const pageBox = pageRef.current!.getBoundingClientRect();
      const normRects = rects.map(rect => ({
        x: (rect.left - pageBox.left) / pageBox.width,
        y: (rect.top - pageBox.top) / pageBox.height,
        w: rect.width / pageBox.width,
        h: rect.height / pageBox.height,
      }));

      saveAnnotation({
        page_number: pageNumber,
        annotation_type: 'highlight',
        coordinates: { x: 0, y: 0, rects: normRects },
        color: '#ffeb00',
      });

      selection.removeAllRanges();
    };

    // Handle click for freetext
    const handleClick = (e: React.MouseEvent) => {
      if (mode !== 'freetext') return;
      
      const pageBox = pageRef.current!.getBoundingClientRect();
      const x = (e.clientX - pageBox.left) / pageBox.width;
      const y = (e.clientY - pageBox.top) / pageBox.height;

      saveAnnotation({
        page_number: pageNumber,
        annotation_type: 'freetext',
        coordinates: { x, y },
        content: 'Neue Notiz',
        color: '#000000',
      });
    };

    // Get annotations for this page
    const pageAnnotations = annotations.filter(ann => ann.page_number === pageNumber);

    return (
      <div 
        className="relative mx-auto my-4 shadow-lg"
        ref={pageRef}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        style={{ width: 'fit-content' }}
      >
        <canvas ref={canvasRef} className="block" />
        <div 
          ref={textRef} 
          className="absolute inset-0 pointer-events-none"
          style={{ mixBlendMode: 'multiply' }}
        />
        <div className="absolute inset-0">
          {pageAnnotations.map(annotation => 
            annotation.annotation_type === 'highlight' && annotation.coordinates.rects
              ? annotation.coordinates.rects.map((rect, i) => (
                  <div
                    key={`${annotation.id}-${i}`}
                    className="absolute pointer-events-none"
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.w * 100}%`,
                      height: `${rect.h * 100}%`,
                      backgroundColor: 'rgba(255, 235, 0, 0.4)',
                    }}
                  />
                ))
              : annotation.annotation_type === 'freetext' ? (
                  <div
                    key={annotation.id}
                    contentEditable
                    suppressContentEditableWarning
                    className="absolute min-w-[100px] min-h-[20px] p-1 bg-white bg-opacity-90 border border-border rounded text-sm cursor-text"
                    style={{
                      left: `${annotation.coordinates.x * 100}%`,
                      top: `${annotation.coordinates.y * 100}%`,
                      color: annotation.color,
                    }}
                    onBlur={(e) => {
                      const text = e.currentTarget.textContent || '';
                      if (text !== annotation.content) {
                        updateAnnotation(annotation.id, { content: text });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Delete' && e.ctrlKey) {
                        e.preventDefault();
                        deleteAnnotation(annotation.id);
                      }
                    }}
                  >
                    {annotation.content}
                  </div>
                ) : null
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">PDF wird geladen...</p>
        </div>
      </div>
    );
  }

  if (!pdf) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-destructive">Fehler beim Laden des PDFs</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 border-b bg-background">
        <Button
          variant={mode === 'none' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('none')}
        >
          <MousePointer className="h-4 w-4 mr-1" />
          Auswählen
        </Button>
        <Button
          variant={mode === 'highlight' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('highlight')}
        >
          <Highlighter className="h-4 w-4 mr-1" />
          Markieren
        </Button>
        <Button
          variant={mode === 'freetext' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('freetext')}
        >
          <Type className="h-4 w-4 mr-1" />
          Text
        </Button>
        
        <div className="flex-1" />
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm min-w-[60px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale(s => Math.min(3, s + 0.2))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Pages */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-muted/20">
        {Array.from({ length: pages }, (_, i) => (
          <Page key={i + 1} pageNumber={i + 1} />
        ))}
      </div>
    </div>
  );
};