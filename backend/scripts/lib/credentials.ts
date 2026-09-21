import { randomBytes } from "node:crypto";

/**
 * Passwords for the operational scripts. None is written in the source: a login the script needs comes from the environment
 * (and the script stops with a clear message when it is missing), and a password the script creates is random.
 */
export function requiredEnv(name: string, purpose: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Set it to ${purpose} and run again (for example: ${name}=... npx tsx <script>).`);
    process.exit(2);
  }
  return value;
}

/** A random password that satisfies the password rules (10+ characters, a letter and a digit). */
export function randomPassword(): string {
  return `${randomBytes(9).toString("base64url")}9a`;
}
