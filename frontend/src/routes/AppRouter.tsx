import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { AppLayout } from "../components/AppLayout";
import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { PostmenPage } from "../pages/PostmenPage";
import { PostmanDetailPage } from "../pages/PostmanDetailPage";
import { BeatsPage } from "../pages/BeatsPage";
import { DeliveriesPage } from "../pages/DeliveriesPage";
import { DeliveryDetailPage } from "../pages/DeliveryDetailPage";
import { ImportsPage } from "../pages/ImportsPage";
import { ImportDetailPage } from "../pages/ImportDetailPage";
import { DataQualityPage } from "../pages/DataQualityPage";
import { MapPage } from "../pages/MapPage";
import { ReportsPage } from "../pages/ReportsPage";
import { AuditLogPage } from "../pages/AuditLogPage";
import { AdminAccountsPage } from "../pages/AdminAccountsPage";
import { AssignmentExceptionsPage } from "../pages/AssignmentExceptionsPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="postmen" element={<PostmenPage />} />
          <Route path="postmen/:id" element={<PostmanDetailPage />} />
          <Route path="beats" element={<BeatsPage />} />
          <Route path="deliveries" element={<DeliveriesPage />} />
          <Route path="deliveries/:id" element={<DeliveryDetailPage />} />
          <Route path="imports" element={<ImportsPage />} />
          <Route path="imports/:id" element={<ImportDetailPage />} />
          <Route path="data-quality" element={<DataQualityPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
          <Route path="admin-accounts" element={<AdminAccountsPage />} />
          <Route path="exceptions" element={<AssignmentExceptionsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
