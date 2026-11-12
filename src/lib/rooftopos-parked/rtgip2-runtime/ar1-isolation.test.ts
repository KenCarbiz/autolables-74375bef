// AR-1 strict option 1: negative forgery tests at the TypeScript layer (k2/D2-ANALYSIS-r2 cases A1-A3,
// B1-B3 and C2*). Each app holds exactly stg-<app>-2 (its own key) and gw-<app>-2 (the Gateway's link
// key towards it); the -1 keys are still present in every database until cutover but are outside
// every verification path. Synthetic keys only. The database side is proven separately (ar1 rehearsal).
import { describe, expect, it } from "vitest";
import {
  MemoryNonceStore,
  canonicalize,
  hmacHex,
  sealEnvelope,
  signEnvelope,
  verifyDelivery,
  type EnvelopeV2,
  type EventType,
  type Registry,
  type ServiceKey,
} from "../rtgip2/protocol.ts";
import { draftEnvelope, syntheticRegistry, T0 } from "../rtgip2/fixtures.ts";
import {
  RECEIPT_PROTOCOL,
  deliveryIdentity,
  receiptDraft,
  signReceiptV2,
  verifyReceiptV2,
  type ReceiptV2,
} from "../rtgip2/receipt-v2.ts";
import { signReceiptQuery, verifyReceiptQuery } from "../rtgip2/receipt-query.ts";
import {
  confirmationDraft,
  inVerificationPath,
  signConfirmation,
  verifyConfirmation,
  verifySourceChain,
  type ConfirmationOutcome,
} from "./source-chain.ts";

type App = "autolabels" | "autocurb" | "autoframe";
const APPS: readonly App[] = ["autolabels", "autocurb", "autoframe"];
const base = syntheticRegistry();
const connections = base.connections;
const connsOf = (app: App) =>
  connections
    .filter((c) => c.source_app === app || c.target_app === app)
    .map((c) => c.connection_id);
const secretOf = (id: string) => `synthetic-ar1-${id}-0123456789abcdef`;
const key = (key_id: string, owner: ServiceKey["owner"], conns: string[]): ServiceKey => ({
  key_id,
  owner,
  dialect: "rtgip/2",
  connection_ids: conns,
  status: "current",
  not_before: T0 - 86_400,
  not_after: T0 + 86_400 * 90,
  secret: secretOf(key_id),
});

interface Row extends ServiceKey {
  audience: App | "gateway" | null;
}
const own = (app: App): Row => ({
  ...key(`stg-${app}-2`, app, connsOf(app)),
  audience: "gateway",
});
const link = (app: App): Row => ({
  ...key(`gw-${app}-2`, "gateway", connsOf(app)),
  audience: app,
});
/** Today's -1 rows: every app database holds all four, with no audience. */
const legacy: Row[] = [
  ...APPS.map((a) => ({ ...key(`stg-${a}-1`, a, connsOf(a)), audience: null })),
  {
    ...key(
      "stg-gateway-1",
      "gateway",
      connections.map((c) => c.connection_id),
    ),
    audience: null,
  },
];
/** What app X's database holds until the -1 rows are retired at cutover. */
const dbRows = (app: App): Row[] => [own(app), link(app), ...legacy];
/** The registry app X's runtime loads: the verification-path filter of runtime.ts and SQL. */
const appRegistry = (app: App): Registry => ({
  connections,
  keys: dbRows(app).filter((r) => inVerificationPath(app, r)),
});
/** The Gateway after cutover (A1-4): every -2 key, one link key per audience. */
const gatewayRegistry: Registry = {
  connections,
  keys: [...APPS.map(own), ...APPS.map(link)],
};
/** Everything the attacker AutoLabels can sign with: its own two -2 keys and every -1 secret. */
const alHolds = (id: string): ServiceKey | undefined =>
  [...dbRows("autolabels")].find((r) => r.key_id === id);
/** A forgery under key id `asId`, signed with a secret the attacker holds. */
const forgeKey = (asId: string, owner: ServiceKey["owner"], withId: string): ServiceKey => ({
  ...key(
    asId,
    owner,
    connections.map((c) => c.connection_id),
  ),
  secret: alHolds(withId)!.secret,
});

async function sealed(source: App, target: App, type: EventType) {
  return sealEnvelope(draftEnvelope(source, target, type));
}
const conn = (e: EnvelopeV2) =>
  connections.find(
    (c) =>
      c.source_app === e.source_app && c.target_app === e.target_app && c.tenant_id === e.tenant_id,
  )!.connection_id;
