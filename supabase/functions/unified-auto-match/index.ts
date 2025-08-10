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

// Simple text extraction from Excel files
async function extractTextFromExcel(supabase: any, filePath: string): Promise<string> {
  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('account-evidence')
      .download(filePath);

    if (downloadError) {
      console.log(`Could not download Excel file ${filePath}:`, downloadError);
      return '';
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let allText = '';

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
      
      for (const row of jsonData) {
        for (const cell of row) {
          if (cell != null && cell !== '') {
            allText += String(cell) + ' ';
          }
        }
        allText += '\n';
      }
    }

    console.log(`Extracted ${allText.length} characters from Excel ${filePath}`);
    return allText;
  } catch (error) {
    console.log(`Error extracting text from Excel file ${filePath}:`, error);
    return '';
  }
}

// Simple text extraction from PDF files
async function extractTextFromPDF(supabase: any, filePath: string): Promise<string> {
  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('account-evidence')
      .download(filePath);

    if (downloadError) {
      console.log(`Could not download PDF file ${filePath}:`, downloadError);
      return '';
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let extractedText = '';
    
    // Simple binary-to-text conversion
    for (let i = 0; i < uint8Array.length; i++) {
      const byte = uint8Array[i];
      if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9) {
        extractedText += String.fromCharCode(byte);
      } else {
        extractedText += ' ';
      }
    }
    
    // Clean up the extracted text
    extractedText = extractedText.replace(/\s+/g, ' ').trim();
    
    console.log(`Extracted ${extractedText.length} characters from PDF ${filePath}`);
    return extractedText;
    
  } catch (error) {
    console.log(`Error extracting text from PDF file ${filePath}:`, error);
    return '';
  }
}

// Generate basic saldo patterns
function generateSaldoPatterns(saldo: number): string[] {
  const patterns: string[] = [];
  const absSaldo = Math.abs(saldo);
  
  // For very small amounts, be more restrictive
  if (absSaldo <= 10) {
    patterns.push(saldo.toFixed(2));
    if (saldo > 0) patterns.push(saldo.toFixed(1));
    return patterns;
  }
  
  // Basic patterns
  patterns.push(saldo.toFixed(2));
  patterns.push((-saldo).toFixed(2));
  
  // Swiss format
  try {
    const swissFormat = saldo.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    patterns.push(swissFormat);
  } catch (e) {
    // Fallback if locale not available
    patterns.push(saldo.toFixed(2));
  }
  
  // German format
  try {
    const germanFormat = saldo.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    patterns.push(germanFormat);
  } catch (e) {
    // Fallback
    patterns.push(saldo.toFixed(2).replace('.', ','));
  }
  
  return [...new Set(patterns)].filter(p => p && p !== '0.00' && p !== '-0.00');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('Starting unified auto-match function');

  try {
    const { trial_balance_id } = await req.json();
    
    if (!trial_balance_id) {
      throw new Error('trial_balance_id is required');
    }

    console.log(`Processing matching for trial_balance_id: ${trial_balance_id}`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if we have account groups
    const { data: existingGroups, error: groupsError } = await supabase
      .from('account_groups')
      .select('id')
      .eq('trial_balance_id', trial_balance_id)
      .limit(1);

    if (groupsError) throw groupsError;

    const hasGroups = existingGroups && existingGroups.length > 0;
    console.log(`Has groups: ${hasGroups}`);

    let accountsToMatch: AccountMatch[] = [];

    if (hasGroups) {
      // Load grouped accounts
      const { data: groupedAccounts, error: assignmentsError } = await supabase
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

      accountsToMatch = (groupedAccounts || []).map(a => ({
        id: a.id,
        account_number: a.account_number,
        account_name: a.account_name,
        current_year_balance: a.current_year_balance,
        previous_year_balance: a.previous_year_balance
      }));

      console.log(`Loaded ${accountsToMatch.length} grouped accounts`);
    } else {
      // Load trial balance directly
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

      // Clear existing temp matches
      await supabase
        .from('temp_account_matches')
        .delete()
        .eq('trial_balance_id', trial_balance_id);

      console.log(`Loaded ${accountsToMatch.length} accounts from trial balance`);
    }

    // Get documents
    const { data: documents, error: documentsError } = await supabase
      .from('account_evidence')
      .select('*')
      .eq('trial_balance_id', trial_balance_id);

    if (documentsError) throw documentsError;

    console.log(`Found ${documents?.length || 0} documents`);

    let matchedCount = 0;

    // Process each account
    for (const account of accountsToMatch) {
      // Skip zero balance accounts
      if (account.current_year_balance === 0) {
        if (hasGroups && account.id) {
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

      const patterns = generateSaldoPatterns(account.current_year_balance);
      const matchedDocuments: string[] = [];

      console.log(`Checking account ${account.account_number} (${account.current_year_balance}) with ${patterns.length} patterns`);

      // Check each document
      for (const doc of documents || []) {
        const fileName = doc.file_name.toLowerCase();
        let docText = '';

        try {
          if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            docText = await extractTextFromExcel(supabase, doc.file_path);
          } else if (fileName.endsWith('.pdf')) {
            docText = await extractTextFromPDF(supabase, doc.file_path);
          }

          // Check patterns in document text
          for (const pattern of patterns) {
            if (docText.includes(pattern)) {
              matchedDocuments.push(doc.id);
              console.log(`✓ MATCH: Pattern "${pattern}" found in ${doc.file_name} for account ${account.account_number}`);
              break;
            }
          }
        } catch (error) {
          console.log(`Error processing document ${doc.file_name}:`, error);
        }
      }

      const matchStatus = matchedDocuments.length > 0 ? 'matched' : 'pending';
      const confidenceScore = matchedDocuments.length > 0 ? 1.0 : null;

      if (matchedDocuments.length > 0) {
        matchedCount++;
      }

      // Save results
      try {
        if (hasGroups && account.id) {
          await supabase
            .from('account_group_assignments')
            .update({
              match_status: matchStatus,
              confidence_score: confidenceScore,
              matched_documents: matchedDocuments
            })
            .eq('id', account.id);
        } else {
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
      } catch (error) {
        console.log(`Error saving results for account ${account.account_number}:`, error);
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