import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0';
import { extractText, getDocumentProxy } from "npm:unpdf";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Types
interface Hit {
  page: number;
  line: string;
  value: number;
  raw: string;
}

interface ExpectedSaldo {
  konto: string;
  wert: number;
  accountId?: string;
}

interface MatchResult {
  konto: string;
  expected: number;
  hit: Hit | null;
  diff: number | null;
  confidence: number;
}

// 1) Robuste PDF-Text Extraktion mit mehreren Fallback-Strategien
async function extractPdfText(bytes: Uint8Array) {
  // Strategie 1: unpdf Library (wenn verfügbar)
  try {
    const doc = await getDocumentProxy(bytes);
    if (doc && typeof doc.getPage === 'function') {
      const { text, pages } = await extractText(doc, { mergePages: false });
      if (pages && Array.isArray(pages)) {
        const pageTexts = pages.map(p => p?.text || '');
        const full = pageTexts.join("\n\n");
        const hasText = /\p{L}|\p{N}/u.test(full);
        
        if (hasText && full.length > 20) {
          console.log('PDF extraction successful with unpdf');
          return { text: full, pages: pageTexts, hasText: true };
        }
      }
    }
  } catch (error) {
    console.log('unpdf extraction failed, trying fallback:', error.message);
  }

  // Strategie 2: Einfache Text-Suche in PDF-Bytes
  try {
    const textDecoder = new TextDecoder('utf-8', { fatal: false });
    const rawText = textDecoder.decode(bytes);
    
    // Extrahiere Text zwischen PDF-Streams
    const textMatches = rawText.match(/BT\s*(.*?)\s*ET/gs) || [];
    const extractedTexts = textMatches
      .map(match => {
        // Entferne PDF-Kommandos und extrahiere nur Text
        return match
          .replace(/BT|ET/g, '')
          .replace(/\/\w+\s+\d+(?:\.\d+)?\s+Tf/g, '') // Font commands
          .replace(/\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+Td/g, '') // Position commands
          .replace(/\(\s*(.*?)\s*\)\s*Tj/g, '$1') // Text drawing commands
          .replace(/\[\s*(.*?)\s*\]\s*TJ/g, '$1') // Array text commands
          .trim();
      })
      .filter(text => text.length > 0);

    if (extractedTexts.length > 0) {
      const fullText = extractedTexts.join('\n');
      const hasText = /\p{L}|\p{N}/u.test(fullText);
      
      if (hasText) {
        console.log('PDF extraction successful with fallback method');
        return { text: fullText, pages: extractedTexts, hasText: true };
      }
    }
  } catch (error) {
    console.log('Fallback extraction failed:', error.message);
  }

  // Strategie 3: Rohe Byte-Suche nach lesbarem Text
  try {
    const textDecoder = new TextDecoder('utf-8', { fatal: false });
    const rawText = textDecoder.decode(bytes);
    
    // Suche nach lesbaren Text-Segmenten
    const readableText = rawText
      .replace(/[^\x20-\x7E\s]/g, ' ') // Nur druckbare ASCII-Zeichen
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter(word => word.length > 2 && /[a-zA-Z]/.test(word))
      .join(' ');

    if (readableText.length > 50) {
      console.log('PDF extraction with raw byte parsing');
      return { text: readableText, pages: [readableText], hasText: true };
    }
  } catch (error) {
    console.log('Raw byte extraction failed:', error.message);
  }

  console.log('All PDF extraction methods failed');
  return { text: '', pages: [''], hasText: false };
}

// 2) OCR fallback using Google Vision API
async function ocrPdf(bytes: Uint8Array): Promise<string> {
  const apiKey = Deno.env.get("GCP_VISION_KEY");
  if (!apiKey) {
    console.warn('No OCR API key found, skipping OCR');
    return '';
  }

  try {
    const base64 = btoa(String.fromCharCode(...bytes));
    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: [{ 
            image: { content: base64 }, 
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }] 
          }],
        }),
      }
    );
    
    const json = await res.json();
    const text = json?.responses?.[0]?.fullTextAnnotation?.text ?? "";
    return text;
  } catch (error) {
    console.error('OCR failed:', error);
    return '';
  }
}

