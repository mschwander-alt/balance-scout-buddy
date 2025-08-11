import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, ArrowLeft, ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, FileText, Eye, PanelLeft, PanelLeftClose, Link, Send, Sparkles, Loader2, Upload } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DocumentViewer } from '@/components/DocumentViewer';
import { SimplePDFViewer } from '@/components/SimplePDFViewer';
import { ExcelViewer } from '@/components/ExcelViewer';
import { PDFCommentExporter } from '@/components/PDFCommentExporter';
import * as XLSX from 'xlsx';

interface Assignment {
  id: string;
  account_group_id: string;
  account_number: string;
  account_name: string;
  current_year_balance: number;
  previous_year_balance: number;
  match_status?: 'pending' | 'matched' | 'unmatched';
  confidence_score?: number;
  matched_documents?: string[];
}

interface AccountGroup {
  id: string;
  trial_balance_id: string;
  name: string;
  description?: string;
  assigned_member_id?: string;
  assignments: Assignment[];
  isOpen: boolean;
}

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

interface TrialBalanceData {
  id: string;
  filename: string;
  file_path: string;
  account_number_column?: string;
  account_name_column?: string;
  current_year_column?: string;
  previous_year_column?: string;
  foreign_currency_column?: string;
}

interface TrialBalanceRow {
  accountNumber: string;
  accountName: string;
  currentYear: number;
  previousYear: number;
  foreignCurrency?: number;
}

const Review: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const trialBalanceId = searchParams.get('trial_balance_id');
  const { user, signOut } = useAuth();

  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [teamMembers, setTeamMembers] = useState<{[key: string]: {name: string, email: string}}>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [unmatchedDocuments, setUnmatchedDocuments] = useState<Document[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showManualAssignModal, setShowManualAssignModal] = useState(false);
  const [selectedDocumentForAssign, setSelectedDocumentForAssign] = useState<string | null>(null);
  const [assignmentForDoc, setAssignmentForDoc] = useState<string>('');
  const [documentPreviews, setDocumentPreviews] = useState<{[accountId: string]: string}>({});
  const [previewLoading, setPreviewLoading] = useState(false);
