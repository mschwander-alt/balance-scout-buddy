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

// Schweizer Kontenrahmen nach Obligationenrecht - Standard Bilanzstruktur
const STANDARD_ACCOUNT_GROUPS = [
  // AKTIVEN - Umlaufvermögen
  {
    name: 'Flüssige Mittel',
    patterns: [/^100/, /^101/, /^102/, /^103/, /^104/, /^105/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Kasse, Post- und Bankguthaben',
    order: 1
  },
  {
    name: 'Kurzfristig gehaltene Aktiven mit Börsenkurs',
    patterns: [/^106/, /^107/, /^108/, /^109/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Kurzfristige Wertschriften',
    order: 2
  },
  {
    name: 'Forderungen aus Lieferungen und Leistungen',
    patterns: [/^110/, /^111/, /^112/, /^113/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Kundenforderungen',
    order: 3
  },
  {
    name: 'Übrige kurzfristige Forderungen',
    patterns: [/^114/, /^115/, /^116/, /^117/, /^118/, /^119/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Diverse Forderungen, Vorschüsse, Verrechnungssteuer',
    order: 4
  },
  {
    name: 'Vorräte und nicht fakturierte Dienstleistungen',
    patterns: [/^120/, /^121/, /^122/, /^123/, /^124/, /^125/, /^126/, /^127/, /^128/, /^129/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Material, Waren, unfertige und fertige Erzeugnisse',
    order: 5
  },
  {
    name: 'Aktive Rechnungsabgrenzung',
    patterns: [/^150/, /^151/, /^152/, /^153/, /^154/, /^155/, /^156/, /^157/, /^158/, /^159/],
    category: 'aktiven' as const,
    subcategory: 'Umlaufvermögen',
    description: 'Vorausbezahlte Aufwände',
    order: 6
  },

  // AKTIVEN - Anlagevermögen
  {
    name: 'Finanzanlagen',
    patterns: [/^140/, /^141/, /^142/, /^143/, /^144/, /^145/, /^146/, /^147/],
    category: 'aktiven' as const,
    subcategory: 'Anlagevermögen',
    description: 'Wertschriften, Darlehen',
    order: 7
  },
  {
    name: 'Beteiligungen',
    patterns: [/^148/, /^149/],
    category: 'aktiven' as const,
    subcategory: 'Anlagevermögen',
    description: 'Beteiligungen an anderen Unternehmen',
    order: 8
  },
  {
    name: 'Mobile Sachanlagen',
    patterns: [/^160/, /^161/, /^162/, /^163/, /^164/, /^165/, /^166/, /^167/, /^168/, /^169/],
    category: 'aktiven' as const,
    subcategory: 'Anlagevermögen',
    description: 'Maschinen, Mobiliar, Fahrzeuge, IT-Anlagen',
    order: 9
  },
  {
    name: 'Immobile Sachanlagen',
    patterns: [/^170/, /^171/, /^172/, /^173/, /^174/, /^175/, /^176/, /^177/, /^178/, /^179/],
    category: 'aktiven' as const,
    subcategory: 'Anlagevermögen',
    description: 'Grundstücke, Gebäude',
    order: 10
  },
  {
    name: 'Immaterielle Werte',
    patterns: [/^180/, /^181/, /^182/, /^183/, /^184/, /^185/, /^186/, /^187/, /^188/, /^189/],
    category: 'aktiven' as const,
    subcategory: 'Anlagevermögen',
    description: 'Patente, Lizenzen, Software, Goodwill',
    order: 11
  },
  {
    name: 'Nicht einbezahltes Grund-, Gesellschafter- oder Stiftungskapital',
    patterns: [/^190/, /^191/, /^192/, /^193/, /^194/, /^195/, /^196/, /^197/, /^198/, /^199/],
    category: 'aktiven' as const,
    subcategory: 'Anlagevermögen',
    description: 'Ausstehende Kapitaleinlagen',
    order: 12
  },

  // PASSIVEN - Fremdkapital kurzfristig
  {
    name: 'Verbindlichkeiten aus Lieferungen und Leistungen',
    patterns: [/^200/, /^201/, /^202/, /^203/, /^204/, /^205/, /^206/, /^207/, /^208/, /^209/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital kurzfristig',
    description: 'Lieferantenverbindlichkeiten',
    order: 13
  },
  {
    name: 'Kurzfristige verzinsliche Verbindlichkeiten',
    patterns: [/^210/, /^211/, /^212/, /^213/, /^214/, /^215/, /^216/, /^217/, /^218/, /^219/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital kurzfristig',
    description: 'Bankverbindlichkeiten, kurzfristige Darlehen',
    order: 14
  },
  {
    name: 'Übrige kurzfristige Verbindlichkeiten',
    patterns: [/^220/, /^221/, /^222/, /^223/, /^224/, /^225/, /^226/, /^227/, /^228/, /^229/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital kurzfristig',
    description: 'Sozialversicherungen, Steuern, diverse Verbindlichkeiten',
    order: 15
  },
  {
    name: 'Passive Rechnungsabgrenzungen und kurzfristige Rückstellungen',
    patterns: [/^230/, /^231/, /^232/, /^233/, /^234/, /^235/, /^236/, /^237/, /^238/, /^239/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital kurzfristig',
    description: 'Erhaltene Vorauszahlungen, aufgelaufene Kosten, kurzfristige Rückstellungen',
    order: 16
  },

  // PASSIVEN - Fremdkapital langfristig
  {
    name: 'Langfristige verzinsliche Verbindlichkeiten',
    patterns: [/^240/, /^241/, /^242/, /^243/, /^244/, /^245/, /^246/, /^247/, /^248/, /^249/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital langfristig',
    description: 'Hypotheken, langfristige Darlehen',
    order: 17
  },
  {
    name: 'Übrige langfristige Verbindlichkeiten',
    patterns: [/^250/, /^251/, /^252/, /^253/, /^254/, /^255/, /^256/, /^257/, /^258/, /^259/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital langfristig',
    description: 'Andere langfristige Verbindlichkeiten',
    order: 18
  },
  {
    name: 'Rückstellungen sowie vom Gesetz vorgesehene steuerlich zulässige Positionen',
    patterns: [/^260/, /^261/, /^262/, /^263/, /^264/, /^265/, /^266/, /^267/, /^268/, /^269/],
    category: 'passiven' as const,
    subcategory: 'Fremdkapital langfristig',
    description: 'Langfristige Rückstellungen',
    order: 19
  },

  // PASSIVEN - Eigenkapital
  {
    name: 'Eigenkapital (gemäss Einzelkarten)',
    patterns: [/^280/, /^281/, /^282/, /^283/, /^284/, /^285/, /^286/, /^287/, /^288/, /^289/, /^290/, /^291/, /^292/, /^293/, /^294/, /^295/, /^296/, /^297/, /^298/, /^299/],
    category: 'passiven' as const,
    subcategory: 'Eigenkapital',
    description: 'Kapital, Reserven, Gewinn/Verlust',
    order: 20
  },

  // ERFOLGSRECHNUNG - Ertrag
  {
    name: 'Betrieblicher Ertrag aus Lieferungen und Leistungen',
    patterns: [/^3000/, /^3200/, /^3400/, /^3600/, /^3700/, /^3710/, /^3800/, /^3900/, /^3940/, /^3970/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Ertrag',
    description: 'Produktionserlöse, Handelserlöse, Dienstleistungserlöse',
    order: 21
  },
  {
    name: 'Aufwand für Material, Handelswaren, Dienstleistungen und Energie',
    patterns: [/^4000/, /^4200/, /^4400/, /^4500/, /^4600/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Aufwand',
    description: 'Materialaufwand, Handelswarenaufwand, Energieaufwand',
    order: 22
  },
  {
    name: 'Personalaufwand',
    patterns: [/^5000/, /^5700/, /^5800/, /^5900/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Aufwand',
    description: 'Lohnaufwand, Sozialversicherungsaufwand, übriger Personalaufwand',
    order: 23
  },
  {
    name: 'Übriger betrieblicher Aufwand, Abschreibungen und Wertberichtigungen sowie Finanzaufwand',
    patterns: [/^6000/, /^6100/, /^6105/, /^6200/, /^6260/, /^6300/, /^6400/, /^6500/, /^6570/, /^6600/, /^6700/, /^6800/, /^6900/, /^6950/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Aufwand',
    description: 'Raumaufwand, Unterhaltsaufwand, Fahrzeugaufwand, Versicherungsaufwand, Energie- und Entsorgungsaufwand, Verwaltungsaufwand, Werbeaufwand',
    order: 24
  },
  {
    name: 'Betriebsfremder, ausserordentlicher, einmaliger oder periodenfremder Aufwand und Ertrag',
    patterns: [/^7000/, /^7010/, /^7500/, /^7510/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Betriebsfremder Erfolg',
    description: 'Betriebsfremder Ertrag und Aufwand, Ausserordentlicher, einmaliger oder periodenfremder Ertrag und Aufwand',
    order: 25
  },
  {
    name: 'Betriebsfremder, ausserordentlicher, einmaliger oder periodenfremder Aufwand und Ertrag',
    patterns: [/^8000/, /^8100/, /^8500/, /^8510/, /^8900/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Betriebsfremder Aufwand',
    description: 'Betriebsfremder Aufwand, Betriebsfremder Ertrag, Ausserordentlicher, einmaliger oder periodenfremder Aufwand, Direkte Steuern',
    order: 26
  },
  {
    name: 'Abschluss',
    patterns: [/^9000/, /^9200/],
    category: 'erfolgsrechnung' as const,
    subcategory: 'Abschluss',
    description: 'Jahresgewinn oder Jahresverlust',
    order: 27
  }
];

// Legacy mapping for backward compatibility
const ACCOUNT_GROUPS: { [key: string]: any } = {};
STANDARD_ACCOUNT_GROUPS.forEach(group => {
  ACCOUNT_GROUPS[group.name] = {
    patterns: group.patterns,
    category: group.category,
    subcategory: group.subcategory,
    description: group.description,
    order: group.order
  };
});

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
  
  // Kategorisiere alle Konten
  for (const account of accounts) {
    const result = categorizeAccount(account.accountNumber);
    if (result) {
      const { groupName } = result;
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(account);
    }
  }
  
  // Erstelle ALLE Standard-Gruppierungsvorschläge (auch leere)
  const suggestions: GroupingSuggestion[] = [];
  
  for (const standardGroup of STANDARD_ACCOUNT_GROUPS) {
    const groupAccounts = groups[standardGroup.name] || [];
    
    suggestions.push({
      name: standardGroup.name,
      description: standardGroup.description,
      accounts: groupAccounts,
      category: standardGroup.category,
      subcategory: standardGroup.subcategory
    });
  }
  
  // Sortierung ist bereits durch die Reihenfolge in STANDARD_ACCOUNT_GROUPS gegeben
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