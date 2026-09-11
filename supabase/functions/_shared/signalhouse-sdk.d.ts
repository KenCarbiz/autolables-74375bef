// @signalhousellc/sdk ships no type declarations (package.json has no "types"
// field), so deno check fails with TS2307 on the npm: import. This ambient
// declaration covers the surface _shared/signalhouse.ts actually uses.
declare module "npm:@signalhousellc/sdk@1.0.66" {
  export class SignalHouseSDK {
    constructor(options: { apiKey: string; baseUrl?: string });
    messages: {
      sendSMS(options: {
        senderPhoneNumber: string;
        recipientPhoneNumbers: string[];
        messageBody: string;
        statusCallbackUrl?: string;
      }): Promise<{
        success?: boolean;
        error?: unknown;
        status?: number;
        data?: Record<string, unknown>;
      }>;
    };
  }
}
