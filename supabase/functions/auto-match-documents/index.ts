import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    // Simple matching logic - just check filenames for account numbers
    const matchedAssignments = assignments.map(assignment => {
      console.log(`Processing account ${assignment.account_number}`)
      
      const matchedDocuments = []
      let confidence = 0
      let status = 'unmatched'

      // Simple filename matching
      for (const doc of documents) {
        const fileName = doc.file_name?.toLowerCase() || ''
        const accountNumber = assignment.account_number?.toString() || ''
        
        if (fileName.includes(accountNumber.toLowerCase())) {
          matchedDocuments.push(doc.id)
          confidence = 0.8
          status = 'matched'
          console.log(`Found match: ${doc.file_name} contains ${accountNumber}`)
          break
        }
      }

      return {
        ...assignment,
        match_status: status,
        confidence_score: confidence,
        matched_documents: matchedDocuments
      }
    })

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