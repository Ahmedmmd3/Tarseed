import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parent: string | null;
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
  receivables: Receivable[];
  addReceivable: (receivable: Omit<Receivable, 'id'>) => Promise<void>;
  updateReceivable: (id: string, receivable: Partial<Receivable>) => Promise<void>;
  payReceivable: (id: string, amount: number) => Promise<void>;
  closures: FinancialClosure[];
  closePeriod: (from: string, to: string) => Promise<FinancialClosure>;
  connectionMode: 'loading' | 'remote' | 'local';
  canRetrySharedConnection: boolean;
  retrySharedConnection: () => Promise<void>;
};

export type SharedUser = {
  id: number;
  accountId: number;
  organizationId: number;
  projectName: string;
  email: string;
  name: string;
  roleId: string;
  permissions: Record<string, boolean>;
  locationScope: string;
  warehouseIds: number[];
  status: string;
  isTeamMember: boolean;
};

const demoYear = new Date().getFullYear();
const storageKey = 'wudooh-accounting-data';
const remoteSessionHintCookie = 'wudooh_remote_session';
const storedDataVersion = 2;

const initialAccounts: Account[] = [
  { id: '1', code: '1000', name: 'الصندوق', type: 'asset', parent: null, balance: 5000, status: 'active' },
  { id: '2', code: '1100', name: 'البنك', type: 'asset', parent: null, balance: 58000, status: 'active' },
  { id: '3', code: '1200', name: 'العملاء', type: 'asset', parent: null, balance: 12000, status: 'active' },
  { id: '4', code: '2000', name: 'الموردين', type: 'liability', parent: null, balance: 4000, status: 'active' },
  { id: '5', code: '3000', name: 'رأس المال', type: 'equity', parent: null, balance: 60000, status: 'active' },
  { id: '6', code: '4000', name: 'المبيعات', type: 'revenue', parent: null, balance: 17000, status: 'active' },
  { id: '7', code: '5000', name: 'المشتريات', type: 'expense', parent: null, balance: 4000, status: 'active' },
  { id: '8', code: '5100', name: 'مصروفات الرواتب', type: 'expense', parent: null, balance: 2000, status: 'active' },
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
  const [needsLegacySessionMigration] = useState(() => hasLegacyStoredData());
  const [shouldVerifyRemoteSession] = useState(() => hasRemoteSessionHint() || hasLegacyStoredData());
  const [accounts, setAccounts] = useState<Account[]>(() => shouldVerifyRemoteSession ? [] : readStoredData()?.accounts ?? initialAccounts);
  const [journals, setJournals] = useState<Journal[]>(() => shouldVerifyRemoteSession ? [] : readStoredData()?.journals ?? initialJournals);
  const [receivables, setReceivables] = useState<Receivable[]>(() => shouldVerifyRemoteSession ? [] : readStoredData()?.receivables ?? initialReceivables);
  const [closures, setClosures] = useState<FinancialClosure[]>(() => shouldVerifyRemoteSession ? [] : readStoredData()?.closures ?? []);
  const [connectionMode, setConnectionMode] = useState<'loading' | 'remote' | 'local'>(
    () => shouldVerifyRemoteSession ? 'loading' : 'local',
  );
  const [canRetrySharedConnection, setCanRetrySharedConnection] = useState(
    () => shouldVerifyRemoteSession,
  );
  const [legacyRecoveryPending, setLegacyRecoveryPending] = useState(needsLegacySessionMigration);
  const [currentUser, setCurrentUser] = useState<SharedUser | null>(null);

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
    clearStoredData();
    setAccounts([]);
    setJournals([]);
    setReceivables([]);
    setClosures([]);
    setCurrentUser(null);
    setLegacyRecoveryPending(false);
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
      const canReadAccounting = sharedUser.roleId === 'owner' || sharedUser.permissions.accounting === true;
      const [accountResult, journalResult, receivableResult, closureResult] = await Promise.all([
        canReadAccounting ? getRecords<Account>('accounts') : Promise.resolve([]),
        canReadAccounting ? getRecords<Journal>('journalEntries') : Promise.resolve([]),
        canReadAccounting ? getRecords<Receivable>('receivables') : Promise.resolve([]),
        canReadAccounting ? getRecords<FinancialClosure>('financialClosures') : Promise.resolve([]),
      ]);
      if (!isActive()) return;
      setAccounts(accountResult.map(normalizeAccount));
      setJournals(journalResult.map(normalizeJournal));
      setReceivables(receivableResult.map(normalizeReceivable));
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
  }, [clearSharedState]);

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

  const addAccount = async (account: Omit<Account, 'id'>) => {
    if (connectionMode === 'remote') {
      const created = normalizeAccount(await createRecord<Account>('accounts', account));
      setAccounts((current) => [...current, created]);
      return;
    }
    setAccounts((current) => [...current, { ...account, id: crypto.randomUUID() }]);
  };

  const updateAccount = async (id: string, account: Partial<Account>) => {
    if (connectionMode === 'remote') {
      const updated = normalizeAccount(await updateRecord<Account>('accounts', id, account));
      setAccounts((current) => current.map((item) => item.id === id ? updated : item));
      return;
    }
    setAccounts((current) => current.map(a => a.id === id ? { ...a, ...account } : a));
  };

  const addJournal = async (journal: Omit<Journal, 'id' | 'number'>) => {
    if (closures.some((closure) => journal.date >= closure.from && journal.date <= closure.to)) return;
    if (connectionMode === 'remote') {
      const created = normalizeJournal(await createRecord<Journal>('journalEntries', journal));
      setJournals((current) => [...current, created]);
      return;
    }
    setJournals((current) => {
      const next = current.length + 1;
      return [...current, { ...journal, id: crypto.randomUUID(), number: `J-${next.toString().padStart(4, '0')}` }];
    });
  };

  const updateJournal = async (id: string, journal: Partial<Journal>) => {
    if (connectionMode === 'remote') {
      const updated = normalizeJournal(await updateRecord<Journal>('journalEntries', id, journal));
      setJournals((current) => current.map((item) => item.id === id ? updated : item));
      return;
    }
    setJournals((current) => current.map(j => j.id === id ? { ...j, ...journal } : j));
  };

  const postJournal = async (id: string) => {
    const journal = journals.find(j => j.id === id);
    if (!journal || journal.status === 'posted') return;
    if (closures.some((closure) => journal.date >= closure.from && journal.date <= closure.to)) return;
    if (connectionMode === 'remote') {
      const updated = normalizeJournal(await updateRecord<Journal>('journalEntries', id, { status: 'posted' }));
      setJournals((current) => current.map((item) => item.id === id ? updated : item));
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
  };

  const addReceivable = async (receivable: Omit<Receivable, 'id'>) => {
    if (connectionMode === 'remote') {
      const created = normalizeReceivable(await createRecord<Receivable>('receivables', receivable));
      setReceivables((current) => [...current, created]);
      return;
    }
    setReceivables((current) => [...current, { ...receivable, id: crypto.randomUUID() }]);
  };

  const updateReceivable = async (id: string, receivable: Partial<Receivable>) => {
    if (connectionMode === 'remote') {
      const updated = normalizeReceivable(await updateRecord<Receivable>('receivables', id, receivable));
      setReceivables((current) => current.map((item) => item.id === id ? updated : item));
      return;
    }
    setReceivables((current) => current.map(r => r.id === id ? { ...r, ...receivable } : r));
  };

  const payReceivable = async (id: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const currentRecord = receivables.find((item) => item.id === id);
    if (!currentRecord) return;
    const paid = Math.min(currentRecord.amount, currentRecord.paid + amount);
    const status: Receivable['status'] = paid >= currentRecord.amount ? 'paid' : 'partial';
    if (connectionMode === 'remote') {
      const updated = normalizeReceivable(await updateRecord<Receivable>('receivables', id, { paid, status }));
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const payload = await response.json() as { closure?: FinancialClosure; error?: string };
      if (!response.ok || !payload.closure) throw new Error(payload.error ?? 'تعذر إقفال الفترة.');
      const closure = normalizeClosure(payload.closure);
      setClosures((current) => [closure, ...current]);
      return closure;
    }
    throw new Error('سجّل الدخول أولاً لاعتماد الإقفال في سجل المنشأة.');
  };

  return (
    <StoreContext.Provider value={{
      currentUser, signOut,
      accounts, addAccount, updateAccount,
      journals, addJournal, updateJournal, postJournal,
      receivables, addReceivable, updateReceivable, payReceivable,
      closures, closePeriod, connectionMode, canRetrySharedConnection,
      retrySharedConnection: loadSharedData,
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

async function createRecord<T>(table: string, data: unknown): Promise<T> {
  const response = await fetch(`/api/data/${table}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const payload = await response.json() as { record?: T; error?: string };
  if (!response.ok || !payload.record) throw new Error(payload.error ?? 'تعذر حفظ السجل.');
  return payload.record;
}

async function updateRecord<T>(table: string, id: string, data: unknown): Promise<T> {
  const response = await fetch(`/api/data/${table}/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const payload = await response.json() as { record?: T; error?: string };
  if (!response.ok || !payload.record) throw new Error(payload.error ?? 'تعذر تحديث السجل.');
  return payload.record;
}

function normalizeAccount(account: Account): Account {
  return { ...account, id: String(account.id), balance: Number(account.balance ?? 0) };
}

function normalizeJournal(journal: Journal): Journal {
  return { ...journal, id: String(journal.id), lines: journal.lines.map((line) => ({ ...line, id: String(line.id), accountId: String(line.accountId), debit: Number(line.debit), credit: Number(line.credit) })) };
}

function normalizeReceivable(receivable: Receivable): Receivable {
  return { ...receivable, id: String(receivable.id), amount: Number(receivable.amount), paid: Number(receivable.paid) };
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
      ? { accounts: data.accounts, journals: data.journals, receivables: data.receivables, closures: Array.isArray(data.closures) ? data.closures : [] }
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
