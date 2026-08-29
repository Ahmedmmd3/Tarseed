import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, operationId } from '@/lib/api';

export type User = {
  id: number;
  organizationId: number;
  projectName: string;
  dataGeneration: number;
  email: string;
  name: string;
  roleId: string;
  permissions: Record<string, boolean>;
  locationScope: string;
  warehouseIds: number[];
  subscription: { status: string; accessActive: boolean };
};
export type Product = {
  id: number;
  name: string;
  sku?: string;
  barcode?: string;
  code?: string;
  price?: number;
  salePrice?: number;
  sellPrice?: number;
  stock?: number;
};
export type Warehouse = { id: number; name: string; status?: string };
export type Balance = { id: number; productId: number; warehouseId: number; quantity: number };
export type Invoice = { id: number | string; number?: string; customerName?: string; issueDate?: string; total?: number; status?: string; paymentMethod?: string };
export type Expense = { id: number | string; description?: string; amount?: number; date?: string; category?: string; vendor?: string };
type Snapshot = { products: Product[]; warehouses: Warehouse[]; balances: Balance[]; invoices: Invoice[]; expenses: Expense[] };
export type CheckoutPayload = {
  warehouseId: number;
  issueDate: string;
  paymentMethod: 'cash' | 'card' | 'credit';
  dueDate?: string;
  customerName?: string;
  clientOperationId: string;
  items: Array<{ productId: number; quantity: number }>;
};
type QueueItem =
  | { id: string; kind: 'checkout'; dataGeneration: number; payload: CheckoutPayload; createdAt: string; status: 'pending' | 'failed'; error?: string }
  | { id: string; kind: 'expense'; dataGeneration: number; payload: Omit<Expense, 'id'> & { clientOperationId: string }; createdAt: string; status: 'pending' | 'failed'; error?: string };

type AppContextValue = Snapshot & {
  user: User | null;
  booting: boolean;
  loading: boolean;
  error: string;
  token: string | null;
  queue: QueueItem[];
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  checkout: (payload: Omit<CheckoutPayload, 'clientOperationId'>) => Promise<{ queued: boolean; invoice?: Invoice }>;
  addExpense: (expense: Omit<Expense, 'id'>) => Promise<{ queued: boolean }>;
  retrySync: () => Promise<void>;
  can: (permission: string) => boolean;
};

const sessionKey = 'tarseed-mobile-session-v1';
const tokenKey = 'tarseed-mobile-token-v1';
const AppContext = createContext<AppContextValue | null>(null);
const emptySnapshot: Snapshot = { products: [], warehouses: [], balances: [], invoices: [], expenses: [] };
const cacheKey = (organizationId: number) => `tarseed-mobile-cache-v1:${organizationId}`;
const queueKey = (organizationId: number) => `tarseed-mobile-queue-v1:${organizationId}`;

async function readSessionToken(): Promise<string | null> {
  return await SecureStore.isAvailableAsync()
    ? SecureStore.getItemAsync(tokenKey)
    : AsyncStorage.getItem(tokenKey);
}

async function saveSessionToken(value: string): Promise<void> {
  if (await SecureStore.isAvailableAsync()) await SecureStore.setItemAsync(tokenKey, value);
  else await AsyncStorage.setItem(tokenKey, value);
}

