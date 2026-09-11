import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendSMS = vi.fn();

vi.mock("@signalhousellc/sdk", () => ({
  SignalHouseSDK: class {
    messages = { sendSMS };
    constructor(public config: Record<string, unknown>) {}
  },
}));

const ENV: Record<string, string> = {};

const loadModule = async () => {
  vi.resetModules();
  return await import("./signalhouse.ts");
};

beforeEach(() => {
  sendSMS.mockReset();
  for (const key of Object.keys(ENV)) delete ENV[key];
  ENV.SIGNALHOUSE_API_KEY = "sh-test-key";
  ENV.SIGNALHOUSE_FROM_NUMBER = "12025551234";
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (key: string) => ENV[key] },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Deno;
});

describe("toSignalHouseNumber", () => {
  it("adds the country code to a bare 10-digit number", async () => {
    const { toSignalHouseNumber } = await loadModule();
    expect(toSignalHouseNumber("4155559876")).toBe("14155559876");
  });

  it("strips E.164 and punctuation rather than passing a + through", async () => {
    const { toSignalHouseNumber } = await loadModule();
    expect(toSignalHouseNumber("+1 (415) 555-9876")).toBe("14155559876");
  });

  it("keeps an 11-digit number as-is", async () => {
    const { toSignalHouseNumber } = await loadModule();
    expect(toSignalHouseNumber("14155559876")).toBe("14155559876");
  });

  it("rejects a number too short to dial", async () => {
    const { toSignalHouseNumber } = await loadModule();
    expect(toSignalHouseNumber("5559876")).toBeNull();
  });

  it("accepts a short code only when the caller allows one", async () => {
    const { toSignalHouseNumber } = await loadModule();
    expect(toSignalHouseNumber("12345")).toBeNull();
    expect(toSignalHouseNumber("12345", { allowShortCode: true })).toBe("12345");
  });
});

describe("sendSignalHouseSms", () => {
  it("sends digits with no + prefix and returns the message id", async () => {
    sendSMS.mockResolvedValue({
      success: true,
      status: 201,
      data: { enqueuedCount: 1, insertedMessages: [{ id: "msg_123" }] },
    });

    const { sendSignalHouseSms } = await loadModule();
    const result = await sendSignalHouseSms("(415) 555-9876", "Hello");

    expect(sendSMS).toHaveBeenCalledWith({
      senderPhoneNumber: "12025551234",
      recipientPhoneNumbers: ["14155559876"],
      messageBody: "Hello",
    });
    expect(result).toMatchObject({ provider: "signalhouse", messageId: "msg_123", enqueuedCount: 1 });
  });

  it("treats a 2xx that enqueued nobody as a failure, not a send", async () => {
    sendSMS.mockResolvedValue({
      success: true,
      status: 201,
      data: {
        requestedRecipientCount: 1,
        enqueuedCount: 0,
        failedCount: 1,
        insertedMessages: [{ id: "msg_9", status: "FAILED", errorCode: "OUT" }],
      },
    });

    const { sendSignalHouseSms } = await loadModule();
    await expect(sendSignalHouseSms("4155559876", "Hello")).rejects.toMatchObject({
      code: "blocked",
      message: expect.stringContaining("opted out"),
    });
  });

  it("reports a Do Not Contact block", async () => {
    sendSMS.mockResolvedValue({
      success: true,
      status: 201,
      data: { enqueuedCount: 0, insertedMessages: [], dncBlockedNumbers: ["14155559876"] },
    });

    const { sendSignalHouseSms } = await loadModule();
    await expect(sendSignalHouseSms("4155559876", "Hello")).rejects.toMatchObject({
      code: "blocked",
      message: expect.stringContaining("Do Not Contact"),
    });
  });

  it("surfaces an envelope failure instead of treating it as sent", async () => {
    sendSMS.mockResolvedValue({ success: false, status: 429, error: "Too many requests" });

    const { sendSignalHouseSms } = await loadModule();
    await expect(sendSignalHouseSms("4155559876", "Hello")).rejects.toMatchObject({
      code: "send_failed",
      status: 429,
    });
  });

  it("refuses to send without credentials", async () => {
    delete ENV.SIGNALHOUSE_API_KEY;

    const { sendSignalHouseSms } = await loadModule();
    await expect(sendSignalHouseSms("4155559876", "Hello")).rejects.toMatchObject({
      code: "not_configured",
    });
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("rejects an unusable recipient before calling the provider", async () => {
    const { sendSignalHouseSms } = await loadModule();
    await expect(sendSignalHouseSms("555", "Hello")).rejects.toMatchObject({
      code: "invalid_recipient",
    });
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("passes a status callback url through when one is configured", async () => {
    ENV.SIGNALHOUSE_STATUS_CALLBACK_URL = "https://example.test/hook";
    sendSMS.mockResolvedValue({
      success: true,
      status: 201,
      data: { enqueuedCount: 1, insertedMessages: [{ id: "msg_1" }] },
    });

    const { sendSignalHouseSms } = await loadModule();
    await sendSignalHouseSms("4155559876", "Hello");

    expect(sendSMS).toHaveBeenCalledWith(
      expect.objectContaining({ statusCallbackUrl: "https://example.test/hook" }),
    );
  });
});
