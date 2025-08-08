import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, ArrowLeft, ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, FileText, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DocumentViewer } from '@/components/DocumentViewer';

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [showManualAssignModal, setShowManualAssignModal] = useState(false);
  const [unmatchedDocuments, setUnmatchedDocuments] = useState<Document[]>([]);
  const [selectedDocumentForAssign, setSelectedDocumentForAssign] = useState<string | null>(null);
  const [assignmentForDoc, setAssignmentForDoc] = useState<string>('');
  const [documentPreview, setDocumentPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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
    if (!trialBalanceId) return;

    try {
      // Lade Gruppen und deren Assignments mit einem JOIN
      const groupsResponse = await supabase
        .from('account_groups')
        .select(`
          *,
          account_group_assignments (*)
        `)
        .eq('trial_balance_id', trialBalanceId);

      const documentsResponse = await supabase
        .from('account_evidence')
        .select('*')
        .eq('trial_balance_id', trialBalanceId);

      if (groupsResponse.error) throw groupsResponse.error;
      if (documentsResponse.error) throw documentsResponse.error;

      // Flache die Assignments aus allen Gruppen aus
      const allAssignments = groupsResponse.data.flatMap(group => 
        group.account_group_assignments?.map(assignment => ({
          ...assignment,
          match_status: (assignment.match_status || 'pending') as 'pending' | 'matched' | 'unmatched'
        })) || []
      );

      const groupsWithAssignments = groupsResponse.data.map(group => ({
        ...group,
        assignments: group.account_group_assignments?.map(assignment => ({
          ...assignment,
          match_status: (assignment.match_status || 'pending') as 'pending' | 'matched' | 'unmatched'
        })) || [],
        isOpen: true
      }));

      setAccountGroups(groupsWithAssignments);
      setAssignments(allAssignments);
      setDocuments(documentsResponse.data || []);
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast.error('Fehler beim Laden der Daten');
    }
  }, [trialBalanceId]);

  const previewDocument = async (document: Document) => {
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from('account-evidence')
        .createSignedUrl(document.file_path, 3600);

      if (error) throw error;
      setDocumentPreview(data.signedUrl);
    } catch (error: any) {
      console.error('Error getting document preview:', error);
      toast.error('Fehler beim Laden der Dokumentvorschau');
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
    // Die Match-Ergebnisse werden jetzt direkt in der Datenbank-Funktion gespeichert
    console.log('Match results saved in database function:', updatedAssignments);
  };

  const handleManualAssign = async (documentId: string, assignmentId: string) => {
    try {
      const assignment = assignments.find(a => a.id === assignmentId);
      const document = documents.find(d => d.id === documentId);
      
      if (!assignment || !document) return;

      const updatedAssignments = assignments.map(a => {
        if (a.id === assignmentId) {
          return {
            ...a,
            match_status: 'matched' as const,
            confidence_score: 1.0,
            matched_documents: [...(a.matched_documents || []), documentId]
          };
        }
        return a;
      });

      await saveMatchResults(updatedAssignments);
      setAssignments(updatedAssignments);
      
      setAccountGroups(prevGroups => 
        prevGroups.map(group => ({
          ...group,
          assignments: updatedAssignments.filter(a => a.account_group_id === group.id)
        }))
      );

      toast.success('Dokument erfolgreich zugewiesen');
      setSelectedDocumentForAssign(null);
    } catch (error: any) {
      console.error('Error during manual assign:', error);
      toast.error('Manuelle Zuweisung fehlgeschlagen');
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
            <Card className="w-full xl:w-2/5 flex-shrink-0">
              <CardHeader className="py-3">
                <CardTitle className="text-lg">Saldobilanz</CardTitle>
                <CardDescription className="text-sm">
                  Klicken Sie auf ein Konto um die gefundenen Nachweise anzuzeigen
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-[calc(100vh-16rem)] overflow-y-auto py-3">
                <div className="space-y-4">
                  {accountGroups.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>Keine Kontengruppen gefunden</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {accountGroups.map((group) => (
                        <Collapsible key={group.id} open={group.isOpen} onOpenChange={() => toggleGroup(group.id)}>
                          <Card>
                            <CollapsibleTrigger asChild>
                              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    {group.isOpen ? 
                                      <ChevronDown className="h-4 w-4" /> : 
                                      <ChevronRight className="h-4 w-4" />
                                    }
                                     <div>
                                       <CardTitle className="text-left text-lg">{group.name}</CardTitle>
                                       {group.description && (
                                         <CardDescription className="text-left text-sm">
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
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="flex-1 min-w-0">
              <CardHeader className="py-3">
                <CardTitle className="text-lg">Gefundene Nachweise</CardTitle>
                <CardDescription className="text-sm">
                  {selectedAccountData ? 
                    `${selectedAccountData.account_number} - ${selectedAccountData.account_name}` :
                    'Wählen Sie ein Konto aus der Liste links'
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[calc(100vh-16rem)] overflow-hidden py-3">
                {selectedAccountData ? (
                  selectedDocuments.length > 0 ? (
                    <div className="space-y-4 h-full overflow-y-auto">
                      {selectedDocuments.map((doc) => (
                        <div key={doc.id} className="border rounded-lg h-full">
                          <DocumentViewer 
                            document={doc}
                            onLoad={() => {}}
                            onError={(error) => console.error('Error loading document:', error)}
                          />
                        </div>
                      ))}
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