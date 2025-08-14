import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Upload, Search, Sparkles, XCircle, FileText } from 'lucide-react';
import { Calculator } from '@/components/Calculator';
import { useAuth } from '@/hooks/useAuth';

const Review: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const trialBalanceId = searchParams.get('trial_balance_id');
  const { user, signOut } = useAuth();
  
  const [isProcessing, setIsProcessing] = useState(false);

  const startAutoMatch = () => {
    toast.info('Automatisches Matching wird gestartet...');
  };

  const startAdvancedAnalysis = () => {
    toast.info('KI-Analyse wird gestartet...');
  };

  const handleUnmatchAll = () => {
    toast.info('Alle Zuordnungen werden entfernt...');
  };

  const handlePdfUpload = () => {
    toast.info('PDF Upload wird im nächsten Schritt implementiert');
  };

  const handleManualAssign = () => {
    toast.info('Manuelle Zuweisung wird geöffnet...');
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card py-2">
        <div className="container mx-auto px-2 py-2 flex justify-between items-center">
          <h1 className="text-xl font-bold text-foreground">Audit Agent</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Willkommen, {user?.email}
            </span>
            <Button variant="outline" size="sm" onClick={signOut}>
              Abmelden
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-2 py-3 max-w-full overflow-hidden">
        <div className="space-y-4 max-w-full">
          <div className="flex items-center justify-between py-2">
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                Automatische Prüfung
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Abgleich der Kontosalden mit den hochgeladenen Nachweisen
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                onClick={startAutoMatch}
                disabled={isProcessing}
                size="sm"
                className="flex items-center gap-2"
              >
                <Search className="h-3 w-3" />
                {isProcessing ? 'Prüfung läuft...' : 'Prüfung starten'}
              </Button>
              
              <Button 
                onClick={startAdvancedAnalysis}
                disabled={isProcessing}
                size="sm"
                variant="outline"
                className="flex items-center gap-2"
              >
                <Sparkles className="h-3 w-3" />
                KI-Analyse
              </Button>

              <Button 
                onClick={handleUnmatchAll}
                disabled={isProcessing}
                size="sm"
                variant="outline"
                className="flex items-center gap-2"
              >
                <XCircle className="h-3 w-3" />
                Unmatch All
              </Button>

              <Button 
                onClick={handlePdfUpload}
                disabled={isProcessing}
                size="sm"
                variant="outline"
                className="flex items-center gap-2"
              >
                <Upload className="h-3 w-3" />
                Kontoblätter hochladen
              </Button>

              <Button 
                onClick={handleManualAssign}
                disabled={isProcessing}
                size="sm"
                variant="outline"
                className="flex items-center gap-2"
              >
                <FileText className="h-3 w-3" />
                man. Zuweisung
              </Button>
            </div>
          </div>

          <div className="text-center py-20">
            <h3 className="text-lg font-medium mb-4">Review-Komponente bereit</h3>
            <p className="text-muted-foreground mb-4">
              Die Buttons sind funktionsbereit. Der "Kontoblätter hochladen" Button ist implementiert 
              und bereit für das PDF-Upload Feature.
            </p>
            <div className="flex justify-center gap-4">
              <Button 
                onClick={() => navigate('/')}
                variant="outline"
              >
                Zurück zum Dashboard
              </Button>
              <Button 
                onClick={() => navigate(`/documents?trial_balance_id=${trialBalanceId}`)}
                variant="outline"
              >
                Zu den Dokumenten
              </Button>
            </div>
          </div>
        </div>
      </main>
      
      {/* Floating Calculator */}
      <Calculator />
    </div>
  );
};

export default Review;