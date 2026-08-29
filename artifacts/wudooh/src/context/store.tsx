import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { migrateLegacyLocalOpeningBalances } from '@/lib/local-ledger';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parent: string | null;
  openingBalance?: number;
  balance: number;
  status: 'active' | 'inactive';
};

export type JournalLine = {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
};

export type Journal = {
  id: string;
  number: string;
  date: string;
  description: string;
  lines: JournalLine[];
  status: 'draft' | 'posted';
  adjustmentType?: 'reversal' | 'correction';
  adjustsJournalId?: string;
  adjustmentStatus?: 'reversed' | 'corrected';
  adjustedByJournalIds?: string[];
  adjustmentReason?: string;
  sourceType?: 'sale' | 'purchase' | 'expense';
  sourceId?: string;
};

export type JournalAdjustmentInput = {
  date: string;
  reason: string;
  description?: string;
  lines?: Array<Omit<JournalLine, 'id'>>;
};

export type ReceivableType = 'receivable' | 'payable';

export type Receivable = {
  id: string;
  party: string;
  type: ReceivableType;
  reference: string;
  dueDate: string;
  amount: number;
  paid: number;
  status: 'unpaid' | 'partial' | 'paid';
};

export type FinancialClosure = {
  id: string;
  from: string;
  to: string;
  status: 'closed';
  closedAt: string;
  netIncome: number;
  totals: { revenue: number; expense: number; netIncome: number; receivables?: number; payables?: number };
};

type StoreContextType = {
  currentUser: SharedUser | null;
  signOut: () => Promise<void>;
  accounts: Account[];
  addAccount: (account: Omit<Account, 'id'>) => Promise<void>;
  updateAccount: (id: string, account: Partial<Account>) => Promise<void>;
  journals: Journal[];
  addJournal: (journal: Omit<Journal, 'id' | 'number'>) => Promise<void>;
  updateJournal: (id: string, journal: Partial<Journal>) => Promise<void>;
  postJournal: (id: string) => Promise<void>;
  adjustJournal: (id: string, action: 'reverse' | 'correct', input: JournalAdjustmentInput, operationId: string) => Promise<{ reversal: Journal; correction?: Journal }>;
  receivables: Receivable[];
  addReceivable: (receivable: Omit<Receivable, 'id'>) => Promise<void>;
  updateReceivable: (id: string, receivable: Partial<Receivable>) => Promise<void>;
  payReceivable: (id: string, amount: number) => Promise<void>;
  closures: FinancialClosure[];
  closePeriod: (from: string, to: string) => Promise<FinancialClosure>;
  connectionMode: 'loading' | 'remote' | 'local';
  canRetrySharedConnection: boolean;
  refreshSession: () => Promise<void>;
  syncQueue: SyncOperation[];
  retrySharedConnection: () => Promise<void>;
  flushPendingSyncOperations: () => Promise<boolean>;
  clearPendingSyncOperations: () => void;
};

export type SharedUser = {
  id: number;
  accountId: number;
  organizationId: number;
  projectName: string;
  dataGeneration: number;
  email: string;
  phone: string | null;
  emailVerifiedAt: string | null;
  name: string;
  roleId: string;
  permissions: Record<string, boolean>;
  locationScope: string;
  warehouseIds: number[];
  status: string;
  isTeamMember: boolean;
  subscription: {
    planId: string;
    status: 'trialing' | 'active' | 'expired' | 'inactive';
    accessActive: boolean;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    subscriptionStartedAt: string | null;
    subscriptionEndsAt: string | null;
  };
};

export type SyncOperation = {
  id: string;
  table: 'accounts' | 'journalEntries' | 'receivables';
  action: 'create' | 'update';
  recordId: string;
  data: Record<string, unknown>;
  dataGeneration: number;
  status: 'pending' | 'failed';
  error?: string;
  createdAt: string;
};

const demoYear = new Date().getFullYear();
const storageKey = 'wudooh-accounting-data';
const remoteSessionHintCookie = 'wudooh_remote_session';
const sharedSessionKeyStorageKey = 'wudooh_shared_session_key';
const syncQueueStoragePrefix = 'wudooh-sync-queue-';
const storedDataVersion = 3;
const staleDataGenerationEvent = 'wudooh:stale-data-generation';

const initialAccounts: Account[] = [
  { id: '1', code: '1000', name: 'الصندوق', type: 'asset', parent: null, openingBalance: 0, balance: 5000, status: 'active' },
  { id: '2', code: '1100', name: 'البنك', type: 'asset', parent: null, openingBalance: 0, balance: 58000, status: 'active' },
  { id: '3', code: '1200', name: 'العملاء', type: 'asset', parent: null, openingBalance: 0, balance: 12000, status: 'active' },
  { id: '4', code: '2000', name: 'الموردين', type: 'liability', parent: null, openingBalance: 0, balance: 4000, status: 'active' },
  { id: '5', code: '3000', name: 'رأس المال', type: 'equity', parent: null, openingBalance: 0, balance: 60000, status: 'active' },
  { id: '6', code: '4000', name: 'المبيعات', type: 'revenue', parent: null, openingBalance: 0, balance: 17000, status: 'active' },
  { id: '7', code: '5000', name: 'المشتريات', type: 'expense', parent: null, openingBalance: 0, balance: 4000, status: 'active' },
  { id: '8', code: '5100', name: 'مصروفات الرواتب', type: 'expense', parent: null, openingBalance: 0, balance: 2000, status: 'active' },
];

