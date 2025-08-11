import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { PDFDocument, rgb } from 'pdf-lib';
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

  const loadPDFAnnotations = async () => {
    if (!user) return [];
    
    try {
      const { data, error } = await supabase
        .from('pdf_annotations')
        .select('annotations')
        .eq('doc_id', document.id)
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) throw error;
      return (data?.annotations as any[]) || [];
    } catch (error) {
      console.error('Error loading PDF annotations:', error);
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

  const embedAnnotationsInPDF = async (originalPdfData: Uint8Array, annotations: any[]): Promise<Uint8Array> => {
    try {
      const pdfDoc = await PDFDocument.load(originalPdfData);
      const pages = pdfDoc.getPages();
      
      // Group annotations by page
      const annotationsByPage: { [pageNum: number]: any[] } = {};
      annotations.forEach(annotation => {
        const pageNum = annotation.page - 1; // Convert to 0-based index
        if (!annotationsByPage[pageNum]) {
          annotationsByPage[pageNum] = [];
        }
        annotationsByPage[pageNum].push(annotation);
      });
      
      // Apply annotations to each page
      Object.keys(annotationsByPage).forEach(pageNumStr => {
        const pageNum = parseInt(pageNumStr);
        const page = pages[pageNum];
        if (!page) return;
        
        const { width, height } = page.getSize();
        const pageAnnotations = annotationsByPage[pageNum];
        
        pageAnnotations.forEach(annotation => {
          if (annotation.type === 'highlight') {
            // Draw highlight rectangles
            annotation.rects?.forEach((rect: any) => {
              const x = rect.x * width;
              const y = height - (rect.y * height) - (rect.h * height); // Flip Y coordinate
              const w = rect.w * width;
              const h = rect.h * height;
              
              // Convert hex color to RGB
              const color = annotation.color || '#ffeb00';
              const r = parseInt(color.slice(1, 3), 16) / 255;
              const g = parseInt(color.slice(3, 5), 16) / 255;
              const b = parseInt(color.slice(5, 7), 16) / 255;
              
              page.drawRectangle({
                x,
                y,
                width: w,
                height: h,
                color: rgb(r, g, b),
                opacity: 0.3, // Semi-transparent highlight
              });
            });
          } else if (annotation.type === 'freetext') {
            // Draw text annotations
            const x = annotation.x * width;
            const y = height - (annotation.y * height); // Flip Y coordinate
            const fontSize = annotation.fontSize || 12;
            const color = annotation.color || '#000000';
            
            // Convert hex color to RGB
            const r = parseInt(color.slice(1, 3), 16) / 255;
            const g = parseInt(color.slice(3, 5), 16) / 255;
            const b = parseInt(color.slice(5, 7), 16) / 255;
            
            page.drawText(annotation.text, {
              x,
              y,
              size: fontSize,
              color: rgb(r, g, b),
            });
          }
        });
      });
      
      return await pdfDoc.save();
    } catch (error) {
      console.error('Error embedding annotations in PDF:', error);
      throw error;
    }
  };

  const generateCommentPage = async (comments: Comment[]): Promise<Uint8Array> => {
    const pdf = new jsPDF();
    
    let currentY = 30;
    
    // Logo placeholder box - top right like in your design
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.5);
    pdf.rect(150, 20, 40, 25);
    
    // Logo placeholder text
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Platzhalter', 170, 30);
    pdf.text('Für Logo', 170, 35);
    
    // Load and add logo if available
    if (companySettings.logo_path) {
      const logoBase64 = await loadLogoAsBase64(companySettings.logo_path);
      if (logoBase64) {
        try {
          pdf.addImage(logoBase64, 'JPEG', 152, 22, 36, 21);
        } catch (error) {
          console.error('Error adding logo to PDF:', error);
        }
      }
    }
    
    currentY = 70;
    
    // Account information table - exactly like your design
    const tableData = [
      ['Konto:', `${accountNumber} – ${accountName}`],
      ['Dokument:', document.file_name],
      ['Erstellungsdatum:', `${new Date().toLocaleDateString('de-DE')} um ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`]
    ];
    
    const tableStartX = 20;
    const tableWidth = 170;
    const labelWidth = 40;
    const valueWidth = 130;
    const rowHeight = 7;
    
    // Draw table outline
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.3);
    pdf.rect(tableStartX, currentY, tableWidth, tableData.length * rowHeight);
    
    // Draw table content
    tableData.forEach((row, index) => {
      const y = currentY + (index * rowHeight);
      
      // Horizontal lines between rows
      if (index > 0) {
        pdf.line(tableStartX, y, tableStartX + tableWidth, y);
      }
      
      // Vertical line between columns
      pdf.line(tableStartX + labelWidth, y, tableStartX + labelWidth, y + rowHeight);
      
      // Add text
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      pdf.text(row[0], tableStartX + 2, y + 5);
      pdf.text(row[1], tableStartX + labelWidth + 2, y + 5);
    });
    
    currentY += (tableData.length * rowHeight) + 20;
    
    // Prüfungsnotizen section
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Prüfungsnotizen', tableStartX, currentY);
    
    currentY += 15;
    
    // Vorjahresvergleich table
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Vorjahresvergleich:', tableStartX, currentY);
    
    currentY += 8;
    
    // Comparison table headers and data
    const compHeaders = ['Lfd. Jahr', 'Vorjahr', 'Abw.', '%'];
    const compData = ['CHF 233.50', 'CHF 2\'200.75', 'CHF -1\'967.25', '-89.4%'];
    const compTableWidth = 120;
    const compColWidth = compTableWidth / 4;
    const compTableHeight = 14;
    
    // Draw comparison table
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.3);
    pdf.rect(tableStartX, currentY, compTableWidth, compTableHeight);
    
    // Headers
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    compHeaders.forEach((header, index) => {
      const x = tableStartX + (index * compColWidth);
      
      // Vertical lines
      if (index > 0) {
        pdf.line(x, currentY, x, currentY + compTableHeight);
      }
      
      pdf.text(header, x + 1, currentY + 5);
    });
    
    // Horizontal line under headers
    pdf.line(tableStartX, currentY + 7, tableStartX + compTableWidth, currentY + 7);
    
    // Data row
    compData.forEach((data, index) => {
      const x = tableStartX + (index * compColWidth);
      
      // Set red color for negative percentage
      if (index === 3 && data.startsWith('-')) {
        pdf.setTextColor(255, 0, 0);
      } else {
        pdf.setTextColor(0, 0, 0);
      }
      
      pdf.text(data, x + 1, currentY + 11);
    });
    
    pdf.setTextColor(0, 0, 0); // Reset color
    
    currentY += compTableHeight + 15;
    
    // Comments section
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Kommentare:', tableStartX, currentY);
    
    currentY += 8;
    
    // Comments content - simple text, no table
    if (comments.length === 0) {
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      pdf.text('Hier kommt der Kommentar rein', tableStartX, currentY);
    } else {
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      
      comments.forEach((comment, index) => {
        if (comments.length > 1) {
          const commentDate = new Date(comment.created_at).toLocaleDateString('de-DE');
          const commentTime = new Date(comment.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
          pdf.text(`${commentDate} ${commentTime}:`, tableStartX, currentY);
          currentY += 5;
        }
        
        const lines = pdf.splitTextToSize(comment.comment_text, 160);
        lines.forEach((line: string) => {
          if (currentY > 270) {
            pdf.addPage();
            currentY = 20;
          }
          pdf.text(line, tableStartX, currentY);
          currentY += 4;
        });
        
        if (index < comments.length - 1) {
          currentY += 5;
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

  const combinePDFs = async (commentPdf: Uint8Array, annotatedPdf: Uint8Array): Promise<Uint8Array> => {
    try {
      const combinedPdf = await PDFDocument.create();
      
      // Add comment page first
      const commentDoc = await PDFDocument.load(commentPdf);
      const commentPages = await combinedPdf.copyPages(commentDoc, commentDoc.getPageIndices());
      commentPages.forEach((page) => combinedPdf.addPage(page));
      
      // Add annotated PDF pages
      const annotatedDoc = await PDFDocument.load(annotatedPdf);
      const annotatedPages = await combinedPdf.copyPages(annotatedDoc, annotatedDoc.getPageIndices());
      annotatedPages.forEach((page) => combinedPdf.addPage(page));
      
      return await combinedPdf.save();
    } catch (error) {
      console.error('Error combining PDFs:', error);
      throw error;
    }
  };

  const handleExportWithComments = async () => {
    try {
      toast.info('PDF mit Kommentaren und Annotationen wird erstellt...');
      
      const [comments, annotations, originalPdf] = await Promise.all([
        loadComments(),
        loadPDFAnnotations(),
        downloadOriginalPDF()
      ]);
      
      // Embed annotations directly into the original PDF
      const annotatedPdf = await embedAnnotationsInPDF(originalPdf, annotations);
      const commentPdf = await generateCommentPage(comments);
      const combinedPdf = await combinePDFs(commentPdf, annotatedPdf);
      
      // Download combined PDF
      const blob = new Blob([combinedPdf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${document.file_name.replace('.pdf', '')}_mit_kommentaren.pdf`;
      link.click();
      
      URL.revokeObjectURL(url);
      toast.success('PDF mit Kommentaren und Annotationen heruntergeladen');
      
    } catch (error) {
      console.error('Error exporting PDF with comments:', error);
      toast.error('Fehler beim Erstellen des PDFs mit Kommentaren');
    }
  };

  const handlePrintWithComments = async () => {
    try {
      toast.info('PDF für Druck wird vorbereitet...');
      
      const [comments, annotations, originalPdf] = await Promise.all([
        loadComments(),
        loadPDFAnnotations(),
        downloadOriginalPDF()
      ]);
      
      // Embed annotations directly into the original PDF
      const annotatedPdf = await embedAnnotationsInPDF(originalPdf, annotations);
      const commentPdf = await generateCommentPage(comments);
      const combinedPdf = await combinePDFs(commentPdf, annotatedPdf);
      
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