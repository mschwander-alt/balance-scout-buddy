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
    
    // Logo placeholder box - exactly like in the design
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
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(100, 100, 100);
          pdf.text('Platzhalter', 50, currentY + 18);
        }
      }
    } else {
      // Show placeholder text exactly like in design
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      pdf.text('Platzhalter', 50, currentY + 18);
    }
    
    currentY += 50;
    
    // Account information table - exact structure from design
    const tableData = [
      ['Konto:', `${accountNumber} – ${accountName}`],
      ['Dokument:', document.file_name],
      ['Erstellungsdatum:', `${new Date().toLocaleDateString('de-DE')} um ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`]
    ];
    
    const tableWidth = 170;
    const labelWidth = 40;
    const valueWidth = 130;
    const rowHeight = 8;
    
    // Draw table with borders
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.3);
    
    // Outer table border
    pdf.rect(20, currentY, tableWidth, tableData.length * rowHeight);
    
    tableData.forEach((row, index) => {
      const y = currentY + (index * rowHeight);
      
      // Horizontal lines between rows
      if (index > 0) {
        pdf.line(20, y, 20 + tableWidth, y);
      }
      
      // Vertical line between columns
      pdf.line(20 + labelWidth, y, 20 + labelWidth, y + rowHeight);
      
      // Add text
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      pdf.text(row[0], 22, y + 5.5);
      pdf.text(row[1], 22 + labelWidth, y + 5.5);
    });
    
    currentY += (tableData.length * rowHeight) + 20;
    
    // Prüfungsnotizen section - exact header from design
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Prüfungsnotizen', 20, currentY);
    
    currentY += 15;
    
    // Vorjahresvergleich subsection
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Vorjahresvergleich:', 20, currentY);
    
    currentY += 10;
    
    // Comparison table - exact structure from design
    const comparisonHeaders = ['Lfd. Jahr', 'Vorjahr', 'Abw.', '%'];
    const comparisonData = ['CHF 233.50', 'CHF 2\'200.75', 'CHF -1\'967.25', '-89.4%'];
    const compTableWidth = 150;
    const colWidth = compTableWidth / 4;
    const headerHeight = 8;
    const dataHeight = 8;
    
    // Draw comparison table
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.3);
    
    // Table border
    pdf.rect(20, currentY, compTableWidth, headerHeight + dataHeight);
    
    // Header row
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(0, 0, 0);
    
    comparisonHeaders.forEach((header, index) => {
      const x = 20 + (index * colWidth);
      
      // Vertical lines
      if (index > 0) {
        pdf.line(x, currentY, x, currentY + headerHeight + dataHeight);
      }
      
      // Header text
      pdf.text(header, x + 2, currentY + 6);
    });
    
    // Horizontal line under headers
    pdf.line(20, currentY + headerHeight, 20 + compTableWidth, currentY + headerHeight);
    
    // Data row
    comparisonData.forEach((data, index) => {
      const x = 20 + (index * colWidth);
      
      // Set red color for percentage if negative
      if (index === 3 && data.startsWith('-')) {
        pdf.setTextColor(255, 0, 0);
      } else {
        pdf.setTextColor(0, 0, 0);
      }
      
      pdf.text(data, x + 2, currentY + headerHeight + 6);
    });
    
    pdf.setTextColor(0, 0, 0); // Reset color
    
    currentY += headerHeight + dataHeight + 15;
    
    // Comments subsection
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Kommentare:', 20, currentY);
    
    currentY += 10;
    
    // Comments content
    if (comments.length === 0) {
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'italic');
      pdf.setTextColor(100, 100, 100);
      pdf.text('Hier kommt der Kommentar rein', 20, currentY);
    } else {
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      
      comments.forEach((comment, index) => {
        const commentDate = new Date(comment.created_at).toLocaleDateString('de-DE');
        const commentTime = new Date(comment.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        
        // Add comment with date/time if multiple comments
        if (comments.length > 1) {
          pdf.setFont('helvetica', 'bold');
          pdf.text(`${commentDate} ${commentTime}:`, 20, currentY);
          currentY += 5;
          pdf.setFont('helvetica', 'normal');
        }
        
        // Comment text
        const lines = pdf.splitTextToSize(comment.comment_text, 160);
        lines.forEach((line: string) => {
          if (currentY > 270) {
            pdf.addPage();
            currentY = 20;
          }
          pdf.text(line, 20, currentY);
          currentY += 4;
        });
        
        if (index < comments.length - 1) {
          currentY += 5; // Space between comments
        }
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