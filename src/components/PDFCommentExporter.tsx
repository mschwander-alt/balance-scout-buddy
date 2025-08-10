import React from 'react';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { Button } from './ui/button';
import { Download, Printer } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Comment {
  id: string;
  comment_text: string;
  created_at: string;
  assignment_id: string;
}

interface PDFCommentExporterProps {
  document: {
    id: string;
    file_name: string;
    file_path: string;
    file_type: string;
  };
  assignmentId: string;
  trialBalanceId: string;
  accountName: string;
  accountNumber: string;
}

export const PDFCommentExporter: React.FC<PDFCommentExporterProps> = ({
  document,
  assignmentId,
  trialBalanceId,
  accountName,
  accountNumber
}) => {
  const { user } = useAuth();

  const loadComments = async (): Promise<Comment[]> => {
    if (!user) return [];

    try {
      const { data, error } = await supabase
        .from('account_comments')
        .select('*')
        .eq('assignment_id', assignmentId)
        .eq('trial_balance_id', trialBalanceId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading comments:', error);
      return [];
    }
  };

  const generateCommentPage = async (comments: Comment[]): Promise<Uint8Array> => {
    const pdf = new jsPDF();
    
    // Header
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Kommentare zur Prüfung', 20, 30);
    
    // Account info
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Konto: ${accountNumber} - ${accountName}`, 20, 50);
    pdf.text(`Dokument: ${document.file_name}`, 20, 60);
    pdf.text(`Datum: ${new Date().toLocaleDateString('de-DE')}`, 20, 70);
    
    // Comments
    let yPosition = 90;
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Kommentare:', 20, yPosition);
    
    yPosition += 20;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    
    if (comments.length === 0) {
      pdf.text('Keine Kommentare vorhanden.', 20, yPosition);
    } else {
      comments.forEach((comment, index) => {
        const commentDate = new Date(comment.created_at).toLocaleDateString('de-DE');
        const commentTime = new Date(comment.created_at).toLocaleTimeString('de-DE');
        
        // Check if we need a new page
        if (yPosition > 250) {
          pdf.addPage();
          yPosition = 30;
        }
        
        // Comment header
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Kommentar ${index + 1} (${commentDate} ${commentTime}):`, 20, yPosition);
        yPosition += 10;
        
        // Comment text with word wrapping
        pdf.setFont('helvetica', 'normal');
        const lines = pdf.splitTextToSize(comment.comment_text, 170);
        pdf.text(lines, 20, yPosition);
        yPosition += lines.length * 5 + 10;
      });
    }
    
    return new Uint8Array(pdf.output('arraybuffer'));
  };

  const downloadOriginalPDF = async (): Promise<Uint8Array> => {
    try {
      const { data, error } = await supabase.storage
        .from('account-evidence')
        .createSignedUrl(document.file_path, 3600);

      if (error) throw error;

      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error('Failed to download PDF');
      
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      console.error('Error downloading original PDF:', error);
      throw error;
    }
  };

  const combinePDFs = async (commentPdf: Uint8Array, originalPdf: Uint8Array): Promise<Uint8Array> => {
    try {
      const combinedPdf = await PDFDocument.create();
      
      // Add comment page
      const commentDoc = await PDFDocument.load(commentPdf);
      const commentPages = await combinedPdf.copyPages(commentDoc, commentDoc.getPageIndices());
      commentPages.forEach((page) => combinedPdf.addPage(page));
      
      // Add original PDF pages
      const originalDoc = await PDFDocument.load(originalPdf);
      const originalPages = await combinedPdf.copyPages(originalDoc, originalDoc.getPageIndices());
      originalPages.forEach((page) => combinedPdf.addPage(page));
      
      return await combinedPdf.save();
    } catch (error) {
      console.error('Error combining PDFs:', error);
      throw error;
    }
  };

  const handleExportWithComments = async () => {
    try {
      toast.info('PDF wird erstellt...');
      
      const [comments, originalPdf] = await Promise.all([
        loadComments(),
        downloadOriginalPDF()
      ]);
      
      const commentPdf = await generateCommentPage(comments);
      const combinedPdf = await combinePDFs(commentPdf, originalPdf);
      
      // Download combined PDF
      const blob = new Blob([combinedPdf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${document.file_name.replace('.pdf', '')}_mit_kommentaren.pdf`;
      link.click();
      
      URL.revokeObjectURL(url);
      toast.success('PDF mit Kommentaren heruntergeladen');
      
    } catch (error) {
      console.error('Error exporting PDF with comments:', error);
      toast.error('Fehler beim Erstellen des PDFs mit Kommentaren');
    }
  };

  const handlePrintWithComments = async () => {
    try {
      toast.info('PDF für Druck wird vorbereitet...');
      
      const [comments, originalPdf] = await Promise.all([
        loadComments(),
        downloadOriginalPDF()
      ]);
      
      const commentPdf = await generateCommentPage(comments);
      const combinedPdf = await combinePDFs(commentPdf, originalPdf);
      
      // Open print dialog
      const blob = new Blob([combinedPdf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url);
      
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
        };
      }
      
      // Clean up after some time
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 5000);
      
      toast.success('Druckdialog geöffnet');
      
    } catch (error) {
      console.error('Error printing PDF with comments:', error);
      toast.error('Fehler beim Drucken des PDFs mit Kommentaren');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleExportWithComments}
        className="flex items-center gap-2"
      >
        <Download className="h-4 w-4" />
        Mit Kommentaren speichern
      </Button>
      
      <Button
        size="sm"
        variant="outline"
        onClick={handlePrintWithComments}
        className="flex items-center gap-2"
      >
        <Printer className="h-4 w-4" />
        Mit Kommentaren drucken
      </Button>
    </div>
  );
};