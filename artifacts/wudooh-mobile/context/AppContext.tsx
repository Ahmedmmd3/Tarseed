import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
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
export type ExpiringPurchaseOrderShare = {
  purchaseOrderId: number;
  shareId: number;
  orderNumber: string;
  supplierName: string;
  expiresAt: string;
  hoursRemaining: number;
};
type Snapshot = {
  products: Product[];
  warehouses: Warehouse[];
  balances: Balance[];
  invoices: Invoice[];
  expenses: Expense[];
  purchaseOrderShareAlerts: ExpiringPurchaseOrderShare[];
};
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
  purchaseOrderShareAlertsError: string;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  rotatePurchaseOrderShare: (purchaseOrderId: number) => Promise<void>;
  revokePurchaseOrderShare: (purchaseOrderId: number) => Promise<void>;
  checkout: (payload: Omit<CheckoutPayload, 'clientOperationId'>) => Promise<{ queued: boolean; invoice?: Invoice }>;
  addExpense: (expense: Omit<Expense, 'id'>) => Promise<{ queued: boolean }>;
  retrySync: () => Promise<void>;
  can: (permission: string) => boolean;
};

const sessionKey = 'tarseed-mobile-session-v1';
const tokenKey = 'tarseed-mobile-token-v1';
const AppContext = createContext<AppContextValue | null>(null);
const emptySnapshot: Snapshot = {
  products: [],
  warehouses: [],
  balances: [],
  invoices: [],
  expenses: [],
  purchaseOrderShareAlerts: [],
};
const cacheKey = (organizationId: number) => `tarseed-mobile-cache-v1:${organizationId}`;
const queueKey = (organizationId: number) => `tarseed-mobile-queue-v1:${organizationId}`;
const shareNotificationKey = (organizationId: number) => `tarseed-mobile-share-notifications-v1:${organizationId}`;
const shareNotificationType = 'purchase-order-share-expiry';
const shareNotificationLeadTimeMs = 24 * 60 * 60 * 1000;
const shareNotificationChannelId = 'supplier-share-expiry';
const shareNotificationSyncs = new Map<number, Promise<void>>();

type PurchaseOrderShareNotification = {
  purchaseOrderId: number;
  shareId: number;
  notificationId: string;
};

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

function apiErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

async function readShareNotificationRecords(organizationId: number): Promise<PurchaseOrderShareNotification[]> {
  if (Platform.OS === 'web') return [];
  try {
    const stored = await AsyncStorage.getItem(shareNotificationKey(organizationId));
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is PurchaseOrderShareNotification => (
      Boolean(record)
      && typeof record === 'object'
      && Number.isInteger((record as PurchaseOrderShareNotification).purchaseOrderId)
      && Number.isInteger((record as PurchaseOrderShareNotification).shareId)
      && typeof (record as PurchaseOrderShareNotification).notificationId === 'string'
    ));
  } catch {
    return [];
  }
}

async function writeShareNotificationRecords(organizationId: number, records: PurchaseOrderShareNotification[]): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await AsyncStorage.setItem(shareNotificationKey(organizationId), JSON.stringify(records));
  } catch {
    // A failed local cache write must not interrupt a successful API refresh.
  }
}

async function cancelShareNotifications(records: PurchaseOrderShareNotification[]): Promise<void> {
  if (Platform.OS === 'web') return;
  await Promise.all(records.map(async (record) => {
    try {
      await Notifications.cancelScheduledNotificationAsync(record.notificationId);
    } catch {
      // The notification may already have fired or been removed by the OS.
    }
  }));
}

async function clearShareNotifications(organizationId: number): Promise<void> {
  if (Platform.OS === 'web') return;
  const records = await readShareNotificationRecords(organizationId);
  await cancelShareNotifications(records);
  await writeShareNotificationRecords(organizationId, []);
}

async function cancelPurchaseOrderShareNotifications(organizationId: number, purchaseOrderId: number): Promise<void> {
  if (Platform.OS === 'web') return;
  const records = await readShareNotificationRecords(organizationId);
  const matching = records.filter((record) => record.purchaseOrderId === purchaseOrderId);
  await cancelShareNotifications(matching);
  await writeShareNotificationRecords(
    organizationId,
    records.filter((record) => record.purchaseOrderId !== purchaseOrderId),
  );
}

