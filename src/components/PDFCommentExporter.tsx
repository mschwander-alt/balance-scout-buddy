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
    
    // Set up modern colors and fonts
    const primaryColor = [37, 99, 235]; // Modern blue
    const grayColor = [107, 114, 128]; // Gray-500
    const lightGrayColor = [249, 250, 251]; // Gray-50
    
    let currentY = 25;
    
    // Load and add logo if available
    if (companySettings.logo_path) {
      const logoBase64 = await loadLogoAsBase64(companySettings.logo_path);
      if (logoBase64) {
        try {
          pdf.addImage(logoBase64, 'JPEG', 20, currentY, 40, 20);
          currentY += 25;
        } catch (error) {
          console.error('Error adding logo to PDF:', error);
        }
      }
    }
    
    // Modern header with gradient-like effect (simulated with rectangles)
    pdf.setFillColor(lightGrayColor[0], lightGrayColor[1], lightGrayColor[2]);
    pdf.rect(15, currentY, 180, 35, 'F');
    
    // Header border
    pdf.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    pdf.setLineWidth(0.5);
    pdf.rect(15, currentY, 180, 35);
    
    // Main title
    pdf.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    pdf.setFontSize(24);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Prüfungsdokumentation', 20, currentY + 15);
    
    // Subtitle
    pdf.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Kommentare und Analyse', 20, currentY + 25);
    
    currentY += 50;
    
    // Company information section (if available)
    if (companySettings.company_name) {
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      
      let companyY = currentY;
      pdf.text(`${companySettings.company_name}`, 130, companyY);
      
      if (companySettings.address) {
        companyY += 5;
        const addressLines = companySettings.address.split('\n');
        addressLines.forEach((line) => {
          pdf.text(line, 130, companyY);
          companyY += 5;
        });
      }
      
      if (companySettings.phone) {
        companyY += 2;
        pdf.text(`Tel: ${companySettings.phone}`, 130, companyY);
        companyY += 5;
      }
      
      if (companySettings.email) {
        pdf.text(`E-Mail: ${companySettings.email}`, 130, companyY);
        companyY += 5;
      }
      
      if (companySettings.website) {
        pdf.text(`Web: ${companySettings.website}`, 130, companyY);
      }
    }
    
    // Account information section with modern styling
    pdf.setFillColor(lightGrayColor[0], lightGrayColor[1], lightGrayColor[2]);
    pdf.rect(15, currentY, 180, 30, 'F');
    pdf.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    pdf.setLineWidth(0.3);
    pdf.rect(15, currentY, 180, 30);
    
    // Account details
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Kontoinformationen', 20, currentY + 10);
    
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Konto: ${accountNumber} - ${accountName}`, 20, currentY + 18);
    pdf.text(`Dokument: ${document.file_name}`, 20, currentY + 25);
    
    // Date
    pdf.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
    pdf.setFontSize(10);
    pdf.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')} um ${new Date().toLocaleTimeString('de-DE')}`, 130, currentY + 25);
    
    currentY += 45;
    
    // Comments section
    pdf.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Kommentare und Anmerkungen', 20, currentY);
    
    currentY += 15;
    
    if (comments.length === 0) {
      // No comments styling
      pdf.setFillColor(254, 249, 195); // Yellow-100
      pdf.rect(15, currentY, 180, 20, 'F');
      pdf.setDrawColor(245, 158, 11); // Amber-500
      pdf.setLineWidth(0.3);
      pdf.rect(15, currentY, 180, 20);
      
      pdf.setTextColor(146, 64, 14); // Amber-800
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'italic');
      pdf.text('Keine Kommentare für dieses Konto erfasst.', 20, currentY + 12);
    } else {
      // Render comments with modern cards
      comments.forEach((comment, index) => {
        const commentDate = new Date(comment.created_at).toLocaleDateString('de-DE');
        const commentTime = new Date(comment.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        
        // Check if we need a new page
        if (currentY > 240) {
          pdf.addPage();
          currentY = 30;
        }
        
        // Comment card background
        pdf.setFillColor(255, 255, 255);
        pdf.rect(15, currentY, 180, 25, 'F');
        
        // Comment card border
        pdf.setDrawColor(229, 231, 235); // Gray-200
        pdf.setLineWidth(0.3);
        pdf.rect(15, currentY, 180, 25);
        
        // Comment header with accent
        pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        pdf.rect(15, currentY, 5, 25, 'F');
        
        // Comment number and date
        pdf.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Kommentar ${index + 1}`, 25, currentY + 8);
        
        pdf.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`${commentDate} | ${commentTime}`, 25, currentY + 15);
        
        currentY += 30;
        
        // Comment text with better formatting
        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        
        const lines = pdf.splitTextToSize(comment.comment_text, 170);
        const lineHeight = 5;
        
        // Background for comment text
        const textHeight = lines.length * lineHeight + 8;
        pdf.setFillColor(248, 250, 252); // Slate-50
        pdf.rect(15, currentY, 180, textHeight, 'F');
        pdf.setDrawColor(226, 232, 240); // Slate-200
        pdf.setLineWidth(0.2);
        pdf.rect(15, currentY, 180, textHeight);
        
        pdf.text(lines, 20, currentY + 8);
        currentY += textHeight + 10;
      });
    }
    
    // Footer
    if (currentY > 250) {
      pdf.addPage();
      currentY = 30;
    }
    
    // Footer line
    pdf.setDrawColor(grayColor[0], grayColor[1], grayColor[2]);
    pdf.setLineWidth(0.3);
    pdf.line(15, 280, 195, 280);
    
    // Footer text
    pdf.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Dieses Dokument wurde automatisch generiert', 20, 285);
    pdf.text(`Seite 1`, 185, 285);
    
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