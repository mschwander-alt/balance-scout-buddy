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

// 1) Verbesserte PDF-Text Extraktion mit Zeilen-Gruppierung
async function extractPdfLines(bytes: Uint8Array) {
  const doc = await getDocumentProxy(bytes);
  const pages: string[][] = [];
  let hasText = false;

  const clean = (s: string) =>
    s
      .replace(/\u00A0|\u202F|\u2007/g, " ")   // NBSP/NNBSP -> Space
      .replace(/[−–—]/g, "-")                 // verschiedene Minus
      .replace(/·|•/g, ".")                   // OCR-Punkte
      .replace(/\s+/g, " ")
      .trim();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc: any = await page.getTextContent();
    if (tc.items?.length) hasText = true;

    // items nach y gruppieren (Toleranz in PDF-User-Units)
    const rows = new Map<number, { y: number; items: { x: number; str: string }[] }>();
    const tol = 2; // Toleranz in PDF-Einheiten
    for (const it of tc.items as any[]) {
      const x = it.transform[4], y = it.transform[5];
      // nächstliegende Zeile finden
      let key: number | null = null;
      for (const k of rows.keys()) if (Math.abs(k - y) < tol) { key = k; break; }
      const k = key ?? y;
      if (!rows.has(k)) rows.set(k, { y: k, items: [] });
      rows.get(k)!.items.push({ x, str: clean(it.str) });
    }

    // sortiere Zeilen nach y (oben->unten) und Items nach x
    const lines = Array.from(rows.values())
      .sort((a, b) => b.y - a.y)
      .map(r => r.items.sort((a, b) => a.x - b.x).map(i => i.str).join(" ").trim())
      .filter(Boolean);

    pages.push(lines);
  }
  return { hasText, pages }; // pages: string[][page][line]
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

// 3) Robuste Schweizer/Deutsche Zahlen-Erkennung
const NUM_RE = /(?:\(|−|-)?\s*(?:CHF|SFr\.?|Fr\.?\s*)?((?:\d{1,3}(?:[.'\s]\d{3})*|\d+)(?:[.,]\d{2}|[.–-])?)(?:\s*\))?/g;

function parseNumberCH(raw: string): number | null {
  const neg = /^\s*[\(-]|−-/.test(raw) || /-\s*$/.test(raw);
  let s = raw.replace(/\s+/g, "").replace(/^CHF|^SFr\.?|^Fr\.?/i, "").replace(/'/g, "");
  s = s.replace(/([.,])(\d{2})$/, (_m, sep, c) => "." + c) // Dezimal
       .replace(/[.–-]$/, ".00");                         // 100.– / 100.- -> 100.00
  // Punkte als Tausender
  s = s.replace(/(\d)[.](?=\d{3}\b)/g, "$1");
  const v = Number(s);
  return isFinite(v) ? (neg ? -v : v) : null;
}

// 4) Kontext-sensitives Suchen nach Saldo-Werten (zeilen-basiert)
function findSaldoValuesFromLines(pageLines: string[][], year: number): Hit[] {
  const hits: Hit[] = [];
  const KEY = new RegExp(`\\b(Saldo(?:bilanz)?|Saldo\\s*Vor(?:trag)?|Saldo\\s*Buchungsjahr|Saldo\\s*${year}|Bilanz|Balance|Total|Summe)\\b`, "i");

  pageLines.forEach((lines, pIdx) => {
    lines.forEach((line, i) => {
      const srcs = [line];
      if (KEY.test(line) && lines[i + 1]) srcs.push(lines[i + 1]); // nächste Zeile als Fallback
      for (const src of srcs) {
        let last: Hit | null = null;
        for (const m of src.matchAll(NUM_RE)) {
          const n = parseNumberCH(m[0]);
          if (n != null) last = { page: pIdx + 1, line: src, value: n, raw: m[0] };
        }
        if (last) hits.push(last);
      }
    });
  });
  return hits;
}

// 5) Verbessertes Scoring mit Kontext-Bonus
function scoreMatch(hit: Hit, exp: number, konto?: string) {
  const tol = Math.max(0.05, 0.002 * Math.abs(exp)); // dynamische Toleranz (0.2%)
  const diff = Math.abs(hit.value - Math.abs(exp));
  let conf = Math.max(0, 1 - diff / (Math.abs(exp) + 1));
  
  // Bonus wenn Kontonummer in derselben Zeile vorkommt
  if (konto && new RegExp(`\\b${konto}\\b`).test(hit.line)) {
    conf += 0.15;
  }
  
  return { diff, conf: Math.min(1, conf), ok: diff <= tol };
}

// 6) Verbessertes Matching mit dynamischem Scoring
function matchSaldos(hits: Hit[], expected: ExpectedSaldo[]): MatchResult[] {
  return expected.map(exp => {
    let best: { h: Hit; diff: number; conf: number } | null = null;
    
    for (const hit of hits) {
      const score = scoreMatch(hit, exp.wert, exp.konto);
      if (!best || score.diff < best.diff) {
        best = { h: hit, diff: score.diff, conf: score.conf };
      }
    }
    
    return {
      konto: exp.konto,
      expected: exp.wert,
      hit: best?.h ?? null,
      diff: best?.diff ?? null,
      confidence: best?.conf ?? 0
    };
  });
}

// 7) Verbesserte Text-Extraktion mit Fallback auf OCR
async function getTextSmart(bytes: Uint8Array) {
  // 1) Versuche digitale PDF-Extraktion
  try {
    const { pages: pageLines, hasText } = await extractPdfLines(bytes);
    if (hasText) {
      console.log('PDF extraction successful with line-based method');
      return { pageLines, method: "pdfjs" };
    }
  } catch (e) { 
    console.log("pdfjs extract failed", e); 
  }

  // 2) Fallback auf OCR
  console.log('PDF has no extractable text, trying OCR...');
  const ocrText = await ocrPdf(bytes);
  const pageLines = ocrText ? [ocrText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)] : [[]];
  return { pageLines, method: "ocr" };
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
        const { pageLines, method } = await getTextSmart(bytes);
        console.log(`Text extraction method for ${doc.file_name}: ${method}`);

        // Find balance values in context using improved line-based search
        const hits = findSaldoValuesFromLines(pageLines, currentYear);
        console.log(`Found ${hits.length} potential balance values in ${doc.file_name}`);

        if (hits.length === 0) continue;

        // Match against expected balances with improved scoring
        const matches = matchSaldos(hits, expectedSaldos);
        const goodMatches = matches.filter(m => m.confidence > 0.75); // Höhere Schwelle für bessere Qualität

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