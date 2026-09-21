import axios from "axios";

/**
 * Turns whatever went wrong into a sentence an administrator can act on. The server's own
 * messages are kept when they are written for people (they are); anything that looks
 * technical (validation dumps, stack-like text) is replaced by the fallback.
 */
export function friendlyError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return "The server could not be reached. Please check your connection and try again.";
    const status = err.response.status;
    const message: unknown = err.response.data?.error?.message;
    if (status === 401) return "Your session has ended. Please sign in again.";
    if (status === 403) return "You do not have permission to do this.";
    if (typeof message === "string" && message.length > 0 && message.length < 220 && !looksTechnical(message)) {
      return message.replace(/^Invalid beat boundary: /i, "The territory is not valid: ");
    }
    if (status === 422 || status === 400) return `${fallback} Please check the details and try again.`;
  }
  return fallback;
}

/**
 * The server refuses to save / verify a territory that overlaps another beat until the administrator confirms it is
 * intended (409 with requiresAcknowledgement). Returns the server's sentence naming the beats, or null for any other error.
 */
export function overlapConflict(err: unknown): string | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return null;
  const error = err.response.data?.error;
  return error?.details?.requiresAcknowledgement === true && typeof error.message === "string" ? error.message : null;
}

function looksTechnical(message: string): boolean {
  return /zod|undefined|\[\d+\]|\bat [a-z]+\.|violat|constraint|prisma|ECONN|uuid|\{|\}/i.test(message);
}
