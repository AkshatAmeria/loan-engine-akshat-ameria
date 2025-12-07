
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { Client } = require("pg");
const csv = require("csv-parser");
const https = require("https");

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

exports.handler = async (event) => {
  console.log("📥 CSV PROCESSOR STARTED");

  
  if (!event.Records) {
    return testDatabaseConnection();
  }

  
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
  console.log("📁 Bucket:", bucket);
  console.log("📄 Key:", key);

  
  const db = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  await db.connect();

  try {
    // Read CSV from S3 
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = response.Body;

    const rows = [];
    console.log("📄 Parsing CSV...");

    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on("data", (row) => rows.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    console.log(`📊 Parsed ${rows.length} rows`);

    // Insert/update users
    let saved = 0;

    for (const row of rows) {
      if (!row.email) continue;

      await db.query(
        `
        INSERT INTO users (user_id, name, email, monthly_income, credit_score, employment_status, age)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (email) DO UPDATE SET
          monthly_income = EXCLUDED.monthly_income,
          credit_score = EXCLUDED.credit_score,
          employment_status = EXCLUDED.employment_status,
          age = EXCLUDED.age;
        `,
        [
          row.user_id || null,
          row.name || "User",
          row.email,
          Number(row.monthly_income) || 0,
          Number(row.credit_score) || 0,
          row.employment_status || null,
          Number(row.age) || 0,
        ]
      );

      saved++;
    }

    console.log(`🟢 Users inserted/updated: ${saved}`);

    //  Trigger Workflow B (empty POST {})

    if (process.env.WEBHOOK_URL) {
      console.log(`🔔 Triggering Workflow B → ${process.env.WEBHOOK_URL}`);

      await triggerWebhook(process.env.WEBHOOK_URL);

      console.log("✅ Workflow B triggered successfully");
    } else {
      console.log("⚠️ No WEBHOOK_URL provided. Skipping.");
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "CSV processed and Workflow B triggered.",
        inserted: saved,
      }),
    };

  } catch (err) {
    console.error("ERROR:", err);
    throw err;

  } finally {
    await db.end();
  }
};


function triggerWebhook(url) {
  const body = "{}"; // EMPTY JSON BODY 
  const u = new URL(url);

  const options = {
    hostname: u.hostname,
    path: u.pathname + (u.search || ""),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": body.length,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.on("data", () => {});
      res.on("end", resolve);
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}


async function testDatabaseConnection() {
  console.log("🔍 Testing DB connection...");

  const db = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  await db.connect();
  const result = await db.query("SELECT NOW()");
  console.log("🕒 DB TIME:", result.rows);
  await db.end();

  return { statusCode: 200, body: "DB OK" };
}
