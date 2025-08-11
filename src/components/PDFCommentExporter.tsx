import React, { useState, useEffect } from 'react';
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

interface CompanySettings {
  company_name?: string;
  logo_path?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
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
  const [companySettings, setCompanySettings] = useState<CompanySettings>({});

  useEffect(() => {
    loadCompanySettings();
  }, [user]);

  const loadCompanySettings = async () => {
    if (!user) return;

    try {
      const { data } = await supabase
        .from('company_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        setCompanySettings(data);
      }
    } catch (error) {
      console.error('Error loading company settings:', error);
    }
  };

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

  const loadLogoAsBase64 = async (logoPath: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage
        .from('logos')
        .createSignedUrl(logoPath, 3600);

      if (error) throw error;

      const response = await fetch(data.signedUrl);
      const blob = await response.blob();
      
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error loading logo:', error);
      return null;
    }
  };

  const generateCommentPage = async (comments: Comment[]): Promise<Uint8Array> => {
    const pdf = new jsPDF();
    
    let currentY = 20;
    
    // Logo placeholder box
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.5);
    pdf.rect(20, currentY, 60, 30);
    
    // Load and add logo if available
    if (companySettings.logo_path) {
      const logoBase64 = await loadLogoAsBase64(companySettings.logo_path);
      if (logoBase64) {
        try {
          pdf.addImage(logoBase64, 'JPEG', 22, currentY + 2, 56, 26);
        } catch (error) {
          console.error('Error adding logo to PDF:', error);
          // Show placeholder text if logo fails
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'normal');
          pdf.text('Platzhalter', 50, currentY + 18);
        }
      }
    } else {
      // Show placeholder text
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Platzhalter', 50, currentY + 18);
    }
    
    currentY += 50;
    
    // Account information table
    const tableRows = [
      ['Konto:', `${accountNumber} - ${accountName}`],
      ['Dokument:', document.file_name],
      ['Erstellungsdatum:', `${new Date().toLocaleDateString('de-DE')} um ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`]
    ];
    
    const tableWidth = 170;
    const colWidth = tableWidth / 2;
    const rowHeight = 8;
    
    // Draw table
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.3);
    
    tableRows.forEach((row, index) => {
      const y = currentY + (index * rowHeight);
      
      // Draw row borders
      pdf.rect(20, y, tableWidth, rowHeight);
      pdf.line(20 + colWidth, y, 20 + colWidth, y + rowHeight);
      
      // Add text
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text(row[0], 22, y + 5.5);
      
      pdf.setFont('helvetica', 'normal');
      pdf.text(row[1], 22 + colWidth, y + 5.5);
    });
    
    currentY += (tableRows.length * rowHeight) + 20;
    
    // Prüfungsnotizen section
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Prüfungsnotizen', 20, currentY);
    
    currentY += 15;
    
    // Vorjahresvergleich subsection (placeholder for now)
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Vorjahresvergleich:', 20, currentY);
    
    currentY += 10;
    
    // Simple comparison table placeholder
    const comparisonTableY = currentY;
    const comparisonTableHeight = 25;
    
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.3);
    pdf.rect(20, comparisonTableY, 150, comparisonTableHeight);
    
    // Table headers
    const headers = ['Lfd. Jahr', 'Vorjahr', 'Abw.', '%'];
    const headerWidth = 150 / 4;
    
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    headers.forEach((header, index) => {
      pdf.text(header, 22 + (index * headerWidth), comparisonTableY + 8);
      if (index < headers.length - 1) {
        pdf.line(20 + ((index + 1) * headerWidth), comparisonTableY, 20 + ((index + 1) * headerWidth), comparisonTableY + comparisonTableHeight);
      }
    });
    
    // Horizontal line under headers
    pdf.line(20, comparisonTableY + 12, 170, comparisonTableY + 12);
    
    // Sample data row
    pdf.setFont('helvetica', 'normal');
    pdf.text('CHF 233.50', 22, comparisonTableY + 20);
    pdf.text('CHF 2\'200.75', 22 + headerWidth, comparisonTableY + 20);
    pdf.text('CHF -1\'967.25', 22 + (2 * headerWidth), comparisonTableY + 20);
    
    pdf.setTextColor(255, 0, 0); // Red for negative percentage
    pdf.text('-89.4%', 22 + (3 * headerWidth), comparisonTableY + 20);
    pdf.setTextColor(0, 0, 0); // Reset to black
    
    currentY += comparisonTableHeight + 20;
    
    // Comments section
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Kommentare:', 20, currentY);
    
    currentY += 10;
    
    // Comments table
    const commentsTableY = currentY;
    let commentsTableHeight = 20;
    
    if (comments.length === 0) {
      // Single row for "no comments"
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.3);
      pdf.rect(20, commentsTableY, 170, commentsTableHeight);
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'italic');
      pdf.text('Keine Kommentare für dieses Konto erfasst.', 22, commentsTableY + 12);
    } else {
      // Calculate needed height for all comments
      let totalTextHeight = 0;
      const commentTexts: string[][] = [];
      
      comments.forEach((comment) => {
        const lines = pdf.splitTextToSize(comment.comment_text, 160);
        commentTexts.push(lines);
        totalTextHeight += Math.max(lines.length * 4, 15); // Minimum 15, or 4 per line
      });
      
      commentsTableHeight = Math.max(totalTextHeight + (comments.length * 5), 30);
      
      // Draw comments table border
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.3);
      pdf.rect(20, commentsTableY, 170, commentsTableHeight);
      
      // Add comments
      let commentY = commentsTableY + 8;
      
      comments.forEach((comment, index) => {
        const commentDate = new Date(comment.created_at).toLocaleDateString('de-DE');
        const commentTime = new Date(comment.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${commentDate} ${commentTime}:`, 22, commentY);
        
        commentY += 6;
        
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        const lines = commentTexts[index];
        lines.forEach((line: string) => {
          pdf.text(line, 22, commentY);
          commentY += 4;
        });
        
        commentY += 5; // Space between comments
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
        Speichern
      </Button>
      
      <Button
        size="sm"
        variant="outline"
        onClick={handlePrintWithComments}
        className="flex items-center gap-2"
      >
        <Printer className="h-4 w-4" />
        Drucken
      </Button>
    </div>
  );
};