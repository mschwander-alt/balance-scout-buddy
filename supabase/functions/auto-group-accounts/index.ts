import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrialBalanceAccount {
  accountNumber: string;
  accountName: string;
  currentYear: number;
  previousYear: number;
  foreignCurrency?: number;
}

interface GroupingSuggestion {
  name: string;
  description: string;
  accounts: TrialBalanceAccount[];
  category: 'aktiven' | 'passiven' | 'erfolgsrechnung';
  subcategory: string;
}

// Schweizer Kontenrahmen nach Obligationenrecht
const ACCOUNT_GROUPS = {
  // AKTIVEN - Umlaufvermögen
  'Flüssige Mittel': {
    patterns: [/^10[0-9]{2}/, /^100[0-9]/, /^101[0-9]/, /^102[0-9]/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Kasse, Post- und Bankguthaben'
  },
  'Forderungen aus Lieferungen und Leistungen': {
    patterns: [/^11[0-9]{2}/, /^110[0-9]/, /^111[0-9]/, /^112[0-9]/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Kundenforderungen'
  },
  'Übrige kurzfristige Forderungen': {
    patterns: [/^13[0-9]{2}/, /^14[0-9]{2}/, /^130[0-9]/, /^140[0-9]/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Diverse Forderungen, Vorschüsse, Verrechnungssteuer'
  },
  'Vorräte': {
    patterns: [/^12[0-9]{2}/, /^120[0-9]/, /^121[0-9]/, /^122[0-9]/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Material, Waren, unfertige und fertige Erzeugnisse'
  },
  'Aktive Rechnungsabgrenzung': {
    patterns: [/^15[0-9]{2}/, /^150[0-9]/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Vorausbezahlte Aufwände'
  },

  // AKTIVEN - Anlagevermögen
  'Finanzanlagen': {
    patterns: [/^16[0-9]{2}/, /^17[0-9]{2}/, /^160[0-9]/, /^170[0-9]/],
    category: 'aktiven' as const,
    subcategory: 'Anlagevermögen',
    description: 'Wertschriften, Beteiligungen, Darlehen'
  },
  'Sachanlagen': {
    patterns: [/^18[0-9]{2}/, /^180[0-9]/, /^181[0-9]/, /^182[0-9]/, /^183[0-9]/, /^184[0-9]/],
    category: 'aktiven' as const,
    subcategory: 'Anlagevermögen',
    description: 'Grundstücke, Gebäude, Maschinen, Mobiliar, Fahrzeuge'
  },
  'Immaterielle Anlagen': {
    patterns: [/^19[0-9]{2}/, /^190[0-9]/, /^191[0-9]/],
    category: 'aktiven' as const,
    subcategory: 'Anlagevermögen',
    description: 'Patente, Lizenzen, Software, Goodwill'
  },

  // PASSIVEN - Fremdkapital kurzfristig
  'Verbindlichkeiten aus Lieferungen und Leistungen': {
    patterns: [/^20[0-9]{2}/, /^200[0-9]/, /^201[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital kurzfristig',
    description: 'Lieferantenverbindlichkeiten'
  },
  'Kurzfristige Finanzverbindlichkeiten': {
    patterns: [/^21[0-9]{2}/, /^210[0-9]/, /^211[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital kurzfristig',
    description: 'Bankverbindlichkeiten, kurzfristige Darlehen'
  },
  'Übrige kurzfristige Verbindlichkeiten': {
    patterns: [/^22[0-9]{2}/, /^23[0-9]{2}/, /^24[0-9]{2}/, /^220[0-9]/, /^230[0-9]/, /^240[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital kurzfristig',
    description: 'Sozialversicherungen, Steuern, diverse Verbindlichkeiten'
  },
  'Passive Rechnungsabgrenzung': {
    patterns: [/^25[0-9]{2}/, /^250[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital kurzfristig',
    description: 'Erhaltene Vorauszahlungen, aufgelaufene Kosten'
  },
  'Rückstellungen': {
    patterns: [/^26[0-9]{2}/, /^260[0-9]/, /^261[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital kurzfristig',
    description: 'Kurzfristige Rückstellungen'
  },

  // PASSIVEN - Fremdkapital langfristig
  'Langfristige Finanzverbindlichkeiten': {
    patterns: [/^27[0-9]{2}/, /^270[0-9]/, /^271[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital langfristig',
    description: 'Hypotheken, langfristige Darlehen'
  },
  'Langfristige Rückstellungen': {
    patterns: [/^28[0-9]{2}/, /^280[0-9]/, /^281[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital langfristig',
    description: 'Langfristige Rückstellungen'
  },

  // PASSIVEN - Eigenkapital
  'Grundkapital': {
    patterns: [/^29[0-9]{2}/, /^290[0-9]/, /^291[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Eigenkapital',
    description: 'Aktienkapital, Stammkapital'
  },
  'Reserven': {
    patterns: [/^292[0-9]/, /^293[0-9]/, /^294[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Eigenkapital',
    description: 'Gesetzliche und freie Reserven'
  },
  'Bilanzgewinn': {
    patterns: [/^295[0-9]/, /^296[0-9]/, /^297[0-9]/],
    category: 'passiven' as const,
    subcategory: 'Eigenkapital',
    description: 'Gewinnvortrag, Jahresgewinn'
  },

  // ERFOLGSRECHNUNG - Ertrag
  'Netto-Erlöse': {
    patterns: [/^30[0-9]{2}/, /^31[0-9]{2}/, /^300[0-9]/, /^310[0-9]/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Ertrag',
    description: 'Warenerlöse, Dienstleistungserlöse'
  },
  'Bestandesänderungen': {
    patterns: [/^32[0-9]{2}/, /^320[0-9]/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Ertrag',
    description: 'Änderungen der Vorräte an unfertigen und fertigen Erzeugnissen'
  },
  'Andere Erträge': {
    patterns: [/^36[0-9]{2}/, /^37[0-9]{2}/, /^38[0-9]{2}/, /^39[0-9]{2}/, /^360[0-9]/, /^370[0-9]/, /^380[0-9]/, /^390[0-9]/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Ertrag',
    description: 'Nebenerlöse, außerordentliche Erträge, Finanzertrag'
  },

  // ERFOLGSRECHNUNG - Aufwand
  'Materialaufwand': {
    patterns: [/^40[0-9]{2}/, /^41[0-9]{2}/, /^400[0-9]/, /^410[0-9]/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Aufwand',
    description: 'Material- und Wareneinkauf, Handelswarenaufwand'
  },
  'Personalaufwand': {
    patterns: [/^50[0-9]{2}/, /^51[0-9]{2}/, /^500[0-9]/, /^510[0-9]/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Aufwand',
    description: 'Löhne, Sozialleistungen, andere Personalkosten'
  },
  'Anderer Betriebsaufwand': {
    patterns: [/^52[0-9]{2}/, /^53[0-9]{2}/, /^54[0-9]{2}/, /^55[0-9]{2}/, /^56[0-9]{2}/, /^57[0-9]{2}/, /^520[0-9]/, /^530[0-9]/, /^540[0-9]/, /^550[0-9]/, /^560[0-9]/, /^570[0-9]/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Aufwand',
    description: 'Raumkosten, Unterhalt, Fahrzeugkosten, Versicherungen, Energie, Verwaltungsaufwand'
  },
  'Abschreibungen': {
    patterns: [/^58[0-9]{2}/, /^580[0-9]/, /^581[0-9]/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Aufwand',
    description: 'Abschreibungen auf Anlagevermögen'
  },
  'Finanzaufwand': {
    patterns: [/^59[0-9]{2}/, /^590[0-9]/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Aufwand',
    description: 'Zinsen, Bankspesen, Kursverluste'
  },
  'Außerordentlicher Aufwand': {
    patterns: [/^65[0-9]{2}/, /^66[0-9]{2}/, /^67[0-9]{2}/, /^68[0-9]{2}/, /^69[0-9]{2}/, /^650[0-9]/, /^660[0-9]/, /^670[0-9]/, /^680[0-9]/, /^690[0-9]/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Aufwand',
    description: 'Außerordentliche, einmalige und periodenfremde Aufwände'
  }
};

function categorizeAccount(accountNumber: string): { groupName: string; config: any } | null {
  // Normalisiere die Kontonummer (entferne Leerzeichen, führende Nullen)
  const normalizedNumber = accountNumber.replace(/\s/g, '').replace(/^0+/, '');
  
  console.log(`Analyzing account: ${accountNumber} (normalized: ${normalizedNumber})`);
  
  for (const [groupName, config] of Object.entries(ACCOUNT_GROUPS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(normalizedNumber)) {
        console.log(`Account ${accountNumber} matches group: ${groupName}`);
        return { groupName, config };
      }
    }
  }
  
  console.log(`Account ${accountNumber} - no match found`);
  return null;
}

function generateGroupingSuggestions(accounts: TrialBalanceAccount[]): GroupingSuggestion[] {
  const groups: { [key: string]: TrialBalanceAccount[] } = {};
  const groupConfigs: { [key: string]: any } = {};
  
  // Kategorisiere alle Konten
  for (const account of accounts) {
    const result = categorizeAccount(account.accountNumber);
    if (result) {
      const { groupName, config } = result;
      if (!groups[groupName]) {
        groups[groupName] = [];
        groupConfigs[groupName] = config;
      }
      groups[groupName].push(account);
    }
  }
  
  // Erstelle Gruppierungsvorschläge
  const suggestions: GroupingSuggestion[] = [];
  for (const [groupName, groupAccounts] of Object.entries(groups)) {
    if (groupAccounts.length > 0) {
      const config = groupConfigs[groupName];
      suggestions.push({
        name: groupName,
        description: config.description,
        accounts: groupAccounts,
        category: config.category,
        subcategory: config.subcategory
      });
    }
  }
  
  // Sortiere nach Kategorie und Namen
  suggestions.sort((a, b) => {
    if (a.category !== b.category) {
      const order = ['aktiven', 'passiven', 'erfolgsrechnung'];
      return order.indexOf(a.category) - order.indexOf(b.category);
    }
    return a.name.localeCompare(b.name);
  });
  
  return suggestions;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accounts } = await req.json();
    
    if (!accounts || !Array.isArray(accounts)) {
      throw new Error('Invalid accounts data provided');
    }

    console.log(`Processing ${accounts.length} accounts for auto-grouping`);
    
    const suggestions = generateGroupingSuggestions(accounts);
    
    console.log(`Generated ${suggestions.length} grouping suggestions`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        suggestions,
        summary: {
          totalAccounts: accounts.length,
          totalGroups: suggestions.length,
          categorizedAccounts: suggestions.reduce((sum, s) => sum + s.accounts.length, 0),
          uncategorizedAccounts: accounts.length - suggestions.reduce((sum, s) => sum + s.accounts.length, 0)
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error) {
    console.error('Error in auto-group-accounts function:', error);
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