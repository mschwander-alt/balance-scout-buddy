import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { FileSpreadsheet, CheckCircle, ArrowLeft, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';

interface TrialBalancePreviewProps {
  trialBalanceId: string;
  onEdit: () => void;
  onConfirm: () => void;
}

interface TrialBalanceData {
  id: string;
  filename: string;
  file_path: string;
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
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    loadTrialBalanceData();
  }, [trialBalanceId]);

  const loadTrialBalanceData = async () => {
    try {
      setHasError(false);
      
      // Load trial balance metadata
      const { data, error } = await supabase
        .from('trial_balances')
        .select('*')
        .eq('id', trialBalanceId)
        .single();

      if (error) throw error;
      setTrialBalance(data);

      // Load and parse the Excel file
      if (data.file_path) {
        await parseExcelFile(data);
      }
    } catch (error: any) {
      console.error('Error loading trial balance data:', error);
      setHasError(true);
      toast({
        title: "Fehler beim Laden",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const parseExcelFile = async (trialBalanceData: TrialBalanceData) => {
    try {
      // Download the file from Supabase storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('trial-balances')
        .download(trialBalanceData.file_path);

      if (downloadError) throw downloadError;

      // Parse Excel file
      const arrayBuffer = await fileData.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      // Get the first worksheet
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Convert to JSON with header row
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      if (jsonData.length < 2) {
        throw new Error('Die Excel-Datei enthält nicht genügend Daten.');
      }

      // Get header row to map columns
      const headers = jsonData[0] as string[];
      const dataRows = jsonData.slice(1);

      // Find column indices based on configuration
      const accountNumberIndex = headers.findIndex(h => h === trialBalanceData.account_number_column);
      const accountNameIndex = headers.findIndex(h => h === trialBalanceData.account_name_column);
      const currentYearIndex = headers.findIndex(h => h === trialBalanceData.current_year_column);
      const previousYearIndex = headers.findIndex(h => h === trialBalanceData.previous_year_column);
      const foreignCurrencyIndex = (trialBalanceData.foreign_currency_column && trialBalanceData.foreign_currency_column.trim() !== '') 
        ? headers.findIndex(h => h === trialBalanceData.foreign_currency_column)
        : -1;

      if (accountNumberIndex === -1 || accountNameIndex === -1 || currentYearIndex === -1 || previousYearIndex === -1) {
        throw new Error('Nicht alle konfigurierten Spalten wurden in der Excel-Datei gefunden.');
      }

      console.log('Column indices:', {
        accountNumber: accountNumberIndex,
        accountName: accountNameIndex,
        currentYear: currentYearIndex,
        previousYear: previousYearIndex,
        foreignCurrency: foreignCurrencyIndex
      });

      // Parse data rows
      const parsedData: TrialBalanceRow[] = dataRows
        .filter(row => row[accountNumberIndex] && row[accountNameIndex]) // Filter empty rows
        .map(row => ({
          accountNumber: String(row[accountNumberIndex] || ''),
          accountName: String(row[accountNameIndex] || ''),
          currentYear: parseFloat(String(row[currentYearIndex] || 0)) || 0,
          previousYear: parseFloat(String(row[previousYearIndex] || 0)) || 0,
          foreignCurrency: foreignCurrencyIndex >= 0 
            ? (parseFloat(String(row[foreignCurrencyIndex] || 0)) || undefined)
            : undefined
        }))
        .slice(0, 20); // Limit to first 20 rows for preview

      setPreviewData(parsedData);
    } catch (error: any) {
      console.error('Error parsing Excel file:', error);
      setHasError(true);
      toast({
        title: "Fehler beim Lesen der Excel-Datei",
        description: error.message,
        variant: "destructive",
      });
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
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="text-muted-foreground">Excel-Datei wird geladen und analysiert...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (hasError || !trialBalance) {
    return (
      <Card className="w-full max-w-6xl mx-auto">
        <CardContent className="flex items-center justify-center p-8">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Fehler beim Laden der Daten</h3>
            <p className="text-muted-foreground mb-4">
              Die Excel-Datei konnte nicht gelesen werden.
            </p>
            <Button variant="outline" onClick={onEdit}>
              Zurück zur Konfiguration
            </Button>
          </div>
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
          Vorschau der konfigurierten Saldobilanz: "{trialBalance.filename}"
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Configuration Summary */}
        <div className="bg-muted/50 rounded-lg p-4">
          <h4 className="font-medium mb-2">Konfiguration:</h4>
          <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
            <div>Kontonummer: {trialBalance.account_number_column}</div>
            <div>Kontobezeichnung: {trialBalance.account_name_column}</div>
            <div>Laufendes Jahr: {trialBalance.current_year_column}</div>
            <div>Vorjahr: {trialBalance.previous_year_column}</div>
            {trialBalance.foreign_currency_column && trialBalance.foreign_currency_column.trim() !== '' && (
              <div>Fremdwährung: {trialBalance.foreign_currency_column}</div>
            )}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Anzahl geladener Datensätze: {previewData.length} (max. 20 für Vorschau)
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
                {trialBalance.foreign_currency_column && trialBalance.foreign_currency_column.trim() !== '' && (
                  <TableHead className="text-right font-semibold">
                    Fremdwährung
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewData.length > 0 ? (
                previewData.map((row, index) => (
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
                    {trialBalance.foreign_currency_column && trialBalance.foreign_currency_column.trim() !== '' && (
                      <TableCell className="text-right font-mono">
                        {row.foreignCurrency !== undefined ? formatSwissNumber(row.foreignCurrency) : '-'}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={trialBalance.foreign_currency_column && trialBalance.foreign_currency_column.trim() !== '' ? 5 : 4} className="text-center py-8">
                    <div className="text-muted-foreground">
                      <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                      Keine Daten gefunden oder Fehler beim Parsen der Excel-Datei
                    </div>
                  </TableCell>
                </TableRow>
              )}
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