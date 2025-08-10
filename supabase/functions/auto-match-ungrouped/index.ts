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

    // Simple balance matching for Excel files only (to avoid timeouts)
    const checkBalanceInFilename = (fileName: string, balance: number): boolean => {
      // Extract numbers from filename using regex
      const numberMatches = fileName.match(/\d+[\.,]?\d*/g);
      if (!numberMatches) return false;
      
      for (const match of numberMatches) {
        const num = parseFloat(match.replace(',', '.'));
        if (!isNaN(num) && isBalanceMatch(num, balance)) {
          return true;
        }
      }
      return false;
    };

    // Create temp matches for each account
    for (const account of parsedAccounts) {
      console.log(`Processing account: ${account.accountNumber} - ${account.accountName} (${account.currentYear})`);
      
      const matchedDocuments: string[] = [];
      let maxConfidence = 0;
      
      // Simplified matching logic to avoid timeouts
      for (const doc of documents) {
        const fileName = doc.file_name.toUpperCase();
        const accountNum = account.accountNumber.toString().trim();
        const accountName = account.accountName.toUpperCase().trim();
        
        let confidence = 0;
        
        // 1. BALANCE IN FILENAME CHECK (for Excel files)
        if (doc.file_name.toLowerCase().includes('.xls')) {
          if (checkBalanceInFilename(fileName, account.currentYear)) {
            confidence = Math.max(confidence, 0.95);
            console.log(`Balance match in filename: ${account.currentYear} found in ${doc.file_name}`);
          } else if (account.previousYear !== 0 && checkBalanceInFilename(fileName, account.previousYear)) {
            confidence = Math.max(confidence, 0.90);
            console.log(`Previous year balance match in filename: ${account.previousYear} found in ${doc.file_name}`);
          }
        }
        
        // 2. ACCOUNT NUMBER MATCHING
        if (fileName.includes(accountNum)) {
          confidence = Math.max(confidence, 0.85);
        }
        
        // 3. ACCOUNT NAME MATCHING
        const accountWords = accountName.split(/\s+/).filter(word => word.length > 2);
        let nameMatches = 0;
        for (const word of accountWords) {
          if (fileName.includes(word)) {
            nameMatches++;
          }
        }
        if (accountWords.length > 0) {
          const nameMatchRatio = nameMatches / accountWords.length;
          if (nameMatchRatio > 0.5) {
            confidence = Math.max(confidence, 0.6 * nameMatchRatio);
          }
        }
        
        // 4. PARTIAL ACCOUNT NUMBER MATCHING
        if (accountNum.length >= 3) {
          const accountPrefix = accountNum.substring(0, 3);
          if (fileName.includes(accountPrefix)) {
            confidence = Math.max(confidence, 0.5);
          }
        }
        
        // 5. PATTERN MATCHING WITH SEPARATORS
        const patterns = [
          accountNum.replace(/(\d)(\d{2})/, '$1-$2'),  // 1000 -> 1-00
          accountNum.replace(/(\d{2})(\d{2})/, '$1-$2'), // 1000 -> 10-00
          accountNum.replace(/(\d)/, '$1.'),            // Add dots
          accountNum.replace(/(\d)/, '$1_'),            // Add underscores
        ];
        
        for (const pattern of patterns) {
          if (fileName.includes(pattern.toUpperCase())) {
            confidence = Math.max(confidence, 0.7);
          }
        }
        
        // 6. ACCOUNTING TERMS MATCHING
        const commonTerms = getAccountTypeTerms(account.accountName);
        for (const term of commonTerms) {
          if (fileName.includes(term.toUpperCase())) {
            confidence = Math.max(confidence, 0.6);
          }
        }
        
        // Only include documents with sufficient confidence
        if (confidence >= 0.5) {
          matchedDocuments.push(doc.id);
          maxConfidence = Math.max(maxConfidence, confidence);
        }
      }

      const matchStatus = matchedDocuments.length > 0 ? 'matched' : 'pending';
      const confidenceScore = matchedDocuments.length > 0 ? Math.round(maxConfidence * 100) / 100 : null;

      if (matchedDocuments.length > 0) {
        matchedCount++;
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