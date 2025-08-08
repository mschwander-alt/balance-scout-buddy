import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import UploadTrialBalance from '@/components/UploadTrialBalance';
import ColumnConfig from '@/components/ColumnConfig';
import TrialBalancePreview from '@/components/TrialBalancePreview';
import TeamMembersManager from '@/components/TeamMembersManager';
import AccountGrouping from '@/components/AccountGrouping';

const Index = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<'upload' | 'configure' | 'preview' | 'team' | 'grouping' | 'dashboard'>('upload');
  const [currentTrialBalanceId, setCurrentTrialBalanceId] = useState<string>('');
  const [currentTrialBalanceData, setCurrentTrialBalanceData] = useState<any>(null);

  const handleUploadSuccess = (trialBalanceId: string) => {
    setCurrentTrialBalanceId(trialBalanceId);
    setCurrentStep('configure');
  };

  const handleConfigurationComplete = () => {
    setCurrentStep('preview');
  };

  const handlePreviewEdit = () => {
    setCurrentStep('configure');
  };

  const handlePreviewConfirm = () => {
    setCurrentStep('team');
  };

  const handleTeamSetupComplete = () => {
    setCurrentStep('grouping');
  };

  const handleGroupingComplete = () => {
    navigate(`/documents?trial_balance_id=${currentTrialBalanceId}`);
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

        {currentStep === 'preview' && (
          <div className="text-center space-y-8">
            <div>
              <h2 className="text-3xl font-bold mb-4 text-foreground">
                Saldobilanz überprüfen
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Überprüfen Sie die Darstellung Ihrer konfigurierten Saldobilanz
              </p>
            </div>
            <TrialBalancePreview 
              trialBalanceId={currentTrialBalanceId} 
              onEdit={handlePreviewEdit}
              onConfirm={(data) => {
                setCurrentTrialBalanceData(data);
                handlePreviewConfirm();
              }}
            />
          </div>
        )}

        {currentStep === 'team' && (
          <div className="text-center space-y-8">
            <div>
              <h2 className="text-3xl font-bold mb-4 text-foreground">
                Team-Mitglieder verwalten
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Fügen Sie Team-Mitglieder hinzu, die später Prüfungsgebiete bearbeiten werden
              </p>
            </div>
            <TeamMembersManager />
            <div className="flex justify-center gap-4">
              <Button variant="outline" onClick={() => setCurrentStep('preview')}>
                Zurück zur Vorschau
              </Button>
              <Button onClick={handleTeamSetupComplete}>
                Weiter zu Gruppierungen
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'grouping' && (
          <div className="text-center space-y-8">
            <div>
              <h2 className="text-3xl font-bold mb-4 text-foreground">
                Konto-Gruppierungen erstellen
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Gruppieren Sie verwandte Konten und ordnen Sie diese Team-Mitgliedern zu
              </p>
            </div>
            <AccountGrouping 
              trialBalanceId={currentTrialBalanceId}
              trialBalanceData={currentTrialBalanceData}
              onGroupingComplete={handleGroupingComplete}
            />
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
