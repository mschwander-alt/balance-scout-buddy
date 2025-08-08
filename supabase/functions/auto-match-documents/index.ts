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
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

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
        status: 400,
      },
    )
  }
})

async function analyzeDocument(supabaseClient: any, document: Document, assignment: Assignment): Promise<number> {
  try {
    console.log(`Analyzing document: ${document.file_name} for account: ${assignment.account_number}`)

    // Download the document from storage
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from('account-evidence')
      .download(document.file_path)

    if (downloadError) {
      console.error(`Error downloading file ${document.file_name}:`, downloadError)
      return 0
    }

    let extractedText = ''
    
    // Extract text based on file type
    if (document.file_type.includes('pdf')) {
      extractedText = await extractTextFromPDF(fileData)
    } else if (document.file_type.includes('excel') || document.file_type.includes('sheet')) {
      extractedText = await extractTextFromExcel(fileData)
    } else if (document.file_type.includes('word') || document.file_type.includes('document')) {
      extractedText = await extractTextFromWord(fileData)
    } else {
      console.log(`Unsupported file type: ${document.file_type}`)
      return 0
    }

    // Analyze the extracted text for matches
    return analyzeTextForMatches(extractedText, assignment)

  } catch (error) {
    console.error(`Error analyzing document ${document.file_name}:`, error)
    return 0
  }
}

async function extractTextFromPDF(fileData: Blob): Promise<string> {
  try {
    // For now, return placeholder text since PDF parsing requires additional libraries
    // In a production environment, you would use libraries like pdf-parse or similar
    console.log('PDF text extraction - placeholder implementation')
    return 'PDF content placeholder'
  } catch (error) {
    console.error('Error extracting PDF text:', error)
    return ''
  }
}

async function extractTextFromExcel(fileData: Blob): Promise<string> {
  try {
    // Placeholder for Excel parsing
    // In production, use libraries like xlsx or similar
    console.log('Excel text extraction - placeholder implementation')
    return 'Excel content placeholder'
  } catch (error) {
    console.error('Error extracting Excel text:', error)
    return ''
  }
}

async function extractTextFromWord(fileData: Blob): Promise<string> {
  try {
    // Placeholder for Word document parsing
    // In production, use libraries like mammoth or similar
    console.log('Word document text extraction - placeholder implementation')
    return 'Word content placeholder'
  } catch (error) {
    console.error('Error extracting Word text:', error)
    return ''
  }
}

function analyzeTextForMatches(text: string, assignment: Assignment): number {
  let confidence = 0
  
  // Look for account number
  if (text.includes(assignment.account_number)) {
    confidence += 0.3
    console.log(`Found account number ${assignment.account_number} in text`)
  }

  // Look for account name (partial matches)
  const accountNameWords = assignment.account_name.toLowerCase().split(' ')
  const foundWords = accountNameWords.filter(word => 
    word.length > 3 && text.toLowerCase().includes(word)
  )
  
  if (foundWords.length > 0) {
    confidence += (foundWords.length / accountNameWords.length) * 0.3
    console.log(`Found ${foundWords.length}/${accountNameWords.length} account name words`)
  }

  // Look for balance amounts (with some tolerance for formatting)
  const currentBalance = Math.abs(assignment.current_year_balance)
  const foreignBalance = assignment.foreign_currency_balance ? Math.abs(assignment.foreign_currency_balance) : null

  // Extract numbers from text and compare
  const numberPattern = /[\d\.,]+/g
  const numbersInText = text.match(numberPattern) || []
  
  for (const numberStr of numbersInText) {
    const cleanNumber = parseFloat(numberStr.replace(/[,\.]/g, ''))
    
    if (!isNaN(cleanNumber)) {
      // Check for exact match with some tolerance
      if (Math.abs(cleanNumber - currentBalance) < 0.01) {
        confidence += 0.5
        console.log(`Found exact current year balance match: ${cleanNumber}`)
        break
      }
      
      // Check foreign currency balance
      if (foreignBalance && Math.abs(cleanNumber - foreignBalance) < 0.01) {
        confidence += 0.5
        console.log(`Found exact foreign currency balance match: ${cleanNumber}`)
        break
      }
      
      // Check for close matches (within 10%)
      if (Math.abs(cleanNumber - currentBalance) / currentBalance < 0.1) {
        confidence += 0.2
        console.log(`Found close current year balance match: ${cleanNumber} vs ${currentBalance}`)
      }
    }
  }

  console.log(`Final confidence score for ${assignment.account_number}: ${confidence}`)
  return Math.min(confidence, 1.0) // Cap at 1.0
}