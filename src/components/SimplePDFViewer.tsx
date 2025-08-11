import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PDFCommentExporter } from './PDFCommentExporter';
import PdfAnnotator from './PdfAnnotator';
import { useAuth } from '@/hooks/useAuth';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, FileText, Link } from 'lucide-react';

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

interface SimplePDFViewerProps {
  document: Document;
  assignmentId?: string;
  trialBalanceId?: string;
  accountName?: string;
  accountNumber?: string;
  // Props für die echte Funktionalität aus Review.tsx
  completedAccounts?: Set<string>;
  onMarkCompleted?: (assignmentId: string) => void;
  onShowMultiAssign?: (document: Document) => void;
  selectedDocuments?: Document[];
  assignments?: any[];
}

export const SimplePDFViewer: React.FC<SimplePDFViewerProps> = ({ 
  document, 
  assignmentId, 
  trialBalanceId, 
  accountName, 
  accountNumber,
  // Echte Funktionalität aus Review.tsx
  completedAccounts = new Set(),
  onMarkCompleted,
  onShowMultiAssign,
  selectedDocuments = [],
  assignments = []
}) => {
  const { user } = useAuth();
  const [documentUrl, setDocumentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState<string>('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentLoaded, setCommentLoaded] = useState(false);

  // Load document URL
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

  // Load existing comment
  useEffect(() => {
    const loadComment = async () => {
      if (!assignmentId || !user?.id || commentLoaded) return;
      
      try {
        const { data, error } = await supabase
          .from('account_comments')
          .select('comment_text')
          .eq('assignment_id', assignmentId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        
        if (data) {
          setComment(data.comment_text);
        }
        setCommentLoaded(true);
      } catch (error: any) {
        console.error('Error loading comment:', error);
      }
    };

    loadComment();
  }, [assignmentId, user?.id, commentLoaded]);

  // Save comment function
  const saveComment = async () => {
    if (!assignmentId || !user?.id || !trialBalanceId) return;
    
    setCommentLoading(true);
    try {
      // Check if comment already exists
      const { data: existingComment } = await supabase
        .from('account_comments')
        .select('id')
        .eq('assignment_id', assignmentId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingComment) {
        // Update existing comment
        const { error } = await supabase
          .from('account_comments')
          .update({ comment_text: comment })
          .eq('id', existingComment.id);
        
        if (error) throw error;
      } else {
        // Create new comment
        const { error } = await supabase
          .from('account_comments')
          .insert({
            assignment_id: assignmentId,
            user_id: user.id,
            trial_balance_id: trialBalanceId,
            comment_text: comment
          });
        
        if (error) throw error;
      }
      
      toast.success('Kommentar gespeichert');
    } catch (error: any) {
      console.error('Error saving comment:', error);
      toast.error('Fehler beim Speichern des Kommentars');
    } finally {
      setCommentLoading(false);
    }
  };

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
    <div className="h-full flex flex-col max-h-[calc(100vh-300px)]">{/* Reduzierte max-height für Footer-Platz */}
      {/* PDF Viewer with Annotations */}
      <div className="flex-1 overflow-hidden min-h-0">{/* min-h-0 für flex-shrink */}
        <PdfAnnotator
          docUrl={documentUrl}
          docId={document.id}
          userId={user?.id || ''}
        />
      </div>
      
      {/* Comment Section - identisch zur Excel-Ansicht */}
      {assignmentId ? (
        <div className="flex-shrink-0 mt-4 bg-muted/30 rounded-lg p-4 border">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">
                Kommentare
              </label>
              <div className="flex items-center gap-2">
                {/* Konten Button - identisch zur Excel-Ansicht */}
                {onShowMultiAssign && selectedDocuments.length > 0 && (
                  <Button 
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onShowMultiAssign(selectedDocuments[0]);
                    }}
                    className="flex items-center gap-2"
                    disabled={selectedDocuments.length === 0}
                  >
                    <Link className="h-4 w-4" />
                    Konten
                  </Button>
                )}
                {/* Als vollständig markieren Button - identisch zur Excel-Ansicht */}
                {assignmentId && onMarkCompleted && (
                  <Button 
                    variant={completedAccounts.has(assignmentId) ? "default" : "outline"}
                    size="sm"
                    onClick={() => onMarkCompleted(assignmentId)}
                    className="flex items-center gap-2"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {completedAccounts.has(assignmentId) ? 'Vollständig' : 'Als vollständig markieren'}
                  </Button>
                )}
              </div>
            </div>
            
            {/* Kommentarfeld - identisch zur Excel-Ansicht */}
            <div className="flex-shrink-0 border-t pt-4 space-y-2">
              <textarea 
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Notizen und Anmerkungen zu diesem Konto und den Nachweisen..."
                className="min-h-[100px] max-h-[200px] resize-none bg-background border-input w-full p-3 rounded-md"
              />
              <div className="flex gap-2">
                <PDFCommentExporter
                  document={document}
                  assignmentId={assignmentId}
                  trialBalanceId={trialBalanceId}
                  accountName={accountName}
                  accountNumber={accountNumber}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};