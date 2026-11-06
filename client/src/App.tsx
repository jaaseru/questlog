import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router';
import { api } from './api';
import { Layout } from './components/Layout';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { BacklogPage } from './pages/BacklogPage';
import { CalendarPage } from './pages/CalendarPage';
import { DayPage } from './pages/DayPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { ShoppingPage } from './pages/ShoppingPage';

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });

  if (me.isPending) return null;
  if (!me.data?.signedIn) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DayPage />} />
        <Route path="day/:date" element={<DayPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="backlog" element={<BacklogPage />} />
        <Route path="shopping" element={<ShoppingPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