const expectOf = async (e: EnvelopeV2) => ({
  envelope: e,
  connection_id: conn(e),
  delivery_id: await deliveryIdentity(e, conn(e)),
});
/**
 * The attacker's signer: it MACs the receipt directly with a secret it holds, under any key id. The
 * core signers' own guards (owner, binding) are no defence, so forgeries never go through them.
 */
async function mac<T extends object>(
  unsigned: T,
  k: ServiceKey,
): Promise<T & { key_id: string; signature: string }> {
  const body = { ...unsigned, key_id: k.key_id };
  return {
    ...body,
    signature: await hmacHex(k.secret, RECEIPT_PROTOCOL + "\n" + canonicalize(body)),
  };
}
async function admission(e: EnvelopeV2, k: ServiceKey, at = T0): Promise<ReceiptV2> {
  return mac(
    await receiptDraft({ ...(await expectOf(e)), kind: "gateway_admission" }, "admitted", at, null),
    k,
  );
}
async function targetReceipt(
  e: EnvelopeV2,
  kind: "target_inbox" | "consumer_commit",
  prev: ReceiptV2,
  k: ServiceKey,
  issuer: Row["owner"] = e.target_app,
): Promise<ReceiptV2> {
  const d = await receiptDraft({ ...(await expectOf(e)), kind }, "applied", T0, prev);
  return mac({ ...d, issuer }, k);
}
async function confirmation(
  e: EnvelopeV2,
  adm: ReceiptV2,
  k: ServiceKey,
  outcome: ConfirmationOutcome = "consumer_committed",
) {
  return mac(await confirmationDraft(await expectOf(e), outcome, T0, adm), k);
}
const nonce = (n: number) => `ar1nonce${String(n).padStart(12, "0")}`;
async function forward(e: EnvelopeV2, body: string, k: ServiceKey, n: number) {
  return (await signEnvelope(body, e, k, T0, nonce(n))) as unknown as Record<string, string>;
}
const atTarget = async (target: App, headers: Record<string, string>, body: string) => {
  const v = await verifyDelivery(headers, body, {
    registry: appRegistry(target),
    nonces: new MemoryNonceStore(),
    nowSec: T0,
    expectedSigner: "gateway",
    receiver: target,
  });
  return "reason" in v ? v.reason : "accepted";
};
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
    return "accepted";
  } catch (err) {
    return (err as Error).message;
  }
};

describe("AR-1 key holding: each app's verification path", () => {
  it("the test signer is byte-identical to the core signers for a genuine key", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const adm = await admission(s.envelope, link("autocurb"));
    const d = await receiptDraft(
      { ...(await expectOf(s.envelope)), kind: "gateway_admission" },
      "admitted",
      T0,
      null,
    );
    expect(adm).toEqual(await signReceiptV2(d, link("autocurb")));
    const c = await confirmationDraft(await expectOf(s.envelope), "consumer_committed", T0, adm);
    expect(await confirmation(s.envelope, adm, link("autocurb"))).toEqual(
      await signConfirmation(c, link("autocurb")),
    );
  });
  it("holds exactly its own key (audience gateway) and the Gateway's key towards it", () => {
    for (const app of APPS)
      expect(appRegistry(app).keys.map((k) => k.key_id)).toEqual([`stg-${app}-2`, `gw-${app}-2`]);
  });
  it("leaves out every -1 row and every key whose audience is another app", () => {
    for (const app of APPS) {
      for (const r of legacy) expect(inVerificationPath(app, r), r.key_id).toBe(false);
      for (const other of APPS.filter((a) => a !== app)) {
        expect(inVerificationPath(app, own(other))).toBe(false);
        expect(inVerificationPath(app, link(other))).toBe(false);
        // Another app's key presented with this app as audience is still not in the path.
        expect(inVerificationPath(app, { ...own(other), audience: app })).toBe(false);
        expect(inVerificationPath(app, { ...link(other), audience: "gateway" })).toBe(false);
      }
    }
  });
});

