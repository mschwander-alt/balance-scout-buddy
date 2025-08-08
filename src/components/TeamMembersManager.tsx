import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Users, Plus, Trash2, Edit, User } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'auditor' | 'senior_auditor' | 'manager' | 'partner';
}

interface TeamMembersManagerProps {
  onTeamMembersChange?: (members: TeamMember[]) => void;
}

const TeamMembersManager = ({ onTeamMembersChange }: TeamMembersManagerProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'auditor' as TeamMember['role']
  });

  useEffect(() => {
    loadTeamMembers();
  }, []);

  const loadTeamMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const typedData: TeamMember[] = (data || []).map(member => ({
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role as TeamMember['role']
      }));

      setTeamMembers(typedData);
      onTeamMembersChange?.(typedData);
    } catch (error: any) {
      console.error('Error loading team members:', error);
      toast({
        title: "Fehler beim Laden der Team-Mitglieder",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) return;

    try {
      if (editingMember) {
        // Update existing member
        const { error } = await supabase
          .from('team_members')
          .update({
            name: formData.name,
            email: formData.email,
            role: formData.role,
          })
          .eq('id', editingMember.id);

        if (error) throw error;

        toast({
          title: "Team-Mitglied aktualisiert",
          description: `${formData.name} wurde erfolgreich aktualisiert.`,
        });
      } else {
        // Create new member
        const { error } = await supabase
          .from('team_members')
          .insert({
            user_id: user.id,
            name: formData.name,
            email: formData.email,
            role: formData.role,
          });

        if (error) throw error;

        toast({
          title: "Team-Mitglied hinzugefügt",
          description: `${formData.name} wurde erfolgreich hinzugefügt.`,
        });
      }

      setFormData({ name: '', email: '', role: 'auditor' });
      setEditingMember(null);
      setIsDialogOpen(false);
      loadTeamMembers();
    } catch (error: any) {
      console.error('Error saving team member:', error);
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEdit = (member: TeamMember) => {
    setEditingMember(member);
    setFormData({
      name: member.name,
      email: member.email,
      role: member.role,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (memberId: string, memberName: string) => {
    if (!confirm(`Sind Sie sicher, dass Sie ${memberName} löschen möchten?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      toast({
        title: "Team-Mitglied gelöscht",
        description: `${memberName} wurde erfolgreich gelöscht.`,
      });

      loadTeamMembers();
    } catch (error: any) {
      console.error('Error deleting team member:', error);
      toast({
        title: "Fehler beim Löschen",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getRoleLabel = (role: TeamMember['role']) => {
    const labels = {
      auditor: 'Prüfer',
      senior_auditor: 'Senior Prüfer',
      manager: 'Manager',
      partner: 'Partner'
    };
    return labels[role];
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Team-Mitglieder verwalten
        </CardTitle>
        <CardDescription>
          Verwalten Sie Ihr Prüfungsteam und ordnen Sie später Prüfungsgebiete zu
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center">
          <h4 className="text-sm font-medium">Team-Mitglieder ({teamMembers.length})</h4>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => {
                setEditingMember(null);
                setFormData({ name: '', email: '', role: 'auditor' });
              }}>
                <Plus className="h-4 w-4 mr-2" />
                Mitglied hinzufügen
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingMember ? 'Team-Mitglied bearbeiten' : 'Neues Team-Mitglied'}
                </DialogTitle>
                <DialogDescription>
                  {editingMember ? 'Bearbeiten Sie die Daten des Team-Mitglieds' : 'Fügen Sie ein neues Team-Mitglied hinzu'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Max Mustermann"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="email">E-Mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="max.mustermann@example.com"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="role">Rolle</Label>
                  <Select value={formData.role} onValueChange={(value) => setFormData(prev => ({ ...prev, role: value as TeamMember['role'] }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auditor">Prüfer</SelectItem>
                      <SelectItem value="senior_auditor">Senior Prüfer</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Abbrechen
                  </Button>
                  <Button type="submit">
                    {editingMember ? 'Aktualisieren' : 'Hinzufügen'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-2">
          {teamMembers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Noch keine Team-Mitglieder hinzugefügt</p>
            </div>
          ) : (
            teamMembers.map((member) => (
              <div key={member.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-sm text-muted-foreground">{member.email} • {getRoleLabel(member.role)}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleEdit(member)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(member.id, member.name)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default TeamMembersManager;