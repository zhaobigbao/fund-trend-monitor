import {
  getFundRecord,
  getHoldingDisclosure,
  getNavSyncSummary,
  listAlertRules,
  listFundRecords,
  listHoldingRows,
  listNavHistory,
  listPreviousHoldingRows,
  listReportsBySignals,
  listWatchlistCodes,
  setWatchlistCode
} from "../data/sqliteProvider.mjs";

export function listFunds(query = "") {
  const keyword = query.trim().toLowerCase();
  const watchlistCodes = listWatchlistCodes();
  return listFundRecords()
    .filter((fund) => {
      if (!keyword) return true;
      return [fund.code, fund.name, fund.manager, fund.category].some((value) => String(value).toLowerCase().includes(keyword));
    })
    .map((fund) => ({
      ...fund,
      watched: watchlistCodes.has(fund.code),
      realtime: buildRealtime(fund.code)
    }));
}

export function getFund(code) {
  return getFundRecord(code) || listFundRecords()[0];
}

export function listWatchlist() {
  return listFunds().filter((fund) => fund.watched);
}

export function updateWatchlist(code, watched) {
  const fund = getFundRecord(code);
  if (!fund) return { code, watched: false, funds: listWatchlist(), error: "Fund not found" };
  setWatchlistCode(fund.code, watched);
  return { code: fund.code, watched: listWatchlistCodes().has(fund.code), funds: listWatchlist() };
}

export function seededNoise(seed, index) {
  const x = Math.sin(seed * 73.41 + index * 11.17) * 10000;
  return x - Math.floor(x);
}

export function buildTrend(code, range = "1m") {
  const fund = getFund(code);
  const historicalRows = listNavHistory(fund.code, trendLimitForRange(range));
  if (historicalRows.length >= 2) {
    return historicalRows.map((row) => ({
      label: row.navDate.slice(5),
      value: row.unitNav,
      date: row.navDate,
      source: row.source,
      dailyGrowth: row.dailyGrowth
    }));
  }

  const points = range === "1w" ? 32 : range === "3m" ? 78 : 56;
  const seed = Number(code.slice(-3));
  let value = fund.nav * (range === "3m" ? 0.94 : range === "1w" ? 0.985 : 0.965);
  return Array.from({ length: points }, (_, index) => {
    const wave = Math.sin((index + seed) / 5.4) * 0.014;
    const pulse = (seededNoise(seed, index) - 0.48) * 0.018;
    const drift = fund.dailyChange >= 0 ? 0.0024 : -0.0008;
    value = Math.max(0.2, value * (1 + wave + pulse + drift));
    return {
      label: range === "1w" ? `${9 + Math.floor(index / 4)}:${String((index % 4) * 15).padStart(2, "0")}` : `T-${points - index}`,
      value: Number(value.toFixed(4))
    };
  });
}

export function buildSyncStatus(code) {
  const fund = getFund(code);
  const summary = getNavSyncSummary(fund.code);
  const synced = summary.recordCount > 0;
  const stale = synced && isStaleNavDate(summary.latestNavDate);

  return {
    fundCode: fund.code,
    status: synced ? (stale ? "stale" : "synced") : "pending",
    label: synced ? (stale ? "待更新" : "已同步") : "待同步",
    source: summary.source || "暂无来源",
    recordCount: summary.recordCount,
    firstNavDate: summary.firstNavDate || "",
    latestNavDate: summary.latestNavDate || "",
    latestSyncedAt: summary.latestSyncedAt || "",
    latestRun: summary.latestRun,
    message: buildSyncMessage(summary, stale)
  };
}

export function buildRealtime(code) {
  const fund = getFund(code);
  const tick = Date.now() / 1000;
  const seed = Number(code.slice(-3));
  const move = Math.sin(tick / 9 + seed) * 0.008 + Math.cos(tick / 17) * 0.004;
  const nav = Number((fund.nav * (1 + move)).toFixed(4));
  return {
    code,
    nav,
    change: Number((((nav - fund.nav) / fund.nav) * 100 + fund.dailyChange * 0.32).toFixed(2)),
    time: new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai"
    }).format(new Date())
  };
}