describe("A1/A3: AutoLabels cannot forge a Gateway forward into AutoCurb or AutoFrame", () => {
  it("AF->AC media forward: own link key, a foreign key id, and the -1 Gateway key all fail", async () => {
    const s = await sealed("autoframe", "autocurb", "media.approved");
    expect(
      await atTarget("autocurb", await forward(s.envelope, s.body, link("autocurb"), 1), s.body),
    ).toBe("accepted");
    expect(
      await atTarget(
        "autocurb",
        await forward(s.envelope, s.body, alHolds("gw-autolabels-2")!, 2),
        s.body,
      ),
    ).toBe("unknown_key");
    expect(
      await atTarget(
        "autocurb",
        await forward(
          s.envelope,
          s.body,
          forgeKey("gw-autocurb-2", "gateway", "gw-autolabels-2"),
          3,
        ),
        s.body,
      ),
    ).toBe("bad_signature");
    expect(
      await atTarget(
        "autocurb",
        await forward(s.envelope, s.body, alHolds("stg-gateway-1")!, 4),
        s.body,
      ),
    ).toBe("unknown_key");
  });
  it("AC->AF appraisal forward into AutoFrame (A3) fails the same way", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    expect(
      await atTarget("autoframe", await forward(s.envelope, s.body, link("autoframe"), 5), s.body),
    ).toBe("accepted");
    expect(
      await atTarget(
        "autoframe",
        await forward(s.envelope, s.body, alHolds("gw-autolabels-2")!, 6),
        s.body,
      ),
    ).toBe("unknown_key");
    expect(
      await atTarget(
        "autoframe",
        await forward(
          s.envelope,
          s.body,
          forgeKey("gw-autoframe-2", "gateway", "stg-autolabels-2"),
          7,
        ),
        s.body,
      ),
    ).toBe("bad_signature");
    expect(
      await atTarget(
        "autoframe",
        await forward(s.envelope, s.body, alHolds("stg-gateway-1")!, 8),
        s.body,
      ),
    ).toBe("unknown_key");
  });
  it("AutoLabels cannot bypass the Gateway with its own event (C1d), with any key it holds", async () => {
    const s = await sealed("autolabels", "autocurb", "vehicle.identity_registered");
    expect(
      await atTarget(
        "autocurb",
        await forward(s.envelope, s.body, alHolds("stg-autolabels-2")!, 9),
        s.body,
      ),
    ).toBe("unknown_key");
    expect(
      await atTarget(
        "autocurb",
        await forward(s.envelope, s.body, alHolds("stg-autolabels-1")!, 10),
        s.body,
      ),
    ).toBe("unknown_key");
    expect(
      await atTarget(
        "autocurb",
        await forward(s.envelope, s.body, alHolds("gw-autolabels-2")!, 11),
        s.body,
      ),
    ).toBe("unknown_key");
  });
  it("the admission receipt attached to a forward cannot be forged either (C1e)", async () => {
    const s = await sealed("autoframe", "autocurb", "media.approved");
    const exp = { ...(await expectOf(s.envelope)), kind: "gateway_admission" as const };
    const reg = appRegistry("autocurb");
    expect(
      await rejects(verifyReceiptV2(await admission(s.envelope, link("autocurb")), exp, reg, T0)),
    ).toBe("accepted");
    expect(
      await rejects(
        verifyReceiptV2(await admission(s.envelope, alHolds("gw-autolabels-2")!), exp, reg, T0),
      ),
    ).toBe("ack_key_not_authorized");
    expect(
      await rejects(
        verifyReceiptV2(await admission(s.envelope, alHolds("stg-gateway-1")!), exp, reg, T0),
      ),
    ).toBe("ack_key_not_authorized");
    expect(
      await rejects(
        verifyReceiptV2(
          await admission(s.envelope, forgeKey("gw-autocurb-2", "gateway", "gw-autolabels-2")),
          exp,
          reg,
          T0,
        ),
      ),
    ).toBe("ack_bad_signature");
  });
});

