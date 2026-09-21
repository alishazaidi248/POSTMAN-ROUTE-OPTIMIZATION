import { useEffect, useState } from "react";
import { apiClient } from "../lib/apiClient";

/**
 * The photo a postman took as proof of a delivery. It is private: there is no public URL, so it is fetched with the
 * signed-in administrator's token and shown from a temporary object URL that is released when the panel closes.
 */
export function ProofPhoto({ deliveryId }: { deliveryId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    apiClient
      .get(`/deliveries/${deliveryId}/proof`, { responseType: "blob" })
      .then((r) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(r.data as Blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deliveryId]);

  if (failed) return <p>The photo could not be loaded.</p>;
  if (!url) return <p>Loading photo…</p>;
  return <img src={url} alt="Proof of delivery" data-testid="proof-photo" style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8 }} />;
}
