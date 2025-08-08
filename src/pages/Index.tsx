import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import UploadTrialBalance from '@/components/UploadTrialBalance';
import ColumnConfig from '@/components/ColumnConfig';

const Index = () => {
  const { user, signOut } = useAuth();
  const [currentStep, setCurrentStep] = useState<'upload' | 'configure' | 'dashboard'>('upload');
  const [currentTrialBalanceId, setCurrentTrialBalanceId] = useState<string>('');

  const handleUploadSuccess = (trialBalanceId: string) => {
    setCurrentTrialBalanceId(trialBalanceId);
    setCurrentStep('configure');
  };

  const handleConfigurationComplete = () => {
    setCurrentStep('dashboard');
  };

  const resetToUpload = () => {
    setCurrentStep('upload');
    setCurrentTrialBalanceId('');
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
        {currentStep === 'upload' && (
          <div className="text-center space-y-8">
            <div>
              <h2 className="text-4xl font-bold mb-4 text-foreground">
                Willkommen bei Audit Agent
              </h2>
              <p className="text-xl text-muted-foreground mb-8">
                Ihre Prüfungssoftware für Financial Auditing
              </p>
            </div>
            <UploadTrialBalance onUploadSuccess={handleUploadSuccess} />
          </div>
        )}

        {currentStep === 'configure' && (
          <div className="text-center space-y-8">
            <div>
              <h2 className="text-3xl font-bold mb-4 text-foreground">
                Spalten konfigurieren
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Definieren Sie die Bedeutung der Spalten in Ihrer Saldobilanz
              </p>
            </div>
            <ColumnConfig 
              trialBalanceId={currentTrialBalanceId} 
              onConfigurationComplete={handleConfigurationComplete}
            />
            <Button variant="outline" onClick={resetToUpload}>
              Neue Datei hochladen
            </Button>
          </div>
        )}

        {currentStep === 'dashboard' && (
          <div className="text-center space-y-8">
            <div>
              <h2 className="text-3xl font-bold mb-4 text-foreground">
                Dashboard
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Ihre Saldobilanz wurde erfolgreich konfiguriert
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <p className="text-muted-foreground mb-4">
                Saldobilanz erfolgreich hochgeladen und konfiguriert!
              </p>
              <Button onClick={resetToUpload}>
                Neue Saldobilanz hochladen
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