// 3) Swiss/German number parser
const NUM_RE = /(?:\(|-)?\s*(?:CHF\s*)?((?:\d{1,3}(?:[.'\s]\d{3})*|\d+)(?:[.,]\d{2})?)(?:\s*\))?/g;

function parseNumberCH(raw: string): number | null {
  const s = raw
    .replace(/\s+/g, "")
    .replace(/^CHF/i, "")
    .replace(/'/g, "")
    .replace(/(\d)[.](?=\d{3}\b)/g, "$1") // 1.234.567 -> 1234567 (thousand separators)
    .replace(/,(\d{2})$/, ".$1"); // ,cc -> .cc
  
  const neg = /^\(|-/.test(raw);
  const v = Number(s);
  if (!isFinite(v)) return null;
  return neg ? -v : v;
}

// 4) Context-based search for balance values
function findSaldoValues(textByPage: string[], year: number): Hit[] {
  const hits: Hit[] = [];
  const KEY_RE = new RegExp(
    `\\b(Saldo(?:bilanz)?|Saldo\\s*Vor(?:trag)?|Saldo\\s*Buchungsjahr|Saldo\\s*${year}|Bilanz|Balance|Total|Summe)\\b`,
    "i"
  );

  textByPage.forEach((pageText, idx) => {
    const lines = pageText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!KEY_RE.test(line)) continue;

      // Take the last number in the line (typical: ... Soll Haben Saldo)
      let last: Hit | null = null;
      for (const m of line.matchAll(NUM_RE)) {
        const raw = m[0];
        const n = parseNumberCH(raw);
        if (n != null) last = { page: idx + 1, line, value: n, raw };
      }
      if (last) hits.push(last);

      // If line only has header, search in next line
      if (KEY_RE.test(line) && !NUM_RE.test(line) && lines[i + 1]) {
        for (const m of lines[i + 1].matchAll(NUM_RE)) {
          const n = parseNumberCH(m[0]);
          if (n != null) {
            hits.push({ 
              page: idx + 1, 
              line: lines[i + 1], 
              value: n, 
              raw: m[0] 
            });
          }
        }
      }
    }
  });

  return hits;
}

// 5) Unified text extraction with OCR fallback
async function getTextSmart(bytes: Uint8Array) {
  const { text, pages, hasText } = await extractPdfText(bytes);
  if (hasText && text.length > 50) {
    return { text, pages, method: 'pdf-extract' };
  }
  
  console.log('PDF has no extractable text, trying OCR...');
  const ocr = await ocrPdf(bytes);
  return { text: ocr, pages: [ocr], method: 'ocr' };
}

// 6) Match balances against expected values
function matchSaldos(
  hits: Hit[],
  expected: ExpectedSaldo[],
  tolerance = 0.05
): MatchResult[] {
  return expected.map(exp => {
    let best: Hit | null = null;
    let bestDiff = Infinity;
    
    for (const hit of hits) {
      const diff = Math.abs(hit.value - Math.abs(exp.wert));
      if (diff < bestDiff) {
        best = hit;
        bestDiff = diff;
      }
    }
    
    const confidence = best ? Math.max(0, 1 - (bestDiff / Math.abs(exp.wert))) : 0;
    
    return {
      konto: exp.konto,
      expected: exp.wert,
      hit: best,
      diff: best ? bestDiff : null,
      confidence: confidence
    };
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { trial_balance_id } = await req.json();
    
    if (!trial_balance_id) {
      throw new Error('trial_balance_id is required');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Starting enhanced PDF matching for trial balance: ${trial_balance_id}`);

    // Get accounts to match
    let expectedSaldos: ExpectedSaldo[] = [];
    
    // Check if we have grouped accounts
    const { data: accountGroups } = await supabase
      .from('account_groups')
      .select('id')
      .eq('trial_balance_id', trial_balance_id)
      .limit(1);

    if (accountGroups && accountGroups.length > 0) {
      // Get grouped accounts
      const { data: assignments } = await supabase
        .from('account_group_assignments')
        .select(`
          id,
          account_number,
          account_name,
          current_year_balance,
          account_groups!inner(trial_balance_id)
        `)
        .eq('account_groups.trial_balance_id', trial_balance_id)
        .neq('current_year_balance', 0);

      expectedSaldos = (assignments || []).map(a => ({
        konto: a.account_number,
        wert: a.current_year_balance,
        accountId: a.id
      }));
    } else {
      // Get ungrouped accounts
      const { data: tempMatches } = await supabase
        .from('temp_account_matches')
        .select('id, account_number, account_name, current_year_balance')
        .eq('trial_balance_id', trial_balance_id)
        .neq('current_year_balance', 0);

      expectedSaldos = (tempMatches || []).map(a => ({
        konto: a.account_number,
        wert: a.current_year_balance,
        accountId: a.id
      }));
    }

    // Get PDF documents
    const { data: documents } = await supabase
      .from('account_evidence')
      .select('id, file_name, file_path, file_type')
      .eq('trial_balance_id', trial_balance_id)
      .or('file_type.ilike.%pdf%,file_path.ilike.%.pdf');

    if (!documents || documents.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No PDF documents found',
        matches: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const currentYear = new Date().getFullYear();
    let totalMatches = 0;
    const allMatches: any[] = [];

    // Process each PDF document
    for (const doc of documents) {
      try {
        console.log(`Processing document: ${doc.file_name}`);

        // Download document
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('account-evidence')
          .download(doc.file_path);

        if (downloadError || !fileData) {
          console.error(`Failed to download ${doc.file_name}:`, downloadError);
          continue;
        }

        const bytes = new Uint8Array(await fileData.arrayBuffer());

        // Extract text using improved method
        const { pages, method } = await getTextSmart(bytes);
        console.log(`Text extraction method for ${doc.file_name}: ${method}`);

        // Find balance values in context
        const hits = findSaldoValues(pages, currentYear);
        console.log(`Found ${hits.length} potential balance values in ${doc.file_name}`);

        if (hits.length === 0) continue;

        // Match against expected balances
        const matches = matchSaldos(hits, expectedSaldos, 0.05);
        const goodMatches = matches.filter(m => m.confidence > 0.7);

        console.log(`Found ${goodMatches.length} high-confidence matches in ${doc.file_name}`);

        // Update database with matches
        for (const match of goodMatches) {
          if (!match.hit || !match.hit.value) continue;

          const expectedSaldo = expectedSaldos.find(e => e.konto === match.konto);
          if (!expectedSaldo?.accountId) continue;

          if (accountGroups && accountGroups.length > 0) {
            // Update grouped accounts
            await supabase
              .from('account_group_assignments')
              .update({
                match_status: 'matched',
                confidence_score: match.confidence,
                matched_documents: [doc.id]
              })
              .eq('id', expectedSaldo.accountId);
          } else {
            // Update ungrouped accounts
            await supabase
              .from('temp_account_matches')
              .update({
                match_status: 'matched',
                confidence_score: match.confidence,
                matched_documents: [doc.id]
              })
              .eq('id', expectedSaldo.accountId);
          }

          totalMatches++;
        }

        allMatches.push({
          document: doc.file_name,
          method,
          hits: hits.length,
          matches: goodMatches.length,
          details: goodMatches
        });

      } catch (error) {
        console.error(`Error processing ${doc.file_name}:`, error);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_documents: documents.length,
      total_matches: totalMatches,
      expected_accounts: expectedSaldos.length,
      details: allMatches
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Enhanced PDF matching error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});