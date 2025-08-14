import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, ArrowLeft, ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, FileText, Eye, PanelLeft, PanelLeftClose, Upload } from 'lucide-react';
import { Calculator } from '@/components/Calculator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DocumentViewer } from '@/components/DocumentViewer';
import { SimplePDFViewer } from '@/components/SimplePDFViewer';
import { ExcelViewer } from '@/components/ExcelViewer';

interface Assignment {
  id: string;
  account_group_id?: string;
  account_number: string;
  account_name: string;
  current_year_balance: number;
  previous_year_balance: number;
  match_status?: string | null;
  confidence_score?: number | null;
  matched_documents?: string[] | null;
  trial_balance_id?: string;
  assigned_member_id?: string | null;
  created_at?: string;
  updated_at?: string;
  foreign_currency_balance?: number | null;
}

interface AccountGroup {
  id: string;
  name: string;
  description?: string;
  status?: string;
  assigned_member_id?: string;
  assignments: Assignment[];
}

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  upload_date: string;
  description?: string;
  account_group_id?: string;
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
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [completedAccounts, setCompletedAccounts] = useState<Set<string>>(new Set());
  const [accountComments, setAccountComments] = useState<{[key: string]: string}>({});
  const [loadedComments, setLoadedComments] = useState<{[key: string]: boolean}>({});

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

      // Bearbeite Groups für UI
      const processedGroups = groupsData?.map(group => ({
        ...group,
        assignments: group.assignments || []
      })) || [];

      // Falls keine Groups vorhanden sind, lade temp_account_matches
      if (processedGroups.length === 0) {
        const { data: tempMatches, error: tempError } = await supabase
          .from('temp_account_matches')
          .select('*')
          .eq('trial_balance_id', trialBalanceId);

        if (tempError) throw tempError;

        setAssignments(tempMatches || []);
      }

      setAccountGroups(processedGroups);
      setDocuments(documentsResponse || []);
      setTeamMembers(teamMemberMap);
      setAccountComments(commentMap);
      setLoadedComments(loadedMap);

      // Setze ersten Account als ausgewählt falls noch keiner ausgewählt
      if (!selectedAccount && processedGroups.length > 0 && processedGroups[0].assignments.length > 0) {
        setSelectedAccount(processedGroups[0].assignments[0].id);
      }

    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Fehler beim Laden der Daten');
    }
  }, [trialBalanceId, user, selectedAccount]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Find selected account data from all groups
  const selectedAccountData = selectedAccount 
    ? accountGroups.flatMap(group => group.assignments).find(a => a.id === selectedAccount) ||
      assignments.find(a => a.id === selectedAccount)
    : null;

  const selectedDocuments = selectedAccountData?.matched_documents
    ? documents.filter(doc => selectedAccountData.matched_documents?.includes(doc.id))
    : [];

  const startAutoMatch = async () => {
    toast.info('Automatisches Matching wird gestartet...');
  };

  const startAdvancedAnalysis = async () => {
    toast.info('KI-Analyse wird gestartet...');
  };

  const handleUnmatchAll = async () => {
    toast.info('Alle Zuordnungen werden entfernt...');
  };

  const handlePdfUpload = () => {
    toast.info('PDF Upload wird im nächsten Schritt implementiert');
  };

  const handleMarkCompleted = (assignmentId: string) => {
    setCompletedAccounts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(assignmentId)) {
        newSet.delete(assignmentId);
      } else {
        newSet.add(assignmentId);
      }
      return newSet;
    });
  };

  const handleCommentChange = (assignmentId: string, comment: string) => {
    setAccountComments(prev => ({
      ...prev,
      [assignmentId]: comment
    }));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-CH', {
      style: 'currency',
      currency: 'CHF',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const getStatusBadge = (assignment: Assignment) => {
    if (assignment.match_status === 'matched') {
      return <Badge variant="default" className="bg-green-500">Matched</Badge>;
    } else if (assignment.match_status === 'unmatched') {
      return <Badge variant="destructive">Unmatched</Badge>;
    } else {
      return <Badge variant="secondary">Pending</Badge>;
    }
  };

  if (!user) {
    return <div>Loading...</div>;
  }

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
                  <Search className="h-3 w-3" />
                  KI-Analyse
                </Button>

                <Button 
                  onClick={handleUnmatchAll}
                  disabled={isProcessing}
                  size="sm"
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <XCircle className="h-3 w-3" />
                  Unmatch All
                </Button>

                <Button 
                  onClick={handlePdfUpload}
                  disabled={isProcessing}
                  size="sm"
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Upload className="h-3 w-3" />
                  Kontoblätter hochladen
                </Button>

                <Button 
                  onClick={() => toast.info('Manuelle Zuweisung wird geöffnet...')}
                  disabled={isProcessing}
                  size="sm"
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <FileText className="h-3 w-3" />
                  man. Zuweisung
                </Button>
              </div>
            </div>

            <div className="flex gap-4 min-h-[calc(100vh-200px)]">
              {/* Linke Sidebar - Kontenliste */}
              <div className={`transition-all duration-300 ${sidebarCollapsed ? 'w-12' : 'w-96'} bg-card border rounded-lg overflow-hidden flex flex-col`}>
                <div className="p-3 border-b bg-muted/50 flex items-center justify-between">
                  <h3 className={`font-medium ${sidebarCollapsed ? 'hidden' : 'block'}`}>
                    Konten ({accountGroups.reduce((acc, group) => acc + group.assignments.length, 0) + assignments.length})
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  >
                    {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                  </Button>
                </div>
                
                {!sidebarCollapsed && (
                  <div className="flex-1 overflow-y-auto">
                    {accountGroups.map(group => (
                      <div key={group.id} className="border-b">
                        <div className="p-2 bg-muted/30">
                          <h4 className="text-sm font-medium">{group.name}</h4>
                          {group.description && (
                            <p className="text-xs text-muted-foreground">{group.description}</p>
                          )}
                        </div>
                        {group.assignments.map(assignment => (
                          <div
                            key={assignment.id}
                            className={`p-3 cursor-pointer border-b hover:bg-muted/50 transition-colors ${
                              selectedAccount === assignment.id ? 'bg-primary/10 border-l-4 border-l-primary' : ''
                            }`}
                            onClick={() => setSelectedAccount(assignment.id)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium">{assignment.account_number}</span>
                              {getStatusBadge(assignment)}
                            </div>
                            <p className="text-xs text-muted-foreground mb-1 truncate">
                              {assignment.account_name}
                            </p>
                            <div className="flex justify-between text-xs">
                              <span>Aktuell: {formatCurrency(assignment.current_year_balance)}</span>
                              {completedAccounts.has(assignment.id) && (
                                <CheckCircle className="h-3 w-3 text-green-500" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}

                    {/* Ungrouped assignments */}
                    {assignments.map(assignment => (
                      <div
                        key={assignment.id}
                        className={`p-3 cursor-pointer border-b hover:bg-muted/50 transition-colors ${
                          selectedAccount === assignment.id ? 'bg-primary/10 border-l-4 border-l-primary' : ''
                        }`}
                        onClick={() => setSelectedAccount(assignment.id)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{assignment.account_number}</span>
                          {getStatusBadge(assignment)}
                        </div>
                        <p className="text-xs text-muted-foreground mb-1 truncate">
                          {assignment.account_name}
                        </p>
                        <div className="flex justify-between text-xs">
                          <span>Aktuell: {formatCurrency(assignment.current_year_balance)}</span>
                          {completedAccounts.has(assignment.id) && (
                            <CheckCircle className="h-3 w-3 text-green-500" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Rechte Seite - Kontodetails */}
              <div className="flex-1 bg-card border rounded-lg overflow-hidden">
                {selectedAccountData ? (
                  <div className="h-full flex flex-col">
                    {/* Header */}
                    <div className="p-4 border-b bg-muted/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">
                            {selectedAccountData.account_number} - {selectedAccountData.account_name}
                          </h3>
                          <div className="mt-2 flex gap-4 text-sm">
                            <span>Aktuell: <strong>{formatCurrency(selectedAccountData.current_year_balance)}</strong></span>
                            <span>Vorjahr: <strong>{formatCurrency(selectedAccountData.previous_year_balance)}</strong></span>
                            <span className={
                              (selectedAccountData.current_year_balance - selectedAccountData.previous_year_balance) >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            }>
                              Abweichung: <strong>{formatCurrency(selectedAccountData.current_year_balance - selectedAccountData.previous_year_balance)}</strong>
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {getStatusBadge(selectedAccountData)}
                          <Button
                            variant={completedAccounts.has(selectedAccountData.id) ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleMarkCompleted(selectedAccountData.id)}
                            className="flex items-center gap-1"
                          >
                            <CheckCircle className="h-3 w-3" />
                            {completedAccounts.has(selectedAccountData.id) ? 'Vollständig' : 'Als vollständig markieren'}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-4">
                      {selectedDocuments.length > 0 ? (
                        <div>
                          <h4 className="text-sm font-medium mb-3">Zugeordnete Dokumente ({selectedDocuments.length})</h4>
                          <Tabs defaultValue={selectedDocuments[0]?.id} className="space-y-4">
                            <TabsList className="grid w-full grid-cols-4 gap-1">
                              {selectedDocuments.slice(0, 4).map(doc => (
                                <TabsTrigger key={doc.id} value={doc.id} className="text-xs">
                                  {doc.file_name.length > 15 ? `${doc.file_name.substring(0, 15)}...` : doc.file_name}
                                </TabsTrigger>
                              ))}
                            </TabsList>
                            {selectedDocuments.map(doc => (
                              <TabsContent key={doc.id} value={doc.id} className="space-y-4">
                                <DocumentViewer document={doc} />
                              </TabsContent>
                            ))}
                          </Tabs>
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                          <h4 className="text-sm font-medium mb-2">Keine Dokumente zugeordnet</h4>
                          <p className="text-xs text-muted-foreground mb-4">
                            Für dieses Konto wurden noch keine Belege zugeordnet.
                          </p>
                        </div>
                      )}

                      {/* Comments Section */}
                      <div className="mt-6 space-y-3">
                        <h4 className="text-sm font-medium">Kommentar</h4>
                        <Textarea
                          placeholder="Kommentar für dieses Konto hinzufügen..."
                          value={accountComments[selectedAccountData.id] || ""}
                          onChange={(e) => handleCommentChange(selectedAccountData.id, e.target.value)}
                          className="min-h-[100px]"
                        />
                        {loadedComments[selectedAccountData.id] && (
                          <p className="text-xs text-muted-foreground">
                            Kommentar wurde geladen
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <Eye className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2">Kein Konto ausgewählt</h3>
                      <p className="text-muted-foreground">
                        Wählen Sie ein Konto aus der Liste links aus, um Details anzuzeigen.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* Floating Calculator */}
        <Calculator />
      </div>
    </TooltipProvider>
  );
};

export default Review;