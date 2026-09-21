import { isCallablePhoneNumber, loginSchema } from "../../src/utils/validation";

describe("loginSchema", () => {
  it("accepts a valid email and password", () => {
    const result = loginSchema.safeParse({ email: "postman@postal.local", password: "a-Test-password-1" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "a-Test-password-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a too-short password", () => {
    const result = loginSchema.safeParse({ email: "postman@postal.local", password: "short" });
    expect(result.success).toBe(false);
  });
});

describe("isCallablePhoneNumber", () => {
  it("accepts a plausible phone number", () => {
    expect(isCallablePhoneNumber("+91 98200 11122")).toBe(true);
    expect(isCallablePhoneNumber("9820011122")).toBe(true);
  });

  it("rejects null, empty, and non-phone strings", () => {
    expect(isCallablePhoneNumber(null)).toBe(false);
    expect(isCallablePhoneNumber(undefined)).toBe(false);
    expect(isCallablePhoneNumber("")).toBe(false);
    expect(isCallablePhoneNumber("call me maybe")).toBe(false);
  });
});
