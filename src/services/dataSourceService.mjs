import {
  getFundRecord,
  getFundSourceBinding,
  getNavSyncSummary,
  listDataSourceDefaultRecords,
  listDataSourceRecords,
  updateDataSourceHealth,
  upsertDataSourceDefault,
  upsertFundSourceBinding
} from "../data/sqliteProvider.mjs";
import { checkHealth } from "../dataSources/eastmoneyFundSource.mjs";
import { buildHoldings } from "./fundAnalytics.mjs";

const SOURCE_DOMAIN_LABELS = {
  fund: "基金基础",
  fundNav: "净值走势",
  fundHoldings: "季度持仓",
  sectorBoard: "板块走势",
  researchReports: "研报摘要"
};

export function listDataSources() {
  return {
    sources: listDataSourceRecords(),
    defaults: listDataSourceDefaultRecords()
  };
}

export function updateDataSourceDefaults(input = {}) {
  const allowedSources = new Set(listDataSourceRecords().map((source) => source.id));
  for (const [domain, sourceId] of Object.entries(input.defaults || {})) {
    if (SOURCE_DOMAIN_LABELS[domain] && allowedSources.has(sourceId)) upsertDataSourceDefault(domain, sourceId);
  }
  return listDataSources();
}

export function updateFundSourceBindings(code, input = {}) {
  const fund = getFundRecord(code);
  if (!fund) return { ok: false, error: "Fund not found" };
  const allowedSources = new Set(listDataSourceRecords().map((source) => source.id));
  for (const [domain, sourceId] of Object.entries(input.bindings || {})) {
    if (SOURCE_DOMAIN_LABELS[domain] && allowedSources.has(sourceId)) upsertFundSourceBinding(fund.code, domain, sourceId);
  }
  return buildSourceCoverage(fund.code);
}

export function buildSourceCoverage(code) {
  const fund = getFundRecord(code);
  const sources = listDataSourceRecords();
  const defaults = new Map(listDataSourceDefaultRecords().map((item) => [item.domain, item.sourceId]));
  const holdings = buildHoldings(fund.code);
  const navSummary = getNavSyncSummary(fund.code);

  const domains = Object.keys(SOURCE_DOMAIN_LABELS).map((domain) => {
    const sourceId = getFundSourceBinding(fund.code, domain) || defaults.get(domain) || "eastmoney";
    const source = sources.find((item) => item.id === sourceId);
    return {
      domain,
      label: SOURCE_DOMAIN_LABELS[domain],
      sourceId,
      sourceName: source?.name || sourceId,
      status: coverageStatus(domain, { holdings, navSummary }),
      detail: coverageDetail(domain, { holdings, navSummary })
    };
  });

  return {
    fundCode: fund.code,
    fundName: fund.name,
    domains,
    sources,
    defaults: Object.fromEntries(defaults.entries())
  };
}

export async function testDataSource(sourceId) {
  if (sourceId !== "eastmoney") return { sourceId, ok: false, message: "当前仅实现东方财富公开数据源" };
  try {
    const result = await checkHealth();
    updateDataSourceHealth(sourceId, result.ok ? "healthy" : "degraded");
    return { sourceId, ok: result.ok, message: result.ok ? "数据源可访问" : "数据源返回为空", checkedAt: result.checkedAt };
  } catch (error) {
    updateDataSourceHealth(sourceId, "failed");
    return { sourceId, ok: false, message: error.message, checkedAt: new Date().toISOString() };
  }
}

function coverageStatus(domain, { holdings, navSummary }) {
  if (domain === "fundNav") return navSummary.recordCount ? "ready" : "pending";
  if (domain === "fundHoldings") return holdings.rows.length ? "ready" : "pending";
  if (domain === "sectorBoard") return holdings.rows.length ? "ready" : "needsHoldings";
  if (domain === "researchReports") return "partial";
  return "ready";
}

function coverageDetail(domain, { holdings, navSummary }) {
  if (domain === "fundNav") return navSummary.recordCount ? `${navSummary.recordCount} 条，最新 ${navSummary.latestNavDate}` : "尚未同步净值";
  if (domain === "fundHoldings") return holdings.rows.length ? `${holdings.quarter}，${holdings.rows.length} 条持仓` : "尚未同步持仓";
  if (domain === "sectorBoard") return holdings.rows.length ? "可按持仓映射板块" : "需要先同步季度持仓";
  if (domain === "researchReports") return "本地摘要 + 后续可接商业源";
  return "基础资料";
}
