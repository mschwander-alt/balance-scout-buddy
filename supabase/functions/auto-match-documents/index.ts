import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

interface Assignment {
  id: string
  account_number: string
  account_name: string
  current_year_balance: number
  previous_year_balance: number
  foreign_currency_balance?: number
  account_group_id: string
  account_group_name: string
}

interface DocumentInfo {
  id: string
  file_name: string
  file_path: string
  file_type: string
  description?: string
}

serve(async (req) => {
  console.log('Auto-match function called')
  
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight')
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log('Creating Supabase client')
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    console.log('Parsing request body')
    const requestData = await req.json()
    const trialBalanceId = requestData.trial_balance_id
    const assignments = requestData.assignments || []
    const documents = requestData.documents || []

    console.log(`Starting auto-match for trial balance: ${trialBalanceId}`)
    console.log(`Processing ${assignments.length} assignments and ${documents.length} documents`)

    const matchedAssignments = []
    let matchedCount = 0

    for (const assignment of assignments) {
      console.log(`Processing assignment: ${assignment.account_number} - ${assignment.account_name}`)
      
      const matchedDocuments = []
      let bestConfidence = 0
      let matchStatus = 'unmatched'

      for (const doc of documents) {
        try {
          const confidence = await analyzeDocument(supabaseClient, doc, assignment)
          
          if (confidence > 0.7) {
            matchedDocuments.push(doc.id)
            bestConfidence = Math.max(bestConfidence, confidence)
            matchStatus = 'matched'
            console.log(`High confidence match for ${assignment.account_number} in ${doc.file_name} (${confidence})`)
          } else if (confidence > 0.4) {
            matchedDocuments.push(doc.id)
            bestConfidence = Math.max(bestConfidence, confidence)
            matchStatus = 'matched'
            console.log(`Medium confidence match for ${assignment.account_number} in ${doc.file_name} (${confidence})`)
          }
        } catch (error) {
          console.error(`Error analyzing document ${doc.file_name}:`, error)
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
        status: 200
      }
    )

  } catch (error) {
    console.error('Error in auto-match-documents:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

async function analyzeDocument(supabaseClient: any, document: DocumentInfo, assignment: Assignment): Promise<number> {
  try {
    console.log(`Analyzing document: ${document.file_name} for account: ${assignment.account_number}`)

    let extractedText = document.file_name + ' ' + (document.description || '')
    
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
    
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let rawText = decoder.decode(uint8Array)
    
    let readableText = ''
    for (let i = 0; i < rawText.length; i++) {
      const char = rawText[i]
      const charCode = char.charCodeAt(0)
      
      if ((charCode >= 32 && charCode <= 126) || charCode === 10 || charCode === 13) {
        readableText += char
      } else if (charCode >= 192 && charCode <= 255) {
        readableText += char
      } else {
        readableText += ' '
      }
    }
    
    readableText = readableText.replace(/\s+/g, ' ').trim()
    
    console.log(`Extracted ${readableText.length} characters from ${fileType}`)
    return readableText.substring(0, 10000)
  } catch (error) {
    console.error('Error extracting text from file:', error)
    return ''
  }
}

function analyzeTextForMatches(inputText: string, assignment: Assignment): number {
  let confidence = 0
  
  const lowerText = inputText.toLowerCase()
  
  const accountNumber = assignment.account_number.toString()
  if (lowerText.includes(accountNumber.toLowerCase())) {
    confidence += 0.4
    console.log(`Found exact account number ${accountNumber} in text`)
  }

  const accountNameWords = assignment.account_name.toLowerCase().split(' ')
  const foundWords = accountNameWords.filter(word => 
    word.length > 3 && lowerText.includes(word)
  )
  
  if (foundWords.length > 0) {
    const nameMatchScore = (foundWords.length / accountNameWords.length) * 0.3
    confidence += nameMatchScore
    console.log(`Found ${foundWords.length}/${accountNameWords.length} account name words: ${foundWords.join(', ')}`)
  }

  const currentBalance = Math.abs(assignment.current_year_balance)
  const foreignBalance = assignment.foreign_currency_balance ? Math.abs(assignment.foreign_currency_balance) : null

  const balanceStr = currentBalance.toFixed(2)
  const balanceStrComma = balanceStr.replace('.', ',')
  const balanceStrApostrophe = balanceStr.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  
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
  
  if (foreignBalance) {
    const foreignBalanceStr = foreignBalance.toFixed(2)
    const foreignBalanceStrComma = foreignBalanceStr.replace('.', ',')
    
    if (lowerText.includes(foreignBalanceStr) || lowerText.includes(foreignBalanceStrComma)) {
      confidence += 0.6
      console.log(`Found foreign currency balance match: ${foreignBalanceStr}`)
    }
  }

  console.log(`Final confidence score for ${assignment.account_number}: ${confidence.toFixed(3)}`)
  return Math.min(confidence, 1.0)
}