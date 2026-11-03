/** SIGKILL fixture process: ONLY an explicitly named disposable socket database, no credentials. */
import postgres from "postgres";
const db = process.argv[2];
if (!db || !/^gw_candidate_[a-z0-9_]+$/.test(db)) throw new Error("Disposable database required");
const sql = postgres({
  host: "/tmp/gateway-final/socket",
  username: "lovable",
  database: db,
  max: 1,
});
const data = JSON.parse(await Bun.stdin.text());
await sql.begin(async (tx) => {
  await tx`SELECT gw_r2_admit(${data.body},${data.connection},${data.sourceKey},${data.gatewayKey},${data.nonce},${data.timestamp},${data.deliveryId})`;
  process.kill(process.pid, "SIGKILL");
});
