import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Package } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { saveAs } from "file-saver";

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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [hasGroups, setHasGroups] = useState(false);

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
    const balance = account.current_year_balance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
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

  const downloadCompletePackage = async () => {
    try {
      setDownloading(true);
      const zip = new JSZip();

      // Group accounts by assigned letter
      const accountsByLetter = accounts.reduce((acc, account) => {
        const letter = account.assigned_letter || 'UNASSIGNED';
        if (!acc[letter]) acc[letter] = [];
        acc[letter].push(account);
        return acc;
      }, {} as Record<string, Account[]>);

      let totalFileCounter = 1;

      for (const [letter, letterAccounts] of Object.entries(accountsByLetter)) {
        for (const account of letterAccounts) {
          const prefix = letter === 'UNASSIGNED' ? 'X' : letter;
          
          // Add cover sheet
          const coverSheet = generateCoverSheet(account);
          const coverFileName = `${prefix}_${totalFileCounter}_Deckblatt_${account.account_number}.txt`;
          zip.file(coverFileName, coverSheet);
          totalFileCounter++;

          // Add evidence files
          for (const evidenceFile of account.evidence_files || []) {
            try {
              const { data: fileData } = await supabase.storage
                .from('account-evidence')
                .download(evidenceFile.file_path);

              if (fileData) {
                const fileExtension = evidenceFile.file_name.split('.').pop() || 'pdf';
                const evidenceFileName = `${prefix}_${totalFileCounter}_${evidenceFile.file_name}`;
                zip.file(evidenceFileName, fileData);
                totalFileCounter++;
              }
            } catch (error) {
              console.error(`Error downloading file ${evidenceFile.file_name}:`, error);
              toast.error(`Fehler beim Download von ${evidenceFile.file_name}`);
            }
          }
        }
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
          <CardTitle>Kontenübersicht</CardTitle>
        </CardHeader>
        <CardContent>
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
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-mono">{account.account_number}</TableCell>
                  <TableCell>{account.account_name}</TableCell>
                  <TableCell className="text-right">
                    {account.current_year_balance.toLocaleString('de-DE', { 
                      style: 'currency', 
                      currency: 'EUR' 
                    })}
                  </TableCell>
                  <TableCell>{getStatusBadge(account.match_status)}</TableCell>
                  <TableCell>
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
                  <TableCell>
                    <Input
                      value={account.assigned_letter || ''}
                      onChange={(e) => updateAccountLetter(account.id, e.target.value)}
                      placeholder="A-Z"
                      maxLength={1}
                      className="w-12 text-center"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default CompleteDownloadManager;