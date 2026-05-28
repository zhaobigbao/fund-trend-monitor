import { getFundRecord, recordSyncRun, replaceCurrentHoldings } from "../data/sqliteProvider.mjs";
import { buildHoldings } from "./fundAnalytics.mjs";

export function updateFundHoldings(code, input = {}) {
  const fund = getFundRecord(code);
  if (!fund) {
    return {
      ok: false,
      code,
      error: "Fund not found"
    };
  }

  const disclosure = normalizeDisclosure(input);
  const rows = normalizeRows(input.rows);
  if (!disclosure.quarter) {
    return {
      ok: false,
      code: fund.code,
      error: "Invalid quarter"
    };
  }
  if (!rows.length) {
    return {
      ok: false,
      code: fund.code,
      error: "At least one holding row is required"
    };
  }

  replaceCurrentHoldings(fund.code, disclosure, rows);
  recordSyncRun("manual", `fund_holdings:${fund.code}`, "success", `${rows.length} holding rows saved`);

  return {
    ok: true,
    holdings: buildHoldings(fund.code)
  };
}

function normalizeDisclosure(input) {
  const quarter = String(input.quarter || "").trim().toUpperCase();
  return {
    quarter: /^20\d{2}Q[1-4]$/.test(quarter) ? quarter : "",
    disclosureDate: normalizeDate(input.disclosureDate),
    source: String(input.source || "本地补录").trim().slice(0, 40) || "本地补录"
  };
}

function normalizeRows(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      name: String(row.name || "").trim(),
      stockCode: String(row.stockCode || row.code || "").trim(),
      weight: Number(row.weight),
      sector: String(row.sector || "").trim(),
      track: String(row.track || "").trim(),
      change: Number(row.change || 0),
      note: String(row.note || "").trim()
    }))
    .filter((row) => {
      if (!row.name || !row.stockCode || seen.has(row.stockCode)) return false;
      seen.add(row.stockCode);
      return true;
    })
    .slice(0, 10);
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
