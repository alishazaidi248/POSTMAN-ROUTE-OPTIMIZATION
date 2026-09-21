/**
 * How often the app re-reads its data from the server while it is open. The server
 * (PostgreSQL) is the source of truth, so a change an admin makes - a new
 * assignment, a beat handed to another postman - reaches the phone within this
 * interval even if the postman never pulls to refresh. Paused while the app is in
 * the background; a refetch also happens when the app returns to the foreground.
 */
export const SERVER_POLL_MS = 60_000;