async function syncShareNotificationsNow(
  organizationId: number,
  alerts: ExpiringPurchaseOrderShare[],
  isSessionActive: () => boolean,
): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!isSessionActive()) return;

  const stored = await readShareNotificationRecords(organizationId);
  if (!isSessionActive()) return;
  const byPurchaseOrder = new Map(alerts.map((alert) => [alert.purchaseOrderId, alert]));
  const obsolete = stored.filter((record) => {
    const alert = byPurchaseOrder.get(record.purchaseOrderId);
    return !alert || alert.shareId !== record.shareId;
  });
  await cancelShareNotifications(obsolete);
  if (!isSessionActive()) return;
  let next = stored.filter((record) => !obsolete.includes(record));

  if (alerts.length === 0) {
    await writeShareNotificationRecords(organizationId, []);
    return;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(shareNotificationChannelId, {
      name: 'تنبيهات روابط الموردين',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    await cancelShareNotifications(next);
    await writeShareNotificationRecords(organizationId, []);
    return;
  }

  const now = Date.now();
  for (const alert of alerts) {
    if (!isSessionActive()) return;
    if (next.some((record) => record.purchaseOrderId === alert.purchaseOrderId && record.shareId === alert.shareId)) {
      continue;
    }
    const expiresAt = Date.parse(alert.expiresAt);
    if (!Number.isFinite(expiresAt)) continue;
    const scheduleAt = Math.max(now + 60 * 1000, expiresAt - shareNotificationLeadTimeMs);
    if (scheduleAt >= expiresAt) continue;

    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'رابط المورد ينتهي قريباً',
          body: `رابط المورد لأمر شراء ${alert.orderNumber} ينتهي خلال أقل من 24 ساعة.`,
          data: {
            type: shareNotificationType,
            organizationId,
            purchaseOrderId: alert.purchaseOrderId,
            shareId: alert.shareId,
          },
          sound: false,
          ...(Platform.OS === 'android' ? { channelId: shareNotificationChannelId } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(scheduleAt),
        },
      });
      next = [
        ...next,
        {
          purchaseOrderId: alert.purchaseOrderId,
          shareId: alert.shareId,
          notificationId,
        },
      ];
    } catch {
      // The alert remains visible in the app even if the OS rejects scheduling.
    }
  }
  if (!isSessionActive()) return;
  await writeShareNotificationRecords(organizationId, next);
}

