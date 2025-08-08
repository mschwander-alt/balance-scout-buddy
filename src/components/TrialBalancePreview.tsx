import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { FileSpreadsheet, CheckCircle, ArrowLeft } from 'lucide-react';

interface TrialBalancePreviewProps {
  trialBalanceId: string;
  onEdit: () => void;
  onConfirm: () => void;
}

interface TrialBalanceData {
  id: string;
  filename: string;
  account_number_column?: string;
  account_name_column?: string;
  current_year_column?: string;
  previous_year_column?: string;
  foreign_currency_column?: string;
}

interface TrialBalanceRow {
  accountNumber: string;
  accountName: string;
  currentYear: number;
  previousYear: number;
  foreignCurrency?: number;
}

const TrialBalancePreview = ({ trialBalanceId, onEdit, onConfirm }: TrialBalancePreviewProps) => {
  const { toast } = useToast();
  const [trialBalance, setTrialBalance] = useState<TrialBalanceData | null>(null);
  const [previewData, setPreviewData] = useState<TrialBalanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadTrialBalanceData();
  }, [trialBalanceId]);

  const loadTrialBalanceData = async () => {
    try {
      const { data, error } = await supabase
        .from('trial_balances')
        .select('*')
        .eq('id', trialBalanceId)
        .single();

      if (error) throw error;

      setTrialBalance(data);
      
      // Mock data for preview - in real implementation, this would parse the actual Excel file
      const mockData: TrialBalanceRow[] = [
        {
          accountNumber: "1000",
          accountName: "Kasse",
          currentYear: 50000.50,
          previousYear: 45000.00,
          foreignCurrency: data.foreign_currency_column ? 5000.25 : undefined
        },
        {
          accountNumber: "1020",
          accountName: "Bank",
          currentYear: 250000.75,
          previousYear: 230000.00,
          foreignCurrency: data.foreign_currency_column ? 25000.50 : undefined
        },
        {
          accountNumber: "1100",
          accountName: "Debitoren",
          currentYear: 120000.00,
          previousYear: 115000.50,
          foreignCurrency: data.foreign_currency_column ? 12000.00 : undefined
        },
        {
          accountNumber: "1200",
          accountName: "Warenvorrat",
          currentYear: 80000.25,
          previousYear: 75000.75,
          foreignCurrency: data.foreign_currency_column ? 8000.10 : undefined
        },
        {
          accountNumber: "2000",
          accountName: "Kreditoren",
          currentYear: -95000.50,
          previousYear: -90000.00,
          foreignCurrency: data.foreign_currency_column ? -9500.25 : undefined
        },
        {
          accountNumber: "2100",
          accountName: "Bankdarlehen",
          currentYear: -150000.00,
          previousYear: -160000.00,
          foreignCurrency: data.foreign_currency_column ? -15000.00 : undefined
        }
      ];

      setPreviewData(mockData);
    } catch (error: any) {
      console.error('Error loading trial balance data:', error);
      toast({
        title: "Fehler beim Laden",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatSwissNumber = (value: number): string => {
    return new Intl.NumberFormat('de-CH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-6xl mx-auto">
        <CardContent className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Saldobilanz Vorschau
        </CardTitle>
        <CardDescription>
          Vorschau der konfigurierten Saldobilanz: "{trialBalance?.filename}"
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Configuration Summary */}
        <div className="bg-muted/50 rounded-lg p-4">
          <h4 className="font-medium mb-2">Konfiguration:</h4>
          <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
            <div>Kontonummer: {trialBalance?.account_number_column}</div>
            <div>Kontobezeichnung: {trialBalance?.account_name_column}</div>
            <div>Laufendes Jahr: {trialBalance?.current_year_column}</div>
            <div>Vorjahr: {trialBalance?.previous_year_column}</div>
            {trialBalance?.foreign_currency_column && (
              <div>Fremdwährung: {trialBalance.foreign_currency_column}</div>
            )}
          </div>
        </div>

        {/* Data Preview Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-left font-semibold">
                  Kontonummer
                </TableHead>
                <TableHead className="text-left font-semibold">
                  Kontobezeichnung
                </TableHead>
                <TableHead className="text-right font-semibold">
                  Saldo {new Date().getFullYear()}
                </TableHead>
                <TableHead className="text-right font-semibold">
                  Saldo {new Date().getFullYear() - 1}
                </TableHead>
                {trialBalance?.foreign_currency_column && (
                  <TableHead className="text-right font-semibold">
                    Fremdwährung
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewData.map((row, index) => (
                <TableRow key={index} className="hover:bg-muted/25">
                  <TableCell className="text-left font-mono">
                    {row.accountNumber}
                  </TableCell>
                  <TableCell className="text-left">
                    {row.accountName}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatSwissNumber(row.currentYear)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatSwissNumber(row.previousYear)}
                  </TableCell>
                  {trialBalance?.foreign_currency_column && (
                    <TableCell className="text-right font-mono">
                      {row.foreignCurrency ? formatSwissNumber(row.foreignCurrency) : '-'}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 justify-center">
          <Button variant="outline" onClick={onEdit}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Konfiguration bearbeiten
          </Button>
          <Button onClick={onConfirm}>
            <CheckCircle className="h-4 w-4 mr-2" />
            Konfiguration bestätigen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default TrialBalancePreview;