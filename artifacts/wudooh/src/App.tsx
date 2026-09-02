import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PwaStatus } from '@/components/pwa-status';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { StoreProvider } from '@/context/store';
import { AppLayout } from '@/components/layout';

import Landing from '@/pages/landing';
import Overview from '@/pages/overview';
import Guide from '@/pages/guide';
import Accounts from '@/pages/accounts';
import Journals from '@/pages/journals';
import Receivables from '@/pages/receivables';
import Reports from '@/pages/reports';
import Export from '@/pages/export';
import Team from '@/pages/team';
import ActivityLog from '@/pages/activity-log';
import EInvoicing from '@/pages/e-invoicing';
import ResetPassword from '@/pages/reset-password';
import POS from '@/pages/pos';
import Sales from '@/pages/sales';
import Quotations from '@/pages/quotations';
import Purchases from '@/pages/purchases';
import PurchaseOrders from '@/pages/purchase-orders';
import Inventory from '@/pages/inventory';
import HR from '@/pages/hr';
import Operations from '@/pages/operations';
import Expenses from '@/pages/expenses';
import ManagerPortal from '@/pages/manager-portal';
import SuperAdminPortal from '@/pages/super-admin-portal';
import TestWorkspaceInvite from '@/pages/test-workspace-invite';
import SupplierPurchaseOrderShare from '@/pages/supplier-purchase-order-share';
import {
  Features,
  Pricing,
  ProductPage,
  ResourcePage,
  SecurityPerformance,
  Solutions,
  WhyTarseed,
} from '@/pages/marketing-pages';

const queryClient = new QueryClient();

function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <AppLayout>{children}</AppLayout>
    </StoreProvider>
  );
}

function SessionLayout({ children }: { children: ReactNode }) {
  return <StoreProvider>{children}</StoreProvider>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/features" component={Features} />
        <Route path="/solutions" component={Solutions} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/why-tarseed" component={WhyTarseed} />
        <Route path="/security-performance" component={SecurityPerformance} />
        <Route path="/products/accounting" component={() => <ProductPage product="accounting" />} />
        <Route path="/products/sales" component={() => <ProductPage product="sales" />} />
        <Route path="/products/hr" component={() => <ProductPage product="hr" />} />
        <Route path="/products/pos" component={() => <ProductPage product="pos" />} />
        <Route path="/resources/help" component={() => <ResourcePage kind="help" />} />
        <Route path="/resources/guide" component={() => <ResourcePage kind="guide" />} />
        <Route path="/resources/operations" component={() => <ResourcePage kind="operations" />} />
        <Route path="/resources/e-invoicing" component={() => <ResourcePage kind="e-invoicing" />} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/purchase-order-share/:token" component={SupplierPurchaseOrderShare} />
        <Route path="/test-workspace-invite" component={TestWorkspaceInvite} />
        <Route path="/manager" component={() => <SessionLayout><ManagerPortal /></SessionLayout>} />
        <Route path="/super-admin" component={SuperAdminPortal} />
        <Route path="/dashboard" component={() => <DashboardLayout><Overview /></DashboardLayout>} />
        <Route path="/guide" component={Guide} />
        <Route path="/pos" component={() => <DashboardLayout><POS /></DashboardLayout>} />
        <Route path="/sales" component={() => <DashboardLayout><Sales /></DashboardLayout>} />
        <Route path="/quotations" component={() => <DashboardLayout><Quotations /></DashboardLayout>} />
        <Route path="/purchases" component={() => <DashboardLayout><Purchases /></DashboardLayout>} />
        <Route path="/purchase-orders" component={() => <DashboardLayout><PurchaseOrders /></DashboardLayout>} />
        <Route path="/inventory" component={() => <DashboardLayout><Inventory /></DashboardLayout>} />
        <Route path="/hr" component={() => <DashboardLayout><HR /></DashboardLayout>} />
        <Route path="/operations" component={() => <DashboardLayout><Operations /></DashboardLayout>} />
        <Route path="/expenses" component={() => <DashboardLayout><Expenses /></DashboardLayout>} />
        <Route path="/accounts" component={() => <DashboardLayout><Accounts /></DashboardLayout>} />
        <Route path="/journals" component={() => <DashboardLayout><Journals /></DashboardLayout>} />
        <Route path="/receivables" component={() => <DashboardLayout><Receivables /></DashboardLayout>} />
        <Route path="/reports" component={() => <DashboardLayout><Reports /></DashboardLayout>} />
         <Route path="/export" component={() => <DashboardLayout><Export /></DashboardLayout>} />
        <Route path="/team" component={() => <DashboardLayout><Team /></DashboardLayout>} />
        <Route path="/operations-log" component={() => <DashboardLayout><ActivityLog /></DashboardLayout>} />
        <Route path="/e-invoicing" component={() => <DashboardLayout><EInvoicing /></DashboardLayout>} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
        <PwaStatus />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;