describe("A2/C2: a source cannot be advanced by forged receipts or confirmations", () => {
  const ac = appRegistry("autocurb");
  it("the genuine path: [admission, gateway_confirmation] signed gw-autocurb-2 confirms (C2b, C2d)", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const exp = await expectOf(s.envelope);
    const adm = await admission(s.envelope, link("autocurb"));
    expect((await verifySourceChain([adm], exp, ac, T0)).state).toBe("gateway_admitted");
    expect(
      (
        await verifySourceChain(
          [adm, await confirmation(s.envelope, adm, link("autocurb"))],
          exp,
          ac,
          T0,
        )
      ).state,
    ).toBe("consumer_committed");
    expect(
      (
        await verifySourceChain(
          [adm, await confirmation(s.envelope, adm, link("autocurb"), "target_quarantined")],
          exp,
          ac,
          T0,
        )
      ).state,
    ).toBe("target_quarantined");
  });
  it("F3: a delivery_abandoned confirmation signed gw-autocurb-2 is terminal (dead_letter); nobody else can mint one", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const exp = await expectOf(s.envelope);
    const adm = await admission(s.envelope, link("autocurb"));
    const abandoned = await confirmation(s.envelope, adm, link("autocurb"), "delivery_abandoned");
    const v = await verifySourceChain([adm, abandoned], exp, ac, T0);
    expect([v.state, "confirmation" in v && v.confirmation.outcome]).toEqual([
      "dead_letter",
      "delivery_abandoned",
    ]);
    for (const k of [own("autoframe"), link("autoframe"), link("autolabels"), own("autolabels")])
      expect(
        await rejects(
          verifySourceChain(
            [adm, await confirmation(s.envelope, adm, k, "delivery_abandoned")],
            exp,
            ac,
            T0,
          ),
        ),
      ).toBe("ack_key_not_authorized");
    expect(
      await rejects(
        verifySourceChain(
          [adm, await confirmation(s.envelope, adm, forgeKey("gw-autocurb-2", "gateway", "stg-gateway-1"), "delivery_abandoned")],
          exp,
          ac,
          T0,
        ),
      ),
    ).toBe("ack_bad_signature");
  });
  it("A2: target receipts minted by AutoLabels with AutoFrame's -1 key never advance AutoCurb", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const exp = await expectOf(s.envelope);
    const adm = await admission(s.envelope, link("autocurb"));
    const inbox = await targetReceipt(s.envelope, "target_inbox", adm, alHolds("stg-autoframe-1")!);
    const commit = await targetReceipt(
      s.envelope,
      "consumer_commit",
      inbox,
      alHolds("stg-autoframe-1")!,
    );
    expect(await rejects(verifySourceChain([adm, inbox, commit], exp, ac, T0))).toBe(
      "ack_chain_shape",
    );
    expect(await rejects(verifySourceChain([adm, inbox], exp, ac, T0))).toBe("ack_wrong_stage");
    // Even genuine AutoFrame receipts are not MAC-checked at the source (A1-2).
    const genuine = await targetReceipt(s.envelope, "target_inbox", adm, own("autoframe"));
    expect(await rejects(verifySourceChain([adm, genuine], exp, ac, T0))).toBe("ack_wrong_stage");
  });
  it("C2a: an admission forged by AutoLabels never moves the row to gateway_admitted", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const exp = await expectOf(s.envelope);
    for (const id of ["gw-autolabels-2", "stg-gateway-1", "stg-autolabels-2"])
      expect(
        await rejects(
          verifySourceChain(
            [await admission(s.envelope, { ...alHolds(id)!, owner: "gateway" })],
            exp,
            ac,
            T0,
          ),
        ),
        id,
      ).toBe("ack_key_not_authorized");
  });
  it("C2e-g: forged confirmations are refused", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const exp = await expectOf(s.envelope);
    const adm = await admission(s.envelope, link("autocurb"));
    const c2e = await confirmation(s.envelope, adm, alHolds("gw-autolabels-2")!);
    expect(await rejects(verifySourceChain([adm, c2e], exp, ac, T0))).toBe(
      "ack_key_not_authorized",
    );
    const c2f = await confirmation(
      s.envelope,
      adm,
      forgeKey("gw-autocurb-2", "gateway", "gw-autolabels-2"),
    );
    expect(await rejects(verifySourceChain([adm, c2f], exp, ac, T0))).toBe("ack_bad_signature");
    const legacyConf = await confirmation(s.envelope, adm, alHolds("stg-gateway-1")!);
    expect(await rejects(verifySourceChain([adm, legacyConf], exp, ac, T0))).toBe(
      "ack_key_not_authorized",
    );
    const c2g = await targetReceipt(
      s.envelope,
      "consumer_commit",
      adm,
      alHolds("stg-autolabels-2")!,
      "autoframe",
    );
    expect(await rejects(verifySourceChain([adm, c2g], exp, ac, T0))).toBe("ack_wrong_stage");
  });
  it("a genuine confirmation is bound to its admission, delivery and outcome", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const exp = await expectOf(s.envelope);
    const adm = await admission(s.envelope, link("autocurb"));
    const other = await admission(s.envelope, link("autocurb"), T0 - 5);
    const linkedElsewhere = await confirmation(s.envelope, other, link("autocurb"));
    expect(await rejects(verifyConfirmation(linkedElsewhere, exp, ac, T0, adm))).toBe(
      "ack_missing_previous_stage",
    );
    const good = await confirmation(s.envelope, adm, link("autocurb"));
    expect(
      await rejects(
        verifyConfirmation({ ...good, outcome: "target_quarantined" }, exp, ac, T0, adm),
      ),
    ).toBe("ack_bad_signature");
    const t = await sealed("autocurb", "autolabels", "appraisal.completed");
    expect(
      await rejects(verifyConfirmation(good, await expectOf(t.envelope), ac, T0, adm)),
    ).toMatch(/^ack_wrong_/);
    // The confirmation for AutoCurb is useless at AutoLabels: its link key is not there.
    const alExp = await expectOf(s.envelope);
    expect(await rejects(verifyConfirmation(good, alExp, appRegistry("autolabels"), T0, adm))).toBe(
      "ack_key_not_authorized",
    );
  });
  it("C2h residual: AutoCurb can mint a 'Gateway' confirmation that only its own verifier accepts", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const exp = await expectOf(s.envelope);
    const adm = await admission(s.envelope, link("autocurb"));
    const self = await confirmation(s.envelope, adm, link("autocurb"));
    expect((await verifySourceChain([adm, self], exp, ac, T0)).state).toBe("consumer_committed");
    for (const other of ["autolabels", "autoframe"] as const)
      expect(await rejects(verifySourceChain([adm, self], exp, appRegistry(other), T0))).toBe(
        "ack_key_not_authorized",
      );
  });
});

