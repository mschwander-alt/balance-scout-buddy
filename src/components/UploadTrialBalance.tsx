import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileSpreadsheet, Check } from 'lucide-react';

interface UploadTrialBalanceProps {
  onUploadSuccess: (trialBalanceId: string) => void;
}

const UploadTrialBalance = ({ onUploadSuccess }: UploadTrialBalanceProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const handleFileUpload = async (file: File) => {
    if (!user) return;

    setIsUploading(true);
    
    try {
      // Validate file type
      const allowedTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/vnd.ms-excel', // .xls
        'text/csv'
      ];
      
      if (!allowedTypes.includes(file.type)) {
        throw new Error('Bitte laden Sie nur Excel (.xlsx, .xls) oder CSV Dateien hoch.');
      }

      // Create file path with user ID folder
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = `${user.id}/${fileName}`;

      // Upload file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('trial-balances')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Save trial balance record to database
      const { data, error: dbError } = await supabase
        .from('trial_balances')
        .insert({
          user_id: user.id,
          filename: file.name,
          file_path: filePath,
          file_size: file.size,
          status: 'uploaded'
        })
        .select()
        .single();

      if (dbError) throw dbError;

      toast({
        title: "Upload erfolgreich",
        description: `${file.name} wurde erfolgreich hochgeladen.`,
      });

      onUploadSuccess(data.id);
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload fehlgeschlagen",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Saldobilanz hochladen
        </CardTitle>
        <CardDescription>
          Laden Sie Ihre Saldobilanz als Excel-Datei (.xlsx, .xls) oder CSV hoch
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive 
              ? 'border-primary bg-primary/5' 
              : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg font-medium mb-2">
            Datei hierher ziehen oder klicken zum Auswählen
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Unterstützte Formate: Excel (.xlsx, .xls), CSV
          </p>
          
          <Input
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            onChange={handleFileSelect}
            className="hidden"
            id="file-upload"
            disabled={isUploading}
          />
          <label htmlFor="file-upload">
            <Button variant="outline" disabled={isUploading} asChild>
              <span className="cursor-pointer">
                {isUploading ? 'Hochladen...' : 'Datei auswählen'}
              </span>
            </Button>
          </label>
        </div>
      </CardContent>
    </Card>
  );
};

export default UploadTrialBalance;