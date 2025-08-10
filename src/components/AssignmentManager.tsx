import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Users, UserCheck, Clock, CheckCircle, AlertCircle, User } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AccountGroup {
  id: string;
  name: string;
  description?: string;
  assigned_member_id?: string;
  assigned_member?: TeamMember;
  status: 'pending' | 'in_progress' | 'completed' | 'reviewed';
  account_count: number;
  is_temp?: boolean; // For temp account matches
}

interface AssignmentManagerProps {
  trialBalanceId: string;
  onAssignmentsUpdated?: () => void;
}

const AssignmentManager = ({ trialBalanceId, onAssignmentsUpdated }: AssignmentManagerProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAssignments, setPendingAssignments] = useState<{ [groupId: string]: string }>({});

  useEffect(() => {
    loadData();
  }, [trialBalanceId]);

  const loadData = async () => {
    try {
      // First, check if we have account groups
      const { data: groupsData, error: groupsError } = await supabase
        .from('account_groups')
        .select(`
          *,
          assigned_member:team_members(id, name, email, role),
          account_group_assignments(id)
        `)
        .eq('trial_balance_id', trialBalanceId)
        .order('created_at', { ascending: true });

      if (groupsError) throw groupsError;

      let groups: AccountGroup[] = [];

      if (groupsData && groupsData.length > 0) {
        // We have account groups, use them
        groups = groupsData.map(group => ({
          id: group.id,
          name: group.name,
          description: group.description,
          assigned_member_id: group.assigned_member_id,
          assigned_member: group.assigned_member,
          status: group.status as AccountGroup['status'],
          account_count: group.account_group_assignments?.length || 0,
          is_temp: false
        }));
      } else {
        // No account groups, check for temp matches and create them if needed
        const { data: tempMatchesData, error: tempError } = await supabase
          .from('temp_account_matches')
          .select('*')
          .eq('trial_balance_id', trialBalanceId)
          .order('account_number', { ascending: true });

        if (tempError) throw tempError;

        if (!tempMatchesData || tempMatchesData.length === 0) {
          // No temp matches exist, create them using the unified auto-match function
          try {
            const { data: matchResult, error: matchError } = await supabase.functions.invoke('unified-auto-match', {
              body: { trial_balance_id: trialBalanceId }
            });

            if (matchError) throw matchError;

            // Reload temp matches after creation
            const { data: newTempMatchesData, error: newTempError } = await supabase
              .from('temp_account_matches')
              .select('*')
              .eq('trial_balance_id', trialBalanceId)
              .order('account_number', { ascending: true });

            if (newTempError) throw newTempError;
            
            if (newTempMatchesData && newTempMatchesData.length > 0) {
              // Load team members for assigned temp matches
              const tempMatchesWithMembers = await Promise.all(
                newTempMatchesData.map(async (match) => {
                  let assignedMember = null;
                  if (match.assigned_member_id) {
                    const { data: memberData } = await supabase
                      .from('team_members')
                      .select('*')
                      .eq('id', match.assigned_member_id)
                      .single();
                    assignedMember = memberData;
                  }
                  
                  return {
                    id: match.id,
                    name: `${match.account_number} - ${match.account_name}`,
                    description: `Saldo: ${match.current_year_balance?.toLocaleString() || 0}`,
                    assigned_member_id: match.assigned_member_id,
                    assigned_member: assignedMember,
                    status: (match.match_status === 'assigned' ? 'in_progress' : 'pending') as AccountGroup['status'],
                    account_count: 1,
                    is_temp: true
                  };
                })
              );
              
              groups = tempMatchesWithMembers;
            }
          } catch (error) {
            console.error('Error creating temp matches:', error);
            toast({
              title: "Fehler beim Erstellen der temporären Zuordnungen",
              description: "Die Konten konnten nicht geladen werden.",
              variant: "destructive",
            });
          }
        } else if (tempMatchesData && tempMatchesData.length > 0) {
          // Load team members for existing temp matches
          const tempMatchesWithMembers = await Promise.all(
            tempMatchesData.map(async (match) => {
              let assignedMember = null;
              if (match.assigned_member_id) {
                const { data: memberData } = await supabase
                  .from('team_members')
                  .select('*')
                  .eq('id', match.assigned_member_id)
                  .single();
                assignedMember = memberData;
              }
              
              return {
                id: match.id,
                name: `${match.account_number} - ${match.account_name}`,
                description: `Saldo: ${match.current_year_balance?.toLocaleString() || 0}`,
                assigned_member_id: match.assigned_member_id,
                assigned_member: assignedMember,
                status: (match.match_status === 'assigned' ? 'in_progress' : 'pending') as AccountGroup['status'],
                account_count: 1,
                is_temp: true
              };
            })
          );
          
          groups = tempMatchesWithMembers;
        }
      }

      setAccountGroups(groups);

      // Load team members
      const { data: membersData, error: membersError } = await supabase
        .from('team_members')
        .select('*')
        .order('name', { ascending: true });

      if (membersError) throw membersError;
      setTeamMembers(membersData || []);

    } catch (error: any) {
      console.error('Error loading assignment data:', error);
      toast({
        title: "Fehler beim Laden der Zuordnungen",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssignmentChange = (groupId: string, memberId: string) => {
    // Convert "unassigned" back to empty string for database
    const actualMemberId = memberId === "unassigned" ? "" : memberId;
    setPendingAssignments(prev => ({
      ...prev,
      [groupId]: actualMemberId
    }));
  };

  const saveAssignment = async (groupId: string) => {
    const memberId = pendingAssignments[groupId];
    const group = accountGroups.find(g => g.id === groupId);
    
    try {
      let error;
      
      if (group?.is_temp) {
        // Update temp_account_matches table
        const { error: tempError } = await supabase
          .from('temp_account_matches')
          .update({
            assigned_member_id: memberId || null,
            match_status: memberId ? 'assigned' : 'pending'
          })
          .eq('id', groupId);
        error = tempError;
      } else {
        // Update account_groups table
        const { error: groupError } = await supabase
          .from('account_groups')
          .update({
            assigned_member_id: memberId || null,
            status: memberId ? 'pending' : 'pending'
          })
          .eq('id', groupId);
        error = groupError;
      }

      if (error) throw error;

      toast({
        title: "Zuordnung gespeichert",
        description: memberId ? "Team-Mitglied wurde zugeordnet" : "Zuordnung wurde entfernt",
      });

      // Remove from pending and reload data
      setPendingAssignments(prev => {
        const updated = { ...prev };
        delete updated[groupId];
        return updated;
      });

      loadData();
      onAssignmentsUpdated?.();

    } catch (error: any) {
      console.error('Error saving assignment:', error);
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const bulkAssign = async () => {
    const updates = Object.entries(pendingAssignments);
    if (updates.length === 0) return;

    try {
      for (const [groupId, memberId] of updates) {
        const group = accountGroups.find(g => g.id === groupId);
        
        if (group?.is_temp) {
          // Update temp_account_matches table
          await supabase
            .from('temp_account_matches')
            .update({
              assigned_member_id: memberId || null,
              match_status: memberId ? 'assigned' : 'pending'
            })
            .eq('id', groupId);
        } else {
          // Update account_groups table
          await supabase
            .from('account_groups')
            .update({
              assigned_member_id: memberId || null,
              status: memberId ? 'pending' : 'pending'
            })
            .eq('id', groupId);
        }
      }

      toast({
        title: "Bulk-Zuordnung abgeschlossen",
        description: `${updates.length} Gruppierungen wurden aktualisiert`,
      });

      setPendingAssignments({});
      loadData();
      onAssignmentsUpdated?.();

    } catch (error: any) {
      console.error('Error in bulk assignment:', error);
      toast({
        title: "Fehler bei Bulk-Zuordnung",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = (status: AccountGroup['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'in_progress':
        return <AlertCircle className="h-4 w-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'reviewed':
        return <UserCheck className="h-4 w-4 text-purple-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
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

  const getAssignmentStats = () => {
    const total = accountGroups.length;
    const assigned = accountGroups.filter(g => g.assigned_member_id).length;
    const unassigned = total - assigned;
    const byMember = teamMembers.map(member => ({
      member,
      count: accountGroups.filter(g => g.assigned_member_id === member.id).length
    }));

    return { total, assigned, unassigned, byMember };
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    );
  }

  const stats = getAssignmentStats();
  const hasPendingChanges = Object.keys(pendingAssignments).length > 0;

  return (
    <div className="space-y-6">
      {/* Assignment Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Zuordnungsübersicht
          </CardTitle>
          <CardDescription>
            Verwalten Sie die Zuordnung von Prüfungsgebieten an Team-Mitglieder
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{stats.total}</div>
              <div className="text-sm text-muted-foreground">Gesamt Gruppen</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{stats.assigned}</div>
              <div className="text-sm text-muted-foreground">Zugeordnet</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{stats.unassigned}</div>
              <div className="text-sm text-muted-foreground">Nicht zugeordnet</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{teamMembers.length}</div>
              <div className="text-sm text-muted-foreground">Team-Mitglieder</div>
            </div>
          </div>

          {/* Team Member Assignment Overview */}
          <div className="grid gap-2">
            <h4 className="font-medium">Zuordnungen pro Team-Mitglied:</h4>
            {stats.byMember.map(({ member, count }) => (
              <div key={member.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span className="font-medium">{member.name}</span>
                  <span className="text-sm text-muted-foreground">({member.role})</span>
                </div>
                <Badge variant={count > 0 ? "default" : "secondary"}>
                  {count} Gruppen
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Assignment Management */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="text-left">
              <CardTitle className="text-left">Zuordnungen verwalten</CardTitle>
              <CardDescription className="text-left">
                Ordnen Sie Gruppierungen einzelnen Team-Mitgliedern zu
              </CardDescription>
            </div>
            {hasPendingChanges && (
              <Button onClick={bulkAssign}>
                Alle Änderungen speichern ({Object.keys(pendingAssignments).length})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Gruppierung</TableHead>
                  <TableHead>Konten</TableHead>
                  <TableHead>Aktuell zugeordnet</TableHead>
                  <TableHead>Neue Zuordnung</TableHead>
                  <TableHead>Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountGroups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(group.status)}
                        {getStatusBadge(group.status)}
                      </div>
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="text-left">
                        <div className="font-medium text-left">{group.name}</div>
                        {group.description && (
                          <div className="text-sm text-muted-foreground text-left">{group.description}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{group.account_count} Konten</Badge>
                    </TableCell>
                    <TableCell>
                      {group.assigned_member ? (
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          <span>{group.assigned_member.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Nicht zugeordnet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={pendingAssignments[group.id] !== undefined 
                          ? (pendingAssignments[group.id] || "unassigned")
                          : (group.assigned_member_id || "unassigned")}
                        onValueChange={(value) => handleAssignmentChange(group.id, value)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Team-Mitglied auswählen" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Nicht zugeordnet</SelectItem>
                          {teamMembers.map((member) => (
                            <SelectItem key={member.id} value={member.id}>
                              {member.name} ({member.role})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {pendingAssignments[group.id] !== undefined && (
                        <Button
                          size="sm"
                          onClick={() => saveAssignment(group.id)}
                          disabled={
                            (pendingAssignments[group.id] || "") === (group.assigned_member_id || "")
                          }
                        >
                          Speichern
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AssignmentManager;