async function syncShareNotifications(
  organizationId: number,
  alerts: ExpiringPurchaseOrderShare[],
  isSessionActive: () => boolean,
): Promise<void> {
  const previous = shareNotificationSyncs.get(organizationId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => syncShareNotificationsNow(organizationId, alerts, isSessionActive));
  shareNotificationSyncs.set(organizationId, current);
  try {
    await current;
  } finally {
    if (shareNotificationSyncs.get(organizationId) === current) shareNotificationSyncs.delete(organizationId);
  }
}

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
  const [purchaseOrderShareAlertsError, setPurchaseOrderShareAlertsError] = useState('');
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
    setPurchaseOrderShareAlertsError('');
    try {
      const headers = { 'X-Wudooh-Data-Generation': String(activeUser.dataGeneration) };
      const canReadPurchaseOrders = activeUser.roleId === 'owner' || activeUser.permissions.inventory === true;
      const shareAlertsPromise: Promise<ExpiringPurchaseOrderShare[] | null> = canReadPurchaseOrders
        ? apiRequest<{ alerts?: ExpiringPurchaseOrderShare[] }>('/api/data/purchaseOrderShares/expiring', { headers }, activeToken)
          .then((payload) => Array.isArray(payload.alerts) ? payload.alerts : [])
          .catch((alertsError: unknown) => {
            setPurchaseOrderShareAlertsError(alertsError instanceof Error
              ? alertsError.message
              : 'تعذر تحميل تنبيهات روابط الموردين.');
            return null;
          })
        : Promise.resolve([]);
      const notificationSchedulesPromise: Promise<ExpiringPurchaseOrderShare[] | null> = canReadPurchaseOrders
        ? apiRequest<{ alerts?: ExpiringPurchaseOrderShare[] }>('/api/data/purchaseOrderShares/notification-schedules', { headers }, activeToken)
          .then(async (payload) => {
            const schedules = Array.isArray(payload.alerts) ? payload.alerts : [];
            if (tokenRef.current === activeToken) {
              await syncShareNotifications(
                activeUser.organizationId,
                schedules,
                () => tokenRef.current === activeToken,
              );
            }
            return schedules;
          })
          .catch((scheduleError: unknown) => {
            const status = apiErrorStatus(scheduleError);
            if (status === 401 || status === 403) void clearShareNotifications(activeUser.organizationId);
            return null;
          })
        : clearShareNotifications(activeUser.organizationId).then(() => []);
      const [products, warehouses, balances, invoices, expenses, shareAlerts] = await Promise.all([
        apiRequest<{ records: Product[] }>('/api/data/products', { headers }, activeToken),
        apiRequest<{ records: Warehouse[] }>('/api/data/warehouses', { headers }, activeToken),
        apiRequest<{ records: Balance[] }>('/api/data/inventoryBalances', { headers }, activeToken),
        apiRequest<{ records: Invoice[] }>('/api/data/invoices', { headers }, activeToken),
        apiRequest<{ records: Expense[] }>('/api/data/expenses', { headers }, activeToken),
        shareAlertsPromise,
        notificationSchedulesPromise,
      ]);
      const next = {
        products: products.records,
        warehouses: warehouses.records,
        balances: balances.records,
        invoices: invoices.records,
        expenses: expenses.records,
      };
      if (tokenRef.current !== activeToken) return;
      setSnapshot((current) => ({
        ...next,
        purchaseOrderShareAlerts: shareAlerts ?? current.purchaseOrderShareAlerts,
      }));
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
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<Snapshot>;
      setSnapshot({
        ...emptySnapshot,
        ...parsed,
        purchaseOrderShareAlerts: Array.isArray(parsed.purchaseOrderShareAlerts) ? parsed.purchaseOrderShareAlerts : [],
      });
    }
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
          await clearShareNotifications(session.user.organizationId);
          await AsyncStorage.removeItem(sessionKey);
          return;
        }
        const result = await apiRequest<{ user: User | null }>('/api/auth/me', {}, storedToken);
        if (active && result.user) await establishSession(result.user, storedToken);
        else {
          await clearShareNotifications(session.user.organizationId);
          await AsyncStorage.removeItem(sessionKey);
        }
      } catch (sessionError) {
        const status = apiErrorStatus(sessionError);
        if (status === 401 || status === 403) {
          try {
            const stored = await AsyncStorage.getItem(sessionKey);
            const parsed = stored ? JSON.parse(stored) as { user?: User } : null;
            if (parsed?.user?.organizationId) await clearShareNotifications(parsed.user.organizationId);
          } catch {
            // Keep the existing session-recovery error visible to the user.
          }
        }
        if (active) setError('تعذر التحقق من الجلسة. يمكنك تسجيل الدخول من جديد.');
      } finally {
        if (active) setBooting(false);
      }
    })();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void retrySync();
        if (queueRef.current.length === 0 && userRef.current && tokenRef.current) {
          void loadRemote(userRef.current, tokenRef.current);
        }
      }
    });
    return () => { active = false; subscription.remove(); };
  }, [establishSession, loadRemote, retrySync]);

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
      if (userRef.current) await clearShareNotifications(userRef.current.organizationId);
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

  const rotatePurchaseOrderShare = useCallback(async (purchaseOrderId: number) => {
    const activeUser = userRef.current;
    const activeToken = tokenRef.current;
    if (!activeUser || !activeToken) throw new Error('سجّل الدخول أولاً.');
    if (activeUser.roleId !== 'owner' && activeUser.permissions.inventory !== true) {
      throw new Error('ليس لديك صلاحية لتدوير روابط أوامر الشراء.');
    }
    await apiRequest<{ rotated: boolean; share: { id: number; status: string; expiresAt: string; createdAt: string; url: string } }>(
      `/api/data/purchaseOrders/${purchaseOrderId}/share`,
      {
        method: 'POST',
        headers: { 'X-Wudooh-Data-Generation': String(activeUser.dataGeneration) },
      },
      activeToken,
    );
    await cancelPurchaseOrderShareNotifications(activeUser.organizationId, purchaseOrderId);
    setSnapshot((current) => ({
      ...current,
      purchaseOrderShareAlerts: current.purchaseOrderShareAlerts.filter((alert) => alert.purchaseOrderId !== purchaseOrderId),
    }));
    await loadRemote(activeUser, activeToken);
  }, [loadRemote]);

  const revokePurchaseOrderShare = useCallback(async (purchaseOrderId: number) => {
    const activeUser = userRef.current;
    const activeToken = tokenRef.current;
    if (!activeUser || !activeToken) throw new Error('سجّل الدخول أولاً.');
    if (activeUser.roleId !== 'owner' && activeUser.permissions.inventory !== true) {
      throw new Error('ليس لديك صلاحية لإبطال روابط أوامر الشراء.');
    }
    await apiRequest<{ revoked: number }>(
      `/api/data/purchaseOrders/${purchaseOrderId}/share/revoke`,
      {
        method: 'POST',
        headers: { 'X-Wudooh-Data-Generation': String(activeUser.dataGeneration) },
      },
      activeToken,
    );
    await cancelPurchaseOrderShareNotifications(activeUser.organizationId, purchaseOrderId);
    setSnapshot((current) => ({
      ...current,
      purchaseOrderShareAlerts: current.purchaseOrderShareAlerts.filter((alert) => alert.purchaseOrderId !== purchaseOrderId),
    }));
    await loadRemote(activeUser, activeToken);
  }, [loadRemote]);

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
    ...snapshot, user, token, queue, booting, loading, error, purchaseOrderShareAlertsError,
    login, logout, refresh, rotatePurchaseOrderShare, revokePurchaseOrderShare, checkout, addExpense, retrySync, can,
  }), [addExpense, booting, can, checkout, error, loading, login, logout, purchaseOrderShareAlertsError, queue, refresh, retrySync, rotatePurchaseOrderShare, revokePurchaseOrderShare, snapshot, token, user]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used within AppProvider');
  return value;
}