const initialJournals: Journal[] = [
  {
    id: '1',
    number: 'J-0001',
    date: `${demoYear}-01-01`,
    description: 'رأس المال المبدئي',
    status: 'posted',
    lines: [
      { id: 'l1', accountId: '2', debit: 60000, credit: 0 },
      { id: 'l2', accountId: '5', debit: 0, credit: 60000 }
    ]
  },
  {
    id: '2',
    number: 'J-0002',
    date: `${demoYear}-01-05`,
    description: 'مبيعات نقدية',
    status: 'posted',
    lines: [
      { id: 'l3', accountId: '1', debit: 5000, credit: 0 },
      { id: 'l4', accountId: '6', debit: 0, credit: 5000 }
    ]
  },
  {
    id: '3',
    number: 'J-0003',
    date: `${demoYear}-01-10`,
    description: 'فاتورة بيع آجل للعميل شركة الأمل',
    status: 'posted',
    lines: [
      { id: 'l5', accountId: '3', debit: 12000, credit: 0 },
      { id: 'l6', accountId: '6', debit: 0, credit: 12000 }
    ]
  },
  {
    id: '4',
    number: 'J-0004',
    date: `${demoYear}-01-12`,
    description: 'شراء بضاعة آجل من مورد الجملة',
    status: 'posted',
    lines: [
      { id: 'l7', accountId: '7', debit: 4000, credit: 0 },
      { id: 'l8', accountId: '4', debit: 0, credit: 4000 }
    ]
  },
  {
    id: '5',
    number: 'J-0005',
    date: `${demoYear}-01-20`,
    description: 'إثبات مصروف الرواتب',
    status: 'posted',
    lines: [
      { id: 'l9', accountId: '8', debit: 2000, credit: 0 },
      { id: 'l10', accountId: '2', debit: 0, credit: 2000 }
    ]
  }
];

