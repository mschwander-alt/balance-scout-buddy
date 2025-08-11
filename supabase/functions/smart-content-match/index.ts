import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrialBalanceAccount {
  id: string;
  account_number: string;
  account_name: string;
  current_year_balance: number;
  source_type: 'grouped' | 'ungrouped';
}

interface DocumentMatch {
  document_id: string;
  confidence: number;
  balance_found: boolean;
  extracted_numbers: number[];
}

// Extract numbers from text using Swiss/German number formats
function extractNumbers(text: string): number[] {
  const numbers: number[] = [];
  
  // Patterns for different number formats commonly used in Switzerland/Germany
  const patterns = [
    /\b(\d{1,3}(?:['\s]\d{3})*(?:[.,]\d{2})?)\b/g,  // Swiss format: 1'234'567.89 or 1 234 567,89
    /\b(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/g,        // US format: 1,234,567.89
    /\b(\d+(?:\.\d{2})?)\b/g,                        // Simple decimal: 1234567.89
    /\b(\d+(?:,\d{2})?)\b/g,                         // European decimal: 1234567,89
  ];

  patterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const numStr = match[1];
      // Normalize the number string
      let normalized = numStr
        .replace(/['\s]/g, '')  // Remove Swiss separators
        .replace(/,(\d{3})/g, '$1')  // Remove thousand separators
        .replace(/,(\d{2})$/, '.$1');  // Convert European decimal comma to dot
      
      const num = parseFloat(normalized);
      if (!isNaN(num) && num > 0) {
        numbers.push(num);
      }
    }
  });

  return [...new Set(numbers)]; // Remove duplicates
}

// Extract text from PDF file
async function extractTextFromPDF(supabase: any, filePath: string): Promise<string> {
  try {
    const { data, error } = await supabase.storage
      .from('account-evidence')
      .download(filePath);

    if (error) {
      console.error('Error downloading PDF:', error);
      return '';
    }

    const arrayBuffer = await data.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Convert binary data to text (simplified approach)
    // In a production environment, you'd use a proper PDF parser
    let text = '';
    for (let i = 0; i < uint8Array.length; i++) {
      if (uint8Array[i] >= 32 && uint8Array[i] <= 126) {
        text += String.fromCharCode(uint8Array[i]);
      } else if (uint8Array[i] === 10 || uint8Array[i] === 13) {
        text += ' ';
      }
    }
    
    return text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    return '';
  }
}

// Extract numbers from Excel file
async function extractNumbersFromExcel(supabase: any, filePath: string): Promise<number[]> {
  try {
    const { data, error } = await supabase.storage
      .from('account-evidence')
      .download(filePath);

    if (error) {
      console.error('Error downloading Excel:', error);
      return [];
    }

    const arrayBuffer = await data.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const numbers: number[] = [];

    // Process all sheets
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      jsonData.forEach((row: any) => {
        if (Array.isArray(row)) {
          row.forEach(cell => {
            if (typeof cell === 'number' && cell > 0) {
              numbers.push(cell);
            } else if (typeof cell === 'string') {
              const extractedNums = extractNumbers(cell);
              numbers.push(...extractedNums);
            }
          });
        }
      });
    });

    return [...new Set(numbers)]; // Remove duplicates
  } catch (error) {
    console.error('Error extracting numbers from Excel:', error);
    return [];
  }
}

// Check if target balance matches any extracted numbers within tolerance
function findBalanceMatch(targetBalance: number, extractedNumbers: number[], tolerance: number = 0.01): boolean {
  const target = Math.abs(targetBalance);
  
  return extractedNumbers.some(num => {
    const diff = Math.abs(num - target);
    const percentDiff = diff / target;
    return percentDiff <= tolerance;
  });
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { trial_balance_id } = await req.json();

    if (!trial_balance_id) {
      return new Response(
        JSON.stringify({ error: 'trial_balance_id is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting smart content matching for trial_balance_id:', trial_balance_id);

    // Check if account groups exist
    const { data: groupsData, error: groupsError } = await supabase
      .from('account_groups')
      .select('id')
      .eq('trial_balance_id', trial_balance_id)
      .limit(1);

    if (groupsError) {
      throw new Error(`Error checking groups: ${groupsError.message}`);
    }

    const hasGroups = groupsData && groupsData.length > 0;
    
    // Get accounts to process
    let accounts: TrialBalanceAccount[] = [];
    
    if (hasGroups) {
      const { data: groupedAccounts, error: accountsError } = await supabase
        .from('account_group_assignments')
        .select(`
          id,
          account_number,
          account_name,
          current_year_balance,
          account_groups!inner(trial_balance_id)
        `)
        .eq('account_groups.trial_balance_id', trial_balance_id)
        .neq('current_year_balance', 0);

      if (accountsError) {
        throw new Error(`Error fetching grouped accounts: ${accountsError.message}`);
      }

      accounts = groupedAccounts.map(acc => ({
        id: acc.id,
        account_number: acc.account_number,
        account_name: acc.account_name,
        current_year_balance: acc.current_year_balance,
        source_type: 'grouped' as const
      }));
    } else {
      const { data: ungroupedAccounts, error: accountsError } = await supabase
        .from('temp_account_matches')
        .select('id, account_number, account_name, current_year_balance')
        .eq('trial_balance_id', trial_balance_id)
        .neq('current_year_balance', 0);

      if (accountsError) {
        throw new Error(`Error fetching ungrouped accounts: ${accountsError.message}`);
      }

      accounts = ungroupedAccounts.map(acc => ({
        id: acc.id,
        account_number: acc.account_number,
        account_name: acc.account_name,
        current_year_balance: acc.current_year_balance,
        source_type: 'ungrouped' as const
      }));
    }

    // Get all documents for this trial balance
    const { data: documents, error: documentsError } = await supabase
      .from('account_evidence')
      .select('id, file_name, file_path, file_type')
      .eq('trial_balance_id', trial_balance_id);

    if (documentsError) {
      throw new Error(`Error fetching documents: ${documentsError.message}`);
    }

    console.log(`Processing ${accounts.length} accounts and ${documents.length} documents`);

    let matchedCount = 0;
    const tolerance = 0.01; // 1% tolerance

    // Process each account
    for (const account of accounts) {
      const targetBalance = Math.abs(account.current_year_balance);
      let bestMatch: DocumentMatch | null = null;
      let highestConfidence = 0;

      // Check each document for matches
      for (const document of documents) {
        let extractedNumbers: number[] = [];
        let confidence = 0;

        try {
          // Extract content based on file type
          if (document.file_type?.toLowerCase().includes('pdf') || document.file_path?.toLowerCase().endsWith('.pdf')) {
            const text = await extractTextFromPDF(supabase, document.file_path);
            extractedNumbers = extractNumbers(text);
          } else if (
            document.file_type?.toLowerCase().includes('excel') ||
            document.file_type?.toLowerCase().includes('spreadsheet') ||
            document.file_path?.toLowerCase().endsWith('.xlsx') ||
            document.file_path?.toLowerCase().endsWith('.xls')
          ) {
            extractedNumbers = await extractNumbersFromExcel(supabase, document.file_path);
          }

          // Check for balance match
          const balanceFound = findBalanceMatch(targetBalance, extractedNumbers, tolerance);
          
          if (balanceFound) {
            confidence += 0.7; // High confidence for exact balance match
          }

          // Additional confidence from filename similarity (bonus points)
          const accountNumberSimilarity = account.account_number && document.file_name ? 
            calculateSimilarity(account.account_number, document.file_name) : 0;
          const accountNameSimilarity = account.account_name && document.file_name ? 
            calculateSimilarity(account.account_name, document.file_name) : 0;

          confidence += Math.max(accountNumberSimilarity, accountNameSimilarity) * 0.3;

          // Keep track of best match for this account
          if (confidence > highestConfidence && confidence >= 0.5) {
            bestMatch = {
              document_id: document.id,
              confidence,
              balance_found: balanceFound,
              extracted_numbers: extractedNumbers
            };
            highestConfidence = confidence;
          }

        } catch (error) {
          console.error(`Error processing document ${document.id}:`, error);
        }
      }

      // Update account with best match or mark as unmatched
      if (bestMatch) {
        const tableName = hasGroups ? 'account_group_assignments' : 'temp_account_matches';
        
        const { error: updateError } = await supabase
          .from(tableName)
          .update({
            match_status: 'matched',
            confidence_score: bestMatch.confidence,
            matched_documents: [bestMatch.document_id]
          })
          .eq('id', account.id);

        if (updateError) {
          console.error(`Error updating ${tableName}:`, updateError);
        } else {
          matchedCount++;
        }
      } else {
        const tableName = hasGroups ? 'account_group_assignments' : 'temp_account_matches';
        
        const { error: updateError } = await supabase
          .from(tableName)
          .update({ match_status: 'unmatched' })
          .eq('id', account.id);

        if (updateError) {
          console.error(`Error updating ${tableName}:`, updateError);
        }
      }
    }

    const result = {
      success: true,
      total_accounts: accounts.length,
      matched_count: matchedCount,
      has_groups: hasGroups,
      match_rate: accounts.length > 0 ? (matchedCount / accounts.length) * 100 : 0
    };

    console.log('Smart content matching completed:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in smart content matching:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Simple string similarity function
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const distance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}
