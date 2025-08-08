import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Settings, Save, Eye } from 'lucide-react';

interface ColumnConfigProps {
  trialBalanceId: string;
  onConfigurationComplete: () => void;
}

interface TrialBalance {
  id: string;
  filename: string;
  account_number_column?: string;
  account_name_column?: string;
  current_year_column?: string;
  previous_year_column?: string;
  foreign_currency_column?: string;
}

const ColumnConfig = ({ trialBalanceId, onConfigurationComplete }: ColumnConfigProps) => {
  const { toast } = useToast();
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [sampleColumns, setSampleColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [columnMapping, setColumnMapping] = useState({
    account_number_column: '',
    account_name_column: '',
    current_year_column: '',
    previous_year_column: '',
    foreign_currency_column: ''
  });

  useEffect(() => {
    loadTrialBalance();
  }, [trialBalanceId]);

  const loadTrialBalance = async () => {
    try {
      const { data, error } = await supabase
        .from('trial_balances')
        .select('*')
        .eq('id', trialBalanceId)
        .single();

      if (error) throw error;

      setTrialBalance(data);
      
      // Set existing mapping if available
      if (data.account_number_column) {
        setColumnMapping({
          account_number_column: data.account_number_column || '',
          account_name_column: data.account_name_column || '',
          current_year_column: data.current_year_column || '',
          previous_year_column: data.previous_year_column || '',
          foreign_currency_column: data.foreign_currency_column || ''
        });
      }

      // Mock sample columns for demonstration
      // In a real implementation, you would parse the Excel file to get actual column names
      setSampleColumns([
        'A - Kontonummer',
        'B - Kontobezeichnung', 
        'C - Saldo 2024',
        'D - Saldo 2023',
        'E - Fremdwährung',
        'F - Zusatzinfo',
        'G - Status'
      ]);
    } catch (error: any) {
      console.error('Error loading trial balance:', error);
      toast({
        title: "Fehler beim Laden",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveConfiguration = async () => {
    setIsSaving(true);
    
    try {
      // Validate required fields
      if (!columnMapping.account_number_column || 
          !columnMapping.account_name_column || 
          !columnMapping.current_year_column || 
          !columnMapping.previous_year_column) {
        throw new Error('Bitte füllen Sie alle Pflichtfelder aus.');
      }

      const { error } = await supabase
        .from('trial_balances')
        .update({
          ...columnMapping,
          status: 'configured'
        })
        .eq('id', trialBalanceId);

      if (error) throw error;

      toast({
        title: "Konfiguration gespeichert",
        description: "Die Spaltenzuordnung wurde erfolgreich gespeichert.",
      });

      onConfigurationComplete();
    } catch (error: any) {
      console.error('Error saving configuration:', error);
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Spalten konfigurieren
        </CardTitle>
        <CardDescription>
          Ordnen Sie den Spalten aus "{trialBalance?.filename}" ihre Bedeutung zu
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Preview section */}
        <div className="bg-muted/50 rounded-lg p-4">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Verfügbare Spalten in der Datei:
          </h4>
          <div className="text-sm text-muted-foreground">
            {sampleColumns.join(', ')}
          </div>
        </div>

        {/* Column mapping */}
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="account-number">Kontonummer *</Label>
              <Select 
                value={columnMapping.account_number_column} 
                onValueChange={(value) => setColumnMapping(prev => ({...prev, account_number_column: value}))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Spalte wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {sampleColumns.map((col) => (
                    <SelectItem key={col} value={col}>{col}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="account-name">Kontobezeichnung *</Label>
              <Select 
                value={columnMapping.account_name_column} 
                onValueChange={(value) => setColumnMapping(prev => ({...prev, account_name_column: value}))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Spalte wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {sampleColumns.map((col) => (
                    <SelectItem key={col} value={col}>{col}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="current-year">Laufendes Jahr *</Label>
              <Select 
                value={columnMapping.current_year_column} 
                onValueChange={(value) => setColumnMapping(prev => ({...prev, current_year_column: value}))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Spalte wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {sampleColumns.map((col) => (
                    <SelectItem key={col} value={col}>{col}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="previous-year">Vorjahr *</Label>
              <Select 
                value={columnMapping.previous_year_column} 
                onValueChange={(value) => setColumnMapping(prev => ({...prev, previous_year_column: value}))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Spalte wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {sampleColumns.map((col) => (
                    <SelectItem key={col} value={col}>{col}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="foreign-currency">Fremdwährung (optional)</Label>
            <Select 
              value={columnMapping.foreign_currency_column} 
              onValueChange={(value) => setColumnMapping(prev => ({...prev, foreign_currency_column: value}))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Spalte wählen (optional)..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Keine Fremdwährung</SelectItem>
                {sampleColumns.map((col) => (
                  <SelectItem key={col} value={col}>{col}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button 
          onClick={handleSaveConfiguration} 
          disabled={isSaving}
          className="w-full"
        >
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Speichern...' : 'Konfiguration speichern'}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ColumnConfig;