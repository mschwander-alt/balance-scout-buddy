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

interface AccountMatch {
  id?: string;
  account_number: string;
  account_name: string;
  current_year_balance: number;
  previous_year_balance?: number;
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

    console.log(`Found ${numbers.length} numeric values in Excel ${filePath}`);
    return [...new Set(numbers)].sort((a, b) => a - b);
  } catch (error) {
    console.log(`Error parsing Excel file ${filePath}:`, error);
    return [];
  }
}

// Helper function to extract numbers from PDF files
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
    
    // Simple binary search for number patterns in PDF
    const uint8Array = new Uint8Array(arrayBuffer);
    let extractedText = '';
    
    // Convert to string and look for readable ASCII characters
    for (let i = 0; i < uint8Array.length; i++) {
      const byte = uint8Array[i];
      // ASCII printable characters (32-126) plus some common chars
      if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13) {
        extractedText += String.fromCharCode(byte);
      } else {
        // Add space to separate potential numbers
        extractedText += ' ';
      }
    }
    
    console.log(`Extracted ${extractedText.length} characters from PDF ${filePath}`);
    
    // More aggressive number extraction patterns for Swiss/German formatting
    const patterns = [
      // Swiss formatting with apostrophe: 1'234.56, 1'234,56
      /\d{1,3}(?:'\d{3})*(?:[.,]\d{1,2})?/g,
      // Space separated thousands: 1 234.56, 1 234,56  
      /\d{1,3}(?:\s\d{3})*(?:[.,]\d{1,2})?/g,
      // Simple decimals: 123.45, 123,45
      /\d+[.,]\d{1,2}/g,
      // Whole numbers (min 2 digits to avoid single digits)
      /\b\d{2,}\b/g
    ];
    
    for (const pattern of patterns) {
      let match;
      pattern.lastIndex = 0; // Reset regex
      
      while ((match = pattern.exec(extractedText)) !== null) {
        const matchStr = match[0];
        
        // Clean the number: remove apostrophes and spaces, normalize decimal separator
        let cleanNumber = matchStr
          .replace(/[''\s]/g, '')  // Remove apostrophes and spaces
          .replace(',', '.');       // Convert comma to dot for decimal
        
        const numValue = parseFloat(cleanNumber);
        
        // Filter reasonable numbers (exclude years, page numbers, etc.)
        if (!isNaN(numValue) && numValue >= 0.01 && numValue < 10000000) {
          // Skip obvious non-financial numbers
          const isYear = numValue >= 1900 && numValue <= 2100;
          const isSmallInt = numValue < 10 && Number.isInteger(numValue);
          
          if (!isYear && !isSmallInt) {
            numbers.push(Math.abs(numValue));
          }
        }
      }
    }
    
    // Remove duplicates and round to 2 decimal places
    const uniqueNumbers = [...new Set(numbers.map(n => Math.round(n * 100) / 100))];
    
    console.log(`Extracted ${uniqueNumbers.length} unique numbers from PDF ${filePath}`);
    
    // Log first few numbers for debugging
    if (uniqueNumbers.length > 0) {
      const samples = uniqueNumbers.slice(0, 5).join(', ');
      console.log(`Sample numbers: ${samples}${uniqueNumbers.length > 5 ? '...' : ''}`);
    }
    
    return uniqueNumbers.sort((a, b) => a - b);
    
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

    console.log(`Processing unified matching for trial_balance_id: ${trial_balance_id}`);
    
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

    const hasGroups = groups && groups.length > 0;
    let accountsToMatch: AccountMatch[] = [];

    if (hasGroups) {
      // Get grouped accounts
      console.log('Processing grouped accounts');
      const { data: assignments, error: assignmentsError } = await supabase
        .from('account_group_assignments')
        .select(`
          id,
          account_number,
          account_name,
          current_year_balance,
          previous_year_balance,
          account_groups!inner(trial_balance_id)
        `)
        .eq('account_groups.trial_balance_id', trial_balance_id);

      if (assignmentsError) throw assignmentsError;

      accountsToMatch = assignments.map(a => ({
        id: a.id,
        account_number: a.account_number,
        account_name: a.account_name,
        current_year_balance: a.current_year_balance,
        previous_year_balance: a.previous_year_balance
      }));
    } else {
      // Get ungrouped accounts from trial balance
      console.log('Processing ungrouped accounts');
      
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

      accountsToMatch = parsedAccounts.map(a => ({
        account_number: a.accountNumber,
        account_name: a.accountName,
        current_year_balance: a.currentYear,
        previous_year_balance: a.previousYear
      }));

      // Clear existing temp matches for ungrouped accounts
      await supabase
        .from('temp_account_matches')
        .delete()
        .eq('trial_balance_id', trial_balance_id);
    }

    console.log(`Found ${accountsToMatch.length} accounts to match`);

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

    // Process matches for each account
    for (const account of accountsToMatch) {
      const matchedDocuments: string[] = [];
      
      // Skip accounts with zero balance
      if (account.current_year_balance === 0) {
        if (hasGroups) {
          // Update grouped assignment
          await supabase
            .from('account_group_assignments')
            .update({
              match_status: 'pending',
              confidence_score: null,
              matched_documents: []
            })
            .eq('id', account.id);
        }
        continue;
      }

      const accountBalance = Math.abs(account.current_year_balance);
      
      // Search for this balance in each document
      for (const doc of documents) {
        const docNumbers = documentNumbers[doc.id] || [];
        
        // Check if the account balance exists in this document
        const balanceFound = docNumbers.some(num => Math.abs(num - accountBalance) < 0.01);
        
        if (balanceFound) {
          matchedDocuments.push(doc.id);
          console.log(`✓ MATCH: Balance ${accountBalance} found in ${doc.file_name} for account ${account.account_number}`);
        }
      }

      const matchStatus = matchedDocuments.length > 0 ? 'matched' : 'pending';
      const confidenceScore = matchedDocuments.length > 0 ? 1.0 : null;

      if (matchedDocuments.length > 0) {
        matchedCount++;
      }

      if (hasGroups) {
        // Update grouped assignment
        await supabase
          .from('account_group_assignments')
          .update({
            match_status: matchStatus,
            confidence_score: confidenceScore,
            matched_documents: matchedDocuments
          })
          .eq('id', account.id);
      } else {
        // Create temp match for ungrouped account
        await supabase
          .from('temp_account_matches')
          .insert({
            trial_balance_id: trial_balance_id,
            account_number: account.account_number,
            account_name: account.account_name,
            current_year_balance: account.current_year_balance,
            previous_year_balance: account.previous_year_balance,
            match_status: matchStatus,
            confidence_score: confidenceScore,
            matched_documents: matchedDocuments
          });
      }
    }

    console.log(`Completed matching: ${matchedCount}/${accountsToMatch.length} matched`);

    const result = {
      total_assignments: accountsToMatch.length,
      matched_count: matchedCount,
      success: true,
      has_groups: hasGroups
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in unified auto-match function:', error);
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