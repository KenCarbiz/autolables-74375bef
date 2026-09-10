// Guards for the Market V2 privilege migration.
//
// WHAT THESE TESTS PROVE AND WHAT THEY DO NOT.
//
// They parse migration TEXT. There is no local PostgreSQL in this repository,
// so nothing here observes a live database. They prove the migration says the
// right thing; they cannot prove the cluster ended up in that state. Effective
// privilege is proven only by the live canaries in the Gate 14A-3 Lovable
// packet, against pg_class.relacl and has_table_privilege.
//
// The parser below simulates the migration's REVOKE/GRANT sequence rather than
// grepping for strings, because the defect this file exists to catch was
// exactly a migration that named privileges individually and silently left the
// unnamed ones in place. A string match for "REVOKE" would have passed on that
// migration too.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const HISTORICAL_PATH = "supabase/migrations/20260910090000_market_intelligence_v2_audit.sql";
const ACL_PATH = "supabase/migrations/20260910120000_market_v2_acl_hardening.sql";

/** The Gate 14A-2 content, already applied to production. Immutable. */
const HISTORICAL_SHA256 =
  "894e9c034ab012afe81093724b476a744740bf652bb5dd37c98822090480a3b5";

const MARKET_V2_TABLES = [
  "vehicle_market_valuations",
  "vehicle_market_comparables",
  "market_value_model_metrics",
  "market_provider_budgets",
  "provider_request_reservations",
] as const;

const EVIDENCE_TABLES = ["vehicle_market_valuations", "vehicle_market_comparables"] as const;

const ALL_PRIVILEGES = [
  "SELECT", "INSERT", "UPDATE", "DELETE",
  "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN",
] as const;

/** Everything an ordinary tenant user must never hold on these tables. */
const FORBIDDEN_FOR_AUTHENTICATED = ALL_PRIVILEGES.filter((p) => p !== "SELECT");

const ACL_SQL = readFileSync(ACL_PATH, "utf8");

/**
 * Executable text only.
 *
 * The rollback plan lives in a comment block and contains GRANT statements that
 * are deliberately NOT executed. Parsing them as if they ran would invert every
 * assertion in this file, so comments are stripped before anything else.
 */
const stripComments = (sql: string): string =>
  sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");

const EXECUTABLE = stripComments(ACL_SQL);

const statements = EXECUTABLE.split(";")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean);

type Grantee = "PUBLIC" | "anon" | "authenticated" | "service_role" | string;

const parseRoles = (raw: string): Grantee[] =>
  raw.split(",").map((r) => r.trim()).filter(Boolean);

const parsePrivileges = (raw: string): string[] => {
  const cleaned = raw.replace(/\bPRIVILEGES\b/i, "").trim();
  if (/^ALL$/i.test(cleaned)) return [...ALL_PRIVILEGES];
  return cleaned.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
};

/**
 * Replay the migration and return the privilege each grantee ends up holding.
 *
 * Sound because the migration revokes ALL from every grantee it touches before
 * granting anything back — asserted independently below. Without that property
 * the final state would depend on the pre-existing grants, which this file
 * cannot see.
 */
interface AclStatement {
  verb: "GRANT" | "REVOKE";
  privileges: string[];
  tables: string[];
  roles: string[];
}

/**
 * One statement may name several tables:
 *
 *   REVOKE ALL PRIVILEGES ON TABLE public.a, public.b FROM sandbox_exec;
 *
 * so the table list is parsed as a list. An earlier version of this parser
 * matched a single table immediately before FROM, which silently registered
 * only the LAST table of a multi-table statement and would have reported the
 * others as untouched.
 */
function parseStatements(): AclStatement[] {
  const parsed: AclStatement[] = [];
  for (const stmt of statements) {
    const m = /^(GRANT|REVOKE)\s+(.+?)\s+ON\s+(?:TABLE\s+)?(.+?)\s+(?:TO|FROM)\s+(.+)$/i.exec(stmt);
    if (!m) continue;
    parsed.push({
      verb: m[1].toUpperCase() as "GRANT" | "REVOKE",
      privileges: parsePrivileges(m[2]),
      tables: [...m[3].matchAll(/public\.(\w+)/g)].map((t) => t[1]),
      roles: parseRoles(m[4]),
    });
  }
  return parsed;
}

const PARSED = parseStatements();

