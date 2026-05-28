import {
  getFundRecord,
  recordSyncRun,
  replaceCurrentHoldings,
  replaceSectorConstituents,
  replaceSectorIntradayPoints,
  upsertSectorRealtimeQuote
} from "../data/sqliteProvider.mjs";
import {
  fetchBoardConstituents,
  fetchBoardIntraday,
  fetchFundPortfolioHoldings,
  listConceptBoards,
  listIndustryBoards
} from "../dataSources/eastmoneyFundSource.mjs";
import { buildHoldings } from "./fundAnalytics.mjs";

const SOURCE_ID = "eastmoney";
const OPTICAL_STOCK_CODES = new Set(["300502", "300308", "300394", "301205", "300620", "603083", "601138"]);

export async function buildSectorRadar(code) {
  const fund = getFundRecord(code);
  if (!fund) throw new Error(`Fund not found: ${code}`);
  const holdings = buildHoldings(fund.code);
  if (!holdings.rows.length) return emptyRadar(fund, "需要先同步季度持仓，才能映射 CPO 等实时板块。");

  try {
    const [conceptBoards, industryBoards] = await Promise.all([listConceptBoards(), listIndustryBoards()]);
    const candidates = selectBoardCandidates(holdings.rows, conceptBoards, industryBoards);
    const boards = [];

    for (const candidate of candidates.slice(0, 5)) {
      const [constituents, intraday] = await Promise.all([fetchBoardConstituents(candidate.code), fetchBoardIntraday(candidate.code)]);
      const intersections = buildIntersections(holdings.rows, constituents);
      upsertSectorRealtimeQuote(SOURCE_ID, candidate);
      replaceSectorConstituents(SOURCE_ID, candidate.code, candidate.name, constituents);
      replaceSectorIntradayPoints(SOURCE_ID, candidate.code, "1d", intraday);
      boards.push({
        ...candidate,
        intersections,
        intersectionWeight: Number(intersections.reduce((sum, item) => sum + item.weight, 0).toFixed(2)),
        intraday: intraday.slice(-40)
      });
    }

    return {
      fundCode: fund.code,
      fundName: fund.name,
      source: "东方财富公开数据",
      sourceId: SOURCE_ID,
      holdingQuarter: holdings.quarter,
      disclosureDate: holdings.disclosureDate,
      generatedAt: formatGeneratedAt(),
      boards: boards.sort((a, b) => b.intersectionWeight - a.intersectionWeight || Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0)),
      message: boards.length ? "已按当前持仓映射实时行业/概念板块。" : "未找到与当前持仓匹配的实时板块。"
    };
  } catch (error) {
    return emptyRadar(fund, `板块实时数据源暂不可用：${error.message}`);
  }
}

export async function syncFundRealData(code) {
  const fund = getFundRecord(code);
  if (!fund) throw new Error(`Fund not found: ${code}`);

  try {
    const portfolio = await fetchFundPortfolioHoldings(fund.code);
    if (!portfolio.rows.length) throw new Error("东方财富未返回持仓明细");
    replaceCurrentHoldings(
      fund.code,
      {
        quarter: portfolio.quarter,
        disclosureDate: portfolio.disclosureDate || portfolio.quarter,
        source: "东方财富基金档案"
      },
      portfolio.rows
    );
    recordSyncRun(SOURCE_ID, `fund_real_data:${fund.code}`, "success", `${portfolio.quarter} holdings synced`);
    const radar = await buildSectorRadar(fund.code);
    return { ok: true, fundCode: fund.code, syncedHoldings: portfolio.rows.length, quarter: portfolio.quarter, radar };
  } catch (error) {
    recordSyncRun(SOURCE_ID, `fund_real_data:${fund.code}`, "failed", error.message);
    throw error;
  }
}

function selectBoardCandidates(holdings, conceptBoards, industryBoards) {
  const terms = buildCandidateTerms(holdings);
  const selected = new Map();

  for (const term of terms) {
    const concept = conceptBoards.find((board) => board.name === term || board.name.includes(term) || term.includes(board.name));
    if (concept) selected.set(concept.code, concept);
  }

  for (const row of holdings) {
    const industry = industryBoards.find((board) => board.name === row.sector || board.name.includes(row.sector) || row.sector.includes(board.name));
    if (industry) selected.set(industry.code, industry);
  }

  for (const board of conceptBoards) {
    if (/CPO|光模块|算力|AI|PCB|铜/.test(board.name) && terms.some((term) => board.name.includes(term) || term.includes(board.name))) {
      selected.set(board.code, board);
    }
  }

  return [...selected.values()];
}

function buildCandidateTerms(holdings) {
  const terms = new Set();
  for (const row of holdings) {
    if (row.track) terms.add(row.track.replace(/[\/｜|].*$/, ""));
    if (row.sector) terms.add(row.sector);
    if (OPTICAL_STOCK_CODES.has(row.stockCode) || /CPO|光模块/.test(row.track)) {
      terms.add("CPO概念");
      terms.add("光模块");
      terms.add("通信设备");
    }
    if (/AI服务器|算力/.test(row.track)) terms.add("算力");
    if (/PCB/.test(row.track)) terms.add("PCB");
    if (/铜/.test(row.track)) terms.add("铜");
    if (/港股科技|AI应用/.test(row.track)) terms.add("AI");
  }
  return [...terms].filter(Boolean);
}

function buildIntersections(holdings, constituents) {
  const byCode = new Map(constituents.map((item) => [item.stockCode, item]));
  return holdings
    .filter((holding) => byCode.has(holding.stockCode))
    .map((holding) => {
      const constituent = byCode.get(holding.stockCode);
      return {
        stockCode: holding.stockCode,
        name: holding.name,
        weight: holding.weight,
        latestPrice: constituent.latestPrice,
        changePercent: constituent.changePercent
      };
    });
}

function emptyRadar(fund, message) {
  return {
    fundCode: fund.code,
    fundName: fund.name,
    source: "东方财富公开数据",
    sourceId: SOURCE_ID,
    holdingQuarter: "暂无持仓",
    disclosureDate: "",
    generatedAt: formatGeneratedAt(),
    boards: [],
    message
  };
}

function formatGeneratedAt() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(new Date());
}