describe("B1-B3: what AutoLabels can make the Gateway accept (core verifiers, Gateway registry after cutover)", () => {
  it("B1: an envelope from AutoFrame is refused, whatever AutoLabels signs it with", async () => {
    const s = await sealed("autoframe", "autolabels", "media.approved");
    const atGateway = async (k: ServiceKey, n: number) => {
      const v = await verifyDelivery(await forward(s.envelope, s.body, k, n), s.body, {
        registry: gatewayRegistry,
        nonces: new MemoryNonceStore(),
        nowSec: T0,
        expectedSigner: "source",
      });
      return "reason" in v ? v.reason : "accepted";
    };
    expect(await atGateway(own("autoframe"), 20)).toBe("accepted");
    expect(await atGateway(forgeKey("stg-autoframe-2", "autoframe", "stg-autolabels-2"), 21)).toBe(
      "bad_signature",
    );
    expect(await atGateway(alHolds("stg-autolabels-2")!, 22)).toBe("source_impersonation");
    expect(await atGateway(alHolds("stg-autoframe-1")!, 23)).toBe("unknown_key");
  });
  it("B2: a target receipt as AutoFrame is refused", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const adm = await admission(s.envelope, link("autoframe"));
    const exp = { ...(await expectOf(s.envelope)), kind: "target_inbox" as const };
    const at = (r: ReceiptV2) => rejects(verifyReceiptV2(r, exp, gatewayRegistry, T0, [adm]));
    expect(await at(await targetReceipt(s.envelope, "target_inbox", adm, own("autoframe")))).toBe(
      "accepted",
    );
    expect(
      await at(
        await targetReceipt(
          s.envelope,
          "target_inbox",
          adm,
          forgeKey("stg-autoframe-2", "autoframe", "stg-autolabels-2"),
        ),
      ),
    ).toBe("ack_bad_signature");
    expect(
      await at(
        await targetReceipt(
          s.envelope,
          "target_inbox",
          adm,
          alHolds("stg-autolabels-2")!,
          "autoframe",
        ),
      ),
    ).toBe("ack_key_not_authorized");
    expect(
      await at(await targetReceipt(s.envelope, "target_inbox", adm, alHolds("stg-autoframe-1")!)),
    ).toBe("ack_key_not_authorized");
  });
  it("B3: a receipt query as AutoCurb is refused", async () => {
    const s = await sealed("autocurb", "autoframe", "appraisal.completed");
    const exp = await expectOf(s.envelope);
    const lookup = (id: string) =>
      id === exp.delivery_id
        ? {
            connection_id: exp.connection_id,
            source_app: "autocurb",
            tenant_id: s.envelope.tenant_id,
            event_id: s.envelope.event_id,
          }
        : null;
    const at = async (k: ServiceKey, n: number) => {
      const q = await signReceiptQuery(
        { delivery_id: exp.delivery_id, event_id: s.envelope.event_id },
        k,
        T0,
        nonce(n),
      );
      const v = await verifyReceiptQuery(q.headers, q.body, {
        registry: gatewayRegistry,
        nonces: new MemoryNonceStore(),
        nowSec: T0,
        lookup,
      });
      return "reason" in v ? v.reason : "accepted";
    };
    expect(await at(own("autocurb"), 30)).toBe("accepted");
    expect(await at(forgeKey("stg-autocurb-2", "autocurb", "stg-autolabels-2"), 31)).toBe(
      "bad_signature",
    );
    expect(await at(alHolds("stg-autolabels-2")!, 32)).toBe("delivery_not_found");
    expect(await at(alHolds("stg-autocurb-1")!, 33)).toBe("unknown_key");
  });
});
