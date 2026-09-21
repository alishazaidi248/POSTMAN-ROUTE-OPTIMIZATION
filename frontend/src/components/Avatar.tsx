import { useState } from "react";
import styles from "../styles/avatar.module.css";

/** "Ramesh Kadam" -> "RK"; "Cher" -> "C"; the first letters of the first and last word. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// Quiet, muted tints so a list of people is easy to tell apart without looking like a rainbow.
const TINTS = [
  ["#e8eef7", "#2f4f7f"],
  ["#eaf3ec", "#2f6b47"],
  ["#f6ede4", "#8a5a2b"],
  ["#eee9f5", "#5b3f8a"],
  ["#f4e9ee", "#8a3f5b"],
  ["#e6f1f2", "#2b6b73"]
];

function tintFor(name: string): [string, string] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = TINTS[hash % TINTS.length];
  return [bg, fg];
}

interface Props {
  name: string;
  /** The person's uploaded picture, when they have one. Otherwise their initials are shown. */
  photoUrl?: string | null;
  size?: number;
}

/** A small circular picture, or a clean initials avatar. Never a stock photo. */
export function Avatar({ name, photoUrl, size = 32 }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [bg, fg] = tintFor(name);
  const showPhoto = !!photoUrl && failedUrl !== photoUrl;

  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.max(11, Math.round(size * 0.38)) }}
      role="img"
      aria-label={showPhoto ? `Photo of ${name}` : `${name} (initials)`}
    >
      {showPhoto ? (
        <img src={photoUrl} alt="" className={styles.image} onError={() => setFailedUrl(photoUrl)} />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
