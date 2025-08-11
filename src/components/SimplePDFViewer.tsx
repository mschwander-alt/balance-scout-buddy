import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PDFCommentExporter } from './PDFCommentExporter';
import PdfAnnotator from './PdfAnnotator';
import { useAuth } from '@/hooks/useAuth';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
}

export const SimplePDFViewer: React.FC<SimplePDFViewerProps> = ({ 
  document, 
  assignmentId, 
  trialBalanceId, 
  accountName, 
  accountNumber 
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
    <div className="h-full flex flex-col">
      {/* PDF Viewer with Annotations */}
      <div className="flex-1">
        <PdfAnnotator
          docUrl={documentUrl}
          docId={document.id}
          userId={user?.id || ''}
        />
      </div>
      
      {/* Comment Section */}
      {assignmentId && (
        <Card className="border-t-0 rounded-t-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              Kommentar zu {accountName} ({accountNumber})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Notizen und Kommentare zu diesem Konto..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-[80px] resize-none"
            />
            <div className="flex justify-between items-center">
              <PDFCommentExporter
                document={document}
                assignmentId={assignmentId}
                trialBalanceId={trialBalanceId}
                accountName={accountName}
                accountNumber={accountNumber}
              />
              <Button 
                onClick={saveComment}
                disabled={commentLoading}
                size="sm"
              >
                {commentLoading ? 'Speichere...' : 'Kommentar speichern'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};