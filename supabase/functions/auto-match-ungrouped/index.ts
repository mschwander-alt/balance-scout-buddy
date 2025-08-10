import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrialBalanceRow {
  accountNumber: string;
  accountName: string;
  currentYear: number;
  previousYear: number;
}

// Helper function to get common accounting terms for better matching
function getAccountTypeTerms(accountName: string): string[] {
  const name = accountName.toLowerCase();
  const terms: string[] = [];
  
  // Cash and bank accounts
  if (name.includes('cash') || name.includes('bank') || name.includes('kasse')) {
    terms.push('bank', 'cash', 'kasse', 'geld');
  }
  
  // Receivables
  if (name.includes('receivable') || name.includes('debitor') || name.includes('forderung')) {
    terms.push('receivable', 'debitor', 'forderung', 'kunde');
  }
  
  // Payables
  if (name.includes('payable') || name.includes('kreditor') || name.includes('verbindlichkeit')) {
    terms.push('payable', 'kreditor', 'verbindlichkeit', 'lieferant');
  }
  
  // Inventory
  if (name.includes('inventory') || name.includes('stock') || name.includes('vorrat')) {
    terms.push('inventory', 'stock', 'vorrat', 'lager');
  }
  
  // Fixed assets
  if (name.includes('asset') || name.includes('anlage') || name.includes('equipment')) {
    terms.push('asset', 'anlage', 'equipment', 'maschine');
  }
  
  // Revenue
  if (name.includes('revenue') || name.includes('sales') || name.includes('umsatz')) {
    terms.push('revenue', 'sales', 'umsatz', 'erlös');
  }
  
  // Expenses
  if (name.includes('expense') || name.includes('cost') || name.includes('aufwand')) {
    terms.push('expense', 'cost', 'aufwand', 'kosten');
  }
  
  return terms;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { trial_balance_id } = await req.json();
    
    if (!trial_balance_id) {
      throw new Error('trial_balance_id is required');
    }

    console.log(`Processing ungrouped accounts for trial_balance_id: ${trial_balance_id}`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if groups exist
    const { data: groups, error: groupsError } = await supabase
      .from('account_groups')
      .select('id')
      .eq('trial_balance_id', trial_balance_id)
      .limit(1);

    if (groupsError) throw groupsError;

    if (groups && groups.length > 0) {
      // Groups exist, use regular matching function
      const { data: functionResult, error: functionError } = await supabase
        .rpc('auto_match_documents_function', { trial_balance_id_param: trial_balance_id });
      
      if (functionError) throw functionError;
      
      return new Response(JSON.stringify(functionResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // No groups exist - process ungrouped trial balance
    
    // Get trial balance metadata
    const { data: trialBalance, error: tbError } = await supabase
      .from('trial_balances')
      .select('*')
      .eq('id', trial_balance_id)
      .single();

    if (tbError || !trialBalance) {
      throw new Error('Trial balance not found');
    }

    // Download and parse Excel file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('trial-balances')
      .download(trialBalance.file_path);

    if (downloadError) throw downloadError;

    const arrayBuffer = await fileData.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    if (jsonData.length < 2) {
      throw new Error('No data found in trial balance file');
    }

    const headers = jsonData[0] as string[];
    const dataRows = jsonData.slice(1);

    // Find column indices
    const accountNumberIndex = headers.findIndex(h => h === trialBalance.account_number_column);
    const accountNameIndex = headers.findIndex(h => h === trialBalance.account_name_column);
    const currentYearIndex = headers.findIndex(h => h === trialBalance.current_year_column);
    const previousYearIndex = headers.findIndex(h => h === trialBalance.previous_year_column);

    if (accountNumberIndex === -1 || accountNameIndex === -1) {
      throw new Error('Required columns not found in trial balance');
    }

    const parsedAccounts: TrialBalanceRow[] = dataRows
      .filter(row => row[accountNumberIndex] && row[accountNameIndex])
      .map(row => ({
        accountNumber: String(row[accountNumberIndex] || '').trim(),
        accountName: String(row[accountNameIndex] || '').trim(),
        currentYear: parseFloat(String(row[currentYearIndex] || 0)) || 0,
        previousYear: parseFloat(String(row[previousYearIndex] || 0)) || 0,
      }));

    console.log(`Found ${parsedAccounts.length} accounts in trial balance`);

    // Clear existing temp matches for this trial balance
    await supabase
      .from('temp_account_matches')
      .delete()
      .eq('trial_balance_id', trial_balance_id);

    // Get documents for this trial balance
    const { data: documents, error: documentsError } = await supabase
      .from('account_evidence')
      .select('*')
      .eq('trial_balance_id', trial_balance_id);

    if (documentsError) throw documentsError;

    console.log(`Available documents: ${documents?.length || 0}`);

    let matchedCount = 0;
    const tempMatches = [];

    // Helper function to check if a value matches within a tolerance
    const isBalanceMatch = (docValue: number, accountBalance: number, tolerance = 0.01): boolean => {
      if (accountBalance === 0) return Math.abs(docValue) < tolerance;
      return Math.abs(docValue - accountBalance) < tolerance || 
             Math.abs(Math.abs(docValue) - Math.abs(accountBalance)) < tolerance;
    };

    // Enhanced function to parse Excel document and extract all numeric values
    const parseExcelForValues = async (doc: any): Promise<number[]> => {
      try {
        if (!doc.file_name.toLowerCase().includes('.xls')) {
          return [];
        }

        console.log(`Parsing Excel file: ${doc.file_name}`);
        const { data: docData, error: docError } = await supabase.storage
          .from('account-evidence')
          .download(doc.file_path);

        if (docError) {
          console.log(`Could not download document ${doc.file_name}:`, docError.message);
          return [];
        }

        const docArrayBuffer = await docData.arrayBuffer();
        const docWorkbook = XLSX.read(docArrayBuffer, { type: 'array' });
        
        const allValues: number[] = [];
        
        // Parse all sheets in the document
        for (const sheetName of docWorkbook.SheetNames) {
          const sheet = docWorkbook.Sheets[sheetName];
          const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];
          
          // Extract all numeric values from the sheet
          for (const row of sheetData) {
            for (const cell of row) {
              if (cell !== null && cell !== undefined && cell !== '') {
                // More robust number parsing
                const cellStr = String(cell).replace(/[^\d.,-]/g, '').replace(',', '.');
                const numValue = parseFloat(cellStr);
                if (!isNaN(numValue) && Math.abs(numValue) > 0.01) {
                  allValues.push(numValue);
                }
              }
            }
          }
        }
        
        console.log(`Found ${allValues.length} numeric values in ${doc.file_name}`);
        return allValues;
      } catch (error) {
        console.log(`Error parsing document ${doc.file_name}:`, error.message);
        return [];
      }
    };

    // Create temp matches for each account - FOCUS ON BALANCE MATCHING ONLY
    for (const account of parsedAccounts) {
      console.log(`Processing account: ${account.accountNumber} - ${account.accountName} (Balance: ${account.currentYear})`);
      
      const matchedDocuments: string[] = [];
      let maxConfidence = 0;
      
      // Process only Excel documents for balance matching
      for (const doc of documents) {
        if (!doc.file_name.toLowerCase().includes('.xls')) {
          continue; // Skip non-Excel files
        }
        
        let confidence = 0;
        
        console.log(`Checking ${doc.file_name} for balance ${account.currentYear}`);
        
        // Parse Excel and check for exact balance matches
        const documentValues = await parseExcelForValues(doc);
        let balanceMatched = false;
        
        // Check if current year balance is found in document
        for (const docValue of documentValues) {
          if (isBalanceMatch(docValue, account.currentYear)) {
            confidence = 0.95; // High confidence for exact balance match
            balanceMatched = true;
            console.log(`✓ BALANCE MATCH: ${docValue} ≈ ${account.currentYear} in ${doc.file_name}`);
            break;
          }
        }
        
        // Only create matches for documents that contain the exact balance
        if (balanceMatched && confidence >= 0.95) {
          matchedDocuments.push(doc.id);
          maxConfidence = Math.max(maxConfidence, confidence);
        }
      }

      const matchStatus = matchedDocuments.length > 0 ? 'matched' : 'pending';
      const confidenceScore = matchedDocuments.length > 0 ? Math.round(maxConfidence * 100) / 100 : null;

      if (matchedDocuments.length > 0) {
        matchedCount++;
        console.log(`✓ Account ${account.accountNumber} matched with ${matchedDocuments.length} documents`);
      } else {
        console.log(`✗ Account ${account.accountNumber} (${account.currentYear}) - no balance matches found`);
      }

      tempMatches.push({
        trial_balance_id: trial_balance_id,
        account_number: account.accountNumber,
        account_name: account.accountName,
        current_year_balance: account.currentYear,
        previous_year_balance: account.previousYear,
        match_status: matchStatus,
        confidence_score: confidenceScore,
        matched_documents: matchedDocuments
      });
    }

    // Insert temp matches
    const { error: insertError } = await supabase
      .from('temp_account_matches')
      .insert(tempMatches);

    if (insertError) throw insertError;

    console.log(`Created ${tempMatches.length} temp matches, ${matchedCount} matched`);
    console.log(`Sample accounts processed:`, parsedAccounts.slice(0, 3));

    const result = {
      total_assignments: tempMatches.length,
      matched_count: matchedCount,
      success: true,
      has_groups: false
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in auto-match-ungrouped function:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});