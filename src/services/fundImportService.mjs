import { fetchNavHistory, searchFunds } from "../dataSources/eastmoneyFundSource.mjs";
import { getFundRecord, recordSyncRun, updateFundNavSnapshot, upsertFundRecord, upsertNavHistory } from "../data/sqliteProvider.mjs";

export async function searchExternalFunds(keyword, limit = 8) {
  if (!keyword.trim()) return [];
  const results = await searchFunds(keyword, limit);
  return results.map((item) => ({
    ...item,
    imported: Boolean(getFundRecord(item.code))
  }));
}

export async function importExternalFund(code, { syncNav = true } = {}) {
  const matches = await searchFunds(code, 1);
  const match = matches.find((item) => item.code === code) || matches[0];
  if (!match) throw new Error(`Fund not found: ${code}`);

  upsertFundRecord({
    code: match.code,
    name: match.name,
    manager: "待同步",
    category: normalizeCategory(match.category),
    risk: "待评估",
    nav: match.nav || 0,
    dailyChange: 0,
    quarterlyReturn: 0,
    maxDrawdown: 0,
    volatility: 0,
    size: "待同步",
    benchmark: "待同步",
    updateAt: match.navDate || "待同步"
  });

  let syncedRecords = 0;
  if (syncNav) {
    const records = await fetchNavHistory(match.code, { pages: 1, pageSize: 90 });
    upsertNavHistory(match.code, records);
    updateFundNavSnapshot(match.code, records.at(-1));
    recordSyncRun("eastmoney", `fund_import:${match.code}`, "success", `${records.length} records synced`);
    syncedRecords = records.length;
  }

  return {
    ...getFundRecord(match.code),
    syncedRecords
  };
}

function normalizeCategory(category) {
  if (!category || category === "基金") return "待分类";
  return category;
}