const initialReceivables: Receivable[] = [
  { id: '1', party: 'شركة الأمل', type: 'receivable', reference: 'INV-1001', dueDate: `${demoYear}-02-25`, amount: 8000, paid: 3000, status: 'partial' },
  { id: '2', party: 'مؤسسة التقنية', type: 'receivable', reference: 'INV-1002', dueDate: `${demoYear}-03-05`, amount: 4000, paid: 0, status: 'unpaid' },
  { id: '3', party: 'مورد الجملة', type: 'payable', reference: 'BILL-050', dueDate: `${demoYear}-02-28`, amount: 5000, paid: 5000, status: 'paid' },
  { id: '4', party: 'شركة التوريدات', type: 'payable', reference: 'BILL-051', dueDate: `${demoYear}-03-10`, amount: 3000, paid: 0, status: 'unpaid' },
];

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [storedData] = useState(() => readStoredData());
  const [needsLegacySessionMigration] = useState(() => hasLegacyStoredData());
  const [shouldVerifyRemoteSession] = useState(() => hasRemoteSessionHint() || hasLegacyStoredData());
  // Keep the last local snapshot available while a known shared session is
  // being verified. The loading screen hides it until verification completes,
  // but it is the safe fallback when the shared service is temporarily down.
  const [accounts, setAccounts] = useState<Account[]>(() => storedData?.accounts ?? initialAccounts);
  const [journals, setJournals] = useState<Journal[]>(() => storedData?.journals ?? initialJournals);
  const [receivables, setReceivables] = useState<Receivable[]>(() => storedData?.receivables ?? initialReceivables);
  const [closures, setClosures] = useState<FinancialClosure[]>(() => storedData?.closures ?? []);
  const [connectionMode, setConnectionMode] = useState<'loading' | 'remote' | 'local'>(
    () => shouldVerifyRemoteSession ? 'loading' : 'local',
  );
  const [canRetrySharedConnection, setCanRetrySharedConnection] = useState(
    () => shouldVerifyRemoteSession,
  );
  const [legacyRecoveryPending, setLegacyRecoveryPending] = useState(needsLegacySessionMigration);
  const [currentUser, setCurrentUser] = useState<SharedUser | null>(null);
  const [sharedSessionKey, setSharedSessionKey] = useState(() => readSharedSessionKey());
  const [syncQueue, setSyncQueue] = useState<SyncOperation[]>(() => {
    const sessionKey = readSharedSessionKey();
    return sessionKey ? readSyncQueue(sessionKey) : [];
  });
  const syncQueueRef = useRef(syncQueue);
  const syncFlushRef = useRef<Promise<boolean> | null>(null);

  const persistSyncQueue = useCallback((sessionKey: string, queue: SyncOperation[]) => {
    syncQueueRef.current = queue;
    setSyncQueue(queue);
    writeSyncQueue(sessionKey, queue);
  }, []);

  const enqueueSyncOperation = useCallback((operation: Omit<SyncOperation, 'id' | 'status' | 'createdAt' | 'dataGeneration'>): SyncOperation | null => {
    if (!sharedSessionKey || !currentUser) return null;
    const operationId = crypto.randomUUID();
    const queuedOperation: SyncOperation = {
      ...operation,
      id: operationId,
      data: operation.action === 'create'
        ? { ...operation.data, clientOperationId: operationId }
        : operation.data,
      status: 'pending',
      createdAt: new Date().toISOString(),
      dataGeneration: currentUser.dataGeneration,
    };
    persistSyncQueue(sharedSessionKey, [
      ...syncQueueRef.current,
      queuedOperation,
    ]);
    return queuedOperation;
  }, [currentUser, persistSyncQueue, sharedSessionKey]);

  const completeCreatedSyncOperation = useCallback((operation: SyncOperation, recordId: string) => {
    if (!sharedSessionKey) return;
    persistSyncQueue(sharedSessionKey, syncQueueRef.current
      .filter((item) => item.id !== operation.id)
      .map((item) => ({
        ...item,
        recordId: item.recordId === operation.recordId ? recordId : item.recordId,
        data: replaceValue(item.data, operation.recordId, recordId) as Record<string, unknown>,
      })));
  }, [persistSyncQueue, sharedSessionKey]);

  const failSyncOperation = useCallback((operation: SyncOperation, error: unknown) => {
    if (!sharedSessionKey) return;
    const message = error instanceof Error ? error.message : 'تعذر مزامنة العملية.';
    persistSyncQueue(sharedSessionKey, syncQueueRef.current.map((item) => item.id === operation.id
      ? { ...item, status: 'failed', error: message }
      : item));
  }, [persistSyncQueue, sharedSessionKey]);

  const completeSyncOperation = useCallback((operation: SyncOperation) => {
    if (!sharedSessionKey) return;
    persistSyncQueue(sharedSessionKey, syncQueueRef.current.filter((item) => item.id !== operation.id));
  }, [persistSyncQueue, sharedSessionKey]);

  const flushSyncQueue = useCallback((sessionKey: string, initialQueue?: SyncOperation[]): Promise<boolean> => {
    if (syncFlushRef.current) return syncFlushRef.current;
    const synchronize = async (): Promise<boolean> => {
      let queue = initialQueue ?? syncQueueRef.current;
      if (!queue.length) return true;

      const saveQueue = (nextQueue: SyncOperation[]) => {
        queue = nextQueue;
        persistSyncQueue(sessionKey, nextQueue);
      };

      for (const operation of queue) {
        if (operation.status === 'failed') return false;
        try {
          if (operation.action === 'create') {
            const created = await createRecord<Record<string, unknown>>(operation.table, operation.data, operation.dataGeneration);
            const normalized = normalizeRecord(operation.table, created);
            const optimisticRecord = queue
              .filter((item) => item.action === 'update' && item.recordId === operation.recordId)
              .reduce<Account | Journal | Receivable>(
                (record, item) => ({ ...record, ...item.data }) as Account | Journal | Receivable,
                normalized,
              );
            replaceLocalRecord(operation.table, operation.recordId, optimisticRecord, {
              accounts: setAccounts,
              journals: setJournals,
              receivables: setReceivables,
            });
            const nextQueue = queue
              .filter((item) => item.id !== operation.id)
              .map((item) => ({
                ...item,
                recordId: item.recordId === operation.recordId ? normalized.id : item.recordId,
                data: replaceValue(item.data, operation.recordId, normalized.id) as Record<string, unknown>,
              }));
            saveQueue(nextQueue);
          } else {
            const updated = await updateRecord<Record<string, unknown>>(operation.table, operation.recordId, operation.data, operation.dataGeneration, operation.id);
            const normalized = normalizeRecord(operation.table, updated);
            replaceLocalRecord(operation.table, operation.recordId, normalized, {
              accounts: setAccounts,
              journals: setJournals,
              receivables: setReceivables,
            });
            saveQueue(queue.filter((item) => item.id !== operation.id));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'تعذر مزامنة العملية.';
          saveQueue(queue.map((item) => item.id === operation.id
            ? { ...item, status: 'failed', error: message }
            : item));
          return false;
        }
      }
      return true;
    };
    const inFlight = synchronize();
    syncFlushRef.current = inFlight;
    void inFlight.finally(() => {
      if (syncFlushRef.current === inFlight) syncFlushRef.current = null;
    });
    return inFlight;
  }, [persistSyncQueue]);

  const flushPendingSyncOperations = useCallback(async (): Promise<boolean> => {
    if (!sharedSessionKey || !syncQueueRef.current.length) return true;
    return flushSyncQueue(sharedSessionKey);
  }, [flushSyncQueue, sharedSessionKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({
      version: storedDataVersion,
      pendingLegacyRecovery: legacyRecoveryPending,
      accounts,
      journals,
      receivables,
      closures,
    }));
  }, [accounts, journals, receivables, closures, legacyRecoveryPending]);

  const clearSharedState = useCallback(() => {
    clearSharedSessionKey();
    clearStoredData();
    setAccounts([]);
    setJournals([]);
    setReceivables([]);
    setClosures([]);
    setCurrentUser(null);
    setLegacyRecoveryPending(false);
    setSharedSessionKey(null);
    syncQueueRef.current = [];
    setSyncQueue([]);
  }, []);

  const loadSharedData = useCallback(async (isActive: () => boolean = () => true): Promise<void> => {
    if (!isActive()) return;
    setConnectionMode('loading');
    try {
      const session = await fetch('/api/auth/me', { credentials: 'include' });
      if (!session.ok) {
        if (session.status === 401 || session.status === 403) {
          clearRemoteSessionHint();
          if (isActive()) {
            clearSharedState();
            setCanRetrySharedConnection(false);
          }
        } else if (isActive()) {
          setCanRetrySharedConnection(true);
        }
        if (isActive()) setConnectionMode('local');
        return;
      }

      const sessionPayload = await session.json() as { user?: unknown | null };
      if (!sessionPayload.user) {
        clearRemoteSessionHint();
        if (isActive()) {
          clearSharedState();
          setCanRetrySharedConnection(false);
          setConnectionMode('local');
        }
        return;
      }

      setRemoteSessionHint();
      if (isActive()) {
        setCurrentUser(sessionPayload.user as SharedUser);
        setCanRetrySharedConnection(true);
        setLegacyRecoveryPending(false);
      }

      const sharedUser = sessionPayload.user as SharedUser;
      if (!sharedUser.subscription?.accessActive) {
        if (isActive()) setConnectionMode('remote');
        return;
      }
      const sessionKey = String(sharedUser.organizationId);
      setSharedSessionKey(sessionKey);
      localStorage.setItem(sharedSessionKeyStorageKey, sessionKey);
      const storedQueue = readSyncQueue(sessionKey);
      const queue = storedQueue.filter((operation) => operation.dataGeneration === sharedUser.dataGeneration);
      if (queue.length !== storedQueue.length) writeSyncQueue(sessionKey, queue);
      syncQueueRef.current = queue;
      setSyncQueue(queue);
      await flushSyncQueue(sessionKey, queue);
      const canReadAccounting = sharedUser.roleId === 'owner' || sharedUser.permissions.accounting === true;
      const [accountResult, journalResult, receivableResult, closureResult] = await Promise.all([
        canReadAccounting ? initializeAccounts(sharedUser.dataGeneration) : Promise.resolve([]),
        canReadAccounting ? getRecords<Journal>('journalEntries') : Promise.resolve([]),
        canReadAccounting ? getRecords<Receivable>('receivables') : Promise.resolve([]),
        canReadAccounting ? getRecords<FinancialClosure>('financialClosures') : Promise.resolve([]),
      ]);
      if (!isActive()) return;
      const queueAfterSync = syncQueueRef.current;
      setAccounts((current) => mergeQueuedRecords(accountResult.map(normalizeAccount), current, queueAfterSync, 'accounts'));
      setJournals((current) => mergeQueuedRecords(journalResult.map(normalizeJournal), current, queueAfterSync, 'journalEntries'));
      setReceivables((current) => mergeQueuedRecords(receivableResult.map(normalizeReceivable), current, queueAfterSync, 'receivables'));
      setClosures(closureResult.map(normalizeClosure));
      setConnectionMode('remote');
    } catch {
      // Keep a known shared-session hint after transport or data-load failures.
      // The user can reconnect without logging in again when the service returns.
      if (isActive()) {
        setCanRetrySharedConnection(true);
        setConnectionMode('local');
      }
    }
  }, [clearSharedState, flushSyncQueue]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      clearRemoteSessionHint();
      clearSharedState();
      setConnectionMode('local');
      setCanRetrySharedConnection(false);
    }
  }, [clearSharedState]);

  useEffect(() => {
    if (!hasRemoteSessionHint() && !needsLegacySessionMigration) return;
    let active = true;
    void loadSharedData(() => active);
    return () => { active = false; };
  }, [loadSharedData, needsLegacySessionMigration]);

  useEffect(() => {
    if (!canRetrySharedConnection) return;
    const reconnect = () => { void loadSharedData(); };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [canRetrySharedConnection, loadSharedData]);

  useEffect(() => {
    const refreshAfterRestore = () => { void loadSharedData(); };
    window.addEventListener(staleDataGenerationEvent, refreshAfterRestore);
    return () => window.removeEventListener(staleDataGenerationEvent, refreshAfterRestore);
  }, [loadSharedData]);

  const currentDataGeneration = (): number => {
    if (!currentUser) throw new Error('تعذر التحقق من إصدار بيانات المنشأة.');
    return currentUser.dataGeneration;
  };

  const addAccount = async (account: Omit<Account, 'id'>) => {
    if (connectionMode === 'remote') {
      const created = normalizeAccount(await createRecord<Account>('accounts', account, currentDataGeneration()));
      setAccounts((current) => [...current, created]);
      return;
    }
    const id = crypto.randomUUID();
    setAccounts((current) => [...current, { ...account, id }]);
    if (connectionMode === 'local' && canRetrySharedConnection) {
      enqueueSyncOperation({ table: 'accounts', action: 'create', recordId: id, data: account as Record<string, unknown> });
    }
  };

  const updateAccount = async (id: string, account: Partial<Account>) => {
    if (connectionMode === 'remote') {
      const updated = normalizeAccount(await updateRecord<Account>('accounts', id, account, currentDataGeneration()));
      setAccounts((current) => current.map((item) => item.id === id ? updated : item));
      return;
    }
    setAccounts((current) => current.map(a => a.id === id ? { ...a, ...account } : a));
    if (connectionMode === 'local' && canRetrySharedConnection) {
      enqueueSyncOperation({ table: 'accounts', action: 'update', recordId: id, data: account as Record<string, unknown> });
    }
  };

  const addJournal = async (journal: Omit<Journal, 'id' | 'number'>) => {
    if (closures.some((closure) => journal.date >= closure.from && journal.date <= closure.to)) return;
    const id = crypto.randomUUID();
    const localJournal = { ...journal, id, number: `J-${(journals.length + 1).toString().padStart(4, '0')}` };
    setJournals((current) => {
      const next = current.length + 1;
      return [...current, { ...localJournal, number: `J-${next.toString().padStart(4, '0')}` }];
    });
    const { id: _localId, ...journalForSync } = localJournal;
    const queuedOperation = (connectionMode === 'remote' || canRetrySharedConnection)
      ? enqueueSyncOperation({ table: 'journalEntries', action: 'create', recordId: id, data: journalForSync as Record<string, unknown> })
      : null;

    if (connectionMode === 'remote' && queuedOperation) {
      try {
        const created = normalizeJournal(await createRecord<Journal>('journalEntries', queuedOperation.data, queuedOperation.dataGeneration));
        setJournals((current) => current.map((item) => item.id === id ? created : item));
        completeCreatedSyncOperation(queuedOperation, created.id);
      } catch (error) {
        failSyncOperation(queuedOperation, error);
        setCanRetrySharedConnection(true);
        setConnectionMode('local');
      }
    }
  };

  const updateJournal = async (id: string, journal: Partial<Journal>) => {
    setJournals((current) => current.map(j => j.id === id ? { ...j, ...journal } : j));
    const queuedOperation = (connectionMode === 'remote' || canRetrySharedConnection)
      ? enqueueSyncOperation({ table: 'journalEntries', action: 'update', recordId: id, data: journal as Record<string, unknown> })
      : null;

    if (connectionMode === 'remote' && queuedOperation) {
      try {
        const updated = normalizeJournal(await updateRecord<Journal>('journalEntries', id, queuedOperation.data, queuedOperation.dataGeneration, queuedOperation.id));
        setJournals((current) => current.map((item) => item.id === id ? updated : item));
        completeSyncOperation(queuedOperation);
      } catch (error) {
        failSyncOperation(queuedOperation, error);
        setCanRetrySharedConnection(true);
        setConnectionMode('local');
      }
    }
  };

  const postJournal = async (id: string) => {
    const journal = journals.find(j => j.id === id);
    if (!journal || journal.status === 'posted') return;
    if (closures.some((closure) => journal.date >= closure.from && journal.date <= closure.to)) return;
    if (connectionMode === 'remote') {
      const queuedOperation = enqueueSyncOperation({
        table: 'journalEntries',
        action: 'update',
        recordId: id,
        data: { status: 'posted' },
      });
      setJournals((current) => current.map((item) => item.id === id ? { ...item, status: 'posted' } : item));
      if (!queuedOperation) return;
      try {
        const updated = normalizeJournal(await updateRecord<Journal>('journalEntries', id, queuedOperation.data, queuedOperation.dataGeneration, queuedOperation.id));
        setJournals((current) => current.map((item) => item.id === id ? updated : item));
        completeSyncOperation(queuedOperation);
      } catch (error) {
        failSyncOperation(queuedOperation, error);
        setCanRetrySharedConnection(true);
        setConnectionMode('local');
      }
      return;
    }
    
    // Update account balances
    const accountsUpdate = [...accounts];
    journal.lines.forEach(line => {
      const accIndex = accountsUpdate.findIndex(a => a.id === line.accountId);
      if (accIndex !== -1) {
        const acc = accountsUpdate[accIndex];
        // Simplified balance logic for demonstration.
        // In real accounting, asset/expense increase with debit, liability/equity/revenue increase with credit.
        let balanceChange = 0;
        if (acc.type === 'asset' || acc.type === 'expense') {
          balanceChange = line.debit - line.credit;
        } else {
          balanceChange = line.credit - line.debit;
        }
        accountsUpdate[accIndex] = { ...acc, balance: acc.balance + balanceChange };
      }
    });

    setAccounts(accountsUpdate);
    setJournals((current) => current.map(item => item.id === id ? { ...item, status: 'posted' } : item));
    if (connectionMode === 'local' && canRetrySharedConnection) {
      enqueueSyncOperation({ table: 'journalEntries', action: 'update', recordId: id, data: { status: 'posted' } });
    }
  };

  const adjustJournal = async (id: string, action: 'reverse' | 'correct', input: JournalAdjustmentInput, operationId: string) => {
    if (connectionMode !== 'remote') {
      throw new Error('عكس وتصحيح القيود يتطلب الاتصال بسجل المنشأة لضمان الذرية وسجل التدقيق.');
    }
    const response = await fetch(`/api/accounting/journals/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': operationId,
        'X-Wudooh-Data-Generation': String(currentDataGeneration()),
      },
      body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({})) as {
      reversal?: Journal;
      correction?: Journal;
      error?: string;
    };
    if (!response.ok || !payload.reversal) {
      notifyStaleDataGeneration(response, payload.error);
      throw new Error(payload.error ?? 'تعذر عكس أو تصحيح القيد.');
    }
    const reversal = normalizeJournal(payload.reversal);
    const correction = payload.correction ? normalizeJournal(payload.correction) : undefined;
    setJournals((current) => [
      ...current,
      reversal,
      ...(correction ? [correction] : []),
    ]);
    return { reversal, ...(correction ? { correction } : {}) };
  };

  const addReceivable = async (receivable: Omit<Receivable, 'id'>) => {
    if (connectionMode === 'remote') {
      const created = normalizeReceivable(await createRecord<Receivable>('receivables', receivable, currentDataGeneration()));
      setReceivables((current) => [...current, created]);
      return;
    }
    const id = crypto.randomUUID();
    setReceivables((current) => [...current, { ...receivable, id }]);
    if (connectionMode === 'local' && canRetrySharedConnection) {
      enqueueSyncOperation({ table: 'receivables', action: 'create', recordId: id, data: receivable as Record<string, unknown> });
    }
  };

  const updateReceivable = async (id: string, receivable: Partial<Receivable>) => {
    if (connectionMode === 'remote') {
      const updated = normalizeReceivable(await updateRecord<Receivable>('receivables', id, receivable, currentDataGeneration()));
      setReceivables((current) => current.map((item) => item.id === id ? updated : item));
      return;
    }
    setReceivables((current) => current.map(r => r.id === id ? { ...r, ...receivable } : r));
    if (connectionMode === 'local' && canRetrySharedConnection) {
      enqueueSyncOperation({ table: 'receivables', action: 'update', recordId: id, data: receivable as Record<string, unknown> });
    }
  };

  const payReceivable = async (id: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const currentRecord = receivables.find((item) => item.id === id);
    if (!currentRecord) return;
    const paid = Math.min(currentRecord.amount, currentRecord.paid + amount);
    const status: Receivable['status'] = paid >= currentRecord.amount ? 'paid' : 'partial';
    if (connectionMode === 'remote') {
      const updated = normalizeReceivable(await updateRecord<Receivable>('receivables', id, { paid, status }, currentDataGeneration()));
      setReceivables((current) => current.map((item) => item.id === id ? updated : item));
      return;
    }
    setReceivables((current) => current.map(r => {
      if (r.id === id) {
        const newPaid = Math.min(r.amount, r.paid + amount);
        let newStatus: Receivable['status'] = 'partial';
        if (newPaid >= r.amount) newStatus = 'paid';
        else if (newPaid === 0) newStatus = 'unpaid';
        return { ...r, paid: newPaid, status: newStatus };
      }
      return r;
    }));
    if (connectionMode === 'local' && canRetrySharedConnection) {
      enqueueSyncOperation({ table: 'receivables', action: 'update', recordId: id, data: { paid, status } });
    }
  };

  const closePeriod = async (from: string, to: string): Promise<FinancialClosure> => {
    if (from > to) throw new Error('تأكد من أن تاريخ بداية الفترة قبل تاريخ النهاية.');
    if (closures.some((closure) => from <= closure.to && to >= closure.from)) {
      throw new Error('تتداخل هذه الفترة مع إقفال مالي قائم.');
    }
    if (connectionMode === 'remote') {
      const response = await fetch('/api/accounting/close', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentDataGeneration()),
        },
        body: JSON.stringify({ from, to, confirmation: 'CLOSE_PERIOD' }),
      });
      const payload = await response.json() as { closure?: FinancialClosure; error?: string };
      if (!response.ok || !payload.closure) {
        notifyStaleDataGeneration(response, payload.error);
        throw new Error(payload.error ?? 'تعذر إقفال الفترة.');
      }
      const closure = normalizeClosure(payload.closure);
      setClosures((current) => [closure, ...current]);
      return closure;
    }
    throw new Error('سجّل الدخول أولاً لاعتماد الإقفال في سجل المنشأة.');
  };

  const retrySharedConnection = useCallback(async (): Promise<void> => {
    if (sharedSessionKey && syncQueueRef.current.some((operation) => operation.status === 'failed')) {
      persistSyncQueue(sharedSessionKey, syncQueueRef.current.map((operation) => ({
        ...operation,
        status: 'pending',
        error: undefined,
      })));
    }
    await loadSharedData();
  }, [loadSharedData, persistSyncQueue, sharedSessionKey]);

  const clearPendingSyncOperations = useCallback((): void => {
    if (!sharedSessionKey) return;
    syncQueueRef.current = [];
    setSyncQueue([]);
    writeSyncQueue(sharedSessionKey, []);
  }, [sharedSessionKey]);

  return (
    <StoreContext.Provider value={{
      currentUser, signOut,
      refreshSession: loadSharedData,
      accounts, addAccount, updateAccount,
      journals, addJournal, updateJournal, postJournal, adjustJournal,
      receivables, addReceivable, updateReceivable, payReceivable,
      closures, closePeriod, connectionMode, canRetrySharedConnection,
      syncQueue,
      retrySharedConnection,
       flushPendingSyncOperations,
       clearPendingSyncOperations,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
}

async function getRecords<T>(table: string): Promise<T[]> {
  const response = await fetch(`/api/data/${table}`, { credentials: 'include' });
  if (!response.ok) throw new Error('تعذر تحميل بيانات المحاسبة.');
  const payload = await response.json() as { records?: T[] };
  return payload.records ?? [];
}

async function initializeAccounts(dataGeneration: number): Promise<Account[]> {
  const response = await fetch('/api/accounting/initialize', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-Wudooh-Data-Generation': String(dataGeneration),
    },
  });
  const payload = await response.json() as { accounts?: Account[]; error?: string };
  if (!response.ok || !Array.isArray(payload.accounts)) {
    notifyStaleDataGeneration(response, payload.error);
    throw new Error(payload.error ?? 'تعذر تهيئة دليل الحسابات.');
  }
  return payload.accounts;
}

async function createRecord<T>(table: string, data: unknown, dataGeneration: number): Promise<T> {
  const response = await fetch(`/api/data/${table}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Wudooh-Data-Generation': String(dataGeneration),
    },
    body: JSON.stringify(data),
  });
  const payload = await response.json() as { record?: T; error?: string };
  if (!response.ok || !payload.record) {
    notifyStaleDataGeneration(response, payload.error);
    throw new Error(payload.error ?? 'تعذر حفظ السجل.');
  }
  return payload.record;
}

