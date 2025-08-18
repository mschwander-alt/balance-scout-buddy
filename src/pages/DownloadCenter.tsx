import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import CompleteDownloadManager from "@/components/CompleteDownloadManager";

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
        {/* Complete Download Manager */}
        {trialBalanceId && (
          <CompleteDownloadManager trialBalanceId={trialBalanceId} />
        )}

      </main>
    </div>
  );
};

export default DownloadCenter;