import { resolveApiBaseUrl } from "../../src/config/env";

describe("resolveApiBaseUrl (the app keeps reaching the backend after a Wi-Fi switch)", () => {
  it("swaps a dev-machine API host for the host the app was loaded from, keeping port and path", () => {
    expect(resolveApiBaseUrl("http://localhost:4000/api/v1", "192.168.29.11")).toBe("http://192.168.29.11:4000/api/v1");
    // A stale LAN IP left in .env from another network.
    expect(resolveApiBaseUrl("http://10.0.79.37:4000/api/v1", "192.168.29.11")).toBe("http://192.168.29.11:4000/api/v1");
    expect(resolveApiBaseUrl("http://192.168.29.11:4000/api/v1", "localhost")).toBe("http://localhost:4000/api/v1");
  });

  it("never touches a real server URL, or when the app was not loaded from a dev machine", () => {
    expect(resolveApiBaseUrl("https://api.example.com/api/v1", "192.168.29.11")).toBe("https://api.example.com/api/v1");
    expect(resolveApiBaseUrl("http://localhost:4000/api/v1", "postman.example.com")).toBe("http://localhost:4000/api/v1");
    expect(resolveApiBaseUrl("http://localhost:4000/api/v1", null)).toBe("http://localhost:4000/api/v1");
  });
});
