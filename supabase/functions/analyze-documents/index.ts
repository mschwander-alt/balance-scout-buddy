import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrialBalanceAccount {
  account_number: string;
  account_name: string;
  current_year_balance: number;
  previous_year_balance: number;
}

interface DocumentAnalysisResult {
  document_id: string;
  extracted_numbers: number[];
  matched_accounts: Array<{
    account_number: string;
    account_name: string;
    balance_amount: number;
    confidence: number;
    match_type: 'exact' | 'close' | 'potential';
  }>;
}

// Extract numbers from text using various patterns
function extractNumbers(text: string): number[] {
  const numbers: number[] = [];
  
  // Swiss number patterns: 1'234.50, 1'234,50, 1234.50, 1234,50, 1 234.50, etc.
  const patterns = [
    // Swiss style with apostrophe: 1'234'567.89 or 1'234'567,89
    /(?:\d{1,3}(?:'?\d{3})*[.,]\d{1,2})/g,
    // Space separated: 1 234 567.89 or 1 234 567,89  
    /(?:\d{1,3}(?:\s\d{3})*[.,]\d{1,2})/g,
    // Simple numbers with decimals: 1234567.89 or 1234567,89
    /(?:\d+[.,]\d{1,2})/g,
    // Whole numbers: 1234567
    /(?:\d{4,})/g
  ];

  patterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => {
        // Clean and convert to number
        let cleaned = match
          .replace(/[''\s]/g, '') // Remove apostrophes and spaces
          .replace(/,/g, '.'); // Convert comma to dot for decimal
        
        const num = parseFloat(cleaned);
        if (!isNaN(num) && num > 0) {
          numbers.push(num);
        }
      });
    }
  });

  return [...new Set(numbers)]; // Remove duplicates
}

// Generate number variations for better matching
function generateNumberVariations(amount: number): number[] {
  const variations: number[] = [amount];
  
  // Add common rounding variations
  variations.push(Math.round(amount));
  variations.push(Math.floor(amount));
  variations.push(Math.ceil(amount));
  
  // Add absolute value
  variations.push(Math.abs(amount));
  
  // Add percentage-based variations (±1%, ±5%)
  variations.push(amount * 1.01);
  variations.push(amount * 0.99);
  variations.push(amount * 1.05);
  variations.push(amount * 0.95);
  
  return [...new Set(variations)];
}

