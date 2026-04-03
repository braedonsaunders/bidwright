/**
 * Import labour units from AdminApp2 SQL Server into bidwright PostgreSQL
 * as Dataset + DatasetRow records in the Knowledge section.
 * Creates two Datasets: NECA Labour Units, PHCC Labour Units.
 */
const sql = require("mssql");
const pg = require("pg");
const { randomUUID } = require("crypto");

const ORG_ID = "cmn67dinu0001vxtg433nckex";
const PG_URL = "postgresql://bidwright:bidwright@localhost:5432/bidwright";

const COLUMNS = [
  { key: "labour_category", name: "Labour Category", type: "text", required: false },
  { key: "class", name: "Class", type: "text", required: false },
  { key: "sub_class", name: "Sub Class", type: "text", required: false },
  { key: "hour_normal", name: "Hour Normal", type: "number", required: false },
  { key: "hour_difficult", name: "Hour Difficult", type: "number", required: false },
  { key: "hour_very_difficult", name: "Hour Very Difficult", type: "number", required: false },
  { key: "uom", name: "UoM", type: "text", required: false },
];

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

  // ── Create Dataset + DatasetRow records ──
  for (const [provider, rows] of [["NECA", neca], ["PHCC", phcc]]) {
    const datasetId = `ds-${provider.toLowerCase()}-${randomUUID().slice(0, 8)}`;

    await pgPool.query(
      `INSERT INTO "Dataset" (
        id, "organizationId", name, description, category, scope,
        columns, "rowCount", source, "sourceDescription", tags,
        "isTemplate", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        datasetId,
        ORG_ID,
        `${provider} Labour Units`,
        `${provider} labour unit hours (normal/difficult/very difficult) — ${rows.length} items imported from AdminApp2`,
        "labour_units",
        "global",
        JSON.stringify(COLUMNS),
        rows.length,
        "import",
        "Imported from AdminApp2.dbo.quote_labourunit",
        `{${provider.toLowerCase()},"labour units","man-hours","labour","estimating"}`,
        false,
        now,
        now,
      ]
    );
    console.log(`Created Dataset: ${provider} Labour Units (${datasetId})`);

    // ── Batch insert DatasetRow records ──
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const rowId = `dr-${randomUUID()}`;
        const data = {
          labour_category: row.LabourCategory ?? "",
          class: row.Class ?? "",
          sub_class: row.SubClass ?? "",
          hour_normal: row.HourNormal ?? 0,
          hour_difficult: row.HourDifficult ?? 0,
          hour_very_difficult: row.HourVeryDifficult ?? 0,
          uom: row.UoM ?? "",
        };
        const metadata = {
          externalId: row.ExternalID?.toString() ?? "",
          sourceId: row.id?.toString() ?? "",
        };

        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6})`
        );
        params.push(
          rowId,
          datasetId,
          JSON.stringify(data),
          inserted + j,
          JSON.stringify(metadata),
          now,
          now,
        );
        paramIdx += 7;
      }

      await pgPool.query(
        `INSERT INTO "DatasetRow" (id, "datasetId", data, "order", metadata, "createdAt", "updatedAt")
         VALUES ${values.join(", ")}`,
        params
      );
      inserted += batch.length;
      process.stdout.write(`\r  ${provider}: ${inserted}/${rows.length} rows`);
    }
    console.log();
  }

  console.log("\nDone! Import complete.");

  // ── Verify ──
  const verify = await pgPool.query(`
    SELECT d.name, d.category, d."rowCount", COUNT(r.id) as actual_rows
    FROM "Dataset" d
    LEFT JOIN "DatasetRow" r ON r."datasetId" = d.id
    WHERE d.name LIKE '%Labour Units'
    GROUP BY d.id, d.name, d.category, d."rowCount"
    ORDER BY d.name
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
