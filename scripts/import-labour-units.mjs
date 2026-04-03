/**
 * Import labour units from AdminApp2 SQL Server into bidwright PostgreSQL.
 * Creates two LabourCostTable records (NECA, PHCC) and their entries.
 */
import { createRequire } from "module";
import { randomUUID } from "crypto";
const require = createRequire(import.meta.url);
const sql = require("mssql");
const pg = require("pg");

const ORG_ID = "cmn67dinu0001vxtg433nckex";
const PG_URL = "postgresql://bidwright:bidwright@localhost:5432/bidwright";

function cuid() {
  // simple unique id matching cuid-ish format
  return `lce-${randomUUID()}`;
}

async function main() {
  // ── Connect to SQL Server ──
  const mssqlPool = await sql.connect({
    server: "10.0.0.44",
    port: 1433,
    user: "webapp",
    password: "22Boswell",
    database: "AdminApp2",
    options: { encrypt: false, trustServerCertificate: true },
  });
  console.log("Connected to SQL Server");

  // ── Connect to PostgreSQL ──
  const pgPool = new pg.Pool({ connectionString: PG_URL });
  console.log("Connected to PostgreSQL");

  // ── Fetch all labour units ──
  const result = await mssqlPool.request().query(`
    SELECT id, ExternalID, LabourCategory, Class, SubClass,
           HourNormal, HourDifficult, HourVeryDifficult, UoM, Provider
    FROM dbo.quote_labourunit
    ORDER BY Provider, LabourCategory, Class, SubClass
  `);
  console.log(`Fetched ${result.recordset.length} rows from SQL Server`);

  const neca = result.recordset.filter((r) => r.Provider === "NECA");
  const phcc = result.recordset.filter((r) => r.Provider === "PHCC");
  console.log(`NECA: ${neca.length} rows, PHCC: ${phcc.length} rows`);

  const now = new Date().toISOString();

  // ── Create LabourCostTable records ──
  for (const [provider, rows] of [["NECA", neca], ["PHCC", phcc]]) {
    const tableId = `lct-${provider.toLowerCase()}-${randomUUID().slice(0, 8)}`;

    await pgPool.query(
      `INSERT INTO "LabourCostTable" (id, "organizationId", name, description, metadata, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tableId,
        ORG_ID,
        `${provider} Labour Units`,
        `Imported from AdminApp2.dbo.quote_labourunit — ${rows.length} entries`,
        JSON.stringify({ source: "AdminApp2", provider, importedAt: now }),
        now,
        now,
      ]
    );
    console.log(`Created LabourCostTable: ${provider} (${tableId})`);

    // ── Batch insert entries ──
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const row of batch) {
        const entryId = cuid();
        const costRates = {
          hourNormal: row.HourNormal ?? 0,
          hourDifficult: row.HourDifficult ?? 0,
          hourVeryDifficult: row.HourVeryDifficult ?? 0,
        };
        const metadata = {
          externalId: row.ExternalID?.toString() ?? "",
          uom: row.UoM ?? "",
          sourceId: row.id?.toString() ?? "",
        };
        const name = row.SubClass
          ? `${row.Class} — ${row.SubClass}`
          : row.Class || "";

        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`
        );
        params.push(
          entryId,
          tableId,
          row.ExternalID?.toString() ?? "",
          name,
          row.LabourCategory ?? "",
          JSON.stringify(costRates),
          JSON.stringify(metadata),
          inserted + (batch.indexOf(row)) // sortOrder
        );
        paramIdx += 8;
      }

      await pgPool.query(
        `INSERT INTO "LabourCostEntry" (id, "tableId", code, name, "group", "costRates", metadata, "sortOrder")
         VALUES ${values.join(", ")}`,
        params
      );
      inserted += batch.length;
      process.stdout.write(`\r  ${provider}: ${inserted}/${rows.length} entries`);
    }
    console.log(); // newline
  }

  console.log("\nDone! Import complete.");

  // ── Verify ──
  const verify = await pgPool.query(`
    SELECT t.name, COUNT(e.id) as entries
    FROM "LabourCostTable" t
    LEFT JOIN "LabourCostEntry" e ON e."tableId" = t.id
    GROUP BY t.id, t.name
    ORDER BY t.name
  `);
  console.log("\n=== Verification ===");
  console.table(verify.rows);

  await mssqlPool.close();
  await pgPool.end();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
