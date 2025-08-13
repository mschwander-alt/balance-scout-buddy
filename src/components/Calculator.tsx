import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calculator as CalculatorIcon, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export const Calculator: React.FC = () => {
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  const inputNumber = (num: string) => {
    if (waitingForOperand) {
      setDisplay(num);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? num : display + num);
    }
  };

  const inputDot = () => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
    } else if (display.indexOf('.') === -1) {
      setDisplay(display + '.');
    }
  };

  const clear = () => {
    setDisplay('0');
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(false);
  };

  const performCalculation = (nextOperator?: string) => {
    const inputValue = parseFloat(display);

    if (previousValue === null) {
      setPreviousValue(inputValue);
    } else if (operator) {
      const currentValue = previousValue || 0;
      let result = currentValue;

      switch (operator) {
        case '+':
          result = currentValue + inputValue;
          break;
        case '-':
          result = currentValue - inputValue;
          break;
        case '*':
          result = currentValue * inputValue;
          break;
        case '/':
          result = inputValue !== 0 ? currentValue / inputValue : 0;
          break;
        case '=':
          result = inputValue;
          break;
        default:
          return;
      }

      setDisplay(String(result));
      setPreviousValue(result);
    }

    setWaitingForOperand(true);
    setOperator(nextOperator || null);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(display);
      toast.success('Ergebnis in Zwischenablage kopiert');
    } catch (error) {
      toast.error('Fehler beim Kopieren');
    }
  };

  const buttonStyle = "h-12 text-lg font-medium transition-colors hover:bg-muted/80";
  const operatorStyle = "h-12 text-lg font-medium bg-primary/10 hover:bg-primary/20 text-primary";

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
      <DialogContent className="sm:max-w-[320px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalculatorIcon className="h-5 w-5" />
            Taschenrechner
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Display */}
          <div className="relative">
            <div className="bg-muted/50 border rounded-lg p-4 text-right">
              <div className="text-2xl font-mono font-bold text-foreground truncate">
                {display}
              </div>
            </div>
            <div className="absolute top-2 right-2 flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={copyToClipboard}
                className="h-6 w-6 p-0"
                title="Kopieren"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Calculator Grid */}
          <div className="grid grid-cols-4 gap-2">
            {/* Row 1 */}
            <Button
              variant="outline"
              onClick={clear}
              className={`${buttonStyle} col-span-2 bg-destructive/10 hover:bg-destructive/20 text-destructive`}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Löschen
            </Button>
            <Button
              variant="outline"
              onClick={() => performCalculation('/')}
              className={operatorStyle}
            >
              ÷
            </Button>
            <Button
              variant="outline"
              onClick={() => performCalculation('*')}
              className={operatorStyle}
            >
              ×
            </Button>

            {/* Row 2 */}
            <Button
              variant="outline"
              onClick={() => inputNumber('7')}
              className={buttonStyle}
            >
              7
            </Button>
            <Button
              variant="outline"
              onClick={() => inputNumber('8')}
              className={buttonStyle}
            >
              8
            </Button>
            <Button
              variant="outline"
              onClick={() => inputNumber('9')}
              className={buttonStyle}
            >
              9
            </Button>
            <Button
              variant="outline"
              onClick={() => performCalculation('-')}
              className={operatorStyle}
            >
              −
            </Button>

            {/* Row 3 */}
            <Button
              variant="outline"
              onClick={() => inputNumber('4')}
              className={buttonStyle}
            >
              4
            </Button>
            <Button
              variant="outline"
              onClick={() => inputNumber('5')}
              className={buttonStyle}
            >
              5
            </Button>
            <Button
              variant="outline"
              onClick={() => inputNumber('6')}
              className={buttonStyle}
            >
              6
            </Button>
            <Button
              variant="outline"
              onClick={() => performCalculation('+')}
              className={operatorStyle}
            >
              +
            </Button>

            {/* Row 4 */}
            <Button
              variant="outline"
              onClick={() => inputNumber('1')}
              className={buttonStyle}
            >
              1
            </Button>
            <Button
              variant="outline"
              onClick={() => inputNumber('2')}
              className={buttonStyle}
            >
              2
            </Button>
            <Button
              variant="outline"
              onClick={() => inputNumber('3')}
              className={buttonStyle}
            >
              3
            </Button>
            <Button
              variant="outline"
              onClick={() => performCalculation('=')}
              className={`${operatorStyle} row-span-2 h-auto`}
            >
              =
            </Button>

            {/* Row 5 */}
            <Button
              variant="outline"
              onClick={() => inputNumber('0')}
              className={`${buttonStyle} col-span-2`}
            >
              0
            </Button>
            <Button
              variant="outline"
              onClick={inputDot}
              className={buttonStyle}
            >
              ,
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};