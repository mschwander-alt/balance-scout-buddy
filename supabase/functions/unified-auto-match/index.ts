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


// Helper function to extract text from PDF files (robust binary approach)
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
    
    // Enhanced binary-to-text conversion with better pattern recognition
    for (let i = 0; i < uint8Array.length; i++) {
      const byte = uint8Array[i];
      // ASCII printable characters + common European chars + line breaks
      if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9) {
        extractedText += String.fromCharCode(byte);
      } else {
        // Add space to separate potential text segments
        extractedText += ' ';
      }
    }
    
    // Clean up the extracted text
    extractedText = extractedText
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/\s+/g, ' ')           // Remove multiple spaces
      .trim();
    
    console.log(`Extracted ${extractedText.length} characters from PDF ${filePath}`);
    return extractedText;
    
  } catch (error) {
    console.log(`Error extracting text from PDF file ${filePath}:`, error);
    return '';
  }
}

// Helper function to extract text from Excel files
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

    // Parse all sheets and convert to text
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

// Generate saldo patterns for matching (optimized for performance)
function generateSaldoPatterns(saldo: number): string[] {
  const patterns: string[] = [];
  const absSaldo = Math.abs(saldo);
  
  // Skip very small amounts that are prone to false matches
  if (absSaldo <= 5) {
    // For very small amounts, only use exact patterns
    patterns.push(saldo.toFixed(2));  // Exact: 1.00
    return patterns.filter(p => p && p !== '0.00' && p !== '-0.00');
  }
  
  // For small amounts (5-50), use fewer patterns to reduce noise
  if (absSaldo <= 50) {
    patterns.push(saldo.toFixed(2));  // 23.50
    patterns.push((-saldo).toFixed(2));  // -23.50
    
    // Only Swiss format for small amounts
    const swissFormat = saldo.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    patterns.push(swissFormat);
    
    return patterns.filter(p => p && p !== '0.00' && p !== '-0.00');
  }
  
  // For larger amounts, use more comprehensive patterns
  // Basic formats
  patterns.push(saldo.toFixed(2));                                    // 233.50
  patterns.push((-saldo).toFixed(2));                                 // -233.50
  
  // Swiss format with apostrophe
  const swissFormat = saldo.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  patterns.push(swissFormat);                                         // 233.50 or 1'233.50
  patterns.push((-saldo).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  
  // German format (thousands with dot, decimal with comma)
  const germanFormat = saldo.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  patterns.push(germanFormat);                                        // 233,50 or 1.233,50
  patterns.push((-saldo).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  
  // Space as thousands separator
  const spaceFormat = saldo.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  patterns.push(spaceFormat);                                         // 1 233.50
  patterns.push(spaceFormat.replace('.', ','));                       // 1 233,50
  
  // With various Unicode spaces
  const nbspFormat = saldo.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  patterns.push(nbspFormat);                                          
  patterns.push(nbspFormat.replace('.', ','));
  
  const thinSpaceFormat = saldo.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  patterns.push(thinSpaceFormat);                                     
  patterns.push(thinSpaceFormat.replace('.', ','));
  
  // Remove duplicates and filter out invalid patterns
  return [...new Set(patterns)].filter(p => p && p !== '0.00' && p !== '-0.00');
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

    // Pre-extract text from all evidence documents
    console.log("Pre-extracting text from all evidence documents...");
    const documentTexts: { [key: string]: string } = {};

    for (const doc of documents) {
      const fileName = doc.file_name.toLowerCase();
      
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        console.log(`Extracting text from Excel file: ${doc.file_name}`);
        documentTexts[doc.id] = await extractTextFromExcel(supabase, doc.file_path);
      } else if (fileName.endsWith('.pdf')) {
        console.log(`Extracting text from PDF file: ${doc.file_name}`);
        documentTexts[doc.id] = await extractTextFromPDF(supabase, doc.file_path);
      }
    }

    let matchedCount = 0;
    const BATCH_SIZE = 10; // Process accounts in batches to avoid timeout
    const MAX_EXECUTION_TIME = 45000; // 45 seconds max execution time
    const startTime = Date.now();

    // Process accounts in batches to avoid timeout
    for (let i = 0; i < accountsToMatch.length; i += BATCH_SIZE) {
      // Check if we're approaching timeout
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        console.log(`Timeout approaching, stopping at account ${i}/${accountsToMatch.length}`);
        break;
      }

      const batch = accountsToMatch.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(accountsToMatch.length/BATCH_SIZE)} (accounts ${i+1}-${Math.min(i+BATCH_SIZE, accountsToMatch.length)})`);

      // Process this batch
      for (const account of batch) {
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

        // Generate saldo patterns for this account
        const saldoPatterns = generateSaldoPatterns(account.current_year_balance);
        console.log(`Generated ${saldoPatterns.length} patterns for account ${account.account_number} (${account.current_year_balance})`);
        
        // Search for saldo patterns in each document
        for (const doc of documents) {
          const docText = documentTexts[doc.id] || '';
          let patternFound = false;
          
          // Check each saldo pattern
          for (const pattern of saldoPatterns) {
            if (docText.includes(pattern)) {
              matchedDocuments.push(doc.id);
              console.log(`✓ MATCH: Pattern "${pattern}" found in ${doc.file_name} for account ${account.account_number}`);
              patternFound = true;
              break; // Found a match, no need to check other patterns for this document
            }
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