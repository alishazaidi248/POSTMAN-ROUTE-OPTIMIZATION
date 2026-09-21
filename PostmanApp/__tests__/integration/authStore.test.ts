/* eslint-disable import/first -- jest.mock calls are hoisted above these
   imports regardless of source order; grouping them first here is clearer. */
jest.mock("../../src/storage/secureStorage", () => ({
  secureStorage: {
    saveTokens: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue(null),
    getRefreshToken: jest.fn().mockResolvedValue(null),
    saveUser: jest.fn().mockResolvedValue(undefined),
    getUser: jest.fn().mockResolvedValue(null),
    clear: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock("../../src/storage/offlineStorage", () => ({
  offlineStorage: {
    clearAll: jest.fn().mockResolvedValue(undefined),
    getOwner: jest.fn().mockResolvedValue(null),
    setOwner: jest.fn().mockResolvedValue(undefined),
    getMutationQueue: jest.fn().mockResolvedValue([]),
    setMutationQueue: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock("../../src/api/authApi", () => ({
  authApi: {
    login: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    me: jest.fn()
  }
}));

import { authApi } from "../../src/api/authApi";
import { secureStorage } from "../../src/storage/secureStorage";
import { offlineStorage } from "../../src/storage/offlineStorage";
import { useAuthStore } from "../../src/store/authStore";
import { useOfflineStore } from "../../src/store/offlineStore";
import { queryClient } from "../../src/lib/queryClient";
import { ApiError } from "../../src/types/api";

const POSTMAN_USER = {
  id: "u1",
  name: "Ramesh Kadam",
  email: "ramesh.kadam@postal.local",
  role: "POSTMAN" as const,
  postOfficeId: "po1",
  postmanId: "pm1"
};

const LOGIN = { accessToken: "access", refreshToken: "refresh" };

function resetStore() {
  useAuthStore.setState({ status: "signedOut", user: null, error: null });
}

beforeEach(() => {
  resetStore();
  jest.clearAllMocks();
  (offlineStorage.getOwner as jest.Mock).mockResolvedValue(null);
  useOfflineStore.setState({ isOnline: true, queue: [], conflicts: [], isSyncing: false });
});

describe("authStore.login — identity comes from GET /auth/me", () => {
  it("signs in a POSTMAN user linked to a Postman profile, using the user the SERVER returns from /auth/me", async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({
      ...LOGIN,
      // A tampered/stale login body must not decide who the user is:
      user: { ...POSTMAN_USER, name: "Someone Else" }
    });
    (authApi.me as jest.Mock).mockResolvedValueOnce(POSTMAN_USER);

    await useAuthStore.getState().login({ email: POSTMAN_USER.email, password: "ChangeMe123!" });

    expect(authApi.me).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(useAuthStore.getState().user).toEqual(POSTMAN_USER);
    expect(secureStorage.saveTokens).toHaveBeenCalledWith("access", "refresh");
    expect(secureStorage.saveUser).toHaveBeenCalledWith(JSON.stringify(POSTMAN_USER));
  });

  it("rejects a non-POSTMAN login (admin account), revokes the session and signs nobody in", async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({ ...LOGIN, user: POSTMAN_USER });
    (authApi.me as jest.Mock).mockResolvedValueOnce({ ...POSTMAN_USER, role: "ADMIN", postmanId: null });

    await expect(useAuthStore.getState().login({ email: "admin@postal.local", password: "ChangeMe123!" })).rejects.toThrow(
      /Postman/
    );
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(authApi.logout).toHaveBeenCalledWith("refresh"); // the tokens that were issued are revoked
    expect(secureStorage.clear).toHaveBeenCalled();
    expect(secureStorage.saveUser).not.toHaveBeenCalled();
  });

  it("rejects a POSTMAN login with no linked Postman profile", async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({ ...LOGIN, user: POSTMAN_USER });
    (authApi.me as jest.Mock).mockResolvedValueOnce({ ...POSTMAN_USER, postmanId: null });

    await expect(useAuthStore.getState().login({ email: POSTMAN_USER.email, password: "x" })).rejects.toThrow(
      /not yet linked/
    );
    expect(useAuthStore.getState().status).toBe("signedOut");
  });

  it("signs out cleanly when /auth/me itself fails after a successful login", async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({ ...LOGIN, user: POSTMAN_USER });
    (authApi.me as jest.Mock).mockRejectedValueOnce(new ApiError("Network unavailable", 0, undefined, true));

    await expect(useAuthStore.getState().login({ email: POSTMAN_USER.email, password: "x" })).rejects.toThrow(/Network/);
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(secureStorage.clear).toHaveBeenCalled();
  });

  it("surfaces invalid-credentials errors from the backend", async () => {
    (authApi.login as jest.Mock).mockRejectedValueOnce(new Error("Invalid email or password"));

    await expect(useAuthStore.getState().login({ email: "x@x.com", password: "wrong" })).rejects.toThrow(
      "Invalid email or password"
    );
    expect(useAuthStore.getState().error).toBe("Invalid email or password");
  });
});

describe("authStore — one account's data never reaches the next", () => {
  it("wipes the query cache on login", async () => {
    queryClient.setQueryData(["deliveries", "ALL"], { rows: [{ id: "previous-account" }] });
    (authApi.login as jest.Mock).mockResolvedValueOnce({ ...LOGIN, user: POSTMAN_USER });
    (authApi.me as jest.Mock).mockResolvedValueOnce(POSTMAN_USER);

    await useAuthStore.getState().login({ email: POSTMAN_USER.email, password: "x" });

    expect(queryClient.getQueryData(["deliveries", "ALL"])).toBeUndefined();
  });

  it("discards cached deliveries and the offline queue when a DIFFERENT account signs in", async () => {
    (offlineStorage.getOwner as jest.Mock).mockResolvedValueOnce("someone-else");
    useOfflineStore.setState({
      queue: [{ id: "q1", type: "DELIVERY_STATUS_UPDATE", deliveryId: "d1", status: "DELIVERED", queuedAt: "x", attempts: 0 }]
    });
    (authApi.login as jest.Mock).mockResolvedValueOnce({ ...LOGIN, user: POSTMAN_USER });
    (authApi.me as jest.Mock).mockResolvedValueOnce(POSTMAN_USER);

    await useAuthStore.getState().login({ email: POSTMAN_USER.email, password: "x" });

    expect(offlineStorage.clearAll).toHaveBeenCalled();
    expect(useOfflineStore.getState().queue).toHaveLength(0);
    expect(offlineStorage.setOwner).toHaveBeenCalledWith("u1");
  });

  it("keeps the queued changes when the SAME account signs back in (e.g. after a session expiry)", async () => {
    (offlineStorage.getOwner as jest.Mock).mockResolvedValueOnce("u1");
    useOfflineStore.setState({
      queue: [{ id: "q1", type: "DELIVERY_STATUS_UPDATE", deliveryId: "d1", status: "DELIVERED", queuedAt: "x", attempts: 0 }]
    });
    (authApi.login as jest.Mock).mockResolvedValueOnce({ ...LOGIN, user: POSTMAN_USER });
    (authApi.me as jest.Mock).mockResolvedValueOnce(POSTMAN_USER);

    await useAuthStore.getState().login({ email: POSTMAN_USER.email, password: "x" });

    expect(offlineStorage.clearAll).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().queue).toHaveLength(1);
  });
});

describe("authStore.hydrate — the server has the final word on who is signed in", () => {
  const stored = () => {
    (secureStorage.getAccessToken as jest.Mock).mockResolvedValue("tok");
    (secureStorage.getUser as jest.Mock).mockResolvedValue(JSON.stringify(POSTMAN_USER));
  };

  afterEach(() => {
    (secureStorage.getAccessToken as jest.Mock).mockResolvedValue(null);
    (secureStorage.getUser as jest.Mock).mockResolvedValue(null);
  });

  it("opens with the saved user, then replaces it with what /auth/me returns", async () => {
    stored();
    (authApi.me as jest.Mock).mockResolvedValueOnce({ ...POSTMAN_USER, name: "Ramesh K. (renamed by admin)" });

    await useAuthStore.getState().hydrate();

    expect(authApi.me).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(useAuthStore.getState().user?.name).toBe("Ramesh K. (renamed by admin)");
  });

  it("stays signed in on the saved user when the server cannot be reached (offline start)", async () => {
    stored();
    (authApi.me as jest.Mock).mockRejectedValueOnce(new ApiError("Network unavailable", 0, undefined, true));

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(useAuthStore.getState().user).toEqual(POSTMAN_USER);
  });

  it("signs out and clears the device when the server says the account is no longer a usable postman", async () => {
    stored();
    (authApi.me as jest.Mock).mockResolvedValueOnce({ ...POSTMAN_USER, postmanId: null });

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(secureStorage.clear).toHaveBeenCalled();
    expect(offlineStorage.clearAll).toHaveBeenCalled();
  });

  it("with no saved session it goes straight to signed out without calling the server", async () => {
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(authApi.me).not.toHaveBeenCalled();
  });
});

describe("authStore.logout", () => {
  it("clears secure storage, the query cache, the offline caches and local session state", async () => {
    useAuthStore.setState({ status: "signedIn", user: POSTMAN_USER, error: null });
    queryClient.setQueryData(["postmanProfile"], { postman: { id: "pm1" } });

    await useAuthStore.getState().logout();

    expect(secureStorage.clear).toHaveBeenCalled();
    expect(offlineStorage.clearAll).toHaveBeenCalled();
    expect(queryClient.getQueryData(["postmanProfile"])).toBeUndefined();
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(useAuthStore.getState().user).toBeNull();
  });
});
