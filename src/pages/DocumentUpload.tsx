import React, { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Upload, FileText, Download, Trash2, Plus } from 'lucide-react';
import { useDropzone } from 'react-dropzone';

interface AccountGroup {
  id: string;
  name: string;
  description?: string;
}

interface UploadedDocument {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  description?: string;
  account_group_id?: string;
  upload_date: string;
  account_group?: AccountGroup;
}

const DocumentUpload = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  
  const trialBalanceId = searchParams.get('trial_balance_id') || '';
  
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    description: '',
    account_group_id: ''
  });

  // Load existing documents and account groups
  const loadData = useCallback(async () => {
    if (!user || !trialBalanceId) return;

    try {
      // Load documents first
      const { data: docsData, error: docsError } = await supabase
        .from('account_evidence')
        .select('*')
        .eq('trial_balance_id', trialBalanceId)
        .order('upload_date', { ascending: false });

      if (docsError) throw docsError;

      // Load account groups
      const { data: groupsData, error: groupsError } = await supabase
        .from('account_groups')
        .select('id, name, description')
        .eq('trial_balance_id', trialBalanceId)
        .order('name', { ascending: true });

      if (groupsError) throw groupsError;
      
      // Map documents with their account groups
      const processedDocs = (docsData || []).map(doc => ({
        id: doc.id,
        file_name: doc.file_name,
        file_path: doc.file_path,
        file_size: doc.file_size,
        file_type: doc.file_type,
        description: doc.description,
        account_group_id: doc.account_group_id,
        upload_date: doc.upload_date,
        account_group: doc.account_group_id 
          ? groupsData?.find(g => g.id === doc.account_group_id)
          : undefined
      }));
      
      setDocuments(processedDocs);
      setAccountGroups(groupsData || []);

    } catch (error: any) {
      console.error('Error loading data:', error);
      toast({
        title: "Fehler",
        description: "Daten konnten nicht geladen werden.",
        variant: "destructive",
      });
    }
  }, [user, trialBalanceId, toast]);

  // Load data on component mount
  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!user || !trialBalanceId) return;

    setUploading(true);
    
    try {
      for (const file of acceptedFiles) {
        // Upload to storage
        const filePath = `${user.id}/${Date.now()}_${file.name}`;
        
        const { error: uploadError } = await supabase.storage
          .from('account-evidence')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Save metadata to database
        const { error: dbError } = await supabase
          .from('account_evidence')
          .insert({
            trial_balance_id: trialBalanceId,
            user_id: user.id,
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            file_type: file.type || 'application/octet-stream',
            description: uploadForm.description || null,
            account_group_id: uploadForm.account_group_id || null
          });

        if (dbError) throw dbError;
      }

      toast({
        title: "Erfolg",
        description: `${acceptedFiles.length} Datei(en) erfolgreich hochgeladen.`,
      });

      // Reload documents
      await loadData();
      
      // Reset form
      setUploadForm({ description: '', account_group_id: '' });
      setIsDialogOpen(false);
      
    } catch (error: any) {
      console.error('Error uploading files:', error);
      toast({
        title: "Fehler",
        description: "Beim Hochladen ist ein Fehler aufgetreten.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }, [user, trialBalanceId, uploadForm, toast, loadData]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
    },
    disabled: uploading
  });

  const downloadDocument = async (document: UploadedDocument) => {
    try {
      const { data, error } = await supabase.storage
        .from('account-evidence')
        .download(document.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.file_name;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Error downloading file:', error);
      toast({
        title: "Fehler",
        description: "Datei konnte nicht heruntergeladen werden.",
        variant: "destructive",
      });
    }
  };

  const deleteDocument = async (document: UploadedDocument) => {
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('account-evidence')
        .remove([document.file_path]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: dbError } = await supabase
        .from('account_evidence')
        .delete()
        .eq('id', document.id);

      if (dbError) throw dbError;

      toast({
        title: "Erfolg",
        description: "Datei wurde gelöscht.",
      });

      await loadData();
    } catch (error: any) {
      console.error('Error deleting file:', error);
      toast({
        title: "Fehler",
        description: "Datei konnte nicht gelöscht werden.",
        variant: "destructive",
      });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileTypeIcon = (fileType: string) => {
    if (fileType.includes('pdf')) return '📄';
    if (fileType.includes('sheet') || fileType.includes('excel')) return '📊';
    if (fileType.includes('word') || fileType.includes('document')) return '📝';
    return '📎';
  };

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
          <div className="text-center">
            <h2 className="text-4xl font-bold mb-4 text-foreground">
              Kontennachweise hochladen
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              Laden Sie alle vom Kunden erhaltenen Kontennachweise hoch (Excel, PDF, Word)
            </p>
          </div>

          {/* Upload Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Neue Dokumente hochladen
              </CardTitle>
              <CardDescription>
                Unterstützte Formate: PDF, Excel (.xls, .xlsx), Word (.doc, .docx)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Dokumente hochladen
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Dokumente hochladen</DialogTitle>
                    <DialogDescription>
                      Ziehen Sie Dateien hierher oder klicken Sie, um Dateien auszuwählen
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="description">Beschreibung (optional)</Label>
                      <Textarea
                        id="description"
                        placeholder="Beschreibung der Dokumente..."
                        value={uploadForm.description}
                        onChange={(e) => setUploadForm(prev => ({ ...prev, description: e.target.value }))}
                      />
                    </div>

                    <div>
                      <Label htmlFor="account-group">Zuordnung zu Gruppe (optional)</Label>
                      <Select
                        value={uploadForm.account_group_id}
                        onValueChange={(value) => setUploadForm(prev => ({ 
                          ...prev, 
                          account_group_id: value === "unassigned" ? "" : value 
                        }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Gruppe auswählen (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Keine Zuordnung</SelectItem>
                          {accountGroups.map((group) => (
                            <SelectItem key={group.id} value={group.id}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div
                      {...getRootProps()}
                      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                        isDragActive 
                          ? 'border-primary bg-primary/10' 
                          : 'border-muted-foreground/25 hover:border-primary/50'
                      } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <input {...getInputProps()} />
                      <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      {isDragActive ? (
                        <p className="text-primary font-medium">Dateien hier ablegen...</p>
                      ) : uploading ? (
                        <p className="text-muted-foreground">Wird hochgeladen...</p>
                      ) : (
                        <div>
                          <p className="font-medium mb-2">Dateien hierher ziehen oder klicken</p>
                          <p className="text-sm text-muted-foreground">
                            PDF, Excel, Word-Dateien
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Documents List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Hochgeladene Dokumente ({documents.length})
              </CardTitle>
              <CardDescription>
                Übersicht aller hochgeladenen Kontennachweise
              </CardDescription>
            </CardHeader>
            <CardContent>
              {documents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Noch keine Dokumente hochgeladen</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Datei</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead>Zugeordnete Gruppe</TableHead>
                        <TableHead>Beschreibung</TableHead>
                        <TableHead>Hochgeladen</TableHead>
                        <TableHead className="text-right">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{getFileTypeIcon(doc.file_type)}</span>
                              <span className="font-medium">{doc.file_name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{formatFileSize(doc.file_size)}</Badge>
                          </TableCell>
                          <TableCell>
                            {doc.account_group ? (
                              <Badge variant="secondary">{doc.account_group.name}</Badge>
                            ) : (
                              <span className="text-muted-foreground">Nicht zugeordnet</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {doc.description ? (
                              <span className="text-sm">{doc.description}</span>
                            ) : (
                              <span className="text-muted-foreground">Keine Beschreibung</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {new Date(doc.upload_date).toLocaleDateString('de-DE')}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => downloadDocument(doc)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => deleteDocument(doc)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex justify-center gap-4">
            <Button variant="outline" onClick={() => navigate('/')}>
              Zurück zur Gruppierung
            </Button>
            <Button onClick={() => navigate('/')}>
              Weiter zum Dashboard
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DocumentUpload;