import { useCallback } from "react";
import { QueryKey, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "@react-navigation/native";

/**
 * Tabs stay mounted once opened, so coming back to one does not, by itself, re-read
 * anything. This re-fetches the given server queries whenever the screen regains
 * focus - but only those that have gone stale, so flipping between tabs does not
 * hammer the API. Keeps what a postman sees in step with what the admin changed.
 *
 * Pass a module-level constant for `keys`.
 */
export function useRefreshStaleOnFocus(keys: readonly QueryKey[]) {
  const queryClient = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      for (const queryKey of keys) {
        void queryClient.refetchQueries({ queryKey, stale: true, type: "active" });
      }
    }, [keys, queryClient])
  );
}
