import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://deno.land/x/sheetjs@v0.18.3/xlsx.mjs'

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

    // Download the document from storage with proper auth headers
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
    // For now, we'll extract basic text patterns from PDF metadata and visible content
    // This is a simplified approach that works with Deno
    const buffer = await fileData.arrayBuffer()
    const uint8Array = new Uint8Array(buffer)
    
    // Convert to string and look for readable text patterns
    const text = new TextDecoder('utf-8', { fatal: false }).decode(uint8Array)
    
    // Extract readable text using regex patterns for common PDF text structures
    const textPatterns = [
      /\/T\s*\([^)]*\)/g, // Text objects in PDF
      /BT\s+([^ET]+)\s+ET/g, // Text blocks
      /Tj\s*\[([^\]]*)\]/g, // Text arrays
    ]
    
    let extractedText = ''
    for (const pattern of textPatterns) {
      const matches = text.match(pattern)
      if (matches) {
        extractedText += matches.join(' ')
      }
    }
    
    // Also look for plain readable text in the binary data
    const readableText = text.replace(/[^\x20-\x7E\s]/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim()
    
    const finalText = extractedText + ' ' + readableText
    console.log(`Extracted ${finalText.length} characters from PDF`)
    return finalText
  } catch (error) {
    console.error('Error extracting PDF text:', error)
    return ''
  }
}

async function extractTextFromExcel(fileData: Blob): Promise<string> {
  try {
    const buffer = await fileData.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    
    let allText = ''
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
      
      // Convert all cells to text
      for (const row of jsonData as any[][]) {
        allText += row.join(' ') + '\n'
      }
    }
    
    console.log(`Extracted ${allText.length} characters from Excel`)
    return allText
  } catch (error) {
    console.error('Error extracting Excel text:', error)
    return ''
  }
}

async function extractTextFromWord(fileData: Blob): Promise<string> {
  try {
    // Word documents are more complex to parse, for now we'll do basic text extraction
    // In production, you would use libraries like mammoth.js
    const buffer = await fileData.arrayBuffer()
    const text = new TextDecoder().decode(buffer)
    
    // Basic text extraction - look for readable text patterns
    const cleanText = text.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
                          .replace(/\s+/g, ' ')
                          .trim()
    
    console.log(`Extracted ${cleanText.length} characters from Word document`)
    return cleanText
  } catch (error) {
    console.error('Error extracting Word text:', error)
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

  // Enhanced number pattern to catch Swiss/German formatting
  const numberPatterns = [
    /(?:CHF|EUR|USD)?\s*[\-]?\s*([\d]{1,3}(?:['\s,.][\d]{3})*(?:[.,][\d]{2})?)/g,
    /[\-]?\s*([\d]{1,3}(?:['\s,.][\d]{3})*(?:[.,][\d]{2})?)\s*(?:CHF|EUR|USD)?/g,
    /([\d]{1,10}(?:[.,][\d]{2})?)/g  // Simple pattern for basic numbers
  ]

  for (const pattern of numberPatterns) {
    const matches = text.matchAll(pattern)
    
    for (const match of matches) {
      const numberStr = match[1] || match[0]
      // Clean the number string - remove separators but keep decimal
      const cleanNumber = numberStr
        .replace(/['\s]/g, '') // Remove apostrophes and spaces (Swiss thousands separator)
        .replace(/,(\d{3})/g, '$1') // Remove thousands commas
        .replace(/,(\d{1,2})$/, '.$1') // Convert decimal comma to dot
      
      const parsedNumber = parseFloat(cleanNumber)
      
      if (!isNaN(parsedNumber) && parsedNumber > 0) {
        // Check for exact match (within 1 CHF tolerance)
        if (Math.abs(parsedNumber - currentBalance) <= 1) {
          confidence += 0.6
          console.log(`Found EXACT current year balance match: ${parsedNumber} vs ${currentBalance}`)
          break
        }
        
        // Check foreign currency balance
        if (foreignBalance && Math.abs(parsedNumber - foreignBalance) <= 1) {
          confidence += 0.6
          console.log(`Found EXACT foreign currency balance match: ${parsedNumber} vs ${foreignBalance}`)
          break
        }
        
        // Check for close matches (within 5%)
        const tolerance = currentBalance * 0.05
        if (Math.abs(parsedNumber - currentBalance) <= tolerance) {
          confidence += 0.3
          console.log(`Found CLOSE current year balance match: ${parsedNumber} vs ${currentBalance} (tolerance: ${tolerance})`)
        }
      }
    }
  }

  console.log(`Final confidence score for ${assignment.account_number}: ${confidence.toFixed(3)}`)
  return Math.min(confidence, 1.0) // Cap at 1.0
}