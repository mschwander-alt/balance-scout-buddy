import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, XCircle, Clock, Search, FileText, ArrowLeft } from 'lucide-react';

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
  description?: string;
  extracted_amounts?: number[];
}

const Review = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  
  const trialBalanceId = searchParams.get('trial_balance_id') || '';
  
  const [assignments, setAssignments] = useState<AccountAssignment[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const loadData = useCallback(async () => {
    if (!user || !trialBalanceId) return;

    try {
      // Load account assignments with groups
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('account_group_assignments')
        .select(`
          *,
          account_groups (
            id,
            name
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
      const processedAssignments = (assignmentsData || []).map(assignment => ({
        id: assignment.id,
        account_number: assignment.account_number,
        account_name: assignment.account_name,
        current_year_balance: assignment.current_year_balance,
        previous_year_balance: assignment.previous_year_balance,
        foreign_currency_balance: assignment.foreign_currency_balance,
        account_group_id: assignment.account_group_id,
        account_group_name: assignment.account_groups?.name || 'Unbekannte Gruppe',
        match_status: 'pending' as const,
        confidence_score: 0,
        matched_documents: []
      }));

      setAssignments(processedAssignments);
      setDocuments(documentsData || []);

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
      setAssignments(data.matched_assignments || []);
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
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR'
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
              <div className="flex items-center gap-4">
                <Button 
                  onClick={startAutoMatch}
                  disabled={isProcessing || assignments.length === 0}
                  className="flex items-center gap-2"
                >
                  <Search className="h-4 w-4" />
                  {isProcessing ? 'Prüfung läuft...' : 'Prüfung starten'}
                </Button>
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
                  {assignments.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>Keine Konten gefunden</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Konto</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignments.map((assignment) => (
                          <TableRow 
                            key={assignment.id}
                            className={`cursor-pointer hover:bg-muted/50 ${
                              selectedAccount === assignment.id ? 'bg-muted' : ''
                            }`}
                            onClick={() => setSelectedAccount(assignment.id)}
                          >
                            <TableCell>
                              <div>
                                <div className="font-medium">{assignment.account_number}</div>
                                <div className="text-sm text-muted-foreground">
                                  {assignment.account_name}
                                </div>
                                <Badge variant="outline" className="text-xs mt-1">
                                  {assignment.account_group_name}
                                </Badge>
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
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Right Side - Document Viewer */}
            <Card>
              <CardHeader>
                <CardTitle>Gefundene Nachweise</CardTitle>
                <CardDescription>
                  {selectedAccountData 
                    ? `Nachweise für Konto ${selectedAccountData.account_number}`
                    : 'Wählen Sie ein Konto aus der Liste aus'
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedAccountData ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Wählen Sie ein Konto aus der Liste aus</p>
                    <p className="text-sm">um die zugehörigen Nachweise anzuzeigen</p>
                  </div>
                ) : selectedDocuments.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <XCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Keine Nachweise gefunden</p>
                    <p className="text-sm">Für dieses Konto wurden keine passenden Dokumente gefunden</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedDocuments.map((document) => (
                      <Card key={document.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium">{document.file_name}</h4>
                              {document.description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {document.description}
                                </p>
                              )}
                              {document.extracted_amounts && document.extracted_amounts.length > 0 && (
                                <div className="mt-2">
                                  <p className="text-sm font-medium">Gefundene Beträge:</p>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {document.extracted_amounts.map((amount, index) => (
                                      <Badge key={index} variant="secondary">
                                        {formatCurrency(amount)}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            <Badge variant="outline">
                              {document.file_type.includes('pdf') ? 'PDF' : 
                               document.file_type.includes('excel') ? 'Excel' : 'Word'}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
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