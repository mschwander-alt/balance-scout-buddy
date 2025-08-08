import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, XCircle, Clock, Search, FileText, ArrowLeft, ChevronDown, ChevronRight, AlertCircle, Eye, MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { DocumentViewer } from "@/components/DocumentViewer";

interface AccountGroup {
  id: string;
  name: string;
  description?: string;
  assignments: AccountAssignment[];
  isOpen: boolean;
}

interface AccountAssignment {
  id: string;
  account_number: string;
  account_name: string;
  current_year_balance: number;
  previous_year_balance: number;
  foreign_currency_balance?: number;
  account_group_id: string;
  account_group_name: string;
  match_status: 'pending' | 'matched' | 'unmatched';
  confidence_score?: number;
  matched_documents?: string[];
}

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  description?: string;
  extracted_amounts?: number[];
}

const Review = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  
  const trialBalanceId = searchParams.get('trial_balance_id') || '';
  
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [assignments, setAssignments] = useState<AccountAssignment[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showManualAssignModal, setShowManualAssignModal] = useState(false);
  const [unmatchedDocuments, setUnmatchedDocuments] = useState<any[]>([]);
  const [selectedDocumentForAssign, setSelectedDocumentForAssign] = useState<string | null>(null);
  const [assignmentForDoc, setAssignmentForDoc] = useState<string>('');
  const [documentPreview, setDocumentPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedAccountForView, setSelectedAccountForView] = useState<AccountAssignment | null>(null);
  const [accountComments, setAccountComments] = useState<{[key: string]: string}>({});

  const saveMatchResults = async (matchedAssignments: AccountAssignment[]) => {
    try {
      // Create a table to save match results if it doesn't exist
      const updates = matchedAssignments.map(assignment => ({
        assignment_id: assignment.id,
        match_status: assignment.match_status,
        confidence_score: assignment.confidence_score || 0,
        matched_documents: assignment.matched_documents || []
      }));

      // For now, we'll store this in localStorage as a quick solution
      // In production, you'd want a proper database table for match results
      localStorage.setItem(`match_results_${trialBalanceId}`, JSON.stringify(updates));
      
      console.log('Match results saved:', updates);
    } catch (error) {
      console.error('Error saving match results:', error);
    }
  };

  const loadMatchResults = () => {
    try {
      const savedResults = localStorage.getItem(`match_results_${trialBalanceId}`);
      return savedResults ? JSON.parse(savedResults) : [];
    } catch (error) {
      console.error('Error loading match results:', error);
      return [];
    }
  };

  const loadData = useCallback(async () => {
    if (!user || !trialBalanceId) return;

    try {
      // Load account groups first to get correct order
      const { data: groupsData, error: groupsError } = await supabase
        .from('account_groups')
        .select('*')
        .eq('trial_balance_id', trialBalanceId)
        .order('created_at', { ascending: true }); // Same order as in AccountGrouping

      if (groupsError) throw groupsError;

      // Load account assignments with groups
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('account_group_assignments')
        .select(`
          *,
          account_groups (
            id,
            name,
            description
          )
        `)
        .eq('account_groups.trial_balance_id', trialBalanceId)
        .order('account_number');

      if (assignmentsError) throw assignmentsError;

      // Load documents
      const { data: documentsData, error: documentsError } = await supabase
        .from('account_evidence')
        .select('*')
        .eq('trial_balance_id', trialBalanceId)
        .order('file_name');

      if (documentsError) throw documentsError;

      // Process assignments data
      console.log('Raw assignments data:', assignmentsData);
      const processedAssignments = (assignmentsData || [])
        .filter(assignment => {
          const hasRequiredData = assignment.account_number && assignment.account_name;
          if (!hasRequiredData) {
            console.log('Skipping assignment with missing data:', assignment);
          }
          return hasRequiredData;
        })
        .map(assignment => ({
          id: assignment.id,
          account_number: assignment.account_number,
          account_name: assignment.account_name,
          current_year_balance: assignment.current_year_balance || 0,
          previous_year_balance: assignment.previous_year_balance || 0,
          foreign_currency_balance: assignment.foreign_currency_balance,
          account_group_id: assignment.account_group_id,
          account_group_name: assignment.account_groups?.name || 'Unbekannte Gruppe',
          match_status: 'pending' as const,
          confidence_score: 0,
          matched_documents: []
        }));

      // Load saved match results and apply them
      const savedMatchResults = loadMatchResults();
      const assignmentsWithResults = processedAssignments.map(assignment => {
        const savedResult = savedMatchResults.find((r: any) => r.assignment_id === assignment.id);
        if (savedResult) {
          return {
            ...assignment,
            match_status: savedResult.match_status,
            confidence_score: savedResult.confidence_score,
            matched_documents: savedResult.matched_documents
          };
        }
        return assignment;
      });
      
      console.log('Processed assignments:', assignmentsWithResults);

      // Group assignments by account group
      const groupedData = (groupsData || []).map(group => ({
        id: group.id,
        name: group.name,
        description: group.description,
        assignments: assignmentsWithResults.filter(a => a.account_group_id === group.id),
        isOpen: true // Start with groups open
      }));

      setAccountGroups(groupedData);
      setAssignments(assignmentsWithResults);
      setDocuments(documentsData || []);
      
      // Load saved comments
      setAccountComments(loadAccountComments());

    } catch (error: any) {
      console.error('Error loading data:', error);
      toast({
        title: "Fehler",
        description: "Daten konnten nicht geladen werden.",
        variant: "destructive",
      });
    }
  }, [user, trialBalanceId, toast]);

  const startAutoMatch = async () => {
    if (!user || !trialBalanceId) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      console.log('Starting auto-match with assignments:', assignments);
      console.log('Documents for matching:', documents);
      
      // Call edge function for auto-matching
      const { data, error } = await supabase.functions.invoke('auto-match-documents', {
        body: {
          trial_balance_id: trialBalanceId,
          assignments: assignments,
          documents: documents
        }
      });

      if (error) throw error;

      // Update assignments with match results
      const updatedAssignments = data.matched_assignments || [];
      
      // Save match results to database
      if (updatedAssignments.length > 0) {
        await saveMatchResults(updatedAssignments);
      }
      
      setAssignments(updatedAssignments);
      
      // Update groups with new assignment data
      setAccountGroups(prevGroups => 
        prevGroups.map(group => ({
          ...group,
          assignments: updatedAssignments.filter((a: AccountAssignment) => a.account_group_id === group.id)
        }))
      );
      
      setProgress(100);

      toast({
        title: "Prüfung abgeschlossen",
        description: `${data.matched_count || 0} von ${assignments.length} Konten konnten automatisch abgeglichen werden.`,
      });

    } catch (error: any) {
      console.error('Error during auto-match:', error);
      toast({
        title: "Fehler",
        description: "Automatischer Abgleich fehlgeschlagen.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const getUnmatchedDocuments = () => {
    const matchedDocIds = new Set();
    assignments.forEach(assignment => {
      if (assignment.matched_documents) {
        assignment.matched_documents.forEach(docId => matchedDocIds.add(docId));
      }
    });
    
    return documents.filter(doc => !matchedDocIds.has(doc.id));
  };

  const previewDocument = async (document: Document) => {
    setPreviewLoading(true);
    try {
      // Get signed URL for document preview instead of downloading blob
      const { data, error } = await supabase.storage
        .from('account-evidence')
        .createSignedUrl(document.file_path, 3600); // 1 hour expiry
      
      if (error) {
        console.error('Error creating signed URL:', error);
        throw error;
      }
      
      if (data?.signedUrl) {
        setDocumentPreview(data.signedUrl);
      } else {
        throw new Error('No signed URL received');
      }
    } catch (error) {
      console.error('Error previewing document:', error);
      toast({
        title: "Fehler",
        description: "Dokumentvorschau konnte nicht geladen werden.",
        variant: "destructive",
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAccountClick = (assignment: AccountAssignment) => {
    setSelectedAccountForView(assignment);
    setPreviewLoading(true);
  };

  const updateAccountComment = (accountId: string, comment: string) => {
    setAccountComments(prev => ({
      ...prev,
      [accountId]: comment
    }));
    
    // Save comments to localStorage
    const savedComments = { ...accountComments, [accountId]: comment };
    localStorage.setItem(`account_comments_${trialBalanceId}`, JSON.stringify(savedComments));
  };

  const loadAccountComments = () => {
    try {
      const savedComments = localStorage.getItem(`account_comments_${trialBalanceId}`);
      return savedComments ? JSON.parse(savedComments) : {};
    } catch (error) {
      console.error('Error loading account comments:', error);
      return {};
    }
  };

  const handleManualAssign = async (documentId: string, assignmentId: string) => {
    try {
      // Find the assignment and document
      const assignment = assignments.find(a => a.id === assignmentId);
      const document = documents.find(d => d.id === documentId);
      
      if (!assignment || !document) return;

      // Update the assignment with manual match
      const updatedAssignments = assignments.map(a => {
        if (a.id === assignmentId) {
          return {
            ...a,
            match_status: 'matched' as const,
            confidence_score: 1.0, // Manual assignments get 100% confidence
            matched_documents: [...(a.matched_documents || []), documentId]
          };
        }
        return a;
      });

      // Save manual assignment result
      await saveMatchResults(updatedAssignments);

      setAssignments(updatedAssignments);
      
      // Update groups
      setAccountGroups(prevGroups => 
        prevGroups.map(group => ({
          ...group,
          assignments: updatedAssignments.filter(a => a.account_group_id === group.id)
        }))
      );

      toast({
        title: "Erfolgreich zugewiesen",
        description: `${document.file_name} wurde ${assignment.account_name} zugewiesen.`,
      });

      setSelectedDocumentForAssign(null);
    } catch (error: any) {
      console.error('Error during manual assign:', error);
      toast({
        title: "Fehler",
        description: "Manuelle Zuweisung fehlgeschlagen.",
        variant: "destructive",
      });
    }
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
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-foreground">Audit Agent</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Willkommen, {user?.email}
            </span>
            <Button variant="outline" onClick={signOut}>
              Abmelden
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-4xl font-bold mb-4 text-foreground">
                Automatische Prüfung
              </h2>
              <p className="text-xl text-muted-foreground">
                Abgleich der Kontosalden mit den hochgeladenen Nachweisen
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => navigate(`/documents?trial_balance_id=${trialBalanceId}`)}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>
          </div>

          {/* Control Panel */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Automatischer Abgleich
              </CardTitle>
              <CardDescription>
                Das System durchsucht alle Dokumente und gleicht die Werte mit den Kontosalden ab
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button 
                  onClick={startAutoMatch}
                  disabled={isProcessing || accountGroups.length === 0}
                  className="flex items-center gap-2"
                >
                  <Search className="h-4 w-4" />
                  {isProcessing ? 'Prüfung läuft...' : 'Prüfung starten'}
                </Button>
                
                <Dialog open={showManualAssignModal} onOpenChange={setShowManualAssignModal}>
                  <DialogTrigger asChild>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setUnmatchedDocuments(getUnmatchedDocuments());
                        setShowManualAssignModal(true);
                      }}
                      className="flex items-center gap-2"
                    >
                      <FileText className="h-4 w-4" />
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
                          {/* Document List */}
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

                          {/* Document Preview */}
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
                                      {previewLoading ? 'Lädt...' : 'Wählen Sie ein Dokument für die Vorschau aus'}
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
                
                {isProcessing && (
                  <div className="flex-1 max-w-md">
                    <Progress value={progress} className="w-full" />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Split View */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Side - Account List */}
            <Card>
              <CardHeader>
                <CardTitle>Saldobilanz</CardTitle>
                <CardDescription>
                  Klicken Sie auf ein Konto um die gefundenen Nachweise anzuzeigen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {accountGroups.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>Keine Kontengruppen gefunden</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {accountGroups.map((group) => (
                        <Card key={group.id} className="border border-border">
                          <Collapsible
                            open={group.isOpen}
                            onOpenChange={() => toggleGroup(group.id)}
                          >
                            <CollapsibleTrigger asChild>
                              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    {group.isOpen ? (
                                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    <div>
                                      <CardTitle className="text-base font-semibold text-left">
                                        {group.name}
                                      </CardTitle>
                                      {group.description && (
                                        <CardDescription className="text-left">
                                          {group.description}
                                        </CardDescription>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline">
                                      {group.assignments.length} Konten
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
                                        <TableCell>
                                          <div>
                                            <div className="font-medium">{assignment.account_number}</div>
                                            <div className="text-sm text-muted-foreground">
                                              {assignment.account_name}
                                            </div>
                                          </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <div className="font-medium">
                                            {formatCurrency(assignment.current_year_balance)}
                                          </div>
                                          {assignment.foreign_currency_balance && (
                                            <div className="text-sm text-muted-foreground">
                                              Fremdwährung: {formatCurrency(assignment.foreign_currency_balance)}
                                            </div>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                          <div className="flex flex-col items-center gap-1">
                                            {getMatchStatusIcon(assignment.match_status)}
                                            <span className="text-xs">
                                              {getMatchStatusText(assignment.match_status)}
                                            </span>
                                            {assignment.confidence_score && assignment.confidence_score > 0 && (
                                              <Badge variant="secondary" className="text-xs">
                                                {Math.round(assignment.confidence_score * 100)}%
                                              </Badge>
                                            )}
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </CardContent>
                            </CollapsibleContent>
                          </Collapsible>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Right Side - Document Viewer */}
            <Card>
              <CardContent className="p-2 h-full">
                {!selectedAccountForView ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Wählen Sie ein Konto aus der Liste aus</p>
                    <p className="text-sm">um die zugehörigen Nachweise anzuzeigen</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Documents */}
                    {selectedAccountForView.matched_documents && selectedAccountForView.matched_documents.length > 0 ? (
                      <div className="space-y-4">
                        {selectedAccountForView.matched_documents.map((docId) => {
                          const document = documents.find(d => d.id === docId);
                          if (!document) return null;
                          
                          return (
                            <div key={document.id} className="space-y-4">
                              {/* Document Header */}
                              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                                <div className="flex-1">
                                  <h5 className="font-medium">{document.file_name}</h5>
                                  <p className="text-sm text-muted-foreground">
                                    {document.file_type} • {Math.round(document.file_size / 1024)} KB
                                  </p>
                                </div>
                                <Badge variant="outline">
                                  {document.file_type.includes('pdf') ? 'PDF' : 
                                   document.file_type.includes('excel') ? 'Excel' : 'Word'}
                                </Badge>
                              </div>
                              
                              {/* Document Viewer */}
                              <div style={{ height: '70vh' }}>
                                <DocumentViewer 
                                  document={document}
                                  onLoad={() => setPreviewLoading(false)}
                                  onError={(error) => {
                                    setPreviewLoading(false);
                                    console.error('Document viewer error:', error);
                                  }}
                                />
                              </div>
                              
                              {/* Comment Section */}
                              <div className="mt-4 space-y-2">
                                <div className="flex items-center gap-2">
                                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                  <label className="text-sm font-medium">Kommentare:</label>
                                </div>
                                <Textarea
                                  placeholder="Notizen oder Kommentare zu diesem Dokument..."
                                  value={accountComments[`${selectedAccountForView.id}_${document.id}`] || ''}
                                  onChange={(e) => updateAccountComment(`${selectedAccountForView.id}_${document.id}`, e.target.value)}
                                  className="min-h-[80px]"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <XCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Keine Nachweise gefunden</p>
                        <p className="text-sm">Für dieses Konto wurden keine passenden Dokumente gefunden</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Navigation */}
          <div className="flex justify-center gap-4">
            <Button variant="outline" onClick={() => navigate(`/documents?trial_balance_id=${trialBalanceId}`)}>
              Zurück zu Dokumenten
            </Button>
            <Button onClick={() => navigate('/')}>
              Zur Übersicht
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Review;