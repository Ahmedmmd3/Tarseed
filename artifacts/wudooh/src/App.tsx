import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { StoreProvider } from '@/context/store';
import { AppLayout } from '@/components/layout';

import Overview from '@/pages/overview';
import Accounts from '@/pages/accounts';
import Journals from '@/pages/journals';
import Receivables from '@/pages/receivables';
import Reports from '@/pages/reports';

const queryClient = new QueryClient();

function Router() {
  return (
    <RoutedErrorBoundary>
      <AppLayout>
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/accounts" component={Accounts} />
          <Route path="/journals" component={Journals} />
          <Route path="/receivables" component={Receivables} />
          <Route path="/reports" component={Reports} />
          <Route component={NotFound} />
        </Switch>
      </AppLayout>
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
      <StoreProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </StoreProvider>
    </QueryClientProvider>
  );
}

export default App;
