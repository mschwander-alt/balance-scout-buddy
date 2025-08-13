import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calculator as CalculatorIcon, Copy, History, Trash2, Minimize2, Maximize2, X } from 'lucide-react';
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
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opening
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

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

  const toggleCalculator = () => {
    if (!isOpen) {
      setIsOpen(true);
      setIsMinimized(false);
    } else {
      setIsMinimized(!isMinimized);
    }
  };

  return (
    <>
      {/* Floating Calculator Button */}
      {!isOpen && (
        <Button 
          onClick={() => setIsOpen(true)}
          className="fixed bottom-4 left-4 z-50 h-12 w-12 p-0 rounded-full shadow-lg"
          title="Taschenrechner öffnen"
        >
          <CalculatorIcon className="h-5 w-5" />
        </Button>
      )}

      {/* Floating Calculator Panel */}
      {isOpen && (
        <Card className="fixed bottom-4 left-4 z-50 shadow-xl border-2" style={{ width: '320px' }}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalculatorIcon className="h-4 w-4" />
                Taschenrechner
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleCalculator}
                  className="h-6 w-6 p-0"
                  title={isMinimized ? "Maximieren" : "Minimieren"}
                >
                  {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  className="h-6 w-6 p-0"
                  title="Schließen"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardHeader>

          {!isMinimized && (
            <CardContent className="space-y-3">
              {/* Input Field */}
              <div className="space-y-2">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="z.B. 123 + 456 * 0.19"
                  className="font-mono"
                  autoComplete="off"
                />
                <div className="text-xs text-muted-foreground">
                  Enter = Berechnen, Esc = Löschen
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button onClick={handleCalculate} size="sm" className="flex-1">
                  Berechnen
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-1"
                >
                  <History className="h-3 w-3" />
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={clearAll}
                  className="flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              {/* Result Display */}
              {result !== null && (
                <div className="bg-muted/50 border rounded-lg p-3 flex items-center justify-between">
                  <span className="text-lg font-mono font-bold text-foreground">
                    {result.toLocaleString('de-DE')}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyResult}
                    className="flex items-center gap-1 h-7"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* History */}
              {showHistory && history.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Verlauf:</label>
                  <div className="max-h-24 overflow-y-auto space-y-1 border rounded-lg p-2 bg-muted/20">
                    {history.map((entry, index) => {
                      const [calculation, result] = entry.split(' = ');
                      return (
                        <div 
                          key={index}
                          className="flex items-center justify-between text-xs hover:bg-muted/50 p-1 rounded cursor-pointer"
                          onClick={() => copyToInput(calculation)}
                          title="Klicken zum Wiederverwenden"
                        >
                          <span className="font-mono text-xs truncate">{calculation}</span>
                          <span className="font-bold text-primary text-xs">{result}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

    </>
  );
};