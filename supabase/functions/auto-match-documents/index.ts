import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://deno.land/x/sheetjs@v0.18.3/xlsx.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

serve(async (req) => {
  console.log(`Received ${req.method} request`)
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request')
    return new Response(null, { 
      status: 200,
      headers: corsHeaders 
    })
  }

  try {
    console.log('Processing POST request')
    
    const requestData = await req.json()
    console.log('Request data received:', {
      trial_balance_id: requestData.trial_balance_id,
      assignments_count: requestData.assignments?.length || 0,
      documents_count: requestData.documents?.length || 0
    })

    const assignments = requestData.assignments || []
    const documents = requestData.documents || []
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const matchedAssignments = []
    
    for (const assignment of assignments) {
      console.log(`Processing account ${assignment.account_number} with balance ${assignment.current_year_balance}`)
      
      const matchedDocuments = []
      let bestConfidence = 0
      let status = 'unmatched'
      
      const targetBalance = Math.abs(assignment.current_year_balance || 0)
      
      // Skip if no balance to match
      if (targetBalance === 0) {
        matchedAssignments.push({
          ...assignment,
          match_status: status,
          confidence_score: 0,
          matched_documents: []
        })
        continue
      }

      for (const doc of documents) {
        try {
          // Try to download and analyze document
          const { data: fileData, error: downloadError } = await supabaseClient.storage
            .from('account-evidence')
            .download(doc.file_path)

          if (!downloadError && fileData) {
            const confidence = await analyzeDocumentForBalance(fileData, targetBalance, assignment.foreign_currency_balance, doc.file_type, doc.file_name)
            
            if (confidence > 0.5) {
              matchedDocuments.push(doc.id)
              bestConfidence = Math.max(bestConfidence, confidence)
              status = 'matched'
              console.log(`Found balance match in ${doc.file_name}: confidence ${confidence}`)
            }
          }
        } catch (error) {
          console.log(`Error analyzing ${doc.file_name}:`, error.message)
        }
      }

      matchedAssignments.push({
        ...assignment,
        match_status: status,
        confidence_score: bestConfidence,
        matched_documents: matchedDocuments
      })
    }

    const matchedCount = matchedAssignments.filter(a => a.match_status === 'matched').length

    console.log(`Matching completed: ${matchedCount}/${assignments.length} matched`)

    const response = {
      matched_assignments: matchedAssignments,
      matched_count: matchedCount,
      total_count: assignments.length
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: corsHeaders
    })

  } catch (error) {
    console.error('Error in auto-match:', error)
    
    return new Response(JSON.stringify({ 
      error: 'Auto-match failed',
      message: error.message 
    }), {
      status: 500,
      headers: corsHeaders
    })
  }
})

async function analyzeDocumentForBalance(fileData: Blob, targetBalance: number, foreignBalance?: number, fileType?: string, fileName?: string): Promise<number> {
  try {
    console.log(`Analyzing ${fileName} (${fileType}) for balance ${targetBalance}`)
    
    let text = ''
    
    // Handle different file types
    if (fileType?.includes('sheet') || fileType?.includes('excel') || fileName?.toLowerCase().endsWith('.xlsx') || fileName?.toLowerCase().endsWith('.xls')) {
      console.log('Processing as Excel file')
      text = await extractTextFromExcel(fileData)
    } else {
      console.log('Processing as text/PDF file')
      text = await extractTextFromGeneral(fileData)
    }
    
    // Look for the target balance in various Swiss/German formats
    const balanceFormats = [
      targetBalance.toFixed(2),                              // 233.50
      targetBalance.toFixed(2).replace('.', ','),            // 233,50
      targetBalance.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'"), // 1'233.50
      targetBalance.toString(),                              // 233.5
      Math.round(targetBalance).toString()                   // 234
    ]
    
    // Also check foreign currency balance if available
    if (foreignBalance) {
      const foreignAbs = Math.abs(foreignBalance)
      balanceFormats.push(
        foreignAbs.toFixed(2),
        foreignAbs.toFixed(2).replace('.', ','),
        foreignAbs.toString()
      )
    }
    
    console.log(`Looking for balance formats: ${balanceFormats.join(', ')} in text`)
    
    for (const format of balanceFormats) {
      if (text.includes(format)) {
        console.log(`Found exact balance match: ${format}`)
        return 0.9 // High confidence for exact match
      }
    }
    
    // Look for close matches (within 5%)
    const tolerance = targetBalance * 0.05
    const numberRegex = /\d{1,10}(?:[.,]\d{1,2})?/g
    const matches = text.match(numberRegex) || []
    
    for (const match of matches) {
      const cleanNumber = parseFloat(match.replace(',', '.'))
      if (!isNaN(cleanNumber) && Math.abs(cleanNumber - targetBalance) <= tolerance) {
        console.log(`Found close balance match: ${cleanNumber} (target: ${targetBalance})`)
        return 0.7 // Good confidence for close match
      }
    }
    
    return 0 // No match found
    
  } catch (error) {
    console.error('Error analyzing document for balance:', error)
    return 0
  }
}

async function extractTextFromExcel(fileData: Blob): Promise<string> {
  try {
    const buffer = await fileData.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    
    let allText = ''
    
    // Process each worksheet
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName]
      
      // Convert to JSON to get all cell values
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1, 
        defval: '',
        raw: false // This ensures numbers are formatted as strings
      })
      
      // Convert all cells to text
      for (const row of jsonData as any[][]) {
        for (const cell of row) {
          if (cell !== null && cell !== undefined && cell !== '') {
            allText += cell.toString() + ' '
          }
        }
        allText += '\n'
      }
    }
    
    console.log(`Extracted ${allText.length} characters from Excel file`)
    return allText
    
  } catch (error) {
    console.error('Error extracting Excel text:', error)
    return ''
  }
}

async function extractTextFromGeneral(fileData: Blob): Promise<string> {
  try {
    const buffer = await fileData.arrayBuffer()
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let text = decoder.decode(buffer)
    
    // Extract readable text
    text = text.replace(/[^\x20-\x7E\s\u00C0-\u017F]/g, ' ')
               .replace(/\s+/g, ' ')
               .trim()
    
    console.log(`Extracted ${text.length} characters from general file`)
    return text
    
  } catch (error) {
    console.error('Error extracting general text:', error)
    return ''
  }