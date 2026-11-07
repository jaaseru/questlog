import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api';
import { App } from './App';
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
    // Rate limits, server hiccups and lost connections usually pass: retry with growing waits
    // (1 s, 2 s, 4 s). Other errors (bad input, not signed in…) won't change on retry.
    queries: {
      staleTime: 30_000,
      retry: (count, err) => count < 3 && (!(err instanceof ApiError) || err.retryable),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    // A 429 from the hosting edge means the request never reached Questlog, so changes are
    // safe to resend. Other failures might have been applied already, so they aren't retried.
    mutations: {
      retry: (count, err) => count < 2 && err instanceof ApiError && err.status === 429,
      retryDelay: (attempt) => 1000 * 2 ** attempt,
    },
  },
});

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
