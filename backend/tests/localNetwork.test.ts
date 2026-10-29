import { describe, expect, it } from "vitest";
import { isLocalNetworkOrigin } from "../src/utils/localNetwork";

describe("isLocalNetworkOrigin (dev CORS survives a Wi-Fi switch)", () => {
  it("allows this machine and any private LAN address, on any port", () => {
    for (const o of ["http://localhost:8081", "http://127.0.0.1:5173", "http://192.168.29.11:8081", "http://10.0.79.37:8081", "http://172.20.1.5:8081"]) {
      expect(isLocalNetworkOrigin(o)).toBe(true);
    }
  });

  it("refuses public hosts, look-alikes and garbage", () => {
    for (const o of ["https://evil.example.com", "http://8.8.8.8", "http://172.32.0.1", "http://192.169.1.1", "http://192.168.1.1.evil.com", "not a url"]) {
      expect(isLocalNetworkOrigin(o)).toBe(false);
    }
  });
});