async function removeSessionToken(): Promise<void> {
  if (await SecureStore.isAvailableAsync()) await SecureStore.deleteItemAsync(tokenKey);
  else await AsyncStorage.removeItem(tokenKey);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const syncPromise = useRef<Promise<void> | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const userRef = useRef<User | null>(null);
  const tokenRef = useRef<string | null>(null);

  const persistQueue = useCallback(async (organizationId: number, next: QueueItem[]) => {
    queueRef.current = next;
    setQueue(next);
    await AsyncStorage.setItem(queueKey(organizationId), JSON.stringify(next));
  }, []);

  const loadRemote = useCallback(async (activeUser: User, activeToken: string) => {
    setLoading(true);
    setError('');
    try {
      const headers = { 'X-Wudooh-Data-Generation': String(activeUser.dataGeneration) };
      const [products, warehouses, balances, invoices, expenses] = await Promise.all([
        apiRequest<{ records: Product[] }>('/api/data/products', { headers }, activeToken),
        apiRequest<{ records: Warehouse[] }>('/api/data/warehouses', { headers }, activeToken),
        apiRequest<{ records: Balance[] }>('/api/data/inventoryBalances', { headers }, activeToken),
        apiRequest<{ records: Invoice[] }>('/api/data/invoices', { headers }, activeToken),
        apiRequest<{ records: Expense[] }>('/api/data/expenses', { headers }, activeToken),
      ]);
      const next = {
        products: products.records,
        warehouses: warehouses.records,
        balances: balances.records,
        invoices: invoices.records,
        expenses: expenses.records,
      };
      setSnapshot(next);
      await AsyncStorage.setItem(cacheKey(activeUser.organizationId), JSON.stringify(next));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحديث بيانات المنشأة.');
    } finally {
      setLoading(false);
    }
  }, []);

  const retrySync = useCallback(async () => {
    if (syncPromise.current) return syncPromise.current;
    const activeUser = userRef.current;
    const activeToken = tokenRef.current;
    if (!activeUser || !activeToken || queueRef.current.length === 0) return;
    const run = async () => {
      let remaining = [...queueRef.current];
      for (const item of remaining) {
        if (item.dataGeneration !== activeUser.dataGeneration) {
          remaining = remaining.map((candidate) => candidate.id === item.id
            ? { ...candidate, status: 'failed', error: 'تغيّر إصدار بيانات المنشأة. راجع العملية قبل إعادة تنفيذها.' }
            : candidate);
          await persistQueue(activeUser.organizationId, remaining);
          break;
        }
        try {
          const headers = { 'X-Wudooh-Data-Generation': String(item.dataGeneration) };
          if (item.kind === 'checkout') {
            await apiRequest('/api/inventory/checkout', {
              method: 'POST', headers, body: JSON.stringify(item.payload),
            }, activeToken);
          } else {
            await apiRequest('/api/data/expenses', {
              method: 'POST', headers, body: JSON.stringify(item.payload),
            }, activeToken);
          }
          remaining = remaining.filter((candidate) => candidate.id !== item.id);
          await persistQueue(activeUser.organizationId, remaining);
        } catch (syncError) {
          remaining = remaining.map((candidate) => candidate.id === item.id
            ? { ...candidate, status: 'failed', error: syncError instanceof Error ? syncError.message : 'تعذرت المزامنة.' }
            : candidate);
          await persistQueue(activeUser.organizationId, remaining);
          break;
        }
      }
      if (remaining.length === 0) await loadRemote(activeUser, activeToken);
    };
    syncPromise.current = run().finally(() => { syncPromise.current = null; });
    return syncPromise.current;
  }, [loadRemote, persistQueue]);

  const establishSession = useCallback(async (nextUser: User, nextToken: string) => {
    userRef.current = nextUser;
    tokenRef.current = nextToken;
    setUser(nextUser);
    setToken(nextToken);
    const [cached, pending] = await Promise.all([
      AsyncStorage.getItem(cacheKey(nextUser.organizationId)),
      AsyncStorage.getItem(queueKey(nextUser.organizationId)),
    ]);
    if (cached) setSnapshot(JSON.parse(cached) as Snapshot);
    const restoredQueue = pending ? JSON.parse(pending) as QueueItem[] : [];
    queueRef.current = restoredQueue.filter((item) => item.dataGeneration === nextUser.dataGeneration);
    setQueue(queueRef.current);
    await Promise.all([
      AsyncStorage.setItem(sessionKey, JSON.stringify({ user: nextUser })),
      saveSessionToken(nextToken),
    ]);
    await loadRemote(nextUser, nextToken);
    void retrySync();
  }, [loadRemote, retrySync]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(sessionKey);
        if (!stored) return;
        const session = JSON.parse(stored) as { user: User };
        const storedToken = await readSessionToken();
        if (!storedToken) {
          await AsyncStorage.removeItem(sessionKey);
          return;
        }
        const result = await apiRequest<{ user: User | null }>('/api/auth/me', {}, storedToken);
        if (active && result.user) await establishSession(result.user, storedToken);
        else await AsyncStorage.removeItem(sessionKey);
      } catch {
        if (active) setError('تعذر التحقق من الجلسة. يمكنك تسجيل الدخول من جديد.');
      } finally {
        if (active) setBooting(false);
      }
    })();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void retrySync();
    });
    return () => { active = false; subscription.remove(); };
  }, [establishSession, retrySync]);

  const login = useCallback(async (identifier: string, password: string) => {
    setError('');
    const result = await apiRequest<{ user: User; sessionToken?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: identifier.trim(), password }),
    });
    if (!result.sessionToken) throw new Error('تعذر إنشاء جلسة التطبيق الآمنة.');
    await establishSession(result.user, result.sessionToken);
    setBooting(false);
  }, [establishSession]);

  const logout = useCallback(async () => {
    try {
      if (tokenRef.current) await apiRequest('/api/auth/logout', { method: 'POST' }, tokenRef.current);
    } finally {
      await Promise.all([AsyncStorage.removeItem(sessionKey), removeSessionToken()]);
      userRef.current = null;
      tokenRef.current = null;
      queueRef.current = [];
      setUser(null);
      setToken(null);
      setQueue([]);
      setSnapshot(emptySnapshot);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!userRef.current || !tokenRef.current) return;
    await retrySync();
    await loadRemote(userRef.current, tokenRef.current);
  }, [loadRemote, retrySync]);

  const checkout = useCallback(async (payload: Omit<CheckoutPayload, 'clientOperationId'>) => {
    if (!userRef.current || !tokenRef.current) throw new Error('سجّل الدخول أولاً.');
    const clientOperationId = operationId();
    const completePayload = { ...payload, clientOperationId };
    const item: QueueItem = {
      id: clientOperationId,
      kind: 'checkout',
      dataGeneration: userRef.current.dataGeneration,
      payload: completePayload,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    await persistQueue(userRef.current.organizationId, [...queueRef.current, item]);
    try {
      const response = await apiRequest<{ invoice: Invoice }>('/api/inventory/checkout', {
        method: 'POST',
        headers: { 'X-Wudooh-Data-Generation': String(userRef.current.dataGeneration) },
        body: JSON.stringify(completePayload),
      }, tokenRef.current);
      await persistQueue(userRef.current.organizationId, queueRef.current.filter((candidate) => candidate.id !== item.id));
      await loadRemote(userRef.current, tokenRef.current);
      return { queued: false, invoice: response.invoice };
    } catch {
      setSnapshot((current) => ({
        ...current,
        balances: current.balances.map((balance) => {
          const sold = payload.items.find((cartItem) => cartItem.productId === balance.productId);
          return sold && balance.warehouseId === payload.warehouseId
            ? { ...balance, quantity: Math.max(0, Number(balance.quantity) - sold.quantity) }
            : balance;
        }),
      }));
      return { queued: true };
    }
  }, [loadRemote, persistQueue]);

  const addExpense = useCallback(async (expense: Omit<Expense, 'id'>) => {
    if (!userRef.current || !tokenRef.current) throw new Error('سجّل الدخول أولاً.');
    const id = operationId();
    const payload = { ...expense, clientOperationId: id };
    const item: QueueItem = {
      id, kind: 'expense', dataGeneration: userRef.current.dataGeneration,
      payload, createdAt: new Date().toISOString(), status: 'pending',
    };
    await persistQueue(userRef.current.organizationId, [...queueRef.current, item]);
    setSnapshot((current) => ({ ...current, expenses: [{ ...expense, id }, ...current.expenses] }));
    try {
      await apiRequest('/api/data/expenses', {
        method: 'POST',
        headers: { 'X-Wudooh-Data-Generation': String(userRef.current.dataGeneration) },
        body: JSON.stringify(payload),
      }, tokenRef.current);
      await persistQueue(userRef.current.organizationId, queueRef.current.filter((candidate) => candidate.id !== id));
      await loadRemote(userRef.current, tokenRef.current);
      return { queued: false };
    } catch {
      return { queued: true };
    }
  }, [loadRemote, persistQueue]);

  const can = useCallback((permission: string) => {
    const active = userRef.current;
    return Boolean(active && (active.roleId === 'owner' || active.permissions[permission] === true));
  }, []);

  const value = useMemo<AppContextValue>(() => ({
    ...snapshot, user, token, queue, booting, loading, error,
    login, logout, refresh, checkout, addExpense, retrySync, can,
  }), [addExpense, booting, can, checkout, error, loading, login, logout, queue, refresh, retrySync, snapshot, token, user]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used within AppProvider');
  return value;
}