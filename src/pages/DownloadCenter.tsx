import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Download, FileText, Table, PieChart } from "lucide-react";

const DownloadCenter = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trialBalanceId, setTrialBalanceId] = useState<string>("");

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('trial_balance_id');
    if (id) {
      setTrialBalanceId(id);
    }
  }, []);

  const handleBack = () => {
    navigate(`/review?trial_balance_id=${trialBalanceId}`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Zurück zur Prüfung
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Download Center</h1>
                <p className="text-sm text-muted-foreground">
                  Laden Sie Ihre Prüfungsberichte und Dokumente herunter
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {user?.email}
              </span>
              <Button
                variant="outline"
                onClick={() => navigate('/auth')}
              >
                Abmelden
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Prüfungsbericht */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Prüfungsbericht
              </CardTitle>
              <CardDescription>
                Vollständiger Bericht der durchgeführten Prüfung
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" disabled>
                <Download className="h-4 w-4 mr-2" />
                PDF herunterladen
              </Button>
            </CardContent>
          </Card>

          {/* Saldenbilanz Export */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Table className="h-5 w-5 text-primary" />
                Saldenbilanz
              </CardTitle>
              <CardDescription>
                Exportierte Saldenbilanz mit allen Anpassungen
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" disabled>
                <Download className="h-4 w-4 mr-2" />
                Excel herunterladen
              </Button>
            </CardContent>
          </Card>

          {/* Prüfungsnachweis */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChart className="h-5 w-5 text-primary" />
                Prüfungsnachweis
              </CardTitle>
              <CardDescription>
                Zusammenfassung aller geprüften Positionen
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" disabled>
                <Download className="h-4 w-4 mr-2" />
                PDF herunterladen
              </Button>
            </CardContent>
          </Card>

        </div>

        {/* Zusätzliche Informationen */}
        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>Informationen</CardTitle>
              <CardDescription>
                Wichtige Hinweise zu Ihren Downloads
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <p>• Alle Berichte werden basierend auf den aktuellen Prüfungsergebnissen generiert</p>
                <p>• Downloads sind 30 Tage nach der Erstellung verfügbar</p>
                <p>• Bei Fragen wenden Sie sich an den Support</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default DownloadCenter;