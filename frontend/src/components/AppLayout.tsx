import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import styles from "../styles/layout.module.css";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/deliveries", label: "Deliveries" },
  { to: "/exceptions", label: "Assignment Exceptions" },
  { to: "/beats", label: "Beats" },
  { to: "/postmen", label: "Postmen" },
  { to: "/map", label: "Map" },
  { to: "/imports", label: "Imports" },
  { to: "/data-quality", label: "Data Quality" },
  { to: "/reports", label: "Reports" },
  { to: "/audit-log", label: "Audit Log" },
  { to: "/admin-accounts", label: "Admin Accounts", superAdminOnly: true }
];

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/deliveries": "Deliveries",
  "/exceptions": "Assignment Exceptions",
  "/beats": "Beats",
  "/postmen": "Postmen",
  "/map": "Operations Map",
  "/imports": "Delivery Imports",
  "/data-quality": "Data Quality",
  "/reports": "Reports",
  "/audit-log": "Audit Log",
  "/admin-accounts": "Admin Accounts"
};

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const title = TITLES[location.pathname] ?? "Postal Delivery Operations";
  const isDetailPage = !(location.pathname in TITLES);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandTitle}>Postal Delivery Ops</div>
          <div className={styles.brandSubtitle}>Operations &amp; Optimization Admin</div>
        </div>
        <nav className={styles.nav}>
          {NAV_ITEMS.filter((item) => !item.superAdminOnly || user?.role === "SUPER_ADMIN").map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.titleGroup}>
            {isDetailPage && (
              <button className={styles.backButton} onClick={() => navigate(-1)} aria-label="Go back">
                ←
              </button>
            )}
            <div className={styles.pageTitle}>{title}</div>
          </div>
          <div className={styles.userChip}>
            <span>{user?.name} &middot; {user?.role}</span>
            <button className={styles.logoutButton} onClick={() => logout()}>
              Log out
            </button>
          </div>
        </header>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