export function buildHoldings(code) {
  const fund = getFund(code);
  const disclosure = getHoldingDisclosure(fund.code);
  if (!disclosure) {
    return {
      fundCode: fund.code,
      quarter: "暂无持仓",
      disclosureDate: "暂无披露",
      source: "尚未同步季报持仓",
      rows: [],
      concentrationTop3: 0,
      concentrationTop10: 0
    };
  }
  const rows = listHoldingRows(fund.code, disclosure.quarter);

  return {
    fundCode: fund.code,
    ...disclosure,
    rows,
    concentrationTop3: Number(rows.slice(0, 3).reduce((sum, item) => sum + item.weight, 0).toFixed(2)),
    concentrationTop10: Number(rows.reduce((sum, item) => sum + item.weight, 0).toFixed(2))
  };
}

export function buildHoldingChanges(code) {
  const fund = getFund(code);
  const holdings = buildHoldings(fund.code);
  const previousRows = listPreviousHoldingRows(fund.code, previousQuarterOf(holdings.quarter));
  const previousByCode = new Map(previousRows.map((row) => [row.stockCode, row]));
  const currentCodes = new Set(holdings.rows.map((row) => row.stockCode));

  const changedRows = holdings.rows.map((row) => {
    const previous = previousByCode.get(row.stockCode);
    const previousWeight = previous?.weight || 0;
    const delta = Number((row.weight - previousWeight).toFixed(2));
    return {
      ...row,
      previousWeight,
      delta,
      changeType: previous ? classifyPositionChange(delta) : "新进"
    };
  });

  for (const previous of previousRows) {
    if (currentCodes.has(previous.stockCode)) continue;
    changedRows.push({
      rank: changedRows.length + 1,
      name: previous.name,
      stockCode: previous.stockCode,
      weight: 0,
      previousWeight: previous.weight,
      delta: Number((0 - previous.weight).toFixed(2)),
      sector: "未知",
      track: "已退出",
      change: 0,
      note: "本季度未进入当前展示持仓",
      changeType: "退出"
    });
  }

  const summary = changedRows.reduce(
    (acc, row) => {
      if (row.changeType === "新进") acc.newCount += 1;
      if (row.changeType === "退出") acc.exitCount += 1;
      if (row.delta > 0) acc.increaseWeight += row.delta;
      if (row.delta < 0) acc.decreaseWeight += Math.abs(row.delta);
      return acc;
    },
    { newCount: 0, exitCount: 0, increaseWeight: 0, decreaseWeight: 0 }
  );

  return {
    fundCode: fund.code,
    quarter: holdings.quarter,
    previousQuarter: previousQuarterOf(holdings.quarter),
    rows: changedRows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    summary: {
      ...summary,
      increaseWeight: Number(summary.increaseWeight.toFixed(2)),
      decreaseWeight: Number(summary.decreaseWeight.toFixed(2))
    }
  };
}

export function buildSectorExposure(code) {
  const exposure = new Map();
  for (const item of buildHoldings(code).rows) {
    exposure.set(item.sector, Number(((exposure.get(item.sector) || 0) + item.weight).toFixed(2)));
  }
  return [...exposure.entries()]
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight);
}

