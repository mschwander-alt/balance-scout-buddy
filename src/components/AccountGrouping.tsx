import React, { useState, useEffect } from 'react';
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
import { Layers, Plus, Save, User, Users, Zap, Sparkles, GripVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import * as XLSX from 'xlsx';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import {
  CSS,
} from '@dnd-kit/utilities';
import { AccountGroupSection } from './AccountGroupSection';
import { DraggableAccountRow } from './DraggableAccountRow';

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
  
  // ALL HOOKS MUST BE AT THE TOP - BEFORE ANY CONDITIONAL RETURNS
  const [isLoading, setIsLoading] = useState(true);
  const [trialBalanceRows, setTrialBalanceRows] = useState<TrialBalanceRow[]>([]);
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [isAutoGrouping, setIsAutoGrouping] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  const [groupFormData, setGroupFormData] = useState({
    name: '',
    description: '',
    assigned_member_id: ''
  });

  // Drag & drop sensors - MUST be with all other hooks at the top
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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

  const handleAutoGrouping = async () => {
    if (!user) return;
    
    setIsAutoGrouping(true);
    
    try {
      // Bereite die Kontodaten für die Edge Function vor
      const accountsData = trialBalanceRows.map(row => ({
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        currentYear: row.currentYear,
        previousYear: row.previousYear,
        foreignCurrency: row.foreignCurrency
      }));

      console.log('Sending accounts for auto-grouping:', accountsData.length);

      // Rufe die Edge Function auf
      const { data, error } = await supabase.functions.invoke('auto-group-accounts', {
        body: { accounts: accountsData }
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Unbekannter Fehler bei der automatischen Gruppierung');
      }

      const { suggestions, summary } = data;
      console.log('Auto-grouping results:', { suggestions, summary });

      // Erstelle die Gruppierungen automatisch
      let createdGroups = 0;
      for (const suggestion of suggestions) {
        if (suggestion.accounts.length > 0) {
          try {
            // Erstelle die Gruppe
            const { data: groupData, error: groupError } = await supabase
              .from('account_groups')
              .insert({
                trial_balance_id: trialBalanceId,
                user_id: user.id,
                name: suggestion.name,
                description: `${suggestion.description} (${suggestion.subcategory})`,
                status: 'pending'
              })
              .select()
              .single();

            if (groupError) throw groupError;

            // Erstelle die Zuordnungen
            const assignments = suggestion.accounts.map(account => ({
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

            createdGroups++;
          } catch (error) {
            console.error(`Fehler beim Erstellen der Gruppe "${suggestion.name}":`, error);
          }
        }
      }

      toast({
        title: "Automatische Gruppierung abgeschlossen",
        description: `${createdGroups} Gruppierungen nach Schweizer OR erstellt. ${summary.categorizedAccounts} von ${summary.totalAccounts} Konten wurden zugeordnet.`,
      });

      // Lade die aktualisierten Gruppierungen
      await loadAccountGroups();
      
    } catch (error: any) {
      console.error('Error in auto-grouping:', error);
      toast({
        title: "Fehler bei automatischer Gruppierung",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsAutoGrouping(false);
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
  const hasForeignCurrency = !!trialBalanceData.foreign_currency_column;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    const activeAccountNumber = active.id as string;
    const overItem = over.id as string;

    // Find source and destination groups
    let sourceGroup: AccountGroup | null = null;
    let destinationGroup: AccountGroup | null = null;

    // Check if dropped on a group (group ID) or another account
    if (overItem.startsWith('group-')) {
      const groupId = overItem.replace('group-', '');
      destinationGroup = accountGroups.find(g => g.id === groupId) || null;
    } else {
      // Find which group the target account belongs to
      destinationGroup = accountGroups.find(group => 
        group.accounts.some(acc => acc.accountNumber === overItem)
      ) || null;
    }

    // Find source group
    sourceGroup = accountGroups.find(group => 
      group.accounts.some(acc => acc.accountNumber === activeAccountNumber)
    ) || null;

    if (!destinationGroup || sourceGroup?.id === destinationGroup.id) return;

    // Move account between groups
    try {
      // Remove from source group
      if (sourceGroup) {
        await supabase
          .from('account_group_assignments')
          .delete()
          .eq('account_group_id', sourceGroup.id)
          .eq('account_number', activeAccountNumber);
      }

      // Add to destination group
      const account = sourceGroup?.accounts.find(acc => acc.accountNumber === activeAccountNumber) ||
                     unassignedAccounts.find(acc => acc.accountNumber === activeAccountNumber);

      if (account) {
        await supabase
          .from('account_group_assignments')
          .insert({
            account_group_id: destinationGroup.id,
            account_number: account.accountNumber,
            account_name: account.accountName,
            current_year_balance: account.currentYear,
            previous_year_balance: account.previousYear,
            foreign_currency_balance: account.foreignCurrency || null,
          });

        toast({
          title: "Konto verschoben",
          description: `${account.accountNumber} wurde zu "${destinationGroup.name}" verschoben.`,
        });

        // Reload groups
        loadAccountGroups();
      }
    } catch (error: any) {
      console.error('Error moving account:', error);
      toast({
        title: "Fehler beim Verschieben",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="w-full max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Konto-Gruppierungen erstellen
            </CardTitle>
            <CardDescription>
              Gruppieren Sie Konten und ordnen Sie diese Team-Mitgliedern zur Bearbeitung zu. Verwenden Sie Drag & Drop zum Umordnen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-center">
              <div className="flex gap-4 text-sm">
                <span>Gesamt: <strong>{trialBalanceRows.length}</strong> Konten</span>
                <span>Unzugeordnet: <strong>{unassignedAccounts.length}</strong> Konten</span>
                <span>Gruppierungen: <strong>{accountGroups.length}</strong></span>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={handleAutoGrouping}
                  disabled={isAutoGrouping || unassignedAccounts.length === 0}
                >
                  {isAutoGrouping ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Auto-Gruppierung (OR)
                </Button>
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
                            ))}
                          </SelectContent>
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
            </div>
          </CardContent>
        </Card>

        {/* Unified Account Table */}
        <Card>
          <CardHeader>
            <CardTitle>Konto-Übersicht</CardTitle>
            <CardDescription>
              Alle Konten in einer Übersicht. Verwenden Sie Drag & Drop zum Verschieben zwischen Gruppen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-8">
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
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="text-left">Kontonummer</TableHead>
                    <TableHead className="text-left">Kontobezeichnung</TableHead>
                    <TableHead className="text-right">Saldo Laufendes Jahr</TableHead>
                    <TableHead className="text-right">Saldo Vorjahr</TableHead>
                    {hasForeignCurrency && (
                      <TableHead className="text-right">Fremdwährung</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <SortableContext
                    items={[
                      ...accountGroups.flatMap(group => group.accounts.map(acc => acc.accountNumber)),
                      ...unassignedAccounts.map(acc => acc.accountNumber)
                    ]}
                    strategy={verticalListSortingStrategy}
                  >
                    {/* Render Account Groups */}
                    {accountGroups.map((group) => (
                      <React.Fragment key={`group-${group.id}`}>
                          {/* Group Header Row */}
                          <TableRow 
                            className="bg-primary/5 border-t-2 border-primary/20 cursor-pointer hover:bg-primary/10 transition-colors"
                            onClick={() => {
                              const newExpanded = new Set(expandedGroups);
                              if (expandedGroups.has(group.id)) {
                                newExpanded.delete(group.id);
                              } else {
                                newExpanded.add(group.id);
                              }
                              setExpandedGroups(newExpanded);
                            }}
                          >
                            <TableCell></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {expandedGroups.has(group.id) ? (
                                  <ChevronDown className="h-4 w-4 text-primary" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-primary" />
                                )}
                                <Layers className="h-4 w-4 text-primary" />
                              </div>
                            </TableCell>
                            <TableCell colSpan={2} className="text-left">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-primary">{group.name}</span>
                                {getStatusBadge(group.status)}
                                {group.assigned_member && (
                                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                    <User className="h-4 w-4" />
                                    {group.assigned_member.name}
                                  </div>
                                )}
                                <span className="text-sm text-muted-foreground">({group.accounts.length} Konten)</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              {formatSwissNumber(group.accounts.reduce((sum, acc) => sum + acc.currentYear, 0))}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              {formatSwissNumber(group.accounts.reduce((sum, acc) => sum + acc.previousYear, 0))}
                            </TableCell>
                            {hasForeignCurrency && (
                              <TableCell className="text-right font-mono font-semibold">
                                {formatSwissNumber(group.accounts.reduce((sum, acc) => sum + (acc.foreignCurrency || 0), 0))}
                              </TableCell>
                            )}
                          </TableRow>
                         
                         {/* Group Accounts - Only show when expanded */}
                         {expandedGroups.has(group.id) && group.accounts.map((account) => (
                           <DraggableAccountRow
                             key={account.accountNumber}
                             account={account}
                             hasForeignCurrency={hasForeignCurrency}
                             formatNumber={formatSwissNumber}
                             showCheckbox={false}
                           />
                         ))}
                      </React.Fragment>
                    ))}

                    {/* Unassigned Accounts Section */}
                    {unassignedAccounts.length > 0 && (
                      <React.Fragment>
                        {/* Unassigned Header Row */}
                        <TableRow className="bg-muted/20 border-t-2">
                          <TableCell colSpan={hasForeignCurrency ? 7 : 6} className="py-4">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-muted-foreground">
                                Unzugeordnete Konten ({unassignedAccounts.length})
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                        
                        {/* Unassigned Accounts */}
                        {unassignedAccounts.map((account) => (
                          <DraggableAccountRow
                            key={account.accountNumber}
                            account={account}
                            hasForeignCurrency={hasForeignCurrency}
                            formatNumber={formatSwissNumber}
                            showCheckbox={true}
                            isSelected={selectedAccounts.has(account.accountNumber)}
                            onSelectionChange={(checked) => {
                              const newSelection = new Set(selectedAccounts);
                              if (checked) {
                                newSelection.add(account.accountNumber);
                              } else {
                                newSelection.delete(account.accountNumber);
                              }
                              setSelectedAccounts(newSelection);
                            }}
                          />
                        ))}
                      </React.Fragment>
                    )}
                  </SortableContext>
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
    </DndContext>
  );
};

export default AccountGrouping;
