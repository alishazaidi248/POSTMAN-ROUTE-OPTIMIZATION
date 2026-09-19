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
  offlineStorage: { clearAll: jest.fn().mockResolvedValue(undefined) }
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
import { useAuthStore } from "../../src/store/authStore";

const POSTMAN_USER = {
  id: "u1",
  name: "Ramesh Kadam",
  email: "ramesh.kadam@postal.local",
  role: "POSTMAN" as const,
  postOfficeId: "po1",
  postmanId: "pm1"
};

function resetStore() {
  useAuthStore.setState({ status: "signedOut", user: null, error: null });
}

describe("authStore.login", () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  it("signs in a POSTMAN user linked to a Postman profile", async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({
      accessToken: "access",
      refreshToken: "refresh",
      user: POSTMAN_USER
    });

    await useAuthStore.getState().login({ email: POSTMAN_USER.email, password: "ChangeMe123!" });

    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(useAuthStore.getState().user).toEqual(POSTMAN_USER);
    expect(secureStorage.saveTokens).toHaveBeenCalledWith("access", "refresh");
  });

  it("rejects a non-POSTMAN login (admin account) without signing in", async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({
      accessToken: "access",
      refreshToken: "refresh",
      user: { ...POSTMAN_USER, role: "ADMIN", postmanId: null }
    });

    await expect(useAuthStore.getState().login({ email: "admin@postal.local", password: "ChangeMe123!" })).rejects.toThrow(
      /Postman/
    );
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(secureStorage.saveTokens).not.toHaveBeenCalled();
  });

  it("rejects a POSTMAN login with no linked Postman profile", async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({
      accessToken: "access",
      refreshToken: "refresh",
      user: { ...POSTMAN_USER, postmanId: null }
    });

    await expect(useAuthStore.getState().login({ email: POSTMAN_USER.email, password: "x" })).rejects.toThrow(
      /not yet linked/
    );
    expect(useAuthStore.getState().status).toBe("signedOut");
  });

  it("surfaces invalid-credentials errors from the backend", async () => {
    (authApi.login as jest.Mock).mockRejectedValueOnce(new Error("Invalid email or password"));

    await expect(useAuthStore.getState().login({ email: "x@x.com", password: "wrong" })).rejects.toThrow(
      "Invalid email or password"
    );
    expect(useAuthStore.getState().error).toBe("Invalid email or password");
  });
});

describe("authStore.logout", () => {
  it("clears secure storage and local session state", async () => {
    useAuthStore.setState({ status: "signedIn", user: POSTMAN_USER, error: null });

    await useAuthStore.getState().logout();

    expect(secureStorage.clear).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(useAuthStore.getState().user).toBeNull();
  });
});
