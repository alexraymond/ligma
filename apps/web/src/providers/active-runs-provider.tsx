'use client';

import { DecisionDialog } from '@/components/decision-dialog';
import { useActiveRuns } from '@/hooks/use-active-runs';
import { type ReactNode, createContext, useContext } from 'react';

type ActiveRunsContextValue = ReturnType<typeof useActiveRuns>;

const ActiveRunsContext = createContext<ActiveRunsContextValue | null>(null);

export function ActiveRunsProvider({ children }: { children: ReactNode }) {
  const activeRuns = useActiveRuns();

  return (
    <ActiveRunsContext.Provider value={activeRuns}>
      {children}
      <DecisionDialog
        open={activeRuns.showDecisionDialog}
        onOpenChange={activeRuns.setShowDecisionDialog}
        decision={activeRuns.pendingDecision}
        onAnswered={activeRuns.handleDecisionAnswered}
      />
    </ActiveRunsContext.Provider>
  );
}

export function useActiveRunsContext(): ActiveRunsContextValue {
  const ctx = useContext(ActiveRunsContext);
  if (!ctx) {
    throw new Error('useActiveRunsContext must be used within ActiveRunsProvider');
  }
  return ctx;
}
