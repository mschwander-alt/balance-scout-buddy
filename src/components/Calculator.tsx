import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calculator as CalculatorIcon, Copy, History, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

// Safe mathematical expression evaluator
const safeEval = (expression: string): number | null => {
  try {
    // Remove spaces and replace common operators
    const cleaned = expression
      .replace(/\s+/g, '')
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/,/g, '.');
    
    // Check if expression contains only allowed characters
    if (!/^[\d+\-*/().]+$/.test(cleaned)) {
      return null;
    }
    
    // Evaluate the expression safely using Function constructor
    const result = Function(`"use strict"; return (${cleaned})`)();
    
    return typeof result === 'number' && isFinite(result) ? result : null;
  } catch {
    return null;
  }
};

export const Calculator: React.FC = () => {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleCalculate = () => {
    if (!input.trim()) return;
    
    const calculated = safeEval(input);
    if (calculated !== null) {
      setResult(calculated);
      const historyEntry = `${input} = ${calculated}`;
      setHistory(prev => [historyEntry, ...prev.slice(0, 9)]); // Keep last 10 calculations
      toast.success('Berechnung erfolgreich');
    } else {
      toast.error('Ungültige mathematische Formel');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCalculate();
    } else if (e.key === 'Escape') {
      setInput('');
      setResult(null);
    }
  };

  const copyResult = async () => {
    if (result !== null) {
      try {
        await navigator.clipboard.writeText(result.toString());
        toast.success('Ergebnis in Zwischenablage kopiert');
      } catch {
        toast.error('Fehler beim Kopieren');
      }
    }
  };

  const copyToInput = (value: string) => {
    setInput(value);
    setResult(null);
    inputRef.current?.focus();
  };

  const clearAll = () => {
    setInput('');
    setResult(null);
    setHistory([]);
    inputRef.current?.focus();
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className="flex items-center gap-2"
          title="Taschenrechner öffnen"
        >
          <CalculatorIcon className="h-4 w-4" />
          Rechner
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalculatorIcon className="h-5 w-5" />
            Taschenrechner
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Input Field */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Mathematische Formel eingeben:</label>
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="z.B. 123 + 456 * 0.19"
              className="font-mono text-lg"
              autoComplete="off"
            />
            <div className="text-xs text-muted-foreground">
              Unterstützt: +, -, *, /, Klammern. Enter = Berechnen, Esc = Löschen
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button onClick={handleCalculate} className="flex-1">
              Berechnen
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1"
            >
              <History className="h-4 w-4" />
              Verlauf
            </Button>
            <Button 
              variant="outline" 
              onClick={clearAll}
              className="flex items-center gap-1"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Result Display */}
          {result !== null && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Ergebnis:</label>
              <div className="relative">
                <div className="bg-muted/50 border rounded-lg p-4 flex items-center justify-between">
                  <span className="text-xl font-mono font-bold text-foreground">
                    {result.toLocaleString('de-DE')}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyResult}
                    className="flex items-center gap-1"
                  >
                    <Copy className="h-4 w-4" />
                    Kopieren
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* History */}
          {showHistory && history.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Verlauf:</label>
              <div className="max-h-32 overflow-y-auto space-y-1 border rounded-lg p-2 bg-muted/20">
                {history.map((entry, index) => {
                  const [calculation, result] = entry.split(' = ');
                  return (
                    <div 
                      key={index}
                      className="flex items-center justify-between text-sm hover:bg-muted/50 p-1 rounded cursor-pointer"
                      onClick={() => copyToInput(calculation)}
                      title="Klicken zum Wiederverwenden"
                    >
                      <span className="font-mono text-xs">{calculation}</span>
                      <span className="font-bold text-primary">{result}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Examples */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Schnellzugriff:</label>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {[
                '1000 * 0.19',
                '(500 + 300) * 0.07',
                '1500 / 12',
                '250 * 1.2'
              ].map((example, index) => (
                <Button
                  key={index}
                  variant="outline"
                  size="sm"
                  onClick={() => copyToInput(example)}
                  className="text-xs h-8 justify-start font-mono"
                >
                  {example}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};