import { getFundRecord, listStockTagRecords, listStockTagsByCodes, recordSyncRun, upsertStockTagRecord } from "../data/sqliteProvider.mjs";
import { buildHoldings } from "./fundAnalytics.mjs";

export function listStocks(query = "") {
  return {
    rows: listStockTagRecords(query)
  };
}

export function listFundStockTags(code) {
  const fund = getFundRecord(code);
  if (!fund) {
    return {
      fundCode: code,
      quarter: "暂无持仓",
      rows: []
    };
  }

  const holdings = buildHoldings(fund.code);
  const tagsByCode = new Map(listStockTagsByCodes(holdings.rows.map((row) => row.stockCode)).map((item) => [item.code, item]));
  return {
    fundCode: fund.code,
    quarter: holdings.quarter,
    disclosureDate: holdings.disclosureDate,
    source: holdings.source,
    rows: holdings.rows.map((row) => {
      const tag = tagsByCode.get(row.stockCode);
      return {
        stockCode: row.stockCode,
        name: row.name,
        weight: row.weight,
        sector: tag?.sector || row.sector || "未分类",
        track: tag?.track || row.track || "待标注",
        concepts: tag?.concepts || [],
        tagSource: tag?.source || "holding",
        tagUpdatedAt: tag?.updatedAt || ""
      };
    })
  };
}

export function updateStockTag(stockCode, input = {}) {
  const code = String(stockCode || "").trim();
  if (!code) {
    return {
      ok: false,
      error: "Stock code is required"
    };
  }

  const tag = upsertStockTagRecord(code, {
    name: input.name,
    market: input.market,
    sector: input.sector,
    track: input.track,
    concepts: input.concepts,
    source: "manual"
  });
  recordSyncRun("manual", `stock_tag:${code}`, "success", `${tag.sector}/${tag.track} saved`);

  return {
    ok: true,
    tag
  };
}
