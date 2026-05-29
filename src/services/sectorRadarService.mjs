import {
  getFundRecord,
  listSectorConstituentRecords,
  listSectorIntradayPointRecords,
  listSectorRealtimeQuoteRecords,
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
const MAX_RADAR_BOARDS = 8;

export async function buildSectorRadar(code) {
  const fund = getFundRecord(code);
  if (!fund) throw new Error(`Fund not found: ${code}`);
  const holdings = buildHoldings(fund.code);
  if (!holdings.rows.length) return emptyRadar(fund, "需要先同步季度持仓，才能映射 CPO 等实时板块。");

  try {
    const [conceptBoards, industryBoards] = await Promise.all([listConceptBoards(), listIndustryBoards()]);
    const candidates = selectBoardCandidates(holdings.rows, conceptBoards, industryBoards);
    const boards = [];

    for (const candidate of candidates.slice(0, MAX_RADAR_BOARDS)) {
      const [constituents, intraday] = await Promise.all([fetchBoardConstituents(candidate.code), fetchBoardIntraday(candidate.code)]);
      const intersections = buildIntersections(holdings.rows, constituents);
      upsertSectorRealtimeQuote(SOURCE_ID, candidate);
      replaceSectorConstituents(SOURCE_ID, candidate.code, candidate.name, constituents);
      replaceSectorIntradayPoints(SOURCE_ID, candidate.code, "1d", intraday);
      boards.push({
        ...candidate,
        intersections,
        intersectionWeight: Number(intersections.reduce((sum, item) => sum + item.weight, 0).toFixed(2)),
        matchedTerms: candidate.matchedTerms || [],
        matchedWeight: candidate.matchedWeight || 0,
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
      boards: sortRadarBoards(boards),
      message: boards.length ? "已按当前持仓映射实时行业/概念板块。" : "未找到与当前持仓匹配的实时板块。"
    };
  } catch (error) {
    const cachedRadar = buildCachedRadar(fund, holdings, `实时源暂不可用，已展示最近一次缓存：${error.message}`);
    return cachedRadar.boards.length ? cachedRadar : emptyRadar(fund, `板块实时数据源暂不可用：${error.message}`);
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

  for (const board of conceptBoards) {
    const match = scoreBoard(board, terms, "concept");
    if (match.score > 0) selected.set(board.code, { ...board, ...match });
  }

  for (const board of industryBoards) {
    const match = scoreBoard(board, terms, "industry");
    if (match.score > 0) selected.set(board.code, { ...board, ...match });
  }

  return [...selected.values()].sort((a, b) => b.score - a.score || Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0));
}

function buildCandidateTerms(holdings) {
  const terms = new Map();
  const addTerm = (term, weight, reason) => {
    const key = normalizeTerm(term);
    if (!key) return;
    const current = terms.get(key) || { key, term: displayTerm(term), weight: 0, reasons: new Set() };
    current.weight += Number(weight || 0);
    current.reasons.add(reason);
    terms.set(key, current);
  };

  for (const row of holdings) {
    const weight = Number(row.weight || 0);
    if (row.track) {
      addTerm(row.track, weight, "track");
      for (const part of splitTrackTerms(row.track)) addTerm(part, weight, "track");
      for (const alias of trackAliases(row.track)) addTerm(alias, weight, "alias");
    }
    if (row.sector) addTerm(row.sector, weight * 0.8, "sector");
    if (OPTICAL_STOCK_CODES.has(row.stockCode) || /CPO|光模块/.test(row.track)) {
      addTerm("CPO概念", weight, "holding");
      addTerm("光模块", weight, "holding");
      addTerm("通信设备", weight * 0.8, "holding");
    }
    if (/AI服务器|算力/.test(row.track)) {
      addTerm("AI服务器", weight, "holding");
      addTerm("算力", weight, "holding");
      addTerm("服务器", weight * 0.8, "holding");
    }
    if (/PCB/.test(row.track)) {
      addTerm("AI PCB", weight, "holding");
      addTerm("PCB", weight, "holding");
      addTerm("印制电路板", weight * 0.8, "holding");
    }
    if (/铜/.test(row.track) || /紫金|矿业/.test(row.name)) {
      addTerm("铜", weight, "holding");
      addTerm("有色金属", weight * 0.8, "holding");
    }
    if (/港股科技|AI应用/.test(row.track)) {
      addTerm("AI应用", weight, "holding");
      addTerm("人工智能", weight * 0.8, "holding");
      addTerm("AIGC", weight * 0.6, "holding");
    }
  }
  return [...terms.values()].sort((a, b) => b.weight - a.weight);
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

function buildCachedRadar(fund, holdings, message) {
  const cachedQuotes = listSectorRealtimeQuoteRecords(SOURCE_ID);
  if (!cachedQuotes.length) return emptyRadar(fund, message);
  const conceptBoards = cachedQuotes.filter((item) => item.type === "concept");
  const industryBoards = cachedQuotes.filter((item) => item.type === "industry");
  const candidates = selectBoardCandidates(holdings.rows, conceptBoards, industryBoards).slice(0, MAX_RADAR_BOARDS);
  const sectorCodes = candidates.map((item) => item.code);
  const constituentsBySector = groupBy(listSectorConstituentRecords(SOURCE_ID, sectorCodes), "sectorCode");
  const intradayBySector = groupBy(listSectorIntradayPointRecords(SOURCE_ID, sectorCodes), "sectorCode");
  const boards = candidates.map((candidate) => {
    const constituents = constituentsBySector.get(candidate.code) || [];
    const intersections = buildIntersections(holdings.rows, constituents);
    return {
      ...candidate,
      intersections,
      intersectionWeight: Number(intersections.reduce((sum, item) => sum + item.weight, 0).toFixed(2)),
      matchedTerms: candidate.matchedTerms || [],
      matchedWeight: candidate.matchedWeight || 0,
      intraday: (intradayBySector.get(candidate.code) || []).slice(-40)
    };
  });

  return {
    fundCode: fund.code,
    fundName: fund.name,
    source: "东方财富公开数据缓存",
    sourceId: SOURCE_ID,
    holdingQuarter: holdings.quarter,
    disclosureDate: holdings.disclosureDate,
    generatedAt: formatGeneratedAt(),
    boards: sortRadarBoards(boards),
    message
  };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

function scoreBoard(board, terms, boardType) {
  const matchedTerms = [];
  let matchedWeight = 0;
  let score = 0;
  const normalizedBoardName = normalizeTerm(board.name);

  for (const item of terms) {
    const term = item.key;
    const weight = Number(item.weight || 0);
    const exact = normalizedBoardName === term || normalizedBoardName === normalizeTerm(`${term}概念`);
    const contains = normalizedBoardName.includes(term) || term.includes(normalizedBoardName);
    if (!exact && !contains) continue;
    const multiplier = exact ? 3 : 1.45;
    const typeBoost = boardType === "concept" ? 1.15 : 0.85;
    matchedTerms.push(item.term);
    matchedWeight += weight;
    score += weight * multiplier * typeBoost;
  }

  return {
    score: Number(score.toFixed(4)),
    matchedTerms: [...new Set(matchedTerms)].slice(0, 4),
    matchedWeight: Number(matchedWeight.toFixed(2))
  };
}

function sortRadarBoards(boards) {
  return [...boards].sort((a, b) => {
    const intersectionGap = b.intersectionWeight - a.intersectionWeight;
    if (Math.abs(intersectionGap) > 0.01) return intersectionGap;
    const scoreGap = (b.score || 0) - (a.score || 0);
    if (Math.abs(scoreGap) > 0.01) return scoreGap;
    return Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0);
  });
}

function splitTrackTerms(track) {
  return String(track)
    .split(/[\/｜|、,，\s]+/)
    .map(normalizeTerm)
    .filter(Boolean);
}

function trackAliases(track) {
  const aliases = [];
  if (/CPO|光模块/.test(track)) aliases.push("CPO概念", "光通信", "通信设备");
  if (/AI服务器|服务器/.test(track)) aliases.push("算力", "服务器", "液冷服务器");
  if (/PCB/.test(track)) aliases.push("PCB", "印制电路板");
  if (/铜/.test(track)) aliases.push("铜", "有色金属");
  if (/AI应用|港股科技/.test(track)) aliases.push("人工智能", "AI应用", "AIGC");
  return aliases;
}

function normalizeTerm(value) {
  return String(value || "")
    .replace(/概念板块|行业板块|板块|指数/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function displayTerm(value) {
  return String(value || "")
    .replace(/概念板块|行业板块|板块|指数/g, "")
    .trim();
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