function simulate(): Map<string, Set<string>> {
  const state = new Map<string, Set<string>>();
  const key = (t: string, r: string) => `${t}|${r}`;
  const touch = (t: string, r: string) => {
    if (!state.has(key(t, r))) state.set(key(t, r), new Set());
    return state.get(key(t, r))!;
  };

  for (const { verb, privileges, tables, roles } of PARSED) {
    for (const table of tables) {
      for (const role of roles) {
        const holds = touch(table, role);
        for (const p of privileges) {
          if (verb === "REVOKE") holds.delete(p);
          else holds.add(p);
        }
      }
    }
  }
  return state;
}

const FINAL = simulate();
const held = (table: string, role: string): string[] =>
  [...(FINAL.get(`${table}|${role}`) ?? new Set<string>())].sort();

describe("the historical migration is immutable", () => {
  it("has not been modified since it was applied to production", () => {
    // 20260910090000 is live production state. Editing it would silently
    // desynchronise the repository from a schema that already exists.
    const actual = createHash("sha256").update(readFileSync(HISTORICAL_PATH)).digest("hex");
    expect(actual).toBe(HISTORICAL_SHA256);
  });
});

describe("the ACL migration changes privileges and nothing else", () => {
  it("contains only GRANT and REVOKE statements", () => {
    const offenders = statements.filter((s) => !/^(GRANT|REVOKE)\b/i.test(s));
    expect(offenders).toEqual([]);
  });

  it("creates, alters and drops nothing", () => {
    for (const verb of [
      "CREATE", "DROP", "ALTER TABLE", "ALTER FUNCTION", "ALTER POLICY", "TRUNCATE",
    ]) {
      expect(EXECUTABLE.toUpperCase(), verb).not.toContain(verb);
    }
  });

  it("writes no rows", () => {
    for (const dml of ["INSERT INTO", "UPDATE PUBLIC.", "DELETE FROM"]) {
      expect(EXECUTABLE.toUpperCase(), dml).not.toContain(dml);
    }
  });

  it("does not weaken row level security", () => {
    const upper = EXECUTABLE.toUpperCase();
    expect(upper).not.toContain("DISABLE ROW LEVEL SECURITY");
    expect(upper).not.toContain("NO FORCE ROW LEVEL SECURITY");
    expect(upper).not.toContain("ROW LEVEL SECURITY");
  });

  it("removes no policy and no trigger", () => {
    const upper = EXECUTABLE.toUpperCase();
    expect(upper).not.toContain("DROP POLICY");
    expect(upper).not.toContain("DROP TRIGGER");
  });

  it("does not change default privileges", () => {
    // The public-schema default grants arwdDxtm to anon, authenticated and
    // service_role on every new table, not just these five. Correcting it needs
    // an audit of every table in the schema, so it is deliberately out of scope.
    expect(EXECUTABLE.toUpperCase()).not.toContain("ALTER DEFAULT PRIVILEGES");
  });

  it("does not alter sandbox_exec's role attributes", () => {
    // Its table grants are narrowed below, but LOGIN and BYPASSRLS are
    // platform-managed and the sandbox depends on them. This migration has no
    // business reaching outside its five tables to alter a platform identity.
    const upper = EXECUTABLE.toUpperCase();
    expect(upper).not.toContain("ALTER ROLE");
    expect(upper).not.toContain("NOLOGIN");
    expect(upper).not.toContain("NOBYPASSRLS");
    expect(upper).not.toContain("CREATE ROLE");
    expect(upper).not.toContain("DROP ROLE");
  });

  it("touches only the five allowlisted tables", () => {
    const referenced = new Set(
      [...EXECUTABLE.matchAll(/public\.(\w+)/g)].map((m) => m[1]),
    );
    expect([...referenced].sort()).toEqual([...MARKET_V2_TABLES].sort());
  });

  it("revokes ALL from every grantee it touches before granting anything back", () => {
    // This is what makes the simulation sound, and it is the defect that let
    // TRUNCATE survive 20260910090000: revoking by name leaves the unnamed
    // privileges in place.
    for (const table of MARKET_V2_TABLES) {
      const grantees = PARSED
        .filter((s) => s.verb === "REVOKE"
          && s.tables.includes(table)
          && ALL_PRIVILEGES.every((p) => s.privileges.includes(p)))
        .flatMap((s) => s.roles);
      expect(grantees, table).toEqual(
        expect.arrayContaining(["PUBLIC", "anon", "authenticated", "service_role", "sandbox_exec"]),
      );
    }
  });
});

describe("PUBLIC and anon end up with nothing", () => {
  for (const table of MARKET_V2_TABLES) {
    it(`grants PUBLIC no privilege on ${table}`, () => {
      expect(held(table, "PUBLIC")).toEqual([]);
    });
    it(`grants anon no privilege on ${table}`, () => {
      expect(held(table, "anon")).toEqual([]);
    });
  }

  it("never names anon or PUBLIC in a GRANT", () => {
    const grants = statements.filter((s) => /^GRANT\b/i.test(s));
    for (const g of grants) {
      const roles = parseRoles(/\sTO\s+(.+)$/i.exec(g)![1]);
      expect(roles, g).not.toContain("anon");
      expect(roles, g).not.toContain("PUBLIC");
    }
  });
});

