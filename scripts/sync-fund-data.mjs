import { fetchNavHistory, searchFunds } from "../src/dataSources/eastmoneyFundSource.mjs";
import { listFundRecords, recordSyncRun, updateFundNavSnapshot, upsertNavHistory } from "../src/data/sqliteProvider.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.search) {
  const results = await searchFunds(args.search, Number(args.limit || 10));
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const codes = args.codes ? args.codes.split(",").map((code) => code.trim()).filter(Boolean) : listFundRecords().map((fund) => fund.code);
const pages = Number(args.pages || 2);
const pageSize = Number(args.pageSize || 120);

for (const code of codes) {
  try {
    const records = await fetchNavHistory(code, { pages, pageSize });
    upsertNavHistory(code, records);
    updateFundNavSnapshot(code, records.at(-1));
    recordSyncRun("eastmoney", `fund_nav_history:${code}`, "success", `${records.length} records synced`);
    console.log(`${code}: synced ${records.length} nav records`);
  } catch (error) {
    recordSyncRun("eastmoney", `fund_nav_history:${code}`, "failed", error.message);
    console.error(`${code}: ${error.message}`);
    process.exitCode = 1;
  }
}

function parseArgs(values) {
  return values.reduce((acc, value) => {
    const match = value.match(/^--([^=]+)=(.*)$/);
    if (match) acc[match[1]] = match[2];
    return acc;
  }, {});
}
