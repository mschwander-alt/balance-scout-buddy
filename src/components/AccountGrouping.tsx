import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Layers, Plus, Save, User, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import * as XLSX from 'xlsx';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface TrialBalanceRow {
  accountNumber: string;
  accountName: string;
  currentYear: number;
  previousYear: number;
  foreignCurrency?: number;
}

interface AccountGroup {
  id: string;
  name: string;
  description?: string;
  assigned_member_id?: string;
  assigned_member?: TeamMember;
  status: 'pending' | 'in_progress' | 'completed' | 'reviewed';
  accounts: TrialBalanceRow[];
}

interface AccountGroupingProps {
  trialBalanceId: string;
  trialBalanceData: any;
  onGroupingComplete: () => void;
}

const AccountGrouping = ({ trialBalanceId, trialBalanceData, onGroupingComplete }: AccountGroupingProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [trialBalanceRows, setTrialBalanceRows] = useState<TrialBalanceRow[]>([]);
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  
  const [groupFormData, setGroupFormData] = useState({
    name: '',
    description: '',
    assigned_member_id: ''
  });

  useEffect(() => {
    loadData();
  }, [trialBalanceId]);

  const loadData = async () => {
    await Promise.all([
      loadTrialBalanceData(),
      loadAccountGroups(),
      loadTeamMembers()
    ]);
    setIsLoading(false);
  };

  const loadTrialBalanceData = async () => {
    try {
      // Download and parse Excel file to get trial balance data
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('trial-balances')
        .download(trialBalanceData.file_path);

      if (downloadError) throw downloadError;

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
      const foreignCurrencyIndex = trialBalanceData.foreign_currency_column 
        ? headers.findIndex(h => h === trialBalanceData.foreign_currency_column)
        : -1;

      const parsedData: TrialBalanceRow[] = dataRows
        .filter(row => row[accountNumberIndex] && row[accountNameIndex])
        .map(row => ({
          accountNumber: String(row[accountNumberIndex] || '').trim(),
          accountName: String(row[accountNameIndex] || '').trim(),
          currentYear: parseFloat(String(row[currentYearIndex] || 0)) || 0,
          previousYear: parseFloat(String(row[previousYearIndex] || 0)) || 0,
          foreignCurrency: foreignCurrencyIndex >= 0 
            ? (parseFloat(String(row[foreignCurrencyIndex] || 0)) || undefined)
            : undefined
        }));

      setTrialBalanceRows(parsedData);
    } catch (error: any) {
      console.error('Error loading trial balance data:', error);
      toast({
        title: "Fehler beim Laden der Saldobilanz",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const loadAccountGroups = async () => {
    try {
      const { data, error } = await supabase
        .from('account_groups')
        .select(`
          *,
          assigned_member:team_members(id, name, email, role),
          account_group_assignments(*)
        `)
        .eq('trial_balance_id', trialBalanceId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const groups: AccountGroup[] = (data || []).map(group => ({
        id: group.id,
        name: group.name,
        description: group.description,
        assigned_member_id: group.assigned_member_id,
        assigned_member: group.assigned_member,
        status: group.status as AccountGroup['status'],
        accounts: (group.account_group_assignments || []).map((assignment: any) => ({
          accountNumber: assignment.account_number,
          accountName: assignment.account_name,
          currentYear: parseFloat(assignment.current_year_balance),
          previousYear: parseFloat(assignment.previous_year_balance),
          foreignCurrency: assignment.foreign_currency_balance ? parseFloat(assignment.foreign_currency_balance) : undefined
        }))
      }));

      setAccountGroups(groups);
    } catch (error: any) {
      console.error('Error loading account groups:', error);
      toast({
        title: "Fehler beim Laden der Gruppierungen",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const loadTeamMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      setTeamMembers(data || []);
    } catch (error: any) {
      console.error('Error loading team members:', error);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user || selectedAccounts.size === 0) {
      toast({
        title: "Fehler",
        description: "Bitte wählen Sie mindestens ein Konto aus.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create the group
      const { data: groupData, error: groupError } = await supabase
        .from('account_groups')
        .insert({
          trial_balance_id: trialBalanceId,
          user_id: user.id,
          name: groupFormData.name,
          description: groupFormData.description,
          assigned_member_id: groupFormData.assigned_member_id || null,
        })
        .select()
        .single();

      if (groupError) throw groupError;

      // Create assignments for selected accounts
      const selectedAccountsData = trialBalanceRows.filter(row => 
        selectedAccounts.has(row.accountNumber)
      );

      const assignments = selectedAccountsData.map(account => ({
        account_group_id: groupData.id,
        account_number: account.accountNumber,
        account_name: account.accountName,
        current_year_balance: account.currentYear,
        previous_year_balance: account.previousYear,
        foreign_currency_balance: account.foreignCurrency || null,
      }));

      const { error: assignmentError } = await supabase
        .from('account_group_assignments')
        .insert(assignments);

      if (assignmentError) throw assignmentError;

      toast({
        title: "Gruppierung erstellt",
        description: `"${groupFormData.name}" wurde mit ${selectedAccounts.size} Konten erstellt.`,
      });

      // Reset form
      setGroupFormData({ name: '', description: '', assigned_member_id: '' });
      setSelectedAccounts(new Set());
      setIsGroupDialogOpen(false);
      
      // Reload groups
      loadAccountGroups();
    } catch (error: any) {
      console.error('Error creating group:', error);
      toast({
        title: "Fehler beim Erstellen der Gruppierung",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const formatSwissNumber = (value: number): string => {
    return new Intl.NumberFormat('de-CH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const getUnassignedAccounts = () => {
    const assignedAccountNumbers = new Set(
      accountGroups.flatMap(group => group.accounts.map(acc => acc.accountNumber))
    );
    return trialBalanceRows.filter(row => !assignedAccountNumbers.has(row.accountNumber));
  };

  const getStatusBadge = (status: AccountGroup['status']) => {
    const variants = {
      pending: 'secondary',
      in_progress: 'outline',
      completed: 'default',
      reviewed: 'default'
    } as const;

    const labels = {
      pending: 'Ausstehend',
      in_progress: 'In Bearbeitung',
      completed: 'Abgeschlossen',
      reviewed: 'Geprüft'
    };

    return <Badge variant={variants[status]}>{labels[status]}</Badge>;
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-6xl mx-auto">
        <CardContent className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="text-muted-foreground">Saldobilanz wird analysiert...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const unassignedAccounts = getUnassignedAccounts();

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Konto-Gruppierungen erstellen
          </CardTitle>
          <CardDescription>
            Gruppieren Sie Konten und ordnen Sie diese Team-Mitgliedern zur Bearbeitung zu
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center">
            <div className="flex gap-4 text-sm">
              <span>Gesamt: <strong>{trialBalanceRows.length}</strong> Konten</span>
              <span>Unzugeordnet: <strong>{unassignedAccounts.length}</strong> Konten</span>
              <span>Gruppierungen: <strong>{accountGroups.length}</strong></span>
            </div>
            <Dialog open={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen}>
              <DialogTrigger asChild>
                <Button disabled={selectedAccounts.size === 0}>
                  <Plus className="h-4 w-4 mr-2" />
                  Neue Gruppierung ({selectedAccounts.size})
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Neue Gruppierung erstellen</DialogTitle>
                  <DialogDescription>
                    Erstellen Sie eine neue Gruppierung mit {selectedAccounts.size} ausgewählten Konten
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateGroup} className="space-y-4">
                  <div>
                    <Label htmlFor="groupName">Name der Gruppierung</Label>
                    <Input
                      id="groupName"
                      value={groupFormData.name}
                      onChange={(e) => setGroupFormData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="z.B. Kasse und Bank"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="groupDescription">Beschreibung (optional)</Label>
                    <Textarea
                      id="groupDescription"
                      value={groupFormData.description}
                      onChange={(e) => setGroupFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Zusätzliche Beschreibung der Gruppierung"
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label htmlFor="assignedMember">Zugeordnetes Team-Mitglied</Label>
                    <Select 
                      value={groupFormData.assigned_member_id} 
                      onValueChange={(value) => setGroupFormData(prev => ({ ...prev, assigned_member_id: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Team-Mitglied auswählen (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Noch nicht zuordnen</SelectItem>
                        {teamMembers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name} ({member.email})
                          </SelectItem>
                        ))}</SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsGroupDialogOpen(false)}>
                      Abbrechen
                    </Button>
                    <Button type="submit">
                      <Save className="h-4 w-4 mr-2" />
                      Gruppierung erstellen
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Existing Groups */}
      {accountGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bestehende Gruppierungen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              {accountGroups.map((group) => (
                <div key={group.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{group.name}</h4>
                      {getStatusBadge(group.status)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {group.assigned_member && (
                        <div className="flex items-center gap-1">
                          <User className="h-4 w-4" />
                          {group.assigned_member.name}
                        </div>
                      )}
                      <span>{group.accounts.length} Konten</span>
                    </div>
                  </div>
                  {group.description && (
                    <p className="text-sm text-muted-foreground mb-2">{group.description}</p>
                  )}
                  <div className="text-sm">
                    <strong>Konten:</strong> {group.accounts.map(acc => acc.accountNumber).join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unassigned Accounts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Unzugeordnete Konten ({unassignedAccounts.length})</CardTitle>
          <CardDescription>
            Wählen Sie Konten aus, um eine neue Gruppierung zu erstellen
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedAccounts.size === unassignedAccounts.length && unassignedAccounts.length > 0}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedAccounts(new Set(unassignedAccounts.map(acc => acc.accountNumber)));
                        } else {
                          setSelectedAccounts(new Set());
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead className="text-left">Kontonummer</TableHead>
                  <TableHead className="text-left">Kontobezeichnung</TableHead>
                  <TableHead className="text-right">Saldo {new Date().getFullYear()}</TableHead>
                  <TableHead className="text-right">Saldo {new Date().getFullYear() - 1}</TableHead>
                  {trialBalanceData.foreign_currency_column && (
                    <TableHead className="text-right">Fremdwährung</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {unassignedAccounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Alle Konten sind bereits gruppiert
                    </TableCell>
                  </TableRow>
                ) : (
                  unassignedAccounts.map((row, index) => (
                    <TableRow key={index} className="hover:bg-muted/25">
                      <TableCell>
                        <Checkbox
                          checked={selectedAccounts.has(row.accountNumber)}
                          onCheckedChange={(checked) => {
                            const newSelected = new Set(selectedAccounts);
                            if (checked) {
                              newSelected.add(row.accountNumber);
                            } else {
                              newSelected.delete(row.accountNumber);
                            }
                            setSelectedAccounts(newSelected);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-left font-mono">{row.accountNumber}</TableCell>
                      <TableCell className="text-left">{row.accountName}</TableCell>
                      <TableCell className="text-right font-mono">{formatSwissNumber(row.currentYear)}</TableCell>
                      <TableCell className="text-right font-mono">{formatSwissNumber(row.previousYear)}</TableCell>
                      {trialBalanceData.foreign_currency_column && (
                        <TableCell className="text-right font-mono">
                          {row.foreignCurrency !== undefined ? formatSwissNumber(row.foreignCurrency) : '-'}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-center gap-4">
        <Button onClick={onGroupingComplete}>
          Gruppierung abschließen
        </Button>
      </div>
    </div>
  );
};

export default AccountGrouping;