describe("authenticated ends up with SELECT and nothing else", () => {
  for (const table of MARKET_V2_TABLES) {
    it(`holds exactly SELECT on ${table}`, () => {
      expect(held(table, "authenticated")).toEqual(["SELECT"]);
    });

    it(`holds none of the mutation or whole-table privileges on ${table}`, () => {
      // RLS mediates SELECT/INSERT/UPDATE/DELETE only. TRUNCATE and REFERENCES
      // are whole-table operations that no policy can restrain, which is why
      // they have to be absent at the privilege layer.
      for (const priv of FORBIDDEN_FOR_AUTHENTICATED) {
        expect(held(table, "authenticated"), `${table}:${priv}`).not.toContain(priv);
      }
    });
  }
});

describe("service_role holds the minimum each table's callers require", () => {
  const EXPECTED: Record<string, string[]> = {
    // market_valuation_commit inserts; the writer reads its own last-good row.
    vehicle_market_valuations: ["INSERT", "SELECT"],
    vehicle_market_comparables: ["INSERT", "SELECT"],
    // UPDATE is required: market_reserve_provider_call is SECURITY INVOKER and
    // takes SELECT ... FOR UPDATE, which PostgreSQL refuses without it.
    // No INSERT: nothing in the codebase creates a budget row.
    market_provider_budgets: ["SELECT", "UPDATE"],
    // INSERT on reserve, UPDATE for reserved -> succeeded / failed / expired.
    provider_request_reservations: ["INSERT", "SELECT", "UPDATE"],
    // No writer exists today, so no write privilege is granted for one.
    market_value_model_metrics: ["SELECT"],
  };

  for (const [table, expected] of Object.entries(EXPECTED)) {
    it(`holds exactly ${expected.join(", ")} on ${table}`, () => {
      expect(held(table, "service_role")).toEqual(expected);
    });
  }

  for (const table of EVIDENCE_TABLES) {
    it(`cannot mutate or reshape ${table}`, () => {
      for (const priv of ["UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
        expect(held(table, "service_role"), `${table}:${priv}`).not.toContain(priv);
      }
    });
  }

  for (const table of MARKET_V2_TABLES) {
    it(`never holds TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on ${table}`, () => {
      for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
        expect(held(table, "service_role"), `${table}:${priv}`).not.toContain(priv);
      }
    });
  }

  it("grants DELETE on no table at all", () => {
    for (const table of MARKET_V2_TABLES) {
      for (const role of ["authenticated", "service_role"]) {
        expect(held(table, role), `${table}:${role}`).not.toContain("DELETE");
      }
    }
  });
});

describe("sandbox_exec keeps diagnostic read access and loses everything else", () => {
  // Lovable's platform diagnostic SQL identity connects as
  // sandbox_exec.<project_ref> through the Supabase pooler. It needs to READ
  // these tables to answer diagnostic questions, and denying SELECT would not
  // even hide the data — the role holds BYPASSRLS regardless.
  //
  // INSERT is the one that matters, and it is the one the append-only design
  // cannot cover: the triggers reject UPDATE and DELETE, so they stop history
  // being rewritten or erased, but a fabricated INSERT is a brand-new row and
  // passes straight through them.
  for (const table of MARKET_V2_TABLES) {
    it(`holds exactly SELECT on ${table}`, () => {
      expect(held(table, "sandbox_exec")).toEqual(["SELECT"]);
    });

    it(`holds no write or whole-table privilege on ${table}`, () => {
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
        expect(held(table, "sandbox_exec"), `${table}:${priv}`).not.toContain(priv);
      }
    });
  }

  it("revokes from sandbox_exec on all five tables before granting back", () => {
    const revoked = new Set(
      PARSED.filter((s) => s.verb === "REVOKE" && s.roles.includes("sandbox_exec"))
        .flatMap((s) => s.tables),
    );
    expect([...revoked].sort()).toEqual([...MARKET_V2_TABLES].sort());
  });

  it("grants sandbox_exec nothing but SELECT anywhere in the migration", () => {
    const granted = PARSED
      .filter((s) => s.verb === "GRANT" && s.roles.includes("sandbox_exec"))
      .flatMap((s) => s.privileges);
    expect([...new Set(granted)]).toEqual(["SELECT"]);
  });
});
