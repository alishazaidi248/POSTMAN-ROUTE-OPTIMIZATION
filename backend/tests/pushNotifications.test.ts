import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  pushToken: { upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  user: { findFirst: vi.fn() },
  notification: { create: vi.fn() }
}));
vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const http = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("axios", () => ({ default: http }));

import { isExpoPushToken, registerPushToken, sendPushToUsers } from "../src/services/push.service";
import { announceAssignmentChanges, flushPostmanNotifications, notifyPostman } from "../src/services/postmanNotifications.service";

const TOKEN = "ExponentPushToken[abcdefghijklmnop]";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue({ id: "user-pm1" });
  prismaMock.notification.create.mockResolvedValue({});
  prismaMock.pushToken.findMany.mockResolvedValue([{ token: TOKEN }]);
  http.post.mockResolvedValue({ data: { data: [{ status: "ok" }] } });
});

describe("push token registration", () => {
  it("accepts only an Expo push token", () => {
    expect(isExpoPushToken(TOKEN)).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[xyz]")).toBe(true);
    for (const bad of ["", "abc", "fcm:APA91b...", "ExponentPushToken[]", "ExponentPushToken[a b]", "https://evil.example/x"]) expect(isExpoPushToken(bad), bad).toBe(false);
  });

  it("refuses to store a token that is not an Expo token", async () => {
    await expect(registerPushToken("u1", "not-a-token", "android")).rejects.toThrow("INVALID_PUSH_TOKEN");
    expect(prismaMock.pushToken.upsert).not.toHaveBeenCalled();
  });

  it("a device that changes hands moves its token to the new login", async () => {
    await registerPushToken("u2", TOKEN, "ios");
    expect(prismaMock.pushToken.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { token: TOKEN }, create: { userId: "u2", token: TOKEN, platform: "ios" }, update: expect.objectContaining({ userId: "u2" }) }));
  });
});

describe("sending", () => {
  it("posts the message to Expo for every registered device of the user", async () => {
    const r = await sendPushToUsers(["user-pm1"], { title: "New delivery", body: "1 new delivery has been assigned to you.", data: { type: "NEW_ASSIGNMENT" } });
    expect(r).toEqual({ sent: 1, removed: 0 });
    const [url, body] = http.post.mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(body).toEqual([expect.objectContaining({ to: TOKEN, title: "New delivery", body: "1 new delivery has been assigned to you.", data: { type: "NEW_ASSIGNMENT" } })]);
  });

  it("forgets a token Expo says is no longer registered", async () => {
    http.post.mockResolvedValue({ data: { data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] } });
    expect(await sendPushToUsers(["user-pm1"], { title: "t", body: "b" })).toEqual({ sent: 0, removed: 1 });
    expect(prismaMock.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: { in: [TOKEN] } } });
  });

  it("never throws when Expo is unreachable (a push must not fail the action behind it)", async () => {
    http.post.mockRejectedValue(new Error("ECONNRESET"));
    await expect(sendPushToUsers(["user-pm1"], { title: "t", body: "b" })).resolves.toEqual({ sent: 0, removed: 0 });
  });

  it("sends nothing to a user with no registered phone", async () => {
    prismaMock.pushToken.findMany.mockResolvedValue([]);
    expect(await sendPushToUsers(["user-pm1"], { title: "t", body: "b" })).toEqual({ sent: 0, removed: 0 });
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe("what a postman is told", () => {
  it("stores the notification first (the source of truth) and then pushes it", async () => {
    expect(await notifyPostman("pm1", { type: "ADMIN_MESSAGE", title: "Message", message: "Come to the counter.", severity: "CRITICAL" })).toBe(true);
    expect(prismaMock.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-pm1", type: "ADMIN_MESSAGE", title: "Message", message: "Come to the counter.", severity: "CRITICAL" }) });
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("a postman with no login gets nothing, and nothing throws", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    expect(await notifyPostman("pm-without-login", { type: "ADMIN_MESSAGE", title: "t", message: "m" })).toBe(false);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it("assignments that arrive together (an import) become ONE notification with the count", async () => {
    for (let i = 0; i < 12; i++) announceAssignmentChanges([{ deliveryId: `d${i}`, trackingId: `T${i}`, priority: "NORMAL", fromPostmanId: null, toPostmanId: "pm1" }]);
    await flushPostmanNotifications();
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.notification.create.mock.calls[0][0].data).toMatchObject({ type: "NEW_ASSIGNMENT", message: "12 new deliveries have been assigned to you." });
  });

  it("an URGENT delivery is announced at once, by itself", async () => {
    announceAssignmentChanges([{ deliveryId: "d1", trackingId: "T-URGENT", priority: "URGENT", fromPostmanId: null, toPostmanId: "pm1" }]);
    await vi.waitFor(() => expect(prismaMock.notification.create).toHaveBeenCalledTimes(1));
    expect(prismaMock.notification.create.mock.calls[0][0].data).toMatchObject({ type: "URGENT_ASSIGNMENT", severity: "CRITICAL", message: "Urgent delivery T-URGENT has been assigned to you." });
  });

  it("the postman who loses a delivery is told it was reassigned; the new one is told it is theirs", async () => {
    announceAssignmentChanges([{ deliveryId: "d1", trackingId: "T1", priority: "NORMAL", fromPostmanId: "pm-old", toPostmanId: "pm-new" }]);
    await flushPostmanNotifications();
    const types = prismaMock.notification.create.mock.calls.map((c) => c[0].data.type).sort();
    expect(types).toEqual(["NEW_ASSIGNMENT", "REASSIGNED"]);
  });

  it("no change of postman means no notification", async () => {
    announceAssignmentChanges([{ deliveryId: "d1", trackingId: "T1", priority: "NORMAL", fromPostmanId: "pm1", toPostmanId: "pm1" }]);
    await flushPostmanNotifications();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});
