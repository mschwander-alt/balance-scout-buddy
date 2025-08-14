import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, X, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface PDFUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trialBalanceId: string;
  accountGroupId?: string;
  assignmentId?: string;
  onUploadComplete?: () => void;
}

interface UploadFile {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  id: string;
  error?: string;
}

export function PDFUploadModal({ open, onOpenChange, trialBalanceId, accountGroupId, assignmentId, onUploadComplete }: PDFUploadModalProps) {
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files).filter(
      file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );
    
    if (files.length === 0) {
      toast.error('Bitte nur PDF-Dateien hochladen');
      return;
    }
    
    addFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    addFiles(files);
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const addFiles = (files: File[]) => {
    const newUploadFiles: UploadFile[] = files.map(file => ({
      file,
      progress: 0,
      status: 'pending',
      id: crypto.randomUUID()
    }));
    
    setUploadFiles(prev => [...prev, ...newUploadFiles]);
  };

  const removeFile = (id: string) => {
    setUploadFiles(prev => prev.filter(f => f.id !== id));
  };

  const uploadFile = async (uploadFile: UploadFile): Promise<void> => {
    if (!user) throw new Error('Nicht angemeldet');

    // Update status to uploading
    setUploadFiles(prev => prev.map(f => 
      f.id === uploadFile.id ? { ...f, status: 'uploading' as const } : f
    ));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folderPath = accountGroupId && assignmentId ? 'account-documents' : 'account-sheets';
    const filePath = `${user.id}/${trialBalanceId}/${folderPath}/${timestamp}-${uploadFile.file.name}`;

    try {
      // Upload file
      const { data, error } = await supabase.storage
        .from('account-evidence')
        .upload(filePath, uploadFile.file);

      if (error) throw error;

      // Save document metadata
      const documentData: any = {
        trial_balance_id: trialBalanceId,
        file_name: uploadFile.file.name,
        file_path: filePath,
        file_type: uploadFile.file.type || 'application/pdf',
        file_size: uploadFile.file.size,
        user_id: user.id,
        is_global: !assignmentId // Mark as global only if this is not for a specific assignment
      };

      // Only add account_group_id if it's a valid UUID (not 'no-group')
      if (accountGroupId && accountGroupId !== 'no-group') {
        documentData.account_group_id = accountGroupId;
      }

      const { data: insertedDoc, error: dbError } = await supabase
        .from('account_evidence')
        .insert(documentData)
        .select('id')
        .single();

      if (dbError) throw dbError;

      // If this is for a specific assignment, update the assignment to include this document
      if (assignmentId && insertedDoc?.id) {
        // Check if this is a grouped or ungrouped assignment
        if (accountGroupId && accountGroupId !== 'no-group') {
          // Grouped assignment - update account_group_assignments
          const { data: currentAssignment, error: fetchError } = await supabase
            .from('account_group_assignments')
            .select('matched_documents')
            .eq('id', assignmentId)
            .single();

          if (fetchError) {
            console.error('Error fetching current assignment:', fetchError);
          } else {
            const currentDocs = currentAssignment.matched_documents || [];
            const updatedDocs = [...currentDocs, insertedDoc.id];

            const { error: updateError } = await supabase
              .from('account_group_assignments')
              .update({ matched_documents: updatedDocs })
              .eq('id', assignmentId);

            if (updateError) {
              console.error('Error updating assignment with document:', updateError);
            }
          }
        } else {
          // Ungrouped assignment - try to update temp_account_matches
          const { data: currentMatch, error: fetchError } = await supabase
            .from('temp_account_matches')
            .select('matched_documents')
            .eq('id', assignmentId)
            .maybeSingle(); // Use maybeSingle instead of single to handle non-existent records

          if (fetchError) {
            console.error('Error fetching current temp match:', fetchError);
          } else if (currentMatch) {
            // Record exists, update it
            const currentDocs = currentMatch.matched_documents || [];
            const updatedDocs = [...currentDocs, insertedDoc.id];

            const { error: updateError } = await supabase
              .from('temp_account_matches')
              .update({ matched_documents: updatedDocs })
              .eq('id', assignmentId);

            if (updateError) {
              console.error('Error updating temp match with document:', updateError);
            }
          }
          // If record doesn't exist, that's fine - the document is saved with is_global: false
        }
      }

      // Mark as completed
      setUploadFiles(prev => prev.map(f => 
        f.id === uploadFile.id ? { ...f, status: 'completed' as const, progress: 100 } : f
      ));

    } catch (error: any) {
      console.error('Upload error:', error);
      setUploadFiles(prev => prev.map(f => 
        f.id === uploadFile.id ? { 
          ...f, 
          status: 'error' as const, 
          error: error.message || 'Upload fehlgeschlagen' 
        } : f
      ));
      throw error;
    }
  };

  const handleUploadAll = async () => {
    if (uploadFiles.length === 0) return;

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      // Upload files one by one to avoid overwhelming the server
      for (const uploadFileItem of uploadFiles) {
        if (uploadFileItem.status === 'pending') {
          try {
            await uploadFile(uploadFileItem);
            successCount++;
          } catch {
            errorCount++;
          }
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} Datei(en) erfolgreich hochgeladen`);
        onUploadComplete?.();
      }
      
      if (errorCount > 0) {
        toast.error(`${errorCount} Datei(en) konnten nicht hochgeladen werden`);
      }

    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusIcon = (status: UploadFile['status']) => {
    switch (status) {
      case 'pending':
        return <FileText className="h-4 w-4 text-muted-foreground" />;
      case 'uploading':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case 'completed':
        return <FileText className="h-4 w-4 text-green-600" />;
      case 'error':
        return <X className="h-4 w-4 text-destructive" />;
    }
  };

  const canUpload = uploadFiles.some(f => f.status === 'pending') && !isUploading;
  const hasCompleted = uploadFiles.some(f => f.status === 'completed');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {accountGroupId ? 'Nachweis für Konto hochladen' : 'Kontoblätter hochladen'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Drop Zone */}
          <Card
            className={`border-2 border-dashed transition-colors ${
              dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
            }`}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
          >
            <CardContent className="p-8 text-center">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">
                PDF-Dateien hier ablegen oder auswählen
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Unterstützte Formate: PDF (max. 50MB pro Datei)
              </p>
              <Button 
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
              >
                Dateien auswählen
              </Button>
              <Input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
            </CardContent>
          </Card>

          {/* File List */}
          {uploadFiles.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium">Ausgewählte Dateien ({uploadFiles.length})</h4>
              <div className="space-y-2 max-h-60 overflow-auto">
                {uploadFiles.map((uploadFile) => (
                  <Card key={uploadFile.id} className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        {getStatusIcon(uploadFile.status)}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {uploadFile.file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(uploadFile.file.size)}
                            {uploadFile.error && (
                              <span className="text-destructive ml-2">
                                • {uploadFile.error}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {uploadFile.status === 'uploading' && (
                          <div className="w-24">
                            <Progress value={uploadFile.progress} className="h-2" />
                          </div>
                        )}
                        {uploadFile.status !== 'uploading' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeFile(uploadFile.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            disabled={isUploading}
          >
            {hasCompleted ? 'Schließen' : 'Abbrechen'}
          </Button>
          
          <Button 
            onClick={handleUploadAll}
            disabled={!canUpload}
            className="flex items-center gap-2"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {isUploading ? 'Wird hochgeladen...' : `${uploadFiles.filter(f => f.status === 'pending').length} Datei(en) hochladen`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}