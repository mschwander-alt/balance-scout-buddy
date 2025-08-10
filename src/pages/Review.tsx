import React, { useState, useEffect, useCallback } from 'react';
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
import { Search, ArrowLeft, ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, FileText, Eye, PanelLeft, PanelLeftClose } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DocumentViewer } from '@/components/DocumentViewer';
import { SimplePDFViewer } from '@/components/SimplePDFViewer';

interface Assignment {
  id: string;
  account_group_id: string;
  account_number: string;
  account_name: string;
  current_year_balance: number;
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
  const [documentPreview, setDocumentPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [accountComments, setAccountComments] = useState<{[key: string]: string}>({});
  const [loadedComments, setLoadedComments] = useState<{[key: string]: boolean}>({});

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

      // Verarbeite Daten mit Type Casting für nullable Felder
      const allAssignments = groupsData.flatMap(group => 
        group.assignments.map(assignment => ({
          ...assignment,
          account_group_id: group.id,
          match_status: (assignment.match_status || 'pending') as 'pending' | 'matched' | 'unmatched',
          confidence_score: assignment.confidence_score || undefined,
          matched_documents: assignment.matched_documents || undefined
        }))
      );

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

      setAssignments(allAssignments);
      setDocuments(documentsResponse || []);
      setTeamMembers(teamMemberMap);
      
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
      setAccountComments(commentMap);
      setLoadedComments(loadedMap);
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast.error('Fehler beim Laden der Daten');
    }
  }, [trialBalanceId, user]);

  const previewDocument = async (document: Document) => {
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from('account-evidence')
        .createSignedUrl(document.file_path, 3600);

      if (error) throw error;
      setDocumentPreview(data.signedUrl);
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
      const { data, error } = await supabase.functions.invoke('auto-match-documents', {
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
      const assignment = assignments.find(a => a.id === assignmentId);
      const document = documents.find(d => d.id === documentId);
      
      if (!assignment || !document) return;

      // Update in der Datenbank
      const updatedMatchedDocuments = assignment.matched_documents 
        ? [...assignment.matched_documents, documentId]
        : [documentId];

      const { error } = await supabase
        .from('account_group_assignments')
        .update({
          match_status: 'matched',
          confidence_score: 1.0, // Manuelle Zuweisung = 100% Vertrauen
          matched_documents: updatedMatchedDocuments
        })
        .eq('id', assignmentId);

      if (error) {
        throw error;
      }

      // Update lokaler State
      const updatedAssignments = assignments.map(a => {
        if (a.id === assignmentId) {
          return {
            ...a,
            match_status: 'matched' as const,
            confidence_score: 1.0,
            matched_documents: updatedMatchedDocuments
          };
        }
        return a;
      });

      setAssignments(updatedAssignments);
      
      setAccountGroups(prevGroups => 
        prevGroups.map(group => ({
          ...group,
          assignments: updatedAssignments.filter(a => a.account_group_id === group.id)
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
      // Prüfe anhand der ersten Kontonummer in der Gruppe
      const firstAccountNumber = group.assignments[0]?.account_number;
      if (firstAccountNumber) {
        const accountNum = parseInt(firstAccountNumber);
        // Schweizer Kontenplan: 1000-2999 = Bilanz, 3000-9999 = Erfolgsrechnung
        if (accountNum >= 1000 && accountNum <= 2999) {
          bilanzGroups.push(group);
        } else if (accountNum >= 3000 && accountNum <= 9999) {
          erfolgsrechnungGroups.push(group);
        } else {
          // Fallback: Standardmäßig in Bilanz
          bilanzGroups.push(group);
        }
      } else {
        // Fallback: Gruppen ohne Konten in Bilanz
        bilanzGroups.push(group);
      }
    });

    return { bilanzGroups, erfolgsrechnungGroups };
  };

  const selectedAccountData = selectedAccount 
    ? assignments.find(a => a.id === selectedAccount)
    : null;

  const selectedDocuments = selectedAccountData?.matched_documents
    ? documents.filter(doc => selectedAccountData.matched_documents?.includes(doc.id))
    : [];

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
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

      <main className="container mx-auto px-2 py-3">
        <div className="space-y-4">
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
                                        {assignments
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
                            {selectedDocumentForAssign && documentPreview ? (
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
                      <p>Keine Kontengruppen gefunden</p>
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
                                             <div className="flex items-center justify-center gap-2">
                                               {getMatchStatusIcon(assignment.match_status || 'pending')}
                                               <span className="text-sm">
                                                 {getMatchStatusText(assignment.match_status || 'pending')}
                                                 {assignment.match_status === 'matched' && assignment.confidence_score && (
                                                   <span className="text-xs text-muted-foreground ml-1">
                                                     {Math.round(assignment.confidence_score * 100)}%
                                                   </span>
                                                 )}
                                               </span>
                                             </div>
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
                                             <div className="flex items-center justify-center gap-2">
                                               {getMatchStatusIcon(assignment.match_status || 'pending')}
                                               <span className="text-sm">
                                                 {getMatchStatusText(assignment.match_status || 'pending')}
                                                 {assignment.match_status === 'matched' && assignment.confidence_score && (
                                                   <span className="text-xs text-muted-foreground ml-1">
                                                     {Math.round(assignment.confidence_score * 100)}%
                                                   </span>
                                                 )}
                                               </span>
                                             </div>
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

            <Card className="flex-1 min-w-0 relative">
              <CardHeader className="py-3">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    className="flex items-center gap-2"
                  >
                    {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                    {sidebarCollapsed ? 'Saldobilanz anzeigen' : 'Saldobilanz ausblenden'}
                  </Button>
                  <div className="border-l border-border h-6"></div>
                  <div>
                    <CardTitle className="text-lg">Gefundene Nachweise</CardTitle>
                    <CardDescription className="text-sm">
                      {selectedAccountData ? 
                        `${selectedAccountData.account_number} - ${selectedAccountData.account_name}` :
                        'Wählen Sie ein Konto aus der Liste links'
                      }
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="h-[calc(100vh-12rem)] overflow-hidden py-3 flex flex-col">
                {selectedAccountData ? (
                  selectedDocuments.length > 0 ? (
                    <div className="flex flex-col h-full gap-4">
                      <div className="flex-1 min-h-0 border rounded-lg">
                        {selectedDocuments.map((doc) => (
                          <div key={doc.id} className="h-full">
                            <SimplePDFViewer document={doc} />
                          </div>
                        ))}
                      </div>
                      
                      {/* Kommentarfeld */}
                      <div className="border-t pt-4 h-[160px] flex-shrink-0">
                        <div className="space-y-3">
                          <label className="text-sm font-medium text-foreground block">
                            Kommentare zu {selectedAccountData.account_number} - {selectedAccountData.account_name}
                          </label>
                          <Textarea
                            placeholder="Notizen und Anmerkungen zu diesem Konto und den Nachweisen..."
                            value={accountComments[selectedAccountData.id] || ''}
                            onChange={(e) => handleCommentChange(selectedAccountData.id, e.target.value)}
                            className="h-[120px] resize-none"
                          />
                          {loadedComments[selectedAccountData.id] && (
                            <p className="text-xs text-muted-foreground mt-1">
                              ✓ Kommentar gespeichert
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground h-full flex flex-col items-center justify-center">
                      <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Keine Nachweise für dieses Konto gefunden</p>
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
    </div>
  );
};

export default Review;