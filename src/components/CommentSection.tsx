import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, Link } from 'lucide-react';
import { PDFCommentExporter } from '@/components/PDFCommentExporter';

interface CommentSectionProps {
  selectedAccountData: any;
  selectedDocuments: any[];
  accountComments: { [key: string]: string };
  loadedComments: { [key: string]: boolean };
  completedAccounts: Set<string>;
  assignments: any[];
  sidebarCollapsed: boolean;
  trialBalanceId: string;
  onCommentChange: (accountId: string, comment: string) => void;
  onMarkCompleted: (accountId: string) => void;
  onShowMultiAssign: (document: any) => void;
}

export const CommentSection: React.FC<CommentSectionProps> = ({
  selectedAccountData,
  selectedDocuments,
  accountComments,
  loadedComments,
  completedAccounts,
  assignments,
  sidebarCollapsed,
  trialBalanceId,
  onCommentChange,
  onMarkCompleted,
  onShowMultiAssign,
}) => {
  if (!selectedAccountData) return null;

  return (
    <div className={`${sidebarCollapsed ? 'w-96 flex-shrink-0' : 'mt-4'} bg-muted/30 rounded-lg p-4 border`}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">
            Kommentare
          </label>
          <div className="flex items-center gap-2">
            {(() => {
              // Count how many other accounts share documents with this account
              const documentsForThisAccount = selectedDocuments.map(doc => doc.id);
              const otherAccountsWithSameDocuments = new Set<string>();
              
              documentsForThisAccount.forEach(docId => {
                assignments.forEach(assignment => {
                  if (assignment.matched_documents?.includes(docId) && assignment.id !== selectedAccountData.id) {
                    otherAccountsWithSameDocuments.add(assignment.id);
                  }
                });
              });
              
              const additionalAccountsCount = otherAccountsWithSameDocuments.size;
              
              return (
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onShowMultiAssign(selectedDocuments[0]);
                  }}
                  className="flex items-center gap-2"
                  disabled={selectedDocuments.length === 0}
                >
                  <Link className="h-4 w-4" />
                  Konten {additionalAccountsCount > 0 && `(${additionalAccountsCount})`}
                </Button>
              );
            })()}
            <Button 
              variant={completedAccounts.has(selectedAccountData.id) ? "default" : "outline"}
              size="sm"
              onClick={() => onMarkCompleted(selectedAccountData.id)}
              className="flex items-center gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              {completedAccounts.has(selectedAccountData.id) ? 'Vollständig' : 'Als vollständig markieren'}
            </Button>
          </div>
        </div>
        
        {/* Kommentarfeld in einem festen Container */}
        <div className="flex-shrink-0 border-t pt-4 space-y-2">
          <Textarea
            placeholder="Notizen und Anmerkungen zu diesem Konto und den Nachweisen..."
            value={accountComments[selectedAccountData.id] || (
              selectedAccountData.match_status === 'matched' && selectedAccountData.confidence_score === 0.8
                ? "Nachweis konnte mit der Saldobilanz abgestimmt werden; es ergaben sich keine Differenzen."
                : ""
            )}
            onChange={(e) => onCommentChange(selectedAccountData.id, e.target.value)}
            className="min-h-[100px] max-h-[200px] resize-none bg-background border-input w-full"
          />
          {loadedComments[selectedAccountData.id] && (
            <p className="text-xs text-muted-foreground">
              ✓ Kommentar gespeichert
            </p>
          )}
          
          {/* Export Buttons */}
          {selectedDocuments.length > 0 && (
            <div className="pt-4 border-t">
              <PDFCommentExporter
                document={selectedDocuments[0]}
                assignmentId={selectedAccountData.id}
                trialBalanceId={trialBalanceId}
                accountName={selectedAccountData.account_name}
                accountNumber={selectedAccountData.account_number}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};