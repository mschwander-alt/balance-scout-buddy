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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import AssignmentManager from './AssignmentManager';

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

      // Function to parse numbers with Swiss/German formatting
      const parseSwissNumber = (value: any): number => {
        if (value === null || value === undefined || value === '') return 0;
        
        let numStr = String(value).trim();
        if (numStr === '' || numStr === '-') return 0;
        
        // Handle negative numbers
        const isNegative = numStr.startsWith('-') || numStr.endsWith('-');
        numStr = numStr.replace(/^-|-$/g, '');
        
        // Remove any currency symbols and spaces
        numStr = numStr.replace(/[€$CHF\s]/g, '');
        
        // Handle different number formats
        // Swiss/German: 1'234'567.89 or 1.234.567,89 or 1 234 567,89
        // Check if last comma is decimal separator (has 1-3 digits after it)
        const lastCommaIndex = numStr.lastIndexOf(',');
        const lastDotIndex = numStr.lastIndexOf('.');
        
        if (lastCommaIndex > lastDotIndex && lastCommaIndex > 0) {
          // Last comma is likely decimal separator
          const afterComma = numStr.substring(lastCommaIndex + 1);
          if (afterComma.length <= 3 && /^\d+$/.test(afterComma)) {
            // Remove thousand separators (dots, apostrophes, spaces) before comma
            const beforeComma = numStr.substring(0, lastCommaIndex).replace(/[.''\s]/g, '');
            numStr = beforeComma + '.' + afterComma;
          }
        } else if (lastDotIndex > lastCommaIndex && lastDotIndex > 0) {
          // Last dot is likely decimal separator
          const afterDot = numStr.substring(lastDotIndex + 1);
          if (afterDot.length <= 3 && /^\d+$/.test(afterDot)) {
            // Remove thousand separators (commas, apostrophes, spaces) before dot
            const beforeDot = numStr.substring(0, lastDotIndex).replace(/[,''\s]/g, '');
            numStr = beforeDot + '.' + afterDot;
          }
        } else {
          // No decimal separator, just remove thousand separators
          numStr = numStr.replace(/[.,''\s]/g, '');
        }
        
        const result = parseFloat(numStr) || 0;
        return isNegative ? -result : result;
      };

      const parsedData: TrialBalanceRow[] = dataRows
        .filter(row => row[accountNumberIndex] && row[accountNameIndex])
        .map(row => ({
          accountNumber: String(row[accountNumberIndex] || '').trim(),
          accountName: String(row[accountNameIndex] || '').trim(),
          currentYear: parseSwissNumber(row[currentYearIndex]),
          previousYear: parseSwissNumber(row[previousYearIndex]),
          foreignCurrency: foreignCurrencyIndex >= 0 
            ? parseSwissNumber(row[foreignCurrencyIndex]) || undefined
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
          currentYear: assignment.current_year_balance || 0,
          previousYear: assignment.previous_year_balance || 0,
          foreignCurrency: assignment.foreign_currency_balance || undefined
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
                          value={groupFormData.assigned_member_id || "unassigned"} 
                          onValueChange={(value) => setGroupFormData(prev => ({ 
                            ...prev, 
                            assigned_member_id: value === "unassigned" ? "" : value 
                          }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Team-Mitglied auswählen (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Noch nicht zuordnen</SelectItem>
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

        {/* Tabbed Account Tables */}
        <Card>
          <CardHeader>
            <CardTitle>Konto-Übersicht</CardTitle>
            <CardDescription>
              Alle Konten nach Bilanz und Erfolgsrechnung getrennt. Verwenden Sie Drag & Drop zum Verschieben zwischen Gruppen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="accounts" className="w-full">
              <TabsList className="grid w-full grid-cols-3 bg-primary/10 border border-primary/20 mb-6">
                <TabsTrigger 
                  value="accounts"
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg font-semibold"
                >
                  Konto-Übersicht
                </TabsTrigger>
                <TabsTrigger 
                  value="assignments"
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg font-semibold"
                >
                  Zuordnungen
                </TabsTrigger>
                <TabsTrigger 
                  value="overview"
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg font-semibold"
                >
                  Team-Übersicht
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="accounts" className="space-y-4">
                <Tabs defaultValue="bilanz" className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-muted/10 border-0 h-8 p-0 mb-4">
                <TabsTrigger 
                  value="bilanz"
                  className="data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-sm text-sm font-medium"
                >
                  Bilanz
                </TabsTrigger>
                <TabsTrigger 
                  value="erfolgsrechnung"
                  className="data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-sm text-sm font-medium"
                >
                  Erfolgsrechnung
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="bilanz" className="space-y-4">
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
                          ...accountGroups.filter(group => group.description?.includes('Umlaufvermögen') || group.description?.includes('Anlagevermögen') || group.description?.includes('Fremdkapital') || group.description?.includes('Eigenkapital')).flatMap(group => group.accounts.map(acc => acc.accountNumber)),
                          ...unassignedAccounts.filter(acc => acc.accountNumber.match(/^[12]/)).map(acc => acc.accountNumber)
                        ]}
                        strategy={verticalListSortingStrategy}
                      >
                        {/* Render Balance Sheet Groups */}
                        {accountGroups
                          .filter(group => group.description?.includes('Umlaufvermögen') || group.description?.includes('Anlagevermögen') || group.description?.includes('Fremdkapital') || group.description?.includes('Eigenkapital'))
                          .map((group) => (
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

                        {/* Unassigned Balance Sheet Accounts */}
                        {unassignedAccounts.filter(acc => acc.accountNumber.match(/^[12]/)).length > 0 && (
                          <React.Fragment>
                            {/* Unassigned Header Row */}
                            <TableRow className="bg-muted/20 border-t-2">
                              <TableCell colSpan={hasForeignCurrency ? 7 : 6} className="py-4">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-muted-foreground">
                                    Unzugeordnete Bilanzkonten ({unassignedAccounts.filter(acc => acc.accountNumber.match(/^[12]/)).length})
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                            
                            {/* Unassigned Accounts */}
                            {unassignedAccounts.filter(acc => acc.accountNumber.match(/^[12]/)).map((account) => (
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
              </TabsContent>
              
              <TabsContent value="erfolgsrechnung" className="space-y-4">
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
                          ...accountGroups.filter(group => !group.description?.includes('Umlaufvermögen') && !group.description?.includes('Anlagevermögen') && !group.description?.includes('Fremdkapital') && !group.description?.includes('Eigenkapital')).flatMap(group => group.accounts.map(acc => acc.accountNumber)),
                          ...unassignedAccounts.filter(acc => !acc.accountNumber.match(/^[12]/)).map(acc => acc.accountNumber)
                        ]}
                        strategy={verticalListSortingStrategy}
                      >
                        {/* Render Income Statement Groups */}
                        {accountGroups
                          .filter(group => !group.description?.includes('Umlaufvermögen') && !group.description?.includes('Anlagevermögen') && !group.description?.includes('Fremdkapital') && !group.description?.includes('Eigenkapital'))
                          .map((group) => (
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

                        {/* Unassigned Income Statement Accounts */}
                        {unassignedAccounts.filter(acc => !acc.accountNumber.match(/^[12]/)).length > 0 && (
                          <React.Fragment>
                            {/* Unassigned Header Row */}
                            <TableRow className="bg-muted/20 border-t-2">
                              <TableCell colSpan={hasForeignCurrency ? 7 : 6} className="py-4">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-muted-foreground">
                                    Unzugeordnete Erfolgsrechnungskonten ({unassignedAccounts.filter(acc => !acc.accountNumber.match(/^[12]/)).length})
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                            
                            {/* Unassigned Accounts */}
                            {unassignedAccounts.filter(acc => !acc.accountNumber.match(/^[12]/)).map((account) => (
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
              </TabsContent>
                </Tabs>
              </TabsContent>
              
              <TabsContent value="assignments" className="space-y-4">
                <AssignmentManager 
                  trialBalanceId={trialBalanceId}
                  onAssignmentsUpdated={loadAccountGroups}
                />
              </TabsContent>
              
              <TabsContent value="overview" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Team-Übersicht</CardTitle>
                    <CardDescription>
                      Überblick über alle Team-Mitglieder und ihre zugeordneten Aufgaben
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4">
                      {teamMembers.map(member => {
                        const assignedGroups = accountGroups.filter(g => g.assigned_member_id === member.id);
                        const totalAccounts = assignedGroups.reduce((sum, group) => sum + group.accounts.length, 0);
                        
                        return (
                          <div key={member.id} className="p-4 border rounded-lg">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <User className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                  <div className="font-medium">{member.name}</div>
                                  <div className="text-sm text-muted-foreground">{member.email} • {member.role}</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-2xl font-bold text-primary">{assignedGroups.length}</div>
                                <div className="text-sm text-muted-foreground">Gruppen</div>
                              </div>
                            </div>
                            
                            {assignedGroups.length > 0 ? (
                              <div className="space-y-2">
                                <div className="text-sm font-medium">Zugeordnete Gruppierungen:</div>
                                <div className="grid gap-2">
                                  {assignedGroups.map(group => (
                                    <div key={group.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                                      <span className="text-sm">{group.name}</span>
                                      <div className="flex items-center gap-2">
                                        <Badge variant="outline">{group.accounts.length} Konten</Badge>
                                        {getStatusBadge(group.status)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="text-xs text-muted-foreground mt-2">
                                  Insgesamt {totalAccounts} Konten zugeordnet
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm text-muted-foreground">
                                Keine Gruppierungen zugeordnet
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-center gap-4">
          <Button variant="outline" onClick={() => window.location.href = '/'}>
            Zurück zum Dashboard
          </Button>
          <Button onClick={onGroupingComplete}>
            {accountGroups.length > 0 
              ? "Weiter zur Dokumentenprüfung" 
              : "Ohne Gruppierungen fortfahren"}
          </Button>
        </div>
      </div>
    </DndContext>
  );
};

export default AccountGrouping;