const [accountComments, setAccountComments] = useState<{[key: string]: string}>({});
  const [loadedComments, setLoadedComments] = useState<{[key: string]: boolean}>({});
  const [completedAccounts, setCompletedAccounts] = useState<Set<string>>(new Set());
  const completedAccountsRef = useRef<Set<string>>(new Set());
  const [showMultiAssignModal, setShowMultiAssignModal] = useState(false);
  const [selectedDocumentForMultiAssign, setSelectedDocumentForMultiAssign] = useState<Document | null>(null);
  const [selectedAccountsForAssign, setSelectedAccountsForAssign] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [documentToReassign, setDocumentToReassign] = useState<Document | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const getUnmatchedDocuments = useCallback(() => {
    const matchedDocumentIds = new Set();
    assignments.forEach(assignment => {
      if (assignment.matched_documents) {
        assignment.matched_documents.forEach(docId => {
          matchedDocumentIds.add(docId);
        });
      }
    });
    return documents.filter(doc => !matchedDocumentIds.has(doc.id));
  }, [documents, assignments]);

  const loadData = useCallback(async () => {
    if (!trialBalanceId || !user) return;
    
    // Only preserve completion status during reload if it was not called after an upload
    // Check if we're in an upload context by checking if there are any pending document assignments
    const currentCompletedAccounts = new Set(completedAccountsRef.current);
    
    try {
      // Lade Account Groups mit Assignments
      const { data: groupsData, error: groupsError } = await supabase
        .from('account_groups')
        .select(`
          *,
          assignments:account_group_assignments(*)
        `)
        .eq('trial_balance_id', trialBalanceId);

      if (groupsError) throw groupsError;

      // Lade Dokumente
      const { data: documentsResponse, error: documentsError } = await supabase
        .from('account_evidence')
        .select('*')
        .eq('trial_balance_id', trialBalanceId);

      if (documentsError) throw documentsError;

      // Lade Team Members
      const { data: teamMembersData, error: teamMembersError } = await supabase
        .from('team_members')
        .select('*')
        .eq('user_id', user.id);

      if (teamMembersError) throw teamMembersError;

      // Lade gespeicherte Kommentare
      const { data: commentsData, error: commentsError } = await supabase
        .from('account_comments')
        .select('*')
        .eq('trial_balance_id', trialBalanceId)
        .eq('user_id', user.id);

      if (commentsError) throw commentsError;

      // Erstelle Kommentar-Mapping
      const commentMap: {[key: string]: string} = {};
      const loadedMap: {[key: string]: boolean} = {};
      
      commentsData?.forEach(comment => {
        commentMap[comment.assignment_id] = comment.comment_text;
        loadedMap[comment.assignment_id] = true;
      });

      // Erstelle Team Member Mapping
      const teamMemberMap: {[key: string]: {name: string, email: string}} = {};
      teamMembersData?.forEach(member => {
        teamMemberMap[member.id] = {
          name: member.name,
          email: member.email
        };
      });

      setDocuments(documentsResponse || []);
      setTeamMembers(teamMemberMap);
      
      if (groupsData && groupsData.length > 0) {
        // Groups exist - use existing logic
        // Sortiere Account Groups nach created_at (Reihenfolge der Gruppierung)
        const sortedGroups = groupsData
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .map(group => ({
            ...group,
            // Sortiere Assignments innerhalb der Gruppe nach Kontonummer aufsteigend
            assignments: group.assignments
              .map(assignment => ({
                ...assignment,
                match_status: (assignment.match_status || 'pending') as 'pending' | 'matched' | 'unmatched',
                confidence_score: assignment.confidence_score || undefined,
                matched_documents: assignment.matched_documents || undefined
              }))
              .sort((a, b) => {
                // Sortiere nach Kontonummer (numerisch wenn möglich, sonst alphabetisch)
                const aNum = parseInt(a.account_number);
                const bNum = parseInt(b.account_number);
                if (!isNaN(aNum) && !isNaN(bNum)) {
                  return aNum - bNum;
                }
                return a.account_number.localeCompare(b.account_number);
              }),
            isOpen: false
          }));
        
        setAccountGroups(sortedGroups);
        // Nur setze assignments für Gruppen, nicht als separates Array
        setAssignments([]);
      } else {
        // No groups exist - load from temp_account_matches or create from trial balance
        await loadTemporaryMatches();
      }
      
      setAccountComments(commentMap);
      setLoadedComments(loadedMap);
      
      // Don't restore completion status after upload - let it be based only on user clicks
      // setCompletedAccounts(currentCompletedAccounts);
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast.error('Fehler beim Laden der Daten');
    }
  }, [trialBalanceId, user]);

  const loadTemporaryMatches = async () => {
    try {
      // First try to load existing temp matches
      const { data: tempMatches, error: tempError } = await supabase
        .from('temp_account_matches')
        .select('*')
        .eq('trial_balance_id', trialBalanceId!);

      if (tempError) throw tempError;

      if (tempMatches && tempMatches.length > 0) {
        // Use existing temp matches
        const tempAssignments: Assignment[] = tempMatches.map(match => ({
          id: match.id,
          account_group_id: 'no-group',
          account_number: match.account_number,
          account_name: match.account_name,
          current_year_balance: match.current_year_balance || 0,
          previous_year_balance: match.previous_year_balance || 0,
          match_status: (match.match_status || 'pending') as 'pending' | 'matched' | 'unmatched',
          confidence_score: match.confidence_score || undefined,
          matched_documents: match.matched_documents || undefined
        })).sort((a, b) => {
          // Sortiere nach Kontonummer numerisch aufsteigend
          const aNum = parseInt(a.account_number);
          const bNum = parseInt(b.account_number);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return aNum - bNum;
          }
          return a.account_number.localeCompare(b.account_number);
        });

        const virtualGroup: AccountGroup = {
          id: 'no-group',
          trial_balance_id: trialBalanceId!,
          name: 'Alle Konten',
          description: 'Ungroupierte Saldobilanz',
          assignments: tempAssignments,
          isOpen: true
        };

        setAccountGroups([virtualGroup]);
        // Nur setze assignments für ungrouped, nicht zusätzlich
        setAssignments([]);
      } else {
        // No temp matches exist, create them using unified auto-match
        console.log('No temp matches found, creating them...');
        
        const { data: matchResult, error: matchError } = await supabase.functions.invoke('unified-auto-match', {
          body: { trial_balance_id: trialBalanceId }
        });

        if (matchError) {
          console.error('Error creating temp matches:', matchError);
          // Fallback to direct trial balance loading
          await loadTrialBalanceDirectly();
          return;
        }

        // Reload temp matches after creation
        const { data: newTempMatches, error: newTempError } = await supabase
          .from('temp_account_matches')
          .select('*')
          .eq('trial_balance_id', trialBalanceId!);

        if (newTempError) {
          console.error('Error loading new temp matches:', newTempError);
          await loadTrialBalanceDirectly();
          return;
        }

        if (newTempMatches && newTempMatches.length > 0) {
          // Use newly created temp matches
          const tempAssignments: Assignment[] = newTempMatches.map(match => ({
            id: match.id,
            account_group_id: 'no-group',
            account_number: match.account_number,
            account_name: match.account_name,
            current_year_balance: match.current_year_balance || 0,
            previous_year_balance: match.previous_year_balance || 0,
            match_status: (match.match_status || 'pending') as 'pending' | 'matched' | 'unmatched',
            confidence_score: match.confidence_score || undefined,
            matched_documents: match.matched_documents || undefined
          })).sort((a, b) => {
            // Sortiere nach Kontonummer numerisch aufsteigend
            const aNum = parseInt(a.account_number);
            const bNum = parseInt(b.account_number);
            if (!isNaN(aNum) && !isNaN(bNum)) {
              return aNum - bNum;
            }
            return a.account_number.localeCompare(b.account_number);
          });

          const virtualGroup: AccountGroup = {
            id: 'no-group',
            trial_balance_id: trialBalanceId!,
            name: 'Alle Konten',
            description: 'Ungroupierte Saldobilanz',
            assignments: tempAssignments,
            isOpen: true
          };

          setAccountGroups([virtualGroup]);
          // Nur setze assignments für ungrouped, nicht zusätzlich
          setAssignments([]);
        } else {
          // Final fallback to direct trial balance loading
          await loadTrialBalanceDirectly();
        }
      }
    } catch (error) {
      console.error('Error loading temporary matches:', error);
      // Fallback to direct trial balance loading
      await loadTrialBalanceDirectly();
    }
  };

  const loadTrialBalanceDirectly = async () => {
    try {
      // Lade Trial Balance Metadaten
      const { data: trialBalanceData, error: tbError } = await supabase
        .from('trial_balances')
        .select('*')
        .eq('id', trialBalanceId)
        .single();

      if (tbError || !trialBalanceData) {
        console.error('Error loading trial balance:', tbError);
        return;
      }

      // Download and parse Excel file
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('trial-balances')
        .download(trialBalanceData.file_path);

      if (downloadError) {
        console.error('Error downloading file:', downloadError);
        return;
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

      if (jsonData.length < 2) return;

      const headers = jsonData[0] as string[];
      const dataRows = jsonData.slice(1);

      // Find column indices
      const accountNumberIndex = headers.findIndex(h => h === trialBalanceData.account_number_column);
      const accountNameIndex = headers.findIndex(h => h === trialBalanceData.account_name_column);
      const currentYearIndex = headers.findIndex(h => h === trialBalanceData.current_year_column);
      const previousYearIndex = headers.findIndex(h => h === trialBalanceData.previous_year_column);

      const parsedData: TrialBalanceRow[] = dataRows
        .filter(row => row[accountNumberIndex] && row[accountNameIndex])
        .map(row => ({
          accountNumber: String(row[accountNumberIndex] || '').trim(),
          accountName: String(row[accountNameIndex] || '').trim(),
          currentYear: parseFloat(String(row[currentYearIndex] || 0)) || 0,
          previousYear: parseFloat(String(row[previousYearIndex] || 0)) || 0,
        }));

      // Create individual assignments from trial balance entries
      const individualAssignments: Assignment[] = parsedData.map(row => ({
        id: `tb-${row.accountNumber}`,
        account_group_id: 'no-group',
        account_number: row.accountNumber,
        account_name: row.accountName,
        current_year_balance: row.currentYear,
        previous_year_balance: row.previousYear,
        match_status: 'pending' as const,
        confidence_score: undefined,
        matched_documents: undefined
      })).sort((a, b) => {
        // Sortiere nach Kontonummer numerisch aufsteigend
        const aNum = parseInt(a.account_number);
        const bNum = parseInt(b.account_number);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return aNum - bNum;
        }
        return a.account_number.localeCompare(b.account_number);
      });

      // Create a virtual group for ungrouped accounts
      const virtualGroup: AccountGroup = {
        id: 'no-group',
        trial_balance_id: trialBalanceId!,
        name: 'Alle Konten',
        description: 'Ungroupierte Saldobilanz',
        assignments: individualAssignments,
        isOpen: true
      };

      setAccountGroups([virtualGroup]);
      // Nur setze assignments für ungrouped, nicht zusätzlich
      setAssignments([]);
    } catch (error) {
      console.error('Error loading trial balance directly:', error);
      toast.error('Fehler beim Laden der Saldobilanz');
    }
  };

  const previewDocument = async (document: Document, accountId?: string) => {
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from('account-evidence')
        .createSignedUrl(document.file_path, 3600);

      if (error) throw error;
      if (accountId) {
        setDocumentPreviews(prev => ({ ...prev, [accountId]: data.signedUrl }));
      }
      return data.signedUrl;
    } catch (error: any) {
      console.error('Error getting document preview:', error);
      toast.error('Fehler beim Laden der Dokumentvorschau');
      return '';
    } finally {
      setPreviewLoading(false);
    }
  };

  const startAutoMatch = async () => {
    if (!trialBalanceId) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      const { data, error } = await supabase.functions.invoke('unified-auto-match', {
        body: { trial_balance_id: trialBalanceId }
      });

      if (error) throw error;

      toast.success('Automatische Zuordnung abgeschlossen');
      await loadData();
    } catch (error: any) {
      console.error('Error during auto match:', error);
      toast.error('Fehler bei der automatischen Zuordnung');
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  };

  const handleAccountClick = (assignment: Assignment) => {
    setSelectedAccount(assignment.id);
  };

  const saveMatchResults = async (updatedAssignments: Assignment[]) => {
    try {
      for (const assignment of updatedAssignments) {
        const { error } = await supabase
          .from('account_group_assignments')
          .update({
            match_status: assignment.match_status,
            confidence_score: assignment.confidence_score,
            matched_documents: assignment.matched_documents
          })
          .eq('id', assignment.id);
        
        if (error) {
          console.error('Error updating assignment:', error);
          throw error;
        }
      }
    } catch (error) {
      console.error('Error saving match results:', error);
      throw error;
    }
  };

  const handleManualAssign = async (documentId: string, assignmentId: string) => {
    try {
      // Find assignment from all groups
      let assignment = null;
      for (const group of accountGroups) {
        const found = group.assignments.find(a => a.id === assignmentId);
        if (found) {
          assignment = found;
          break;
        }
      }
      
      const document = documents.find(d => d.id === documentId);
      
      if (!assignment || !document) {
        toast.error('Konto oder Dokument nicht gefunden');
        return;
      }

      // Bestimme die richtige Tabelle basierend auf der Gruppierung
      const isUsingGroups = accountGroups.length > 0 && accountGroups[0].id !== 'no-group';
      const tableName = isUsingGroups ? 'account_group_assignments' : 'temp_account_matches';

      // Update in der Datenbank
      const updatedMatchedDocuments = assignment.matched_documents 
        ? [...assignment.matched_documents, documentId]
        : [documentId];

      const { error } = await supabase
        .from(tableName)
        .update({
          match_status: 'matched',
          confidence_score: 1.0, // Manuelle Zuweisung = 100% Vertrauen
          matched_documents: updatedMatchedDocuments
        })
        .eq('id', assignmentId);

      if (error) {
        throw error;
      }

      // Update lokaler State für account groups
      setAccountGroups(prevGroups => 
        prevGroups.map(group => ({
          ...group,
          assignments: group.assignments.map(assignment => {
            if (assignment.id === assignmentId) {
              return {
                ...assignment,
                match_status: 'matched' as const,
                confidence_score: 1.0,
                matched_documents: updatedMatchedDocuments
              };
            }
            return assignment;
          })
        }))
      );

      toast.success('Dokument erfolgreich zugewiesen');
      setSelectedDocumentForAssign(null);
      setAssignmentForDoc('');
    } catch (error: any) {
      console.error('Error during manual assign:', error);
      toast.error('Manuelle Zuweisung fehlgeschlagen');
    }
  };

  // Funktion für Mehrfachzuweisung
  const handleMultiAssign = async () => {
    if (!selectedDocumentForMultiAssign || selectedAccountsForAssign.size === 0) return;

    try {
      // Bestimme die richtige Tabelle basierend auf der Gruppierung
      const isUsingGroups = accountGroups.length > 0 && accountGroups[0].id !== 'no-group';
      const tableName = isUsingGroups ? 'account_group_assignments' : 'temp_account_matches';

      for (const assignmentId of selectedAccountsForAssign) {
        // Find assignment from all groups
        let assignment = null;
        for (const group of accountGroups) {
          const found = group.assignments.find(a => a.id === assignmentId);
          if (found) {
            assignment = found;
            break;
          }
        }
        if (!assignment) continue;

        const updatedMatchedDocuments = assignment.matched_documents 
          ? [...assignment.matched_documents, selectedDocumentForMultiAssign.id]
          : [selectedDocumentForMultiAssign.id];

        await supabase
          .from(tableName)
          .update({
            match_status: 'matched',
            confidence_score: 1.0,
            matched_documents: updatedMatchedDocuments
          })
          .eq('id', assignmentId);
      }

      // Aktualisiere lokalen State
      await loadData();
      
      toast.success(`Nachweis erfolgreich zu ${selectedAccountsForAssign.size} Konten zugewiesen`);
      setSearchQuery('');
      setShowMultiAssignModal(false);
      setSelectedDocumentForMultiAssign(null);
      setSelectedAccountsForAssign(new Set());
    } catch (error: any) {
      console.error('Error during multi assign:', error);
      toast.error('Mehrfachzuweisung fehlgeschlagen');
    }
  };

  // Funktion zum Entfernen und Neu-Zuweisen von Dokumenten
  const handleReassignDocument = async () => {
    if (!documentToReassign || !selectedAccountData || selectedAccountsForAssign.size === 0) return;

    try {
      // Bestimme die richtige Tabelle basierend auf der Gruppierung
      const isUsingGroups = accountGroups.length > 0 && accountGroups[0].id !== 'no-group';
      const tableName = isUsingGroups ? 'account_group_assignments' : 'temp_account_matches';

      // Entferne von aktuellem Konto
      const updatedMatchedDocuments = selectedAccountData.matched_documents?.filter(
        docId => docId !== documentToReassign.id
      ) || [];

      await supabase
        .from(tableName)
        .update({
          matched_documents: updatedMatchedDocuments.length > 0 ? updatedMatchedDocuments : null,
          match_status: updatedMatchedDocuments.length > 0 ? 'matched' : 'pending'
        })
        .eq('id', selectedAccountData.id);

      // Weise neuen Konten zu
      for (const assignmentId of selectedAccountsForAssign) {
        // Find assignment from all groups
        let assignment = null;
        for (const group of accountGroups) {
          const found = group.assignments.find(a => a.id === assignmentId);
          if (found) {
            assignment = found;
            break;
          }
        }
        if (!assignment) continue;

        const updatedMatchedDocuments = assignment.matched_documents 
          ? [...assignment.matched_documents, documentToReassign.id]
          : [documentToReassign.id];

        await supabase
          .from(tableName)
          .update({
            match_status: 'matched',
            confidence_score: 1.0,
            matched_documents: updatedMatchedDocuments
          })
          .eq('id', assignmentId);
      }

      // Aktualisiere lokalen State
      await loadData();
      
      toast.success(`Nachweis erfolgreich zu ${selectedAccountsForAssign.size} Konto${selectedAccountsForAssign.size > 1 ? 'en' : ''} verschoben`);
      setSearchQuery('');
      setShowReassignModal(false);
      setDocumentToReassign(null);
      setSelectedAccountsForAssign(new Set());
    } catch (error: any) {
      console.error('Error during reassign:', error);
      toast.error('Verschiebung fehlgeschlagen');
    }
  };

  // Funktion zum Speichern von Kommentaren
  const saveComment = async (assignmentId: string, commentText: string) => {
    if (!user || !trialBalanceId) return;

    try {
      // Prüfe ob bereits ein Kommentar existiert
      const { data: existingComment } = await supabase
        .from('account_comments')
        .select('id')
        .eq('assignment_id', assignmentId)
        .eq('user_id', user.id)
        .single();

      if (existingComment) {
        // Update bestehenden Kommentar
        const { error } = await supabase
          .from('account_comments')
          .update({ comment_text: commentText })
          .eq('id', existingComment.id);
        
        if (error) throw error;
      } else {
        // Erstelle neuen Kommentar
        const { error } = await supabase
          .from('account_comments')
          .insert({
            user_id: user.id,
            trial_balance_id: trialBalanceId,
            assignment_id: assignmentId,
            comment_text: commentText
          });
        
        if (error) throw error;
      }

      // Markiere als geladen
      setLoadedComments(prev => ({
        ...prev,
        [assignmentId]: true
      }));

    } catch (error: any) {
      console.error('Error saving comment:', error);
      toast.error('Fehler beim Speichern des Kommentars');
    }
  };

  // Debounce utility function
  const debounce = (func: Function, delay: number) => {
    let timeoutId: NodeJS.Timeout;
    return (...args: any[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(null, args), delay);
    };
  };

  // Debounced comment save
  const debouncedSaveComment = useCallback(
    debounce((assignmentId: string, commentText: string) => {
      if (commentText.trim()) {
        saveComment(assignmentId, commentText);
      }
    }, 1000),
    [user, trialBalanceId]
  );

  const handleCommentChange = (assignmentId: string, value: string) => {
    setAccountComments(prev => ({
      ...prev,
      [assignmentId]: value
    }));
    
    // Auto-save nach 1 Sekunde
    debouncedSaveComment(assignmentId, value);
  };

  // Upload function for documents
  const handleDocumentUpload = async (file: File, accountId: string) => {
    if (!user || !trialBalanceId) return;

    setIsUploading(true);
    try {
      console.log('Starting upload for account:', accountId);
      
      // Erstelle eindeutigen Dateinamen
      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const filePath = `${user.id}/${fileName}`;

      // Upload zu Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('account-evidence')
        .upload(filePath, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }

      console.log('File uploaded successfully:', uploadData);

      // Erstelle Database-Eintrag
      const { data: docData, error: docError } = await supabase
        .from('account_evidence')
        .insert({
          trial_balance_id: trialBalanceId,
          user_id: user.id,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: file.type
        })
        .select()
        .single();

      if (docError) {
        console.error('Database insert error:', docError);
        throw docError;
      }

      console.log('Document record created:', docData);

      // Lade direkt die Vorschau für das neue Dokument
      const { data: signedUrlData, error: urlError } = await supabase.storage
        .from('account-evidence')
        .createSignedUrl(filePath, 3600);

      if (urlError) {
        console.error('Signed URL error:', urlError);
      } else if (signedUrlData) {
        console.log('Setting document preview for account:', accountId, signedUrlData.signedUrl);
        setDocumentPreviews(prev => ({ ...prev, [accountId]: signedUrlData.signedUrl }));
      }

      // Weise das Dokument automatisch dem Konto zu
      try {
        await handleManualAssign(docData.id, accountId);
        console.log('Document assigned successfully to account:', accountId);
        
        // Update the assignment's match_status to 'matched' after successful upload
        setAssignments(prevAssignments => 
          prevAssignments.map(assignment => 
            assignment.id === accountId 
              ? { ...assignment, match_status: 'matched' }
              : assignment
          )
        );
        
        // Force a fresh data reload after assignment to update status indicators
        setTimeout(async () => {
          await loadData();
        }, 100);
        
      } catch (assignError) {
        console.error('Assignment error:', assignError);
        // Fahre trotzdem fort - das Dokument ist hochgeladen
        // Even if assignment fails, reload data to show the uploaded document
        setTimeout(async () => {
          await loadData();
        }, 100);
      }
      
      toast.success('Dokument erfolgreich hochgeladen und zugewiesen');
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error('Fehler beim Hochladen: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleMarkCompleted = (assignmentId: string) => {
    const isCurrentlyCompleted = completedAccounts.has(assignmentId);
    
    setCompletedAccounts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(assignmentId)) {
        newSet.delete(assignmentId);
      } else {
        newSet.add(assignmentId);
        
        // Add completion text to comment when marking as complete
        if (user) {
          const currentComment = accountComments[assignmentId] || "";
          const userInitials = user.email?.split('@')[0].substring(0, 2).toUpperCase() || "XX";
          const currentDate = new Date().toLocaleDateString('de-DE');
          const completionText = `completed by ${userInitials}, ${currentDate}`;
          
          // Only add if not already present
          if (!currentComment.includes(completionText)) {
            const newComment = currentComment.trim() 
              ? `${currentComment}\n\n${completionText}`
              : completionText;
            
            setAccountComments(prev => ({
              ...prev,
              [assignmentId]: newComment
            }));
            
            // Save the updated comment
            debouncedSaveComment(assignmentId, newComment);
          }
        }
        
        // Mark all manually assigned accounts as completed too
        const selectedAssignment = assignments.find(a => a.id === assignmentId);
        if (selectedAssignment?.matched_documents) {
          // Find all assignments that share the same documents
          const documentsUsedByThisAssignment = selectedAssignment.matched_documents;
          documentsUsedByThisAssignment.forEach(docId => {
            assignments.forEach(assignment => {
              if (assignment.matched_documents?.includes(docId) && assignment.id !== assignmentId) {
                newSet.add(assignment.id);
              }
            });
          });
        }
      }
      // Don't update ref automatically - only when user explicitly clicks
      // completedAccountsRef.current = newSet;
      return newSet;
    });
    toast.success(isCurrentlyCompleted ? 'Als unvollständig markiert' : 'Als vollständig markiert');
  };

  const toggleGroup = (groupId: string) => {
    setAccountGroups(prevGroups =>
      prevGroups.map(group =>
        group.id === groupId ? { ...group, isOpen: !group.isOpen } : group
      )
    );
  };

  const getMatchStatusIcon = (status: string) => {
    switch (status) {
      case 'matched':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'unmatched':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getMatchStatusText = (status: string) => {
    switch (status) {
      case 'matched':
        return 'Gefunden';
      case 'unmatched':
        return 'Nicht gefunden';
      default:
        return 'Ausstehend';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-CH', {
      style: 'currency',
      currency: 'CHF'
    }).format(amount);
  };

  const calculateGroupSum = (group: AccountGroup) => {
    return group.assignments.reduce((sum, assignment) => sum + assignment.current_year_balance, 0);
  };

  const getInitialsFromEmail = (email: string) => {
    // Extrahiere den Teil vor dem @ und teile bei Punkt oder Unterstrich
    const namePart = email.split('@')[0];
    const nameParts = namePart.split(/[._]/);
    
    if (nameParts.length >= 2) {
      return (nameParts[0][0] + nameParts[1][0]).toUpperCase();
    } else if (nameParts.length === 1 && nameParts[0].length >= 2) {
      return nameParts[0].substring(0, 2).toUpperCase();
    }
    return 'N/A';
  };

  const getTeamMemberInitials = (memberId?: string) => {
    if (!memberId || !teamMembers[memberId]) return null;
    return getInitialsFromEmail(teamMembers[memberId].email);
  };

  // Funktion zur Kategorisierung der Account Groups
  const categorizeAccountGroups = (groups: AccountGroup[]) => {
    const bilanzGroups: AccountGroup[] = [];
    const erfolgsrechnungGroups: AccountGroup[] = [];

    groups.forEach(group => {
      const hasBalanceSheetAccounts = group.assignments.some(assignment => {
        const accountNumber = parseInt(assignment.account_number);
        return accountNumber >= 1000 && accountNumber <= 2999;
      });

      const hasProfitLossAccounts = group.assignments.some(assignment => {
        const accountNumber = parseInt(assignment.account_number);
        return accountNumber >= 3000 && accountNumber <= 9999;
      });

      if (hasBalanceSheetAccounts && hasProfitLossAccounts) {
        // Gemischte Gruppe: aufteilen
        const balanceSheetAssignments = group.assignments.filter(assignment => {
          const accountNumber = parseInt(assignment.account_number);
          return accountNumber >= 1000 && accountNumber <= 2999;
        });

        const profitLossAssignments = group.assignments.filter(assignment => {
          const accountNumber = parseInt(assignment.account_number);
          return accountNumber >= 3000 && accountNumber <= 9999;
        });

        if (balanceSheetAssignments.length > 0) {
          bilanzGroups.push({
            ...group,
            assignments: balanceSheetAssignments
          });
        }

        if (profitLossAssignments.length > 0) {
          erfolgsrechnungGroups.push({
            ...group,
            id: `${group.id}-erf`,
            assignments: profitLossAssignments
          });
        }
      } else if (hasBalanceSheetAccounts) {
        bilanzGroups.push(group);
      } else if (hasProfitLossAccounts) {
        erfolgsrechnungGroups.push(group);
      } else {
        // Fallback: Gruppen ohne Konten in Bilanz
        bilanzGroups.push(group);
      }
    });

    return { bilanzGroups, erfolgsrechnungGroups };
  };

  // Find selected account data from all groups
  const selectedAccountData = selectedAccount 
    ? accountGroups.flatMap(group => group.assignments).find(a => a.id === selectedAccount)
    : null;

  const selectedDocuments = selectedAccountData?.matched_documents
    ? documents.filter(doc => selectedAccountData.matched_documents?.includes(doc.id))
    : [];

  // Erweiterte KI-Analyse
  const startAdvancedAnalysis = async () => {
    setIsProcessing(true);
    setProgress(0);

    try {
      console.log('Starting advanced AI analysis...');
      
      const { data, error } = await supabase.functions.invoke('analyze-documents', {
        body: { trial_balance_id: trialBalanceId }
      });

      console.log('Analysis result:', data);
      console.log('Analysis error:', error);
      
      if (data?.success) {
        toast.success(
          `KI-Analyse abgeschlossen! ${data.auto_assigned || 0} Dokumente automatisch zugewiesen (${data.high_confidence_matches || 0} sichere Treffer von ${data.total_matches || 0} Matches gefunden)`
        );
        
        // Reload data to show updated matches
        await loadData();
      } else {
        toast.warning(`KI-Analyse abgeschlossen aber mit Problemen: ${data?.error || error?.message || 'Unbekannter Fehler'}`);
      }
    } catch (error: any) {
      console.error('Error during advanced analysis:', error);
      toast.error(`KI-Analyse fehlgeschlagen: ${error.message}`);
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card py-2">
        <div className="container mx-auto px-2 py-2 flex justify-between items-center">
          <h1 className="text-xl font-bold text-foreground">Audit Agent</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Willkommen, {user?.email}
            </span>
            <Button variant="outline" size="sm" onClick={signOut}>
              Abmelden
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-2 py-3 max-w-full overflow-hidden">
        <div className="space-y-4 max-w-full">
          <div className="flex items-center justify-between py-2">
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                Automatische Prüfung
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Abgleich der Kontosalden mit den hochgeladenen Nachweisen
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                onClick={startAutoMatch}
                disabled={isProcessing}
                size="sm"
                className="flex items-center gap-2"
              >
                <Search className="h-3 w-3" />
                {isProcessing ? 'Prüfung läuft...' : 'Prüfung starten'}
              </Button>
              
              <Button 
                onClick={startAdvancedAnalysis}
                disabled={isProcessing}
                size="sm"
                variant="outline"
                className="flex items-center gap-2"
              >
                <Sparkles className="h-3 w-3" />
                {isProcessing ? 'KI-Analyse läuft...' : 'KI-Analyse'}
              </Button>
              
              <Dialog open={showManualAssignModal} onOpenChange={setShowManualAssignModal}>
                <DialogTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setUnmatchedDocuments(getUnmatchedDocuments());
                      setShowManualAssignModal(true);
                    }}
                    className="flex items-center gap-2"
                  >
                    <FileText className="h-3 w-3" />
                    Nicht gematchte Dateien manuell zuweisen
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
                  <DialogHeader>
                    <DialogTitle>Manuelle Dokumentenzuweisung</DialogTitle>
                  </DialogHeader>
                  
                  <div className="flex-1 flex gap-6 min-h-0">
                    {getUnmatchedDocuments().length === 0 ? (
                      <div className="flex-1 flex items-center justify-center">
                        <p className="text-center text-muted-foreground">
                          Alle Dokumente wurden automatisch zugeordnet.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="w-1/2 flex flex-col gap-4 overflow-y-auto">
                          <p className="text-sm text-muted-foreground">
                            {getUnmatchedDocuments().length} Dokumente wurden noch nicht zugeordnet. 
                            Wählen Sie ein Dokument und das entsprechende Konto aus.
                          </p>
                          
                          <div className="space-y-3">
                            {getUnmatchedDocuments().map((document) => (
                              <div key={document.id} className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                                selectedDocumentForAssign === document.id ? 'border-primary bg-muted/50' : 'hover:bg-muted/30'
                              }`}
                              onClick={() => {
                                setSelectedDocumentForAssign(document.id);
                                previewDocument(document);
                              }}>
                                <div className="space-y-3">
                                  <div>
                                    <h4 className="font-medium">{document.file_name}</h4>
                                    <p className="text-sm text-muted-foreground">
                                      {document.file_type} • {Math.round(document.file_size / 1024)} KB
                                    </p>
                                  </div>
                                  
                                  <div className="flex items-center gap-2">
                                    <Select 
                                      value={selectedDocumentForAssign === document.id ? assignmentForDoc : ""}
                                      onValueChange={(value) => {
                                        setSelectedDocumentForAssign(document.id);
                                        setAssignmentForDoc(value);
                                      }}
                                    >
                                      <SelectTrigger className="flex-1">
                                        <SelectValue placeholder="Konto auswählen..." />
                                      </SelectTrigger>
                                       <SelectContent>
                                         {accountGroups
                                           .flatMap(group => group.assignments)
                                           .filter((assignment, index, self) => 
                                             index === self.findIndex(a => 
                                               a.account_number === assignment.account_number && 
                                               a.account_name === assignment.account_name
                                             )
                                           )
                                           .map((assignment) => (
                                             <SelectItem key={assignment.id} value={assignment.id}>
                                               {assignment.account_number} - {assignment.account_name}
                                             </SelectItem>
                                           ))}
                                       </SelectContent>
                                    </Select>
                                    
                                    <Button 
                                      size="sm"
                                      disabled={selectedDocumentForAssign !== document.id || !assignmentForDoc}
                                      onClick={() => handleManualAssign(document.id, assignmentForDoc)}
                                    >
                                      Zuweisen
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="w-1/2 border rounded-lg flex flex-col min-h-0">
                          <div className="p-3 border-b bg-muted/30">
                            <h5 className="font-medium">Dokumentvorschau</h5>
                          </div>
                          <div className="flex-1 min-h-0">
                            {selectedDocumentForAssign ? (
                              <DocumentViewer 
                                document={getUnmatchedDocuments().find(d => d.id === selectedDocumentForAssign)!}
                                onLoad={() => {}}
                                onError={(error) => console.error('Preview error:', error)}
                              />
                            ) : (
                              <div className="h-full flex items-center justify-center">
                                <div className="text-center">
                                  <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-60" />
                                   <p className="text-muted-foreground">
                                     Wählen Sie ein Dokument für die Vorschau aus
                                   </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
              
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => navigate(`/documents?trial_balance_id=${trialBalanceId}`)}
              >
                <ArrowLeft className="h-3 w-3 mr-2" />
                Zurück
              </Button>
            </div>
          </div>

          {isProcessing && (
            <div className="flex justify-center">
              <div className="max-w-md w-full">
                <Progress value={progress} className="w-full" />
              </div>
            </div>
          )}

          <div className="flex flex-col xl:flex-row gap-6 min-h-[calc(100vh-12rem)]">
            <Card className={`transition-all duration-300 flex-shrink-0 ${
              sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-full xl:w-1/2'
            }`}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Saldobilanz</CardTitle>
                    <CardDescription className="text-sm">
                      Klicken Sie auf ein Konto um die gefundenen Nachweise anzuzeigen
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="max-h-[calc(100vh-16rem)] overflow-y-auto py-3">
                <div className="space-y-4">
                  {accountGroups.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>Lade Saldobilanz...</p>
                    </div>
                  ) : (
                    <Tabs defaultValue="bilanz" className="w-full">
                      <TabsList className="grid w-full grid-cols-2 mb-4">
                        <TabsTrigger value="bilanz">BILANZ</TabsTrigger>
                        <TabsTrigger value="erfolgsrechnung">ERFOLGSRECHNUNG</TabsTrigger>
                      </TabsList>
                      
                      <TabsContent value="bilanz" className="space-y-2">
                        {categorizeAccountGroups(accountGroups).bilanzGroups.map((group) => (
                          <Collapsible key={group.id} open={group.isOpen} onOpenChange={() => toggleGroup(group.id)}>
                            <Card>
                              <CollapsibleTrigger asChild>
                                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      {group.isOpen ? 
                                        <ChevronDown className="h-4 w-4" /> : 
                                        <ChevronRight className="h-4 w-4" />
                                      }
                                       <div>
                                         <CardTitle className="text-left text-base">{group.name}</CardTitle>
                                       </div>
                                    </div>
                                     <div className="flex items-center gap-2">
                                       {getTeamMemberInitials(group.assigned_member_id) && (
                                         <Badge variant="default" className="bg-blue-500 text-white text-xs px-2 py-1">
                                           {getTeamMemberInitials(group.assigned_member_id)}
                                         </Badge>
                                       )}
                                       <Badge variant="outline">
                                         {formatCurrency(calculateGroupSum(group))}
                                       </Badge>
                                        <Badge variant={
                                          group.assignments.some(a => a.match_status === 'matched') 
                                            ? 'default' 
                                            : 'secondary'
                                        }>
                                          {group.assignments.filter(a => a.match_status === 'matched').length} gefunden
                                        </Badge>
                                     </div>
                                  </div>
                                </CardHeader>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <CardContent className="pt-0">
                                  <Table>
                                     <TableHeader>
                                       <TableRow>
                                         <TableHead>Konto</TableHead>
                                         <TableHead className="text-right">Saldo</TableHead>
                                         <TableHead className="text-center">Nachweise</TableHead>
                                         <TableHead className="text-center">Status</TableHead>
                                       </TableRow>
                                     </TableHeader>
                                    <TableBody>
                                      {group.assignments.map((assignment) => (
                                         <TableRow 
                                           key={assignment.id}
                                           className={`cursor-pointer hover:bg-muted/50 ${
                                             selectedAccount === assignment.id ? 'bg-muted' : ''
                                           }`}
                                           onClick={() => {
                                             setSelectedAccount(assignment.id);
                                             handleAccountClick(assignment);
                                           }}
                                         >
                                          <TableCell className="py-2">
                                            <div className="flex items-center gap-2">
                                              <span className="font-medium">{assignment.account_number}</span>
                                              <span className="text-sm text-muted-foreground">
                                                {assignment.account_name}
                                              </span>
                                            </div>
                                          </TableCell>
                                           <TableCell className="text-right py-2">
                                             {formatCurrency(assignment.current_year_balance)}
                                           </TableCell>
                                            <TableCell className="text-center py-2">
                                              <div className="flex items-center justify-center">
                                                {getMatchStatusIcon(assignment.match_status || 'pending')}
                                                {assignment.match_status === 'matched' && assignment.confidence_score === 0.8 && (
                                                  <span className="text-xs text-muted-foreground ml-1">auto</span>
                                                )}
                                              </div>
                                            </TableCell>
                                            <TableCell className="text-center py-2">
                                              {completedAccounts.has(assignment.id) && (
                                                <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                                              )}
                                            </TableCell>
                                         </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </CardContent>
                              </CollapsibleContent>
                            </Card>
                          </Collapsible>
                        ))}
                      </TabsContent>
                      
                      <TabsContent value="erfolgsrechnung" className="space-y-2">
                        {categorizeAccountGroups(accountGroups).erfolgsrechnungGroups.map((group) => (
                          <Collapsible key={group.id} open={group.isOpen} onOpenChange={() => toggleGroup(group.id)}>
                            <Card>
                              <CollapsibleTrigger asChild>
                                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      {group.isOpen ? 
                                        <ChevronDown className="h-4 w-4" /> : 
                                        <ChevronRight className="h-4 w-4" />
                                      }
                                       <div>
                                         <CardTitle className="text-left text-base">{group.name}</CardTitle>
                                       </div>
                                    </div>
                                     <div className="flex items-center gap-2">
                                       {getTeamMemberInitials(group.assigned_member_id) && (
                                         <Badge variant="default" className="bg-blue-500 text-white text-xs px-2 py-1">
                                           {getTeamMemberInitials(group.assigned_member_id)}
                                         </Badge>
                                       )}
                                       <Badge variant="outline">
                                         {formatCurrency(calculateGroupSum(group))}
                                       </Badge>
                                        <Badge variant={
                                          group.assignments.some(a => a.match_status === 'matched') 
                                            ? 'default' 
                                            : 'secondary'
                                        }>
                                          {group.assignments.filter(a => a.match_status === 'matched').length} gefunden
                                        </Badge>
                                     </div>
                                  </div>
                                </CardHeader>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <CardContent className="pt-0">
                                  <Table>
                                     <TableHeader>
                                       <TableRow>
                                         <TableHead>Konto</TableHead>
                                         <TableHead className="text-right">Saldo</TableHead>
                                         <TableHead className="text-center">Nachweise</TableHead>
                                         <TableHead className="text-center">Status</TableHead>
                                       </TableRow>
                                     </TableHeader>
                                    <TableBody>
                                      {group.assignments.map((assignment) => (
                                         <TableRow 
                                           key={assignment.id}
                                           className={`cursor-pointer hover:bg-muted/50 ${
                                             selectedAccount === assignment.id ? 'bg-muted' : ''
                                           }`}
                                           onClick={() => {
                                             setSelectedAccount(assignment.id);
                                             handleAccountClick(assignment);
                                           }}
                                         >
                                          <TableCell className="py-2">
                                            <div className="flex items-center gap-2">
                                              <span className="font-medium">{assignment.account_number}</span>
                                              <span className="text-sm text-muted-foreground">
                                                {assignment.account_name}
                                              </span>
                                            </div>
                                          </TableCell>
                                           <TableCell className="text-right py-2">
                                             {formatCurrency(assignment.current_year_balance)}
                                           </TableCell>
                                            <TableCell className="text-center py-2">
                                              <div className="flex items-center justify-center">
                                                {getMatchStatusIcon(assignment.match_status || 'pending')}
                                                {assignment.match_status === 'matched' && assignment.confidence_score === 0.8 && (
                                                  <span className="text-xs text-muted-foreground ml-1">auto</span>
                                                )}
                                              </div>
                                            </TableCell>
                                            <TableCell className="text-center py-2">
                                              {completedAccounts.has(assignment.id) && (
                                                <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                                              )}
                                            </TableCell>
                                         </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </CardContent>
                              </CollapsibleContent>
                            </Card>
                          </Collapsible>
                        ))}
                      </TabsContent>
                    </Tabs>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="flex-1 min-w-0 relative overflow-hidden">
              <CardHeader className="py-3 flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                      >
                        {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {sidebarCollapsed ? 'Saldobilanz anzeigen' : 'Saldobilanz ausblenden'}
                    </TooltipContent>
                  </Tooltip>
                  <div className="border-l border-border h-6"></div>
                   {selectedAccountData ? (
                     <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between w-full gap-3">
                       <div className="min-w-0 flex-shrink">
                         <CardTitle className="text-sm font-medium truncate">
                           {selectedAccountData.account_number} - {selectedAccountData.account_name}
                         </CardTitle>
                       </div>
                       
                       <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2 border overflow-hidden max-w-[600px] min-w-0">
                         {(() => {
                           const currentYearStr = formatCurrency(selectedAccountData.current_year_balance);
                           const previousYearStr = formatCurrency(selectedAccountData.previous_year_balance);
                           const deviationStr = formatCurrency(selectedAccountData.current_year_balance - selectedAccountData.previous_year_balance);
                           
                           // More aggressive text size scaling based on total character count
                           const totalLength = currentYearStr.length + previousYearStr.length + deviationStr.length;
                           const maxLength = Math.max(currentYearStr.length, previousYearStr.length, deviationStr.length);
                           
                           let textSizeClass = 'text-xs';
                           if (totalLength > 60 || maxLength > 16) {
                             textSizeClass = 'text-xs scale-75 origin-center';
                           } else if (totalLength > 45 || maxLength > 13) {
                             textSizeClass = 'text-xs scale-85 origin-center';
                           } else if (maxLength > 10) {
                             textSizeClass = 'text-xs';
                           } else {
                             textSizeClass = 'text-sm';
                           }
                           
                           return (
                             <>
                               <div className="text-center min-w-0 flex-1 px-1">
                                 <div className="text-xs text-muted-foreground mb-1 whitespace-nowrap">Lfd. Jahr</div>
                                 <div className={`font-medium ${textSizeClass} leading-tight whitespace-nowrap`} title={currentYearStr}>
                                   {currentYearStr}
                                 </div>
                               </div>
                               
                               <div className="text-center min-w-0 flex-1 px-1">
                                 <div className="text-xs text-muted-foreground mb-1 whitespace-nowrap">Vorjahr</div>
                                 <div className={`font-medium ${textSizeClass} leading-tight whitespace-nowrap`} title={previousYearStr}>
                                   {previousYearStr}
                                 </div>
                               </div>
                               
                               <div className="text-center min-w-0 flex-1 px-1">
                                 <div className="text-xs text-muted-foreground mb-1 whitespace-nowrap">Abwg.</div>
                                 <div className={`font-medium ${textSizeClass} leading-tight whitespace-nowrap`} title={deviationStr}>
                                   {deviationStr}
                                 </div>
                               </div>
                               
                               {selectedAccountData.previous_year_balance !== 0 && (
                                 <div className="text-center min-w-0 flex-1 px-1">
                                   <div className="text-xs text-muted-foreground mb-1 whitespace-nowrap">%</div>
                                   <div className={`font-medium ${textSizeClass} leading-tight whitespace-nowrap ${
                                     ((selectedAccountData.current_year_balance - selectedAccountData.previous_year_balance) / selectedAccountData.previous_year_balance * 100) >= 0 
                                       ? 'text-green-600' 
                                       : 'text-red-600'
                                   }`}>
                                     {((selectedAccountData.current_year_balance - selectedAccountData.previous_year_balance) / selectedAccountData.previous_year_balance * 100).toFixed(1)}%
                                   </div>
                                 </div>
                               )}
                             </>
                           );
                         })()}
                       </div>
                     </div>
                  ) : (
                    <div>
                      <CardTitle className="text-lg">Nachweise</CardTitle>
                      <CardDescription className="text-sm">
                        Wählen Sie ein Konto aus der Liste links
                      </CardDescription>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col py-3 overflow-hidden" style={{height: 'calc(100vh - 12rem)'}}>
                {selectedAccountData ? (
                  selectedDocuments.length > 0 || (selectedAccountData && documentPreviews[selectedAccountData.id]) ? (
                    <div className="flex flex-col h-full">
                      {selectedDocuments.length > 0 ? (
                        <>
                          {/* Document tabs with embedded reassign icons */}
                          <Tabs defaultValue={selectedDocuments[0]?.id} className="flex flex-col h-full">
                            <TabsList className="grid w-full mb-3 flex-shrink-0" style={{gridTemplateColumns: `repeat(${selectedDocuments.length}, 1fr)`}}>
                              {selectedDocuments.map((doc) => (
                                <div key={doc.id} className="relative group">
                                  <TabsTrigger value={doc.id} className="text-xs px-2 truncate w-full flex items-center gap-1">
                                    <span className="truncate">
                                      {doc.file_name.length > 15 ? `${doc.file_name.substring(0, 15)}...` : doc.file_name}
                                    </span>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Send 
                                            className="h-3 w-3 opacity-60 hover:opacity-100 cursor-pointer flex-shrink-0" 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setDocumentToReassign(doc);
                                              setShowReassignModal(true);
                                            }}
                                          />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Neu zuweisen
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </TabsTrigger>
                                </div>
                              ))}
                            </TabsList>
                            
                            {selectedDocuments.map((doc) => (
                              <TabsContent key={doc.id} value={doc.id} className="flex-1 mt-0 overflow-hidden">
                                <div className="h-full border rounded-lg overflow-hidden">
                                  {doc.file_type === 'application/pdf' ? (
                                    <SimplePDFViewer 
                                      document={doc} 
                                      assignmentId={selectedAccountData.id}
                                      trialBalanceId={trialBalanceId}
                                      accountName={selectedAccountData.account_name}
                                      accountNumber={selectedAccountData.account_number}
                                    />
                                  ) : doc.file_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                                       doc.file_type === 'application/vnd.ms-excel' ? (
                                    <ExcelViewer document={doc} />
                                  ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground bg-muted/30">
                                      <FileText className="h-16 w-16 mb-4 opacity-60" />
                                      <p className="text-center">
                                        {doc.file_name}
                                      </p>
                                      <p className="text-sm text-center mt-2">
                                        Vorschau für diesen Dateityp nicht verfügbar
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </TabsContent>
                            ))}
                          </Tabs>
                        </>
                      ) : (selectedAccountData && documentPreviews[selectedAccountData.id]) ? (
                        // Preview for newly uploaded document
                        <div className="flex-1 border rounded-lg overflow-hidden">
                          <div className="p-3 border-b bg-muted/30">
                            <h5 className="font-medium">Neues Dokument</h5>
                          </div>
                          <div className="h-full">
                            <iframe
                              src={`https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(documentPreviews[selectedAccountData.id])}`}
                              className="w-full h-full border-0"
                              title="Neu hochgeladenes Dokument"
                            />
                          </div>
                        </div>
                      ) : null}
                        
                        
                        {/* Kommentarfeld */}
                        <div className="mt-4 bg-muted/30 rounded-lg p-4 border">
                          <div className="space-y-3">
                             <div className="flex items-center justify-between">
                               <label className="text-sm font-medium text-foreground">
                                 Kommentare
                               </label>
                               <div className="flex items-center gap-2">
                                 {(() => {
                                   // Count how many other accounts share documents with this account
                                   const documentsForThisAccount = selectedDocuments.map(doc => doc.id);
                                   const otherAccountsWithSameDocuments = new Set<string>();
                                   
                                   documentsForThisAccount.forEach(docId => {
                                     assignments.forEach(assignment => {
                                       if (assignment.matched_documents?.includes(docId) && assignment.id !== selectedAccountData.id) {
                                         otherAccountsWithSameDocuments.add(assignment.id);
                                       }
                                     });
                                   });
                                   
                                   const additionalAccountsCount = otherAccountsWithSameDocuments.size;
                                   
                                   return (
                                     <Button 
                                       variant="outline"
                                       size="sm"
                                       onClick={() => {
                                         setSelectedDocumentForMultiAssign(selectedDocuments[0]);
                                         setShowMultiAssignModal(true);
                                       }}
                                       className="flex items-center gap-2"
                                       disabled={selectedDocuments.length === 0}
                                     >
                                        <Link className="h-4 w-4" />
                                        Konten {additionalAccountsCount > 0 && `(${additionalAccountsCount})`}
                                     </Button>
                                   );
                                 })()}
                                 <Button 
                                   variant={completedAccounts.has(selectedAccountData.id) ? "default" : "outline"}
                                   size="sm"
                                   onClick={() => handleMarkCompleted(selectedAccountData.id)}
                                   className="flex items-center gap-2"
                                 >
                                   <CheckCircle className="h-4 w-4" />
                                   {completedAccounts.has(selectedAccountData.id) ? 'Vollständig' : 'Als vollständig markieren'}
                                 </Button>
                                </div>
                              </div>
                             
                             {/* Kommentarfeld in einem festen Container */}
                             <div className="flex-shrink-0 border-t pt-4 space-y-2">
                             <Textarea
                               placeholder="Notizen und Anmerkungen zu diesem Konto und den Nachweisen..."
                               value={accountComments[selectedAccountData.id] || (
                                 selectedAccountData.match_status === 'matched' && selectedAccountData.confidence_score === 0.8
                                   ? "Nachweis konnte mit der Saldobilanz abgestimmt werden; es ergaben sich keine Differenzen."
                                   : ""
                               )}
                               onChange={(e) => handleCommentChange(selectedAccountData.id, e.target.value)}
                               className="min-h-[100px] max-h-[200px] resize-none bg-background border-input w-full"
                             />
                              {loadedComments[selectedAccountData.id] && (
                                <p className="text-xs text-muted-foreground">
                                  ✓ Kommentar gespeichert
                                </p>
                              )}
                              
                              {/* Export Buttons */}
                              {selectedDocuments.length > 0 && (
                                <div className="pt-4 border-t">
                                  <PDFCommentExporter
                                    document={selectedDocuments[0]}
                                    assignmentId={selectedAccountData.id}
                                    trialBalanceId={trialBalanceId}
                                    accountName={selectedAccountData.account_name}
                                    accountNumber={selectedAccountData.account_number}
                                  />
                                </div>
                              )}
                             </div>
                          </div>
                       </div>
                    </div>
                   ) : (
                     <div className="text-center py-8 text-muted-foreground h-full flex flex-col items-center justify-center">
                       <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                       <p className="mb-4">Keine Nachweise für dieses Konto gefunden</p>
                       <div className="space-y-3">
                         <p className="text-sm">Möchten Sie ein neues Dokument für dieses Konto hochladen?</p>
                         <div className="flex justify-center">
                           <input
                             type="file"
                             id="document-upload"
                             accept=".pdf,.xlsx,.xls"
                             style={{ display: 'none' }}
                             onChange={(e) => {
                               const file = e.target.files?.[0];
                               if (file && selectedAccountData) {
                                 handleDocumentUpload(file, selectedAccountData.id);
                               }
                             }}
                           />
                           <Button
                             variant="outline"
                             size="sm"
                             onClick={() => document.getElementById('document-upload')?.click()}
                             disabled={isUploading || !selectedAccountData}
                             className="flex items-center gap-2"
                           >
                             {isUploading ? (
                               <Loader2 className="h-4 w-4 animate-spin" />
                             ) : (
                               <Upload className="h-4 w-4" />
                             )}
                             {isUploading ? 'Wird hochgeladen...' : 'Dokument hochladen'}
                           </Button>
                         </div>
                         <p className="text-xs text-muted-foreground">
                           Unterstützte Formate: PDF, Excel (.xlsx, .xls)
                         </p>
                       </div>
                     </div>
                   )
                ) : (
                  <div className="text-center py-8 text-muted-foreground h-full flex flex-col items-center justify-center">
                    <p>Wählen Sie ein Konto aus, um die Nachweise anzuzeigen</p>
                  </div>
                )}
              </CardContent>
             </Card>
           </div>

           <div className="flex justify-center gap-3 py-2">
             <Button variant="outline" size="sm" onClick={() => navigate(`/documents?trial_balance_id=${trialBalanceId}`)}>
               Zurück zu Dokumenten
             </Button>
             <Button size="sm" onClick={() => navigate('/')}>
               Zur Übersicht
             </Button>
           </div>
         </div>
       </main>

        {/* Reassign-Dialog */}
        <Dialog open={showReassignModal} onOpenChange={setShowReassignModal}>
          <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>Nachweis neu zuweisen</DialogTitle>
              <div className="mt-3">
                <p className="text-sm text-muted-foreground mb-3">
                  Nachweis: <strong>{documentToReassign?.file_name}</strong>
                </p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Konto suchen..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            </DialogHeader>
            
            {/* Scrollable content area */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              <p className="text-sm text-muted-foreground mb-4 flex-shrink-0">
                Wählen Sie die Konten aus, denen dieser Nachweis zugewiesen werden soll:
              </p>
              
              <div className="flex-1 overflow-y-auto border rounded-lg">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Konto</TableHead>
                      <TableHead className="text-right">Lfd. Jahr</TableHead>
                      <TableHead className="text-right">Vorjahr</TableHead>
                      <TableHead className="text-right">Abweichung</TableHead>
                    </TableRow>
                  </TableHeader>
                   <TableBody>
                     {accountGroups
                       .flatMap(group => group.assignments)
                       .filter(assignment => {
                         const matchesSearch = searchQuery === '' || 
                           assignment.account_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           assignment.account_name.toLowerCase().includes(searchQuery.toLowerCase());
                         
                         return matchesSearch && assignment.id !== selectedAccountData?.id;
                       })
                       .map(assignment => (
                        <TableRow 
                          key={assignment.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            const newSelection = new Set(selectedAccountsForAssign);
                            if (newSelection.has(assignment.id)) {
                              newSelection.delete(assignment.id);
                            } else {
                              newSelection.add(assignment.id);
                            }
                            setSelectedAccountsForAssign(newSelection);
                          }}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedAccountsForAssign.has(assignment.id)}
                              onChange={() => {}} // Handled by parent onClick
                              className="rounded"
                            />
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium text-sm">
                                {assignment.account_number} - {assignment.account_name}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(assignment.current_year_balance)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(assignment.previous_year_balance)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={
                              (assignment.current_year_balance - assignment.previous_year_balance) >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            }>
                              {formatCurrency(assignment.current_year_balance - assignment.previous_year_balance)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            
            {/* Fixed footer with buttons */}
            <div className="flex justify-end gap-3 pt-4 flex-shrink-0 border-t bg-background">
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowReassignModal(false);
                  setDocumentToReassign(null);
                  setSelectedAccountsForAssign(new Set());
                  setSearchQuery('');
                }}
              >
                Abbrechen
              </Button>
              <Button 
                onClick={handleReassignDocument}
                disabled={selectedAccountsForAssign.size === 0}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Zu {selectedAccountsForAssign.size} Konto{selectedAccountsForAssign.size > 1 ? 'en' : ''} verschieben
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Mehrfachzuweisungs-Dialog */}
        <Dialog open={showMultiAssignModal} onOpenChange={setShowMultiAssignModal}>
          <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>Nachweis weiteren Konten zuweisen</DialogTitle>
              <div className="mt-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Konto suchen..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            </DialogHeader>
            
            {/* Scrollable content area */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              <p className="text-sm text-muted-foreground mb-4 flex-shrink-0">
                Wählen Sie die Konten aus, denen dieser Nachweis zusätzlich zugewiesen werden soll:
              </p>
              
              <div className="flex-1 overflow-y-auto border rounded-lg">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Konto</TableHead>
                      <TableHead className="text-right">Lfd. Jahr</TableHead>
                      <TableHead className="text-right">Vorjahr</TableHead>
                      <TableHead className="text-right">Abweichung</TableHead>
                    </TableRow>
                  </TableHeader>
                   <TableBody>
                     {accountGroups
                       .flatMap(group => group.assignments)
                       .filter(assignment => {
                         const matchesSearch = searchQuery === '' || 
                           assignment.account_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           assignment.account_name.toLowerCase().includes(searchQuery.toLowerCase());
                         
                         return matchesSearch &&
                           !assignment.matched_documents?.includes(selectedDocumentForMultiAssign?.id || '') &&
                           assignment.id !== selectedAccountData?.id;
                       })
                       .map(assignment => (
                        <TableRow 
                          key={assignment.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            const newSelection = new Set(selectedAccountsForAssign);
                            if (newSelection.has(assignment.id)) {
                              newSelection.delete(assignment.id);
                            } else {
                              newSelection.add(assignment.id);
                            }
                            setSelectedAccountsForAssign(newSelection);
                          }}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedAccountsForAssign.has(assignment.id)}
                              onChange={() => {}} // Handled by parent onClick
                              className="rounded"
                            />
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium text-sm">
                                {assignment.account_number} - {assignment.account_name}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(assignment.current_year_balance)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(assignment.previous_year_balance)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={
                              (assignment.current_year_balance - assignment.previous_year_balance) >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            }>
                              {formatCurrency(assignment.current_year_balance - assignment.previous_year_balance)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            
            {/* Fixed footer with buttons */}
            <div className="flex justify-end gap-3 pt-4 flex-shrink-0 border-t bg-background">
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowMultiAssignModal(false);
                  setSelectedDocumentForMultiAssign(null);
                  setSelectedAccountsForAssign(new Set());
                  setSearchQuery('');
                }}
              >
                Abbrechen
              </Button>
              <Button 
                onClick={handleMultiAssign}
                disabled={selectedAccountsForAssign.size === 0}
              >
                {selectedAccountsForAssign.size} Konten zuweisen
              </Button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </TooltipProvider>
  );
};

export default Review;