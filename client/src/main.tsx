import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api';
import { App } from './App';
import { applyLayout } from './layout';
import { registerServiceWorker } from './push';
import './styles.css';

// Any 401 means the session ended: drop back to the login screen.
const onError = (error: Error) => {
  if (error instanceof ApiError && error.status === 401) {
    queryClient.setQueryData(['me'], { signedIn: false });
  }
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2 },
  },
});

registerServiceWorker();
applyLayout();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
