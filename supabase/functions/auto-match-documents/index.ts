import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Assignment {
  id: string;
  account_number: string;
  account_name: string;
  current_year_balance: number;
  previous_year_balance: number;
  foreign_currency_balance?: number;
  account_group_id: string;
  account_group_name: string;
}

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  description?: string;
}

serve(async (req) => {
  console.log('Auto-match function called')
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight')
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Creating Supabase client')
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    console.log('Parsing request body')
    const { trial_balance_id, assignments, documents } = await req.json()

    console.log(`Starting auto-match for trial balance: ${trial_balance_id}`)
    console.log(`Processing ${assignments.length} assignments and ${documents.length} documents`)

    const matchedAssignments = []
    let matchedCount = 0

    // Process each assignment
    for (const assignment of assignments) {
      console.log(`Processing assignment: ${assignment.account_number} - ${assignment.account_name}`)
      
      const matchedDocuments = []
      let bestConfidence = 0
      let matchStatus = 'unmatched'

      // Look for documents that might contain this account's balance
      for (const document of documents) {
        try {
          const confidence = await analyzeDocument(supabaseClient, document, assignment)
          
          if (confidence > 0.7) { // High confidence threshold
            matchedDocuments.push(document.id)
            bestConfidence = Math.max(bestConfidence, confidence)
            matchStatus = 'matched'
            console.log(`Found high confidence match for ${assignment.account_number} in ${document.file_name} (${confidence})`)
          } else if (confidence > 0.4) { // Medium confidence
            matchedDocuments.push(document.id)
            bestConfidence = Math.max(bestConfidence, confidence)
            matchStatus = 'matched'
            console.log(`Found medium confidence match for ${assignment.account_number} in ${document.file_name} (${confidence})`)
          }
        } catch (error) {
          console.error(`Error analyzing document ${document.file_name}:`, error)
        }
      }

      if (matchStatus === 'matched') {
        matchedCount++
      }

      matchedAssignments.push({
        ...assignment,
        match_status: matchStatus,
        confidence_score: bestConfidence,
        matched_documents: matchedDocuments
      })
    }

    console.log(`Auto-match completed: ${matchedCount}/${assignments.length} accounts matched`)

    return new Response(
      JSON.stringify({
        matched_assignments: matchedAssignments,
        matched_count: matchedCount,
        total_count: assignments.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in auto-match-documents:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})

async function analyzeDocument(supabaseClient: any, document: Document, assignment: Assignment): Promise<number> {
  try {
    console.log(`Analyzing document: ${document.file_name} for account: ${assignment.account_number}`)

    // For now, let's do a basic filename analysis to avoid storage issues
    let extractedText = document.file_name + ' ' + (document.description || '')
    
    // Try to download and analyze the document content
    try {
      const { data: fileData, error: downloadError } = await supabaseClient.storage
        .from('account-evidence')
        .download(document.file_path)

      if (!downloadError && fileData) {
        const additionalText = await extractTextFromFile(fileData, document.file_type)
        extractedText += ' ' + additionalText
      } else {
        console.log(`Could not download file ${document.file_name}, using filename only`)
      }
    } catch (error) {
      console.log(`Error downloading ${document.file_name}, using filename only:`, error)
    }

    // Analyze the extracted text for matches
    return analyzeTextForMatches(extractedText, assignment)

  } catch (error) {
    console.error(`Error analyzing document ${document.file_name}:`, error)
    return 0
  }
}

async function extractTextFromFile(fileData: Blob, fileType: string): Promise<string> {
  try {
    if (!fileData || fileData.size === 0) {
      return ''
    }

    const buffer = await fileData.arrayBuffer()
    const uint8Array = new Uint8Array(buffer)
    
    // Simple text extraction - look for readable ASCII characters
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let text = decoder.decode(uint8Array)
    
    // Extract readable text patterns
    let readableText = ''
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      const charCode = char.charCodeAt(0)
      
      // Keep readable ASCII characters, numbers, and common symbols
      if ((charCode >= 32 && charCode <= 126) || charCode === 10 || charCode === 13) {
        readableText += char
      } else if (charCode >= 192 && charCode <= 255) {
        // Keep extended ASCII for European characters
        readableText += char
      } else {
        readableText += ' '
      }
    }
    
    // Clean up whitespace
    readableText = readableText.replace(/\s+/g, ' ').trim()
    
    console.log(`Extracted ${readableText.length} characters from ${fileType}`)
    return readableText.substring(0, 10000) // Limit to prevent memory issues
  } catch (error) {
    console.error('Error extracting text from file:', error)
    return ''
  }
}

function analyzeTextForMatches(text: string, assignment: Assignment): number {
  let confidence = 0
  
  // Convert text to lowercase for case-insensitive matching
  const lowerText = text.toLowerCase()
  
  // Look for account number (exact match)
  const accountNumber = assignment.account_number.toString()
  if (lowerText.includes(accountNumber.toLowerCase())) {
    confidence += 0.4
    console.log(`Found exact account number ${accountNumber} in text`)
  }

  // Look for account name (partial matches)
  const accountNameWords = assignment.account_name.toLowerCase().split(' ')
  const foundWords = accountNameWords.filter(word => 
    word.length > 3 && lowerText.includes(word)
  )
  
  if (foundWords.length > 0) {
    const nameMatchScore = (foundWords.length / accountNameWords.length) * 0.3
    confidence += nameMatchScore
    console.log(`Found ${foundWords.length}/${accountNameWords.length} account name words: ${foundWords.join(', ')}`)
  }

  // Look for balance amounts with various formatting
  const currentBalance = Math.abs(assignment.current_year_balance)
  const foreignBalance = assignment.foreign_currency_balance ? Math.abs(assignment.foreign_currency_balance) : null

  // Enhanced number patterns for Swiss/German formatting
  const balanceStr = currentBalance.toFixed(2)
  const balanceStrComma = balanceStr.replace('.', ',')
  const balanceStrApostrophe = balanceStr.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  
  // Check for various balance formats
  const balanceFormats = [
    balanceStr,
    balanceStrComma,
    balanceStrApostrophe,
    currentBalance.toString(),
    Math.round(currentBalance).toString()
  ]
  
  for (const format of balanceFormats) {
    if (lowerText.includes(format)) {
      confidence += 0.6
      console.log(`Found balance match: ${format} in text`)
      break
    }
  }
  
  // Check foreign currency balance if available
  if (foreignBalance) {
    const foreignBalanceStr = foreignBalance.toFixed(2)
    const foreignBalanceStrComma = foreignBalanceStr.replace('.', ',')
    
    if (lowerText.includes(foreignBalanceStr) || lowerText.includes(foreignBalanceStrComma)) {
      confidence += 0.6
      console.log(`Found foreign currency balance match: ${foreignBalanceStr}`)
    }
  }

  console.log(`Final confidence score for ${assignment.account_number}: ${confidence.toFixed(3)}`)
  return Math.min(confidence, 1.0) // Cap at 1.0
}
