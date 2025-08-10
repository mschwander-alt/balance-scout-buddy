import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
import { getDocument, GlobalWorkerOptions } from 'https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs'

// Set up PDF.js worker
GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.worker.mjs';

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

    console.log(`Headers found: ${JSON.stringify(headers)}`);
    console.log(`Column mapping - Account Number: ${trialBalance.account_number_column}, Account Name: ${trialBalance.account_name_column}, Current Year: ${trialBalance.current_year_column}`);

    // Find column indices - more flexible matching
    let accountNumberIndex = -1;
    let accountNameIndex = -1;
    let currentYearIndex = -1;
    let previousYearIndex = -1;

    // Try exact match first, then partial match
    for (let i = 0; i < headers.length; i++) {
      const header = String(headers[i] || '').trim();
      
      if (trialBalance.account_number_column && header === trialBalance.account_number_column) {
        accountNumberIndex = i;
      } else if (trialBalance.account_name_column && header === trialBalance.account_name_column) {
        accountNameIndex = i;
      } else if (trialBalance.current_year_column && header === trialBalance.current_year_column) {
        currentYearIndex = i;
      } else if (trialBalance.previous_year_column && header === trialBalance.previous_year_column) {
        previousYearIndex = i;
      }
    }

    console.log(`Column indices - Number: ${accountNumberIndex}, Name: ${accountNameIndex}, Current: ${currentYearIndex}, Previous: ${previousYearIndex}`);

    if (accountNumberIndex === -1 || accountNameIndex === -1) {
      console.log('Required columns not found - trying fallback detection');
      // Fallback: try to find columns by common patterns
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase().trim();
        if (accountNumberIndex === -1 && (header.includes('konto') || header.includes('account') || header.includes('nummer'))) {
          accountNumberIndex = i;
          console.log(`Found account number column at index ${i}: ${headers[i]}`);
        }
        if (accountNameIndex === -1 && (header.includes('bezeichnung') || header.includes('name') || header.includes('text'))) {
          accountNameIndex = i;
          console.log(`Found account name column at index ${i}: ${headers[i]}`);
        }
      }
    }

    if (accountNumberIndex === -1 || accountNameIndex === -1) {
      throw new Error(`Required columns not found. Account Number Index: ${accountNumberIndex}, Account Name Index: ${accountNameIndex}`);
    }

    const parsedAccounts: TrialBalanceRow[] = [];
    let skippedRows = 0;
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const accountNumber = String(row[accountNumberIndex] || '').trim();
      const accountName = String(row[accountNameIndex] || '').trim();
      
      // Skip empty rows or rows without essential data
      if (!accountNumber || !accountName || accountNumber === '0' || accountName.toLowerCase() === 'total') {
        skippedRows++;
        if (skippedRows <= 5) { // Only log first few skipped rows to avoid spam
          console.log(`Skipping row ${i + 2}: missing account data - Number: "${accountNumber}", Name: "${accountName}"`);
        }
        continue;
      }
      
      const currentYear = currentYearIndex >= 0 ? (parseFloat(String(row[currentYearIndex] || 0)) || 0) : 0;
      const previousYear = previousYearIndex >= 0 ? (parseFloat(String(row[previousYearIndex] || 0)) || 0) : 0;
      
      parsedAccounts.push({
        accountNumber,
        accountName,
        currentYear,
        previousYear,
      });
    }

    console.log(`Found ${parsedAccounts.length} accounts in trial balance, skipped ${skippedRows} rows`);

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
        console.log(`Error parsing Excel document ${doc.file_name}:`, error.message);
        return [];
      }
    };

    // Enhanced function to parse PDF document and extract all numeric values
    const parsePDFForValues = async (doc: any): Promise<number[]> => {
      try {
        console.log(`Parsing PDF file: ${doc.file_name}`);
        const { data: docData, error: docError } = await supabase.storage
          .from('account-evidence')
          .download(doc.file_path);

        if (docError) {
          console.log(`Could not download PDF document ${doc.file_name}:`, docError.message);
          return [];
        }

        const arrayBuffer = await docData.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Load PDF document
        const pdfDoc = await getDocument({ data: uint8Array }).promise;
        const allValues: number[] = [];
        
        // Process each page
        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          const page = await pdfDoc.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          // Extract text from all text items
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
          
          // Extract all numeric values using regex
          const numberPattern = /\d+[\.,]?\d*/g;
          const matches = pageText.match(numberPattern);
          
          if (matches) {
            for (const match of matches) {
              const cleanedMatch = match.replace(',', '.');
              const numValue = parseFloat(cleanedMatch);
              if (!isNaN(numValue) && Math.abs(numValue) > 0.01) {
                allValues.push(numValue);
              }
            }
          }
        }
        
        console.log(`Found ${allValues.length} numeric values in PDF ${doc.file_name}`);
        return allValues;
      } catch (error) {
        console.log(`Error parsing PDF document ${doc.file_name}:`, error.message);
        return [];
      }
    };

    // Pre-parse all documents once to avoid repeated parsing
    console.log('Pre-parsing all evidence documents...');
    const documentData = new Map<string, number[]>();
    
    for (const doc of documents) {
      const isExcel = doc.file_name.toLowerCase().includes('.xls');
      const isPDF = doc.file_name.toLowerCase().includes('.pdf');
      
      if (!isExcel && !isPDF) {
        continue;
      }
      
      try {
        let values: number[] = [];
        if (isExcel) {
          values = await parseExcelForValues(doc);
        } else if (isPDF) {
          values = await parsePDFForValues(doc);
        }
        documentData.set(doc.id, values);
      } catch (error) {
        console.log(`Error pre-parsing ${doc.file_name}:`, error.message);
        documentData.set(doc.id, []);
      }
    }

    // SIMPLE BALANCE MATCHING: Search for exact current year balance in pre-parsed data
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
      
      // Search through pre-parsed document data
      for (const doc of documents) {
        const values = documentData.get(doc.id) || [];
        
        // Check if the exact balance is found in this document
        const balanceFound = values.some(value => isBalanceMatch(value, account.currentYear));
        
        if (balanceFound) {
          matchedDocuments.push(doc.id);
          console.log(`✓ MATCH: Balance ${account.currentYear} found in ${doc.file_name}`);
        }
      }

      // Create the temp match record
      const matchStatus = matchedDocuments.length > 0 ? 'matched' : 'pending';
      const confidenceScore = matchedDocuments.length > 0 ? 1.0 : null;

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