export function buildPeerComparison(code) {
  const fund = getFund(code);
  const selectedTopSector = buildSectorExposure(fund.code)[0]?.sector;
  const rows = listFundRecords()
    .filter((item) => item.code === fund.code || item.category === fund.category || item.risk === fund.risk)
    .map((item) => {
      const topSector = buildSectorExposure(item.code)[0];
      const score = scoreFund(item, topSector?.sector === selectedTopSector);
      return {
        code: item.code,
        name: item.name,
        manager: item.manager,
        category: item.category,
        risk: item.risk,
        quarterlyReturn: item.quarterlyReturn,
        maxDrawdown: item.maxDrawdown,
        volatility: item.volatility,
        topSector: topSector?.sector || "未知",
        topSectorWeight: topSector?.weight || 0,
        score,
        selected: item.code === fund.code
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const selected = rows.find((item) => item.selected);
  return {
    fundCode: fund.code,
    benchmark: fund.benchmark,
    peerCount: rows.length,
    selectedRank: selected?.rank || 0,
    rows
  };
}

export function buildReports(code) {
  const holdings = buildHoldings(code);
  const sectorWeight = new Map(buildSectorExposure(code).map((item) => [item.sector, item.weight]));
  const stockWeight = new Map(holdings.rows.map((item) => [item.stockCode, item.weight]));
  const trackWeight = holdings.rows.reduce((acc, item) => {
    acc.set(item.track, Number(((acc.get(item.track) || 0) + item.weight).toFixed(2)));
    return acc;
  }, new Map());

  return listReportsBySignals({
    sectors: [...sectorWeight.keys()],
    tracks: [...trackWeight.keys()],
    stockCodes: [...stockWeight.keys()]
  }).map((report) => ({
    ...report,
    matchLabel: reportMatchLabel(report),
    matchWeight: reportMatchWeight(report, { sectorWeight, trackWeight, stockWeight }),
    heat: Math.round(reportHeatBase(report) + seededNoise(report.sector.length, report.title.length) * 18)
  }))
  .sort((a, b) => b.heat - a.heat || b.matchWeight - a.matchWeight);
}

export function buildAlerts(code) {
  const fund = getFund(code);
  const realtime = buildRealtime(code);
  const sectors = buildSectorExposure(code);
  const holdings = buildHoldings(code);
  const alerts = [];
  const rules = listAlertRules();
  const metrics = {
    absRealtimeChange: Math.abs(realtime.change),
    topSectorWeight: sectors[0]?.weight || 0,
    concentrationTop3: holdings.concentrationTop3,
    maxDrawdown: fund.maxDrawdown
  };

  if (isRuleTriggered(rules.find((rule) => rule.metric === "absRealtimeChange"), metrics.absRealtimeChange)) {
    alerts.push({
      level: Math.abs(realtime.change) >= 1.8 ? "high" : "medium",
      title: "盘中波动放大",
      message: `当前估算变化为 ${formatPercent(realtime.change)}，建议结合重仓股同步观察。`,
      trigger: "abs(realtime.change) >= 1.2%"
    });
  }

  if (isRuleTriggered(rules.find((rule) => rule.metric === "topSectorWeight"), metrics.topSectorWeight)) {
    alerts.push({
      level: "high",
      title: "行业集中度偏高",
      message: `${sectors[0].sector} 权重达到 ${sectors[0].weight.toFixed(2)}%，组合受单一赛道影响较大。`,
      trigger: "topSector.weight >= 35%"
    });
  }

  if (isRuleTriggered(rules.find((rule) => rule.metric === "concentrationTop3"), metrics.concentrationTop3)) {
    alerts.push({
      level: "medium",
      title: "前三重仓影响较强",
      message: `前三大持仓合计 ${holdings.concentrationTop3.toFixed(2)}%，净值对头部股票弹性较高。`,
      trigger: "concentrationTop3 >= 30%"
    });
  }

  if (isRuleTriggered(rules.find((rule) => rule.metric === "maxDrawdown"), metrics.maxDrawdown)) {
    alerts.push({
      level: "medium",
      title: "历史回撤较深",
      message: `近阶段最大回撤 ${formatPercent(fund.maxDrawdown)}，需要控制单只基金仓位。`,
      trigger: "maxDrawdown <= -15%"
    });
  }

  return alerts.length
    ? alerts
    : [
        {
          level: "low",
          title: "暂无显著风险信号",
          message: "当前监控规则未触发高优先级预警，继续跟踪净值和研报变化。",
          trigger: "no active alert"
        }
      ];
}

export function buildInsight(code) {
  const sectors = buildSectorExposure(code);
  const topSector = sectors[0];
  const fund = getFund(code);
  const holdings = buildHoldings(code);
  const holdingsList = holdings.rows;
  if (!holdingsList.length) {
    return {
      headline: `${fund.name}已导入基金池，当前主要可观察净值走势，持仓与研报仍待同步。`,
      confidence: 45,
      generatedAt: formatGeneratedAt(),
      dataScope: "历史净值、基础基金信息",
      bullets: [
        "当前没有季报持仓数据，暂不生成行业暴露和持仓结构判断。",
        "可以先用净值趋势观察阶段强弱，等待后续同步持仓和标签数据。",
        "AI 结论置信度较低，因为证据链还不完整。"
      ],
      actions: ["优先同步历史净值并观察回撤区间。", "后续补充季报持仓后，再启用行业、赛道和研报分析。", "在持仓数据缺失前，不做同类风格归因判断。"],
      evidence: [`基金基础信息来源：${fund.updateAt}`, "持仓数据：尚未同步", "研报观点样本：尚未匹配"]
    };
  }
  const positive = holdingsList.filter((item) => item.change > 0).length;
  const reportList = buildReports(code);
  const alerts = buildAlerts(code).filter((alert) => alert.level !== "low");

  return {
    headline: `${fund.name}当前趋势偏${fund.dailyChange >= 0 ? "强" : "震荡"}，核心观察点在${topSector.sector}配置延续性`,
    confidence: fund.dailyChange >= 0 ? 78 : 64,
    generatedAt: formatGeneratedAt(),
    dataScope: `${holdings.quarter} 持仓、盘中估值、${reportList.length} 条赛道研报摘要`,
    bullets: [
      `前十大持仓中有${positive}只近阶段表现为正，组合动量处在${positive >= 4 ? "改善" : "分化"}状态。`,
      `前三大持仓合计占比${holdings.concentrationTop3.toFixed(2)}%，短期净值会明显受${holdingsList[0].name}与${holdingsList[1].name}影响。`,
      `${topSector.sector}暴露为${topSector.weight.toFixed(2)}%，需要同步跟踪相关赛道研报中的库存、订单和估值变化。`
    ],
    actions: [
      fund.dailyChange >= 0 ? "维持观察，等待净值突破近月高点后再提高仓位权重。" : "先看区间支撑，不急于追买，等待回撤后的成交确认。",
      "把行业研报更新频率设为周度，重点看观点是否从估值修复转向盈利兑现。",
      alerts.length ? "当前已有预警触发，先确认触发条件是否来自单一行业或头部持仓。" : "暂无高优先级预警，可继续跟踪行业景气度和净值强弱。"
    ],
    evidence: [
      `${holdings.quarter} 披露日期 ${holdings.disclosureDate}，数据源：${holdings.source}`,
      `第一大行业 ${topSector.sector}，权重 ${topSector.weight.toFixed(2)}%`,
      `研报观点样本：${reportList.slice(0, 2).map((report) => `${report.source}《${report.title}》`).join("；")}`
    ]
  };
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function classifyPositionChange(delta) {
  if (delta >= 0.5) return "增持";
  if (delta <= -0.5) return "减持";
  return "稳定";
}

function previousQuarterOf(quarter) {
  const match = quarter.match(/^(\d{4})Q([1-4])$/);
  if (!match) return "上一季度";
  const year = Number(match[1]);
  const q = Number(match[2]);
  return q === 1 ? `${year - 1}Q4` : `${year}Q${q - 1}`;
}

function trendLimitForRange(range) {
  if (range === "1w") return 7;
  if (range === "3m") return 90;
  return 30;
}

function isStaleNavDate(navDate) {
  if (!navDate) return false;
  const latest = new Date(`${navDate}T00:00:00+08:00`);
  const now = new Date();
  const days = (now.getTime() - latest.getTime()) / 86400000;
  return days > 7;
}

function buildSyncMessage(summary, stale) {
  if (!summary.recordCount) return "尚未同步历史净值，走势图将使用模拟曲线。";
  if (stale) return `最近净值日为 ${summary.latestNavDate}，建议执行同步任务刷新。`;
  return `已同步 ${summary.recordCount} 条历史净值，最近净值日 ${summary.latestNavDate}。`;
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

function scoreFund(fund, sameTopSector) {
  const returnScore = fund.quarterlyReturn * 5;
  const drawdownScore = 100 + fund.maxDrawdown * 3;
  const volatilityPenalty = fund.volatility * 1.2;
  const sectorBonus = sameTopSector ? 3 : 0;
  return Math.round(Math.max(0, returnScore + drawdownScore - volatilityPenalty + sectorBonus));
}

function reportMatchLabel(report) {
  if (report.targetType === "stock") return `个股 ${report.stockCode}`;
  if (report.targetType === "track") return `赛道 ${report.track || report.targetKey}`;
  return `行业 ${report.sector}`;
}

function reportMatchWeight(report, { sectorWeight, trackWeight, stockWeight }) {
  if (report.targetType === "stock") return stockWeight.get(report.stockCode || report.targetKey) || 0;
  if (report.targetType === "track") return trackWeight.get(report.track || report.targetKey) || 0;
  return sectorWeight.get(report.sector || report.targetKey) || 0;
}

function reportHeatBase(report) {
  if (report.targetType === "stock") return 76;
  if (report.targetType === "track") return 70;
  return 62;
}

function isRuleTriggered(rule, value) {
  if (!rule) return false;
  if (rule.operator === ">=") return value >= rule.threshold;
  if (rule.operator === "<=") return value <= rule.threshold;
  if (rule.operator === ">") return value > rule.threshold;
  if (rule.operator === "<") return value < rule.threshold;
  return false;
}
