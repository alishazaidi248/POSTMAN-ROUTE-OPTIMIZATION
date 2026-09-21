import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";
import styles from "../styles/layout.module.css";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  superAdminOnly?: boolean;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Operations",
    items: [
      { to: "/", label: "Dashboard", icon: "dashboard", end: true },
      { to: "/deliveries", label: "Deliveries", icon: "parcel" },
      { to: "/exceptions", label: "Assignment Exceptions", icon: "alert" }
    ]
  },
  {
    label: "Management",
    items: [
      { to: "/beats", label: "Beats", icon: "beat" },
      { to: "/postmen", label: "Postmen", icon: "users" },
      { to: "/map", label: "Map", icon: "map" }
    ]
  },
  {
    label: "Data",
    items: [
      { to: "/imports", label: "Imports", icon: "upload" },
      { to: "/data-quality", label: "Data Quality", icon: "quality" },
      { to: "/reports", label: "Reports", icon: "report" },
      { to: "/audit-log", label: "Audit Log", icon: "audit" },
      { to: "/admin-accounts", label: "Admin Accounts", icon: "shield", superAdminOnly: true }
    ]
  }
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

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: "Super Administrator", ADMIN: "Administrator", POSTMAN: "Postman" };

const isSmall = () => window.matchMedia("(max-width: 760px)").matches;

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const title = TITLES[location.pathname] ?? "Postal Delivery Operations";
  const isDetailPage = !(location.pathname in TITLES);

  // Desktop: full sidebar, or an icons-only rail when collapsed (narrower windows start collapsed).
  // Phone: the sidebar is a drawer. This is only a layout preference, never business data.
  const [collapsed, setCollapsed] = useState(() => window.matchMedia("(max-width: 1100px)").matches);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const toggle = () => (isSmall() ? setDrawerOpen((o) => !o) : setCollapsed((c) => !c));

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.iconButton} onClick={toggle} aria-label="Show or hide the menu">
            <Icon name="menu" />
          </button>
          <div className={styles.brand}>
            <span className={styles.brandMark}><Icon name="parcel" size={15} /></span>
            <span className={styles.crumbRoot}>Postal Delivery Operations</span>
          </div>
          <div className={styles.crumbs}>
            <span className={styles.crumbRoot}>/</span>
            {isDetailPage && (
              <button className={styles.iconButton} onClick={() => navigate(-1)} aria-label="Go back" style={{ width: 26, height: 26 }}>
                ←
              </button>
            )}
            <strong>{title}</strong>
          </div>
        </div>
        <div className={styles.userArea}>
          {user && <Avatar name={user.name} size={30} />}
          <div className={styles.userText}>
            <div className={styles.userName}>{user?.postOfficeName ?? user?.name}</div>
            <div className={styles.userRole}>
              {user?.postOfficeName ? `${user.name} · ` : ""}
              {user ? ROLE_LABEL[user.role] ?? user.role : ""}
            </div>
          </div>
          <button className={styles.logoutButton} onClick={() => logout()}>
            <Icon name="logout" size={14} /> Log out
          </button>
        </div>
      </header>

      {drawerOpen && <div className={styles.scrim} onClick={() => setDrawerOpen(false)} />}
      <aside
        className={`${styles.sidebar} ${collapsed ? styles.sidebarRail : ""} ${drawerOpen ? styles.sidebarOpen : ""}`}
        aria-label="Main menu"
      >
        <nav>
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.superAdminOnly || user?.role === "SUPER_ADMIN");
            if (items.length === 0) return null;
            return (
              <div key={group.label} className={styles.group}>
                <div className={styles.groupLabel}>{group.label}</div>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={item.label}
                    className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
                  >
                    <span className={styles.navIcon}><Icon name={item.icon} /></span>
                    <span className={styles.navLabel}>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className={`${styles.main} ${collapsed ? styles.mainRail : ""}`}>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
