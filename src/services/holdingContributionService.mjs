import { listCachedStockQuoteRecords } from "../data/sqliteProvider.mjs";
import { fetchStockQuotes } from "../dataSources/eastmoneyFundSource.mjs";
import { buildHoldings } from "./fundAnalytics.mjs";

const SOURCE_ID = "eastmoney";

export async function buildHoldingContributions(code) {
  const holdings = buildHoldings(code);
  if (!holdings.rows.length) {
    return {
      fundCode: holdings.fundCode,
      quarter: holdings.quarter,
      disclosureDate: holdings.disclosureDate,
      quoteSource: "暂无行情",
      generatedAt: formatGeneratedAt(),
      message: "需要先同步季度持仓，才能估算重仓股贡献。",
      summary: emptySummary(),
      rows: []
    };
  }

  const stockCodes = holdings.rows.map((row) => row.stockCode);
  const quoteResult = await loadQuotes(stockCodes);
  const quoteByCode = new Map(quoteResult.quotes.map((quote) => [quote.stockCode, quote]));
  const rows = holdings.rows.map((holding) => {
    const quote = quoteByCode.get(holding.stockCode);
    const stockChange = Number.isFinite(quote?.changePercent) ? quote.changePercent : 0;
    const contribution = Number(((holding.weight * stockChange) / 100).toFixed(4));
    return {
      rank: holding.rank,
      name: holding.name,
      stockCode: holding.stockCode,
      sector: holding.sector,
      track: holding.track,
      weight: holding.weight,
      latestPrice: quote?.latestPrice ?? null,
      stockChange,
      contribution,
      quoteStatus: quote ? "matched" : "missing"
    };
  });

  return {
    fundCode: holdings.fundCode,
    quarter: holdings.quarter,
    disclosureDate: holdings.disclosureDate,
    quoteSource: quoteResult.source,
    generatedAt: formatGeneratedAt(),
    message: quoteResult.message,
    summary: buildContributionSummary(rows),
    rows: rows.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
  };
}

async function loadQuotes(stockCodes) {
  try {
    const quotes = await fetchStockQuotes(stockCodes);
    if (quotes.length) {
      return {
        source: "东方财富实时行情",
        message: `已匹配 ${quotes.length}/${stockCodes.length} 只重仓股实时行情`,
        quotes
      };
    }
  } catch (error) {
    const cachedQuotes = normalizeCachedQuotes(listCachedStockQuoteRecords(SOURCE_ID, stockCodes));
    if (cachedQuotes.length) {
      return {
        source: "东方财富板块成份缓存",
        message: `实时个股行情暂不可用，已用板块成份缓存匹配 ${cachedQuotes.length}/${stockCodes.length} 只重仓股：${error.message}`,
        quotes: cachedQuotes
      };
    }
    return {
      source: "暂无可用行情",
      message: `个股行情源暂不可用：${error.message}`,
      quotes: []
    };
  }

  const cachedQuotes = normalizeCachedQuotes(listCachedStockQuoteRecords(SOURCE_ID, stockCodes));
  return {
    source: cachedQuotes.length ? "东方财富板块成份缓存" : "暂无可用行情",
    message: cachedQuotes.length ? `实时个股行情为空，已用板块成份缓存匹配 ${cachedQuotes.length}/${stockCodes.length} 只重仓股` : "暂无重仓股行情可用于贡献估算",
    quotes: cachedQuotes
  };
}

function normalizeCachedQuotes(rows) {
  const byCode = new Map();
  for (const row of rows) {
    if (!byCode.has(row.stockCode)) byCode.set(row.stockCode, row);
  }
  return [...byCode.values()];
}

function buildContributionSummary(rows) {
  const matchedRows = rows.filter((row) => row.quoteStatus === "matched");
  const positiveRows = matchedRows.filter((row) => row.contribution > 0);
  const negativeRows = matchedRows.filter((row) => row.contribution < 0);
  const positiveContribution = sumContribution(positiveRows);
  const negativeContribution = sumContribution(negativeRows);
  const netContribution = sumContribution(matchedRows);
  const topPositive = [...positiveRows].sort((a, b) => b.contribution - a.contribution)[0] || null;
  const topNegative = [...negativeRows].sort((a, b) => a.contribution - b.contribution)[0] || null;
  return {
    matchedCount: matchedRows.length,
    totalCount: rows.length,
    positiveContribution,
    negativeContribution,
    netContribution,
    topPositive,
    topNegative
  };
}

function sumContribution(rows) {
  return Number(rows.reduce((sum, row) => sum + row.contribution, 0).toFixed(4));
}

function emptySummary() {
  return {
    matchedCount: 0,
    totalCount: 0,
    positiveContribution: 0,
    negativeContribution: 0,
    netContribution: 0,
    topPositive: null,
    topNegative: null
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
