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

// Helper function to extract numbers from Excel files
async function extractNumbersFromExcel(supabase: any, filePath: string): Promise<number[]> {
  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('account-evidence')
      .download(filePath);

    if (downloadError) {
      console.log(`Could not download Excel file ${filePath}:`, downloadError);
      return [];
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const numbers: number[] = [];

    // Parse all sheets
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      for (const row of jsonData) {
        for (const cell of row) {
          if (cell != null) {
            const numValue = parseFloat(String(cell).replace(/[^\d.-]/g, ''));
            if (!isNaN(numValue) && numValue !== 0) {
              numbers.push(Math.abs(numValue));
            }
          }
        }
      }
    }

    console.log(`Found ${numbers.length} numeric values in ${filePath}`);
    return numbers;
  } catch (error) {
    console.log(`Error parsing Excel file ${filePath}:`, error);
    return [];
  }
}

// Helper function to extract numbers from PDF files using improved text extraction
async function extractNumbersFromPDF(supabase: any, filePath: string): Promise<number[]> {
  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('account-evidence')
      .download(filePath);

    if (downloadError) {
      console.log(`Could not download PDF file ${filePath}:`, downloadError);
      return [];
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const numbers: number[] = [];
    
    // Convert PDF binary to text by looking for readable text patterns
    const uint8Array = new Uint8Array(arrayBuffer);
    let text = '';
    
    // Extract readable ASCII text from PDF stream
    for (let i = 0; i < uint8Array.length - 1; i++) {
      const char = uint8Array[i];
      // Include printable ASCII characters and common European characters
      if ((char >= 32 && char <= 126) || char === 10 || char === 13) {
        text += String.fromCharCode(char);
      } else {
        // Add space to separate potential numbers
        text += ' ';
      }
    }
    
    // Improved number extraction with better patterns
    // Look for numbers with various decimal separators and thousands separators
    const numberPatterns = [
      /\b\d{1,3}(?:['\s]\d{3})*[.,]\d{2}\b/g,  // 1'000.50, 1 000,50
      /\b\d{1,3}(?:['\s]\d{3})*\b/g,           // 1'000, 1 000
      /\b\d+[.,]\d+\b/g,                       // 123.45, 123,45
      /\b\d+\b/g                               // 123
    ];
    
    for (const pattern of numberPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Clean and normalize the number
          let cleanNum = match
            .replace(/['\s]/g, '')        // Remove thousands separators
            .replace(',', '.');           // Normalize decimal separator
          
          const numValue = parseFloat(cleanNum);
          if (!isNaN(numValue) && numValue > 0 && numValue < 999999999) {
            numbers.push(Math.abs(numValue));
          }
        }
      }
    }
    
    // Remove duplicates and sort
    const uniqueNumbers = [...new Set(numbers)].sort((a, b) => a - b);
    
    console.log(`Found ${uniqueNumbers.length} unique numeric values in PDF ${filePath}`);
    console.log(`Sample values: ${uniqueNumbers.slice(0, 10).join(', ')}`);
    
    return uniqueNumbers;
  } catch (error) {
    console.log(`Error parsing PDF file ${filePath}:`, error);
    return [];
  }
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

    // Pre-parse all evidence documents to extract numeric values
    console.log("Pre-parsing all evidence documents...");
    const documentNumbers: { [key: string]: number[] } = {};

    for (const doc of documents) {
      const fileName = doc.file_name.toLowerCase();
      
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        console.log(`Parsing Excel file: ${doc.file_name}`);
        documentNumbers[doc.id] = await extractNumbersFromExcel(supabase, doc.file_path);
      } else if (fileName.endsWith('.pdf')) {
        console.log(`Parsing PDF file: ${doc.file_name}`);
        documentNumbers[doc.id] = await extractNumbersFromPDF(supabase, doc.file_path);
      }
    }

    let matchedCount = 0;
    const tempMatches = [];

    // Create temp matches for each account based on balance matching
    for (const account of parsedAccounts) {
      const matchedDocuments: string[] = [];
      
      // Skip accounts with zero balance
      if (account.currentYear === 0) {
        tempMatches.push({
          trial_balance_id: trial_balance_id,
          account_number: account.accountNumber,
          account_name: account.accountName,
          current_year_balance: account.currentYear,
          previous_year_balance: account.previousYear,
          match_status: 'pending',
          confidence_score: null,
          matched_documents: []
        });
        continue;
      }

      const accountBalance = Math.abs(account.currentYear);
      
      // Search for this balance in each document
      for (const doc of documents) {
        const docNumbers = documentNumbers[doc.id] || [];
        
        // Check if the account balance exists in this document
        const balanceFound = docNumbers.some(num => Math.abs(num - accountBalance) < 0.01);
        
        if (balanceFound) {
          matchedDocuments.push(doc.id);
          console.log(`✓ MATCH: Balance ${accountBalance} found in ${doc.file_name}`);
        }
      }

      const matchStatus = matchedDocuments.length > 0 ? 'matched' : 'pending';
      const confidenceScore = matchedDocuments.length > 0 ? 1.0 : null; // 100% confidence for exact balance matches

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