async function updateRecord<T>(table: string, id: string, data: unknown, dataGeneration: number, operationId?: string): Promise<T> {
  const response = await fetch(`/api/data/${table}/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Wudooh-Data-Generation': String(dataGeneration),
      ...(operationId ? { 'Idempotency-Key': operationId } : {}),
    },
    body: JSON.stringify(data),
  });
  const payload = await response.json() as { record?: T; error?: string };
  if (!response.ok || !payload.record) {
    notifyStaleDataGeneration(response, payload.error);
    throw new Error(payload.error ?? 'تعذر تحديث السجل.');
  }
  return payload.record;
}

function notifyStaleDataGeneration(response: Response, error?: string): void {
  if (response.status !== 409 || !error?.includes('تغيّرت بيانات المنشأة')) return;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(staleDataGenerationEvent));
}

function normalizeAccount(account: Account): Account {
  return {
    ...account,
    id: String(account.id),
    ...(account.openingBalance == null ? {} : { openingBalance: Number(account.openingBalance) }),
    balance: Number(account.balance ?? 0),
  };
}

function normalizeJournal(journal: Journal): Journal {
  return {
    ...journal,
    id: String(journal.id),
    ...(journal.sourceId == null ? {} : { sourceId: String(journal.sourceId) }),
    ...(journal.adjustsJournalId == null ? {} : { adjustsJournalId: String(journal.adjustsJournalId) }),
    ...(Array.isArray(journal.adjustedByJournalIds) ? { adjustedByJournalIds: journal.adjustedByJournalIds.map(String) } : {}),
    lines: journal.lines.map((line) => ({ ...line, id: String(line.id), accountId: String(line.accountId), debit: Number(line.debit), credit: Number(line.credit) })),
  };
}

function normalizeReceivable(receivable: Receivable): Receivable {
  return { ...receivable, id: String(receivable.id), amount: Number(receivable.amount), paid: Number(receivable.paid) };
}

function normalizeRecord(table: SyncOperation['table'], record: Record<string, unknown>): Account | Journal | Receivable {
  if (table === 'accounts') return normalizeAccount(record as unknown as Account);
  if (table === 'journalEntries') return normalizeJournal(record as unknown as Journal);
  return normalizeReceivable(record as unknown as Receivable);
}

function replaceLocalRecord(
  table: SyncOperation['table'],
  oldId: string,
  record: Account | Journal | Receivable,
  setters: {
    accounts: React.Dispatch<React.SetStateAction<Account[]>>;
    journals: React.Dispatch<React.SetStateAction<Journal[]>>;
    receivables: React.Dispatch<React.SetStateAction<Receivable[]>>;
  },
): void {
  if (table === 'accounts') {
    const account = record as Account;
    setters.accounts((current) => current.map((item) => item.id === oldId ? account : item));
    if (account.id !== oldId) {
      setters.journals((current) => current.map((journal) => replaceValue(journal, oldId, account.id) as Journal));
      setters.receivables((current) => current.map((receivable) => replaceValue(receivable, oldId, account.id) as Receivable));
    }
    return;
  }
  if (table === 'journalEntries') {
    const journal = record as Journal;
    setters.journals((current) => current.map((item) => item.id === oldId ? journal : item));
    return;
  }
  const receivable = record as Receivable;
  setters.receivables((current) => current.map((item) => item.id === oldId ? receivable : item));
}

function replaceValue(value: unknown, oldValue: string, newValue: string): unknown {
  if (value === oldValue) return newValue;
  if (Array.isArray(value)) return value.map((item) => replaceValue(item, oldValue, newValue));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceValue(item, oldValue, newValue)]));
  }
  return value;
}

function mergeQueuedRecords<T extends { id: string }>(
  remoteRecords: T[],
  localRecords: T[],
  queue: SyncOperation[],
  table: SyncOperation['table'],
): T[] {
  const result = [...remoteRecords];
  for (const operation of queue.filter((item) => item.table === table)) {
    const localRecord = localRecords.find((item) => item.id === operation.recordId);
    const remoteIndex = result.findIndex((item) => item.id === operation.recordId);
    if (operation.action === 'create') {
      if (localRecord && remoteIndex === -1) result.push(localRecord);
      continue;
    }
    const currentRecord = remoteIndex === -1 ? localRecord : result[remoteIndex];
    if (!currentRecord) continue;
    const queuedRecord = { ...currentRecord, ...(localRecord ?? {}), ...operation.data } as T;
    if (remoteIndex === -1) result.push(queuedRecord);
    else result[remoteIndex] = queuedRecord;
  }
  return result;
}

function normalizeClosure(closure: FinancialClosure): FinancialClosure {
  return { ...closure, id: String(closure.id), netIncome: Number(closure.netIncome), totals: { ...closure.totals, revenue: Number(closure.totals.revenue), expense: Number(closure.totals.expense), netIncome: Number(closure.totals.netIncome) } };
}

function readStoredData(): { accounts: Account[]; journals: Journal[]; receivables: Receivable[]; closures: FinancialClosure[] } | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<{ accounts: Account[]; journals: Journal[]; receivables: Receivable[]; closures: FinancialClosure[] }>;
    return Array.isArray(data.accounts) && Array.isArray(data.journals) && Array.isArray(data.receivables)
      ? { accounts: migrateLegacyLocalOpeningBalances(data.accounts, data.journals), journals: data.journals, receivables: data.receivables, closures: Array.isArray(data.closures) ? data.closures : [] }
      : null;
  } catch {
    return null;
  }
}

function hasRemoteSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((cookie) => cookie.trim().startsWith(`${remoteSessionHintCookie}=`));
}

function clearRemoteSessionHint(): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${remoteSessionHintCookie}=; Max-Age=0; Path=/`;
  }
}

function clearStoredData(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(storageKey);
  }
}

function readSharedSessionKey(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(sharedSessionKeyStorageKey);
}

function clearSharedSessionKey(): void {
  const sessionKey = readSharedSessionKey();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(sharedSessionKeyStorageKey);
    if (sessionKey) localStorage.removeItem(getSyncQueueStorageKey(sessionKey));
  }
}

function getSyncQueueStorageKey(sessionKey: string): string {
  return `${syncQueueStoragePrefix}${encodeURIComponent(sessionKey)}`;
}

function readSyncQueue(sessionKey: string): SyncOperation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getSyncQueueStorageKey(sessionKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSyncOperation);
  } catch {
    return [];
  }
}

function writeSyncQueue(sessionKey: string, queue: SyncOperation[]): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(getSyncQueueStorageKey(sessionKey), JSON.stringify(queue));
  }
}

function isSyncOperation(value: unknown): value is SyncOperation {
  if (!value || typeof value !== 'object') return false;
  const operation = value as Partial<SyncOperation>;
  return typeof operation.id === 'string'
    && (operation.table === 'accounts' || operation.table === 'journalEntries' || operation.table === 'receivables')
    && (operation.action === 'create' || operation.action === 'update')
    && typeof operation.recordId === 'string'
    && Boolean(operation.data && typeof operation.data === 'object' && !Array.isArray(operation.data))
    && Number.isSafeInteger(operation.dataGeneration)
    && (operation.status === 'pending' || operation.status === 'failed')
    && typeof operation.createdAt === 'string';
}

function setRemoteSessionHint(): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${remoteSessionHintCookie}=1; Max-Age=${14 * 24 * 60 * 60}; Path=/; SameSite=Lax`;
  }
}

function hasLegacyStoredData(): boolean {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return false;
    const data = JSON.parse(raw) as { version?: unknown; pendingLegacyRecovery?: unknown };
    return data.version !== storedDataVersion || data.pendingLegacyRecovery === true;
  } catch {
    return false;
  }
}
