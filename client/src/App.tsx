import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router';
import { api } from './api';
import { Layout } from './components/Layout';
import { BacklogPage } from './pages/BacklogPage';
import { DayPage } from './pages/DayPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });

  if (me.isPending) return null;
  if (!me.data?.signedIn) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DayPage />} />
        <Route path="day/:date" element={<DayPage />} />
        <Route path="backlog" element={<BacklogPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
