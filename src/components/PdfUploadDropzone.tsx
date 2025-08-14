import React from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Loader2 } from 'lucide-react';

interface PdfUploadDropzoneProps {
  onUpload: (file: File) => void;
  uploading: boolean;
}

export const PdfUploadDropzone: React.FC<PdfUploadDropzoneProps> = ({ onUpload, uploading }) => {
  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    accept: {
      'application/pdf': ['.pdf']
    },
    maxFiles: 1,
    onDrop: (files) => {
      if (files.length > 0) {
        onUpload(files[0]);
      }
    }
  });

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragActive 
            ? 'border-primary bg-primary/5' 
            : 'border-muted-foreground/25 hover:border-primary/50'
        } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        {uploading ? (
          <div className="space-y-2">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            <p className="text-muted-foreground">PDF wird hochgeladen...</p>
          </div>
        ) : isDragActive ? (
          <p className="text-primary font-medium">PDF hier ablegen...</p>
        ) : (
          <div className="space-y-2">
            <p className="text-foreground font-medium">
              PDF hierher ziehen oder klicken zum Auswählen
            </p>
            <p className="text-sm text-muted-foreground">
              Nur PDF-Dateien werden akzeptiert
            </p>
          </div>
        )}
      </div>
      
      {acceptedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Ausgewählte Datei:</p>
          <div className="flex items-center gap-2 p-2 bg-muted rounded">
            <FileText className="h-4 w-4" />
            <span className="text-sm">{acceptedFiles[0].name}</span>
            <span className="text-xs text-muted-foreground">
              ({(acceptedFiles[0].size / 1024 / 1024).toFixed(2)} MB)
            </span>
          </div>
        </div>
      )}
    </div>
  );
};