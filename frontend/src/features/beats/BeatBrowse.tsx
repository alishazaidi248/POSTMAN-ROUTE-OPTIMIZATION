import { useEffect, useMemo, useRef, useState } from "react";
import { ActiveBadge, VerificationBadge } from "./StatusBadge";
import { BeatRecord, VERIFICATION_COLOR, deliveriesOf, formatWhen, matchesSearch } from "./beatTypes";
import { Icon } from "../../components/icons";
import styles from "./beats.module.css";

export type Filter = "ALL" | "VERIFIED" | "PENDING" | "ATTENTION";

export const matchesFilter = (b: BeatRecord, f: Filter) =>
  f === "ALL" ||
  (f === "VERIFIED" && b.verificationStatus === "VERIFIED") ||
  (f === "PENDING" && b.verificationStatus === "PENDING_VERIFICATION") ||
  (f === "ATTENTION" && b.verificationStatus === "NEEDS_REVIEW");

/** Compact totals; each one filters the list below when clicked. */
export function BeatSummary({ beats, filter, onFilter }: { beats: BeatRecord[]; filter: Filter; onFilter: (f: Filter) => void }) {
  const count = (f: Filter) => beats.filter((b) => matchesFilter(b, f)).length;
  const items: { key: Filter; label: string; color?: string }[] = [
    { key: "ALL", label: "Total beats" },
    { key: "VERIFIED", label: "Verified", color: VERIFICATION_COLOR.VERIFIED },
    { key: "PENDING", label: "Pending verification", color: VERIFICATION_COLOR.PENDING_VERIFICATION },
    { key: "ATTENTION", label: "Need attention", color: VERIFICATION_COLOR.NEEDS_REVIEW }
  ];
  return (
    <div className={styles.summary} data-testid="beat-summary">
      {items.map((item) => (
        <button
          key={item.key}
          className={`${styles.chip} ${filter === item.key ? styles.chipActive : ""}`}
          onClick={() => onFilter(filter === item.key ? "ALL" : item.key)}
          aria-pressed={filter === item.key}
        >
          {item.color && <span className={styles.chipDot} style={{ background: item.color }} />}
          <strong>{count(item.key)}</strong> {item.label}
        </button>
      ))}
    </div>
  );
}

/** Type a beat number, name, sector or post office; pick a result to select it and centre the map on it. */
export function BeatSearch({ beats, onPick }: { beats: BeatRecord[]; onPick: (b: BeatRecord) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => (query.trim() ? beats.filter((b) => matchesSearch(b, query)).slice(0, 8) : []), [beats, query]);

  useEffect(() => {
    const close = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (b: BeatRecord) => {
    onPick(b);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className={styles.searchWrap} ref={boxRef}>
      <span className={styles.searchIcon}><Icon name="search" size={16} /></span>
      <input
        className={styles.searchInput}
        placeholder="Search beats..."
        aria-label="Search beats"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && results[active]) pick(results[active]);
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && query.trim() && (
        <div className={styles.searchResults} role="listbox">
          {results.length === 0 ? (
            <div className={styles.searchEmpty}>No beats match &ldquo;{query}&rdquo;.</div>
          ) : (
            results.map((b, i) => (
              <button
                key={b.id}
                role="option"
                aria-selected={i === active}
                className={`${styles.searchItem} ${i === active ? styles.searchItemActive : ""}`}
                onClick={() => pick(b)}
              >
                <span>
                  <strong>{b.beatNumber}</strong> — {b.name}
                  <div className={styles.muted}>{b.postOfficeName}</div>
                </span>
                <VerificationBadge value={b.verificationStatus} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** All beats in a table; "View" selects the beat and centres the map on it. */
export function BeatTable({ beats, selectedId, onView, emptyMessage }: { beats: BeatRecord[]; selectedId: string | null; onView: (b: BeatRecord) => void; emptyMessage: string }) {
  return (
    <div className={styles.tableCard}>
      <div className={styles.tableHead}>
        <h2>All beats</h2>
        <span className={styles.muted}>{beats.length} shown</span>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.beatTable}>
          <thead>
            <tr>
              <th>Beat</th><th>Name</th><th>Post office</th><th>Status</th><th>Postman</th><th>Deliveries</th><th>Last updated</th><th />
            </tr>
          </thead>
          <tbody>
            {beats.length === 0 ? (
              <tr><td colSpan={8} className={styles.tableEmpty}>{emptyMessage}</td></tr>
            ) : (
              beats.map((b) => (
                <tr key={b.id} className={b.id === selectedId ? styles.rowSelected : undefined}>
                  <td><strong>{b.beatNumber}</strong></td>
                  <td>{b.name}</td>
                  <td>{b.postOfficeName}</td>
                  <td style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <VerificationBadge value={b.verificationStatus} />
                    {b.status === "INACTIVE" && <ActiveBadge active={false} />}
                  </td>
                  <td>{b.assignedPostmanName ?? <span className={styles.muted}>Not assigned</span>}</td>
                  <td>{deliveriesOf(b)}</td>
                  <td>{formatWhen(b.updatedAt)}</td>
                  <td><button className={`${styles.btn} ${styles.btnSmall}`} onClick={() => onView(b)}>View</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