// Match extracted numbers with account balances
function matchNumbersToAccounts(extractedNumbers: number[], accounts: TrialBalanceAccount[]): Array<{
  account_number: string;
  account_name: string;
  balance_amount: number;
  confidence: number;
  match_type: 'exact' | 'close' | 'potential';
}> {
  const matches: Array<{
    account_number: string;
    account_name: string;
    balance_amount: number;
    confidence: number;
    match_type: 'exact' | 'close' | 'potential';
  }> = [];

  accounts.forEach(account => {
    const accountBalance = Math.abs(account.current_year_balance);
    if (accountBalance === 0) return; // Skip zero balances
    
    const balanceVariations = generateNumberVariations(accountBalance);
    
    extractedNumbers.forEach(extractedNum => {
      const extractedAbs = Math.abs(extractedNum);
      
      // Check for exact matches
      if (balanceVariations.some(variation => Math.abs(variation - extractedAbs) < 0.01)) {
        matches.push({
          account_number: account.account_number,
          account_name: account.account_name,
          balance_amount: account.current_year_balance,
          confidence: 1.0,
          match_type: 'exact'
        });
        return;
      }
      
      // Check for close matches (within 1%)
      if (balanceVariations.some(variation => {
        const diff = Math.abs(variation - extractedAbs);
        return diff / Math.max(variation, extractedAbs) <= 0.01;
      })) {
        matches.push({
          account_number: account.account_number,
          account_name: account.account_name,
          balance_amount: account.current_year_balance,
          confidence: 0.9,
          match_type: 'close'
        });
        return;
      }
      
      // Check for potential matches (within 5%)
      if (balanceVariations.some(variation => {
        const diff = Math.abs(variation - extractedAbs);
        return diff / Math.max(variation, extractedAbs) <= 0.05;
      })) {
        matches.push({
          account_number: account.account_number,
          account_name: account.account_name,
          balance_amount: account.current_year_balance,
          confidence: 0.7,
          match_type: 'potential'
        });
      }
    });
  });

  // Remove duplicates and sort by confidence
  const uniqueMatches = matches.filter((match, index, self) => 
    index === self.findIndex(m => 
      m.account_number === match.account_number && 
      m.match_type === match.match_type
    )
  ).sort((a, b) => b.confidence - a.confidence);

  return uniqueMatches;
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

    console.log('Starting document analysis for trial_balance_id:', trial_balance_id);

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get OpenAI API key
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Fetch trial balance accounts
    let accounts: TrialBalanceAccount[] = [];
    
    // First try to get accounts from groups
    const { data: groupsData, error: groupsError } = await supabase
      .from('account_groups')
      .select(`
        *,
        assignments:account_group_assignments(*)
      `)
      .eq('trial_balance_id', trial_balance_id);

    if (groupsData && groupsData.length > 0) {
      // Use accounts from groups
      accounts = groupsData.flatMap(group => 
        group.assignments.map((assignment: any) => ({
          account_number: assignment.account_number,
          account_name: assignment.account_name,
          current_year_balance: assignment.current_year_balance,
          previous_year_balance: assignment.previous_year_balance
        }))
      );
    } else {
      // Try temp_account_matches
      const { data: tempMatches, error: tempError } = await supabase
        .from('temp_account_matches')
        .select('*')
        .eq('trial_balance_id', trial_balance_id);

      if (tempMatches && tempMatches.length > 0) {
        accounts = tempMatches.map(match => ({
          account_number: match.account_number,
          account_name: match.account_name,
          current_year_balance: match.current_year_balance || 0,
          previous_year_balance: match.previous_year_balance || 0
        }));
      }
    }

    if (accounts.length === 0) {
      throw new Error('No accounts found for this trial balance');
    }

    console.log(`Found ${accounts.length} accounts to analyze`);

    // Fetch documents
    const { data: documents, error: docsError } = await supabase
      .from('account_evidence')
      .select('*')
      .eq('trial_balance_id', trial_balance_id);

    if (docsError) throw docsError;

    if (!documents || documents.length === 0) {
      throw new Error('No documents found for this trial balance');
    }

    console.log(`Found ${documents.length} documents to analyze`);

    const analysisResults: DocumentAnalysisResult[] = [];
    let processedCount = 0;

    // Process each document
    for (const document of documents) {
      try {
        console.log(`Processing document ${processedCount + 1}/${documents.length}: ${document.file_name}`);

        // Download document
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('account-evidence')
          .download(document.file_path);

        if (downloadError) {
          console.error(`Error downloading ${document.file_name}:`, downloadError);
          continue;
        }

        // Convert to base64 for OpenAI
        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

        // Extract text using OpenAI
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are a document text extraction specialist. Extract all text from the document, paying special attention to numbers, amounts, and financial data. Preserve the original formatting and context of numbers. Include currency symbols and formatting (commas, apostrophes, spaces) as they appear in the document.`
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Extract all text from this document, especially focusing on numbers and financial amounts:'
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${document.file_type};base64,${base64}`
                    }
                  }
                ]
              }
            ],
            max_tokens: 4000,
            temperature: 0
          }),
        });

        if (!openaiResponse.ok) {
          console.error(`OpenAI API error for ${document.file_name}:`, await openaiResponse.text());
          continue;
        }

        const openaiResult = await openaiResponse.json();
        const extractedText = openaiResult.choices[0].message.content;

        // Extract numbers from the text
        const extractedNumbers = extractNumbers(extractedText);
        console.log(`Extracted ${extractedNumbers.length} numbers from ${document.file_name}`);

        // Match numbers to accounts
        const matchedAccounts = matchNumbersToAccounts(extractedNumbers, accounts);
        console.log(`Found ${matchedAccounts.length} potential matches for ${document.file_name}`);

        analysisResults.push({
          document_id: document.id,
          extracted_numbers: extractedNumbers,
          matched_accounts: matchedAccounts
        });

        // Store analysis result in database
        const { error: insertError } = await supabase
          .from('document_analysis')
          .upsert({
            document_id: document.id,
            trial_balance_id: trial_balance_id,
            user_id: document.user_id,
            extracted_numbers: extractedNumbers,
            matched_accounts: matchedAccounts,
            analysis_status: 'completed'
          });

        if (insertError) {
          console.error(`Error storing analysis for ${document.file_name}:`, insertError);
        }

        processedCount++;

      } catch (error) {
        console.error(`Error processing document ${document.file_name}:`, error);
        continue;
      }
    }

    // Update matched documents in assignments/temp_matches based on analysis
    let updatedAssignments = 0;
    
    for (const result of analysisResults) {
      if (result.matched_accounts.length === 0) continue;

      for (const match of result.matched_accounts) {
        if (match.confidence < 0.9) continue; // Only auto-assign high confidence matches

        try {
          // Try to update in account_group_assignments first
          const { data: assignment, error: assignmentError } = await supabase
            .from('account_group_assignments')
            .select('id, matched_documents')
            .eq('account_number', match.account_number);

          if (assignment && assignment.length > 0) {
            const existingDocs = assignment[0].matched_documents || [];
            if (!existingDocs.includes(result.document_id)) {
              const updatedDocs = [...existingDocs, result.document_id];
              
              const { error: updateError } = await supabase
                .from('account_group_assignments')
                .update({
                  matched_documents: updatedDocs,
                  match_status: 'matched',
                  confidence_score: match.confidence
                })
                .eq('id', assignment[0].id);

              if (!updateError) {
                updatedAssignments++;
                console.log(`Auto-assigned document to account ${match.account_number} in groups`);
              }
            }
          } else {
            // Try temp_account_matches
            const { data: tempMatch, error: tempError } = await supabase
              .from('temp_account_matches')
              .select('id, matched_documents')
              .eq('account_number', match.account_number);

            if (tempMatch && tempMatch.length > 0) {
              const existingDocs = tempMatch[0].matched_documents || [];
              if (!existingDocs.includes(result.document_id)) {
                const updatedDocs = [...existingDocs, result.document_id];
                
                const { error: updateError } = await supabase
                  .from('temp_account_matches')
                  .update({
                    matched_documents: updatedDocs,
                    match_status: 'matched',
                    confidence_score: match.confidence
                  })
                  .eq('id', tempMatch[0].id);

                if (!updateError) {
                  updatedAssignments++;
                  console.log(`Auto-assigned document to account ${match.account_number} in temp matches`);
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error updating assignment for account ${match.account_number}:`, error);
        }
      }
    }

    const summary = {
      success: true,
      total_documents: documents.length,
      processed_documents: processedCount,
      total_matches: analysisResults.reduce((sum, r) => sum + r.matched_accounts.length, 0),
      auto_assigned: updatedAssignments,
      high_confidence_matches: analysisResults.reduce((sum, r) => 
        sum + r.matched_accounts.filter(m => m.confidence >= 0.9).length, 0
      )
    };

    console.log('Document analysis completed:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-documents function:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});