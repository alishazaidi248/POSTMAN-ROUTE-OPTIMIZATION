import { queryOptions, useQuery } from "@tanstack/react-query";
import { postmanApi } from "../api/postmanApi";
import { SERVER_POLL_MS } from "../config/polling";

/**
 * The signed-in postman's profile from GET /me/profile: name, employee id, phone and
 * assigned beat all come from the server, which resolves WHO is asking from the login
 * (User.postmanId) - the app never sends a postman id. Re-read periodically so a beat
 * an admin reassigns shows up on the phone without a restart.
 */
export const profileQueryOptions = () =>
  queryOptions({
    queryKey: ["postmanProfile"],
    queryFn: () => postmanApi.getProfile(),
    staleTime: 30_000,
    refetchInterval: SERVER_POLL_MS
  });

export function usePostmanProfile() {
  return useQuery(profileQueryOptions());
}
