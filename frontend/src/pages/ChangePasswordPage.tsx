import { FormEvent, useState } from "react";
import { useAuth } from "../lib/auth";
import { friendlyError } from "../lib/friendlyError";
import styles from "../styles/components.module.css";

/**
 * Shown INSTEAD of the panel while the signed-in account still has the temporary password someone else set for it. The
 * password rules are the server's (it says what is wrong); this page only asks for the two passwords and that the new one
 * is typed twice.
 */
export function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== again) {
      setError("The two new passwords are not the same.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(friendlyError(err, "The password could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
      <form onSubmit={submit} className={styles.card} style={{ width: 380 }} data-testid="change-password">
        <div style={{ borderBottom: "3px solid var(--color-red-700)", paddingBottom: 12, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Choose a new password</div>
          <div style={{ fontSize: 12, color: "var(--color-ink-500)", marginTop: 2 }}>
            {user?.email} is using a temporary password. Choose your own to continue.
          </div>
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="current-password">Temporary password</label>
          <input id="current-password" className={styles.input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="new-password">New password</label>
          <input id="new-password" className={styles.input} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="new-password-again">New password again</label>
          <input id="new-password-again" className={styles.input} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        {error && <div className={styles.errorText} role="alert" style={{ marginBottom: 12 }}>{error}</div>}
        <button className={styles.buttonPrimary} type="submit" disabled={busy || !current || !next || !again} style={{ width: "100%" }}>
          {busy ? "Saving..." : "Save new password"}
        </button>
        <button type="button" className={styles.button} onClick={() => void logout()} style={{ width: "100%", marginTop: 8 }}>
          Sign out
        </button>
      </form>
    </div>
  );
}
