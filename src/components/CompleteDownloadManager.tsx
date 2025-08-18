import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileText, Package, CheckCircle, XCircle, Clock, X } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { PDFDocument, rgb } from "pdf-lib";
import { useAuth } from "@/hooks/useAuth";

interface Account {
  id: string;
  account_number: string;
  account_name: string;
  current_year_balance: number;
  match_status?: string;
  confidence_score?: number;
  matched_documents?: string[];
  evidence_files?: Array<{
    id: string;
    file_name: string;
    file_path: string;
  }>;
  assigned_letter?: string;
}

interface CompleteDownloadManagerProps {
  trialBalanceId: string;
}

const CompleteDownloadManager = ({ trialBalanceId }: CompleteDownloadManagerProps) => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [hasGroups, setHasGroups] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

  // Sort accounts by account number (ascending) for display, independent of evidence
  const displayAccounts = useMemo(() => {
    const toNum = (v: string) => {
      const cleaned = String(v).replace(/[^0-9]/g, "");
      return cleaned ? parseInt(cleaned, 10) : 0;
    };
    return [...accounts].sort((a, b) => toNum(a.account_number) - toNum(b.account_number));
  }, [accounts]);

  // Separate accounts for Balance Sheet (1000-2999) and Income Statement (3000+)
  const balanceSheetAccounts = useMemo(() => 
    displayAccounts.filter(acc => {
      const num = parseInt(acc.account_number.replace(/[^0-9]/g, ""), 10);
      return num >= 1000 && num <= 2999;
    }), 
    [displayAccounts]
  );

  const incomeStatementAccounts = useMemo(() => 
    displayAccounts.filter(acc => {
      const num = parseInt(acc.account_number.replace(/[^0-9]/g, ""), 10);
      return num >= 3000;
    }), 
    [displayAccounts]
  );

  useEffect(() => {
    loadAccounts();
  }, [trialBalanceId]);

  const loadAccounts = async () => {
    try {
      setLoading(true);

      // Check if groups exist
      const { data: groups } = await supabase
        .from('account_groups')
        .select('id')
        .eq('trial_balance_id', trialBalanceId);

      const hasGroupsData = groups && groups.length > 0;
      setHasGroups(hasGroupsData);

      let accountsData: Account[] = [];

      if (hasGroupsData) {
        // Load grouped accounts
        const { data: groupIds } = await supabase
          .from('account_groups')
          .select('id')
          .eq('trial_balance_id', trialBalanceId);

        const groupIdList = groupIds?.map(g => g.id) || [];
        
        const { data: assignments } = await supabase
          .from('account_group_assignments')
          .select(`
            id,
            account_number,
            account_name,
            current_year_balance,
            match_status,
            confidence_score,
            matched_documents
          `)
          .in('account_group_id', groupIdList);

        accountsData = assignments || [];
      } else {
        // Load ungrouped accounts
        const { data: tempMatches } = await supabase
          .from('temp_account_matches')
          .select(`
            id,
            account_number,
            account_name,
            current_year_balance,
            match_status,
            confidence_score,
            matched_documents
          `)
          .eq('trial_balance_id', trialBalanceId);

        accountsData = tempMatches || [];
      }

      // Load evidence files for each account
      const { data: evidenceFiles } = await supabase
        .from('account_evidence')
        .select('id, file_name, file_path')
        .eq('trial_balance_id', trialBalanceId);

      // Map evidence files to accounts based on matched_documents
      const accountsWithEvidence = accountsData.map(account => {
        const evidence = evidenceFiles?.filter(file => 
          account.matched_documents?.includes(file.id)
        ) || [];
        
        return {
          ...account,
          evidence_files: evidence,
          assigned_letter: ''
        };
      });

      setAccounts(accountsWithEvidence);
    } catch (error) {
      console.error('Error loading accounts:', error);
      toast.error('Fehler beim Laden der Konten');
    } finally {
      setLoading(false);
    }
  };

  const updateAccountLetter = (accountId: string, letter: string) => {
    setAccounts(prev => prev.map(account => 
      account.id === accountId 
        ? { ...account, assigned_letter: letter.toUpperCase() }
        : account
    ));
  };

  const handleRowClick = (accountId: string, event: React.MouseEvent) => {
    event.preventDefault();
    setSelectedAccounts(prev => {
      const newSet = new Set(prev);
      if (event.ctrlKey || event.metaKey) {
        // CTRL/CMD click: toggle selection
        if (newSet.has(accountId)) {
          newSet.delete(accountId);
        } else {
          newSet.add(accountId);
        }
      } else {
        // Regular click: select only this item
        newSet.clear();
        newSet.add(accountId);
      }
      return newSet;
    });
  };

  const assignLetterToSelected = (letter: string) => {
    const upperLetter = letter.toUpperCase();
    setAccounts(prev => prev.map(account => 
      selectedAccounts.has(account.id) 
        ? { ...account, assigned_letter: upperLetter }
        : account
    ));
    // Clear selection after assignment
    setSelectedAccounts(new Set());
  };

  const clearSelection = () => {
    setSelectedAccounts(new Set());
  };

  const applyLetterToRange = (fromAccount: string, toAccount: string, letter: string) => {
    setAccounts(prev => prev.map(account => {
      const accountNum = parseInt(account.account_number);
      const fromNum = parseInt(fromAccount);
      const toNum = parseInt(toAccount);
      
      if (accountNum >= fromNum && accountNum <= toNum) {
        return { ...account, assigned_letter: letter.toUpperCase() };
      }
      return account;
    }));
  };

  const generateCoverSheet = (account: Account): string => {
    const comments = `Kommentare für Konto ${account.account_number} - ${account.account_name}`;
    const balance = account.current_year_balance.toLocaleString('de-DE', { style: 'currency', currency: 'CHF' });
    const status = account.match_status || 'Ungeprüft';
    
    return `
DECKBLATT
=========

Konto: ${account.account_number}
Bezeichnung: ${account.account_name}
Saldo: ${balance}
Status: ${status}
Konfidenz: ${account.confidence_score ? (account.confidence_score * 100).toFixed(1) + '%' : 'N/A'}

Nachweise:
${account.evidence_files?.map(file => `- ${file.file_name}`).join('\n') || 'Keine Nachweise vorhanden'}

Kommentare:
${comments}

Generated: ${new Date().toLocaleString('de-DE')}
    `.trim();
  };

  const loadPDFAnnotations = async (documentId: string): Promise<any[]> => {
    try {
      const { data, error } = await supabase
        .from('pdf_annotations')
        .select('annotations')
        .eq('doc_id', documentId)
        .eq('user_id', user?.id || '')
        .maybeSingle();
      
      if (error) throw error;
      return (data?.annotations as any[]) || [];
    } catch (error) {
      console.error('Error loading PDF annotations:', error);
      return [];
    }
  };

  const loadAccountComments = async (accountId: string): Promise<string[]> => {
    try {
      const { data, error } = await supabase
        .from('account_comments')
        .select('comment_text')
        .eq('assignment_id', accountId);
      
      if (error) throw error;
      return data?.map(c => c.comment_text) || [];
    } catch (error) {
      console.error('Error loading comments:', error);
      return [];
    }
  };

  const embedAnnotationsInPDF = async (originalPdfData: Uint8Array, annotations: any[]): Promise<Uint8Array> => {
    try {
      const pdfDoc = await PDFDocument.load(originalPdfData);
      const pages = pdfDoc.getPages();
      
      // Group annotations by page
      const annotationsByPage: { [pageNum: number]: any[] } = {};
      annotations.forEach(ann => {
        if (!annotationsByPage[ann.page]) {
          annotationsByPage[ann.page] = [];
        }
        annotationsByPage[ann.page].push(ann);
      });
      
      // Add annotations to each page
      Object.entries(annotationsByPage).forEach(([pageNumStr, pageAnnotations]) => {
        const pageNum = parseInt(pageNumStr) - 1; // Convert to 0-based
        if (pageNum >= 0 && pageNum < pages.length) {
          const page = pages[pageNum];
          const { width, height } = page.getSize();
          
          pageAnnotations.forEach(ann => {
            if (ann.type === 'highlight') {
              // Add highlight rectangles
              ann.rects?.forEach((rect: any) => {
                const x = rect.x * width;
                const y = height - (rect.y * height) - (rect.h * height);
                const w = rect.w * width;
                const h = rect.h * height;
                
                page.drawRectangle({
                  x, y, width: w, height: h,
                  color: rgb(1, 1, 0),
                  opacity: 0.3,
                });
              });
            } else if (ann.type === 'freetext') {
              // Add text annotations
              const x = ann.x * width;
              const y = height - (ann.y * height);
              
              page.drawText(ann.text, {
                x, y,
                size: ann.fontSize || 12,
                color: rgb(1, 0, 0),
              });
            }
          });
        }
      });
      
      return await pdfDoc.save();
    } catch (error) {
      console.error('Error embedding annotations:', error);
      return originalPdfData;
    }
  };

  const generateCommentPDF = async (account: Account, comments: string[]): Promise<Uint8Array> => {
    try {
      // Import the same logic as PDFCommentExporter for consistent formatting
      const { jsPDF } = await import('jspdf');
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
      
      currentY = 70;
      
      // Account information table - exactly like PDFCommentExporter
      const tableData = [
        ['Konto:', `${account.account_number} – ${account.account_name}`],
        ['Dokument:', account.evidence_files?.[0]?.file_name || 'Kein Dokument'],
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
          const lines = pdf.splitTextToSize(comment, 160);
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
    } catch (error) {
      console.error('Error generating comment PDF:', error);
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage();
      return await pdfDoc.save();
    }
  };

  const combinePDFs = async (commentPdf: Uint8Array, annotatedPdf: Uint8Array): Promise<Uint8Array> => {
    try {
      const finalDoc = await PDFDocument.create();
      
      // Add comment pages first
      const commentDoc = await PDFDocument.load(commentPdf);
      const commentPages = await finalDoc.copyPages(commentDoc, commentDoc.getPageIndices());
      commentPages.forEach(page => finalDoc.addPage(page));
      
      // Add annotated PDF pages
      const annotatedDoc = await PDFDocument.load(annotatedPdf);
      const annotatedPages = await finalDoc.copyPages(annotatedDoc, annotatedDoc.getPageIndices());
      annotatedPages.forEach(page => finalDoc.addPage(page));
      
      return await finalDoc.save();
    } catch (error) {
      console.error('Error combining PDFs:', error);
      return annotatedPdf;
    }
  };

  const downloadCompletePackage = async () => {
    try {
      setDownloading(true);
      const zip = new JSZip();

      // First sort all accounts by account number (descending), regardless of letter
      const sortedAccounts = accounts.sort((a, b) => {
        const numA = parseInt(a.account_number, 10) || 0;
        const numB = parseInt(b.account_number, 10) || 0;
        return numB - numA; // descending order: higher numbers first
      });

      // Prefetch all comments for this TB and current user
      const { data: allComments } = await supabase
        .from('account_comments')
        .select('assignment_id, comment_text')
        .eq('trial_balance_id', trialBalanceId)
        .eq('user_id', user?.id || '');

      const commentsMap: Record<string, string[]> = {};
      (allComments || []).forEach((c: any) => {
        const key = c.assignment_id as string;
        if (!commentsMap[key]) commentsMap[key] = [];
        commentsMap[key].push(c.comment_text as string);
      });

      // Track counters per letter (reset for each letter)
      const letterCounters: { [key: string]: number } = {};

      let anyFilesAdded = false;

      for (const account of sortedAccounts) {
        // Normalize letter assignment
        const raw = account.assigned_letter?.trim().toUpperCase();
        const letter = raw && /^[A-Z]$/.test(raw) ? raw : 'UNASSIGNED';
        const prefix = letter === 'UNASSIGNED' ? 'X' : letter;
        
        // Initialize counter for this letter if not exists
        if (!letterCounters[letter]) {
          letterCounters[letter] = 1;
        }
        
        const comments = commentsMap[account.id] || [];
        const hasEvidence = (account.evidence_files?.length || 0) > 0;
        const hasComments = comments.length > 0;
        
        // Skip accounts with no comments and no evidence
        if (!hasComments && !hasEvidence) {
          continue;
        }

        // If only comments and no evidence -> export cover sheet alone
        if (hasComments && !hasEvidence) {
          const commentPdf = await generateCommentPDF(account, comments);
          const coverName = `${prefix}_${letterCounters[letter]}_Deckblatt_${account.account_number}.pdf`;
          zip.file(coverName, commentPdf);
          letterCounters[letter]++;
          anyFilesAdded = true;
        }

        // Process evidence files - merge multiple files for same account
        if (account.evidence_files && account.evidence_files.length > 0) {
          const pdfFiles: Uint8Array[] = [];
          const nonPdfFiles: { name: string; data: Blob }[] = [];
          
          // Collect all files for this account
          for (const evidenceFile of account.evidence_files) {
            try {
              // Download original file
              const { data: fileData } = await supabase.storage
                .from('account-evidence')
                .download(evidenceFile.file_path);

              if (fileData) {
                const fileBuffer = await fileData.arrayBuffer();
                const ext = evidenceFile.file_name.split('.').pop()?.toLowerCase();

                if (ext === 'pdf') {
                  const originalPdf = new Uint8Array(fileBuffer);
                  // Load annotations and embed them
                  const annotations = await loadPDFAnnotations(evidenceFile.id);
                  const annotatedPdf = await embedAnnotationsInPDF(originalPdf, annotations);
                  pdfFiles.push(annotatedPdf);
                } else {
                  // Store non-PDF files separately
                  nonPdfFiles.push({
                    name: evidenceFile.file_name,
                    data: fileData
                  });
                }
              }
            } catch (error) {
              console.error(`Error processing file ${evidenceFile.file_name}:`, error);
              toast.error(`Fehler beim Verarbeiten von ${evidenceFile.file_name}`);
            }
          }

          // Create merged PDF if we have PDF files
          if (pdfFiles.length > 0) {
            try {
              let finalPdf: Uint8Array;
              
              if (pdfFiles.length === 1 && hasComments) {
                // Single PDF with comments
                const commentPdf = await generateCommentPDF(account, comments);
                finalPdf = await combinePDFs(commentPdf, pdfFiles[0]);
              } else if (pdfFiles.length === 1) {
                // Single PDF without comments
                finalPdf = pdfFiles[0];
              } else {
                // Multiple PDFs - merge them all
                const mergedDoc = await PDFDocument.create();
                
                // Add comment page first if we have comments
                if (hasComments) {
                  const commentPdf = await generateCommentPDF(account, comments);
                  const commentDoc = await PDFDocument.load(commentPdf);
                  const commentPages = await mergedDoc.copyPages(commentDoc, commentDoc.getPageIndices());
                  commentPages.forEach(page => mergedDoc.addPage(page));
                }
                
                // Add all PDF files
                for (const pdfData of pdfFiles) {
                  const pdfDoc = await PDFDocument.load(pdfData);
                  const pages = await mergedDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
                  pages.forEach(page => mergedDoc.addPage(page));
                }
                
                finalPdf = await mergedDoc.save();
              }
              
              const mergedFileName = `${prefix}_${letterCounters[letter]}_Nachweis_${account.account_number}.pdf`;
              zip.file(mergedFileName, finalPdf);
              letterCounters[letter]++;
              anyFilesAdded = true;
            } catch (error) {
              console.error('Error merging PDFs:', error);
              toast.error(`Fehler beim Zusammenführen der PDFs für Konto ${account.account_number}`);
            }
          }
          
          // Add non-PDF files separately
          for (const nonPdfFile of nonPdfFiles) {
            const fileName = `${prefix}_${letterCounters[letter]}_${nonPdfFile.name}`;
            zip.file(fileName, nonPdfFile.data);
            letterCounters[letter]++;
            anyFilesAdded = true;
          }
        }
      }

      if (!anyFilesAdded) {
        toast.error('Keine Dateien zum Download');
        return;
      }
      // Generate and download ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const fileName = `Prüfungsunterlagen_${new Date().toISOString().split('T')[0]}.zip`;
      saveAs(zipBlob, fileName);
      toast.success('Komplettdownload erfolgreich erstellt');
    } catch (error) {
      console.error('Error creating complete download:', error);
      toast.error('Fehler beim Erstellen des Komplettdownloads');
    } finally {
      setDownloading(false);
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'matched':
        return <Badge variant="default" className="bg-green-100 text-green-800">Zugeordnet</Badge>;
      case 'unmatched':
        return <Badge variant="destructive">Keine Zuordnung</Badge>;
      default:
        return <Badge variant="secondary">Ausstehend</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Lade Kontendaten...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Komplettdownload Konfiguration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Weisen Sie Buchstaben zu Konten zu und erstellen Sie einen strukturierten Download aller Deckblätter und Nachweise.
            </p>
            
            {/* Quick assign tool */}
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium">Von Konto:</label>
                <Input 
                  id="fromAccount" 
                  placeholder="z.B. 1000" 
                  className="mt-1"
                />
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium">Bis Konto:</label>
                <Input 
                  id="toAccount" 
                  placeholder="z.B. 1090" 
                  className="mt-1"
                />
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium">Buchstabe:</label>
                <Input 
                  id="rangeLetter" 
                  placeholder="B" 
                  maxLength={1}
                  className="mt-1"
                />
              </div>
              <Button 
                onClick={() => {
                  const fromAccount = (document.getElementById('fromAccount') as HTMLInputElement)?.value;
                  const toAccount = (document.getElementById('toAccount') as HTMLInputElement)?.value;
                  const letter = (document.getElementById('rangeLetter') as HTMLInputElement)?.value;
                  
                  if (fromAccount && toAccount && letter) {
                    applyLetterToRange(fromAccount, toAccount, letter);
                  }
                }}
                variant="outline"
              >
                Bereich zuweisen
              </Button>
            </div>

            <Button 
              onClick={downloadCompletePackage}
              disabled={downloading}
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              {downloading ? 'Erstelle Download...' : 'Komplettdownload starten'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Kontenübersicht</CardTitle>
            {selectedAccounts.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedAccounts.size} ausgewählt
                </span>
                <div className="flex items-center gap-1">
                  {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(letter => (
                    <Button
                      key={letter}
                      size="sm"
                      variant="outline"
                      className="h-6 w-6 p-0"
                      onClick={() => assignLetterToSelected(letter)}
                    >
                      {letter}
                    </Button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearSelection}
                  className="h-6 w-6 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
          {selectedAccounts.size > 0 && (
            <p className="text-sm text-muted-foreground">
              STRG+Klick für Mehrfachauswahl. Klicken Sie auf einen Buchstaben, um ihn den ausgewählten Konten zuzuweisen.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="bilanz" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="bilanz">Bilanz</TabsTrigger>
              <TabsTrigger value="erfolgsrechnung">Erfolgsrechnung</TabsTrigger>
            </TabsList>
            
            <TabsContent value="bilanz" className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Konto</TableHead>
                    <TableHead>Bezeichnung</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Nachweise</TableHead>
                    <TableHead>Buchstabe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                   {balanceSheetAccounts.map((account) => (
                     <TableRow 
                       key={account.id} 
                       className={`h-6 cursor-pointer transition-colors ${
                         selectedAccounts.has(account.id) 
                           ? 'bg-primary/10 border-primary/30' 
                           : 'hover:bg-muted/50'
                       }`}
                       onClick={(e) => handleRowClick(account.id, e)}
                     >
                       <TableCell className="font-mono py-1">{account.account_number}</TableCell>
                       <TableCell className="py-1">{account.account_name}</TableCell>
                       <TableCell className="text-right py-1">
                          {account.current_year_balance.toLocaleString('de-DE', { 
                            style: 'currency', 
                            currency: 'CHF' 
                          })}
                       </TableCell>
                       <TableCell className="py-1">{getStatusBadge(account.match_status)}</TableCell>
                       <TableCell className="py-1">
                         <div className="space-y-1">
                           {account.evidence_files?.map((file, index) => (
                             <div key={file.id} className="flex items-center gap-1 text-xs">
                               <FileText className="h-3 w-3" />
                               <span className="truncate max-w-[200px]" title={file.file_name}>
                                 {file.file_name}
                               </span>
                             </div>
                           ))}
                           {(!account.evidence_files || account.evidence_files.length === 0) && (
                             <span className="text-muted-foreground text-xs">Keine Nachweise</span>
                           )}
                         </div>
                       </TableCell>
                       <TableCell className="py-1">
                         <Input
                           value={account.assigned_letter || ''}
                           onChange={(e) => updateAccountLetter(account.id, e.target.value)}
                           placeholder="A-Z"
                           maxLength={1}
                           className="w-12 text-center h-6"
                         />
                       </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="erfolgsrechnung" className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Konto</TableHead>
                    <TableHead>Bezeichnung</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Nachweise</TableHead>
                    <TableHead>Buchstabe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                   {incomeStatementAccounts.map((account) => (
                     <TableRow 
                       key={account.id} 
                       className={`h-6 cursor-pointer transition-colors ${
                         selectedAccounts.has(account.id) 
                           ? 'bg-primary/10 border-primary/30' 
                           : 'hover:bg-muted/50'
                       }`}
                       onClick={(e) => handleRowClick(account.id, e)}
                     >
                       <TableCell className="font-mono py-1">{account.account_number}</TableCell>
                       <TableCell className="py-1">{account.account_name}</TableCell>
                       <TableCell className="text-right py-1">
                          {account.current_year_balance.toLocaleString('de-DE', { 
                            style: 'currency', 
                            currency: 'CHF' 
                          })}
                       </TableCell>
                       <TableCell className="py-1">{getStatusBadge(account.match_status)}</TableCell>
                       <TableCell className="py-1">
                         <div className="space-y-1">
                           {account.evidence_files?.map((file, index) => (
                             <div key={file.id} className="flex items-center gap-1 text-xs">
                               <FileText className="h-3 w-3" />
                               <span className="truncate max-w-[200px]" title={file.file_name}>
                                 {file.file_name}
                               </span>
                             </div>
                           ))}
                           {(!account.evidence_files || account.evidence_files.length === 0) && (
                             <span className="text-muted-foreground text-xs">Keine Nachweise</span>
                           )}
                         </div>
                       </TableCell>
                       <TableCell className="py-1">
                         <Input
                           value={account.assigned_letter || ''}
                           onChange={(e) => updateAccountLetter(account.id, e.target.value)}
                           placeholder="A-Z"
                           maxLength={1}
                           className="w-12 text-center h-6"
                         />
                       </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default CompleteDownloadManager;