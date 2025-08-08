import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronRight, User, Edit, Trash2 } from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableAccountRow } from './DraggableAccountRow';

interface TrialBalanceRow {
  accountNumber: string;
  accountName: string;
  currentYear: number;
  previousYear: number;
  foreignCurrency?: number;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AccountGroup {
  id: string;
  name: string;
  description?: string;
  assigned_member_id?: string;
  assigned_member?: TeamMember;
  status: 'pending' | 'in_progress' | 'completed' | 'reviewed';
  accounts: TrialBalanceRow[];
}

interface AccountGroupSectionProps {
  group: AccountGroup;
  hasForeignCurrency: boolean;
  formatNumber: (value: number) => string;
  onEdit?: (group: AccountGroup) => void;
  onDelete?: (groupId: string) => void;
}

const getStatusBadge = (status: AccountGroup['status']) => {
  const variants = {
    pending: 'secondary',
    in_progress: 'outline',
    completed: 'default',
    reviewed: 'default'
  } as const;

  const labels = {
    pending: 'Ausstehend',
    in_progress: 'In Bearbeitung',
    completed: 'Abgeschlossen',
    reviewed: 'Geprüft'
  };

  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
};

export const AccountGroupSection = ({ 
  group, 
  hasForeignCurrency, 
  formatNumber, 
  onEdit, 
  onDelete 
}: AccountGroupSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const currentYearTotal = group.accounts.reduce((sum, acc) => sum + acc.currentYear, 0);
  const previousYearTotal = group.accounts.reduce((sum, acc) => sum + acc.previousYear, 0);
  const foreignCurrencyTotal = group.accounts.reduce((sum, acc) => sum + (acc.foreignCurrency || 0), 0);

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 h-6 w-6"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
            <CardTitle className="text-lg">{group.name}</CardTitle>
            {getStatusBadge(group.status)}
          </div>
          <div className="flex items-center gap-2">
            {group.assigned_member && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                {group.assigned_member.name}
              </div>
            )}
            <span className="text-sm text-muted-foreground">
              {group.accounts.length} Konten
            </span>
            <div className="flex gap-1">
              {onEdit && (
                <Button variant="ghost" size="sm" onClick={() => onEdit(group)}>
                  <Edit className="h-4 w-4" />
                </Button>
              )}
              {onDelete && (
                <Button variant="ghost" size="sm" onClick={() => onDelete(group.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
        {group.description && (
          <p className="text-sm text-muted-foreground mt-1">{group.description}</p>
        )}
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Kontonummer</TableHead>
                  <TableHead>Kontobezeichnung</TableHead>
                  <TableHead className="text-right">Saldo Laufendes Jahr</TableHead>
                  <TableHead className="text-right">Saldo Vorjahr</TableHead>
                  {hasForeignCurrency && (
                    <TableHead className="text-right">Fremdwährung</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext
                  items={group.accounts.map(acc => acc.accountNumber)}
                  strategy={verticalListSortingStrategy}
                >
                  {group.accounts.map((account) => (
                    <DraggableAccountRow
                      key={account.accountNumber}
                      account={account}
                      hasForeignCurrency={hasForeignCurrency}
                      formatNumber={formatNumber}
                    />
                  ))}
                </SortableContext>
                
                {/* Total Row */}
                <TableRow className="bg-muted/20 font-semibold border-t-2">
                  <TableCell></TableCell>
                  <TableCell colSpan={2}>
                    <strong>Total {group.name}</strong>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <strong>{formatNumber(currentYearTotal)}</strong>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <strong>{formatNumber(previousYearTotal)}</strong>
                  </TableCell>
                  {hasForeignCurrency && (
                    <TableCell className="text-right font-mono">
                      <strong>{formatNumber(foreignCurrencyTotal)}</strong>
                    </TableCell>
                  )}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
};