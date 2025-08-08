import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';

interface TrialBalanceRow {
  accountNumber: string;
  accountName: string;
  currentYear: number;
  previousYear: number;
  foreignCurrency?: number;
}

interface DraggableAccountRowProps {
  account: TrialBalanceRow;
  hasForeignCurrency: boolean;
  formatNumber: (value: number) => string;
}

export const DraggableAccountRow = ({ account, hasForeignCurrency, formatNumber }: DraggableAccountRowProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: account.accountNumber });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={`hover:bg-muted/25 ${isDragging ? 'shadow-lg' : ''}`}
    >
      <TableCell className="w-8">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab hover:cursor-grabbing p-1 rounded hover:bg-muted"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell className="font-mono text-sm">{account.accountNumber}</TableCell>
      <TableCell>{account.accountName}</TableCell>
      <TableCell className="text-right font-mono">{formatNumber(account.currentYear)}</TableCell>
      <TableCell className="text-right font-mono">{formatNumber(account.previousYear)}</TableCell>
      {hasForeignCurrency && (
        <TableCell className="text-right font-mono">
          {account.foreignCurrency !== undefined ? formatNumber(account.foreignCurrency) : '-'}
        </TableCell>
      )}
    </TableRow>
  );
};