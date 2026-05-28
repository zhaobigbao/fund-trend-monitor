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
    const sections = {
      trend: [
        {
          title: "净值观察优先",
          detail: "当前主要依据历史净值和基础资料观察阶段强弱，暂不做行业和重仓股归因。",
          level: "medium"
        }
      ],
      risks: [
        {
          title: "持仓证据不足",
          detail: "缺少季报持仓后，行业暴露、赛道匹配和研报引用都不能形成完整证据链。",
          level: "high"
        }
      ],
      evidence: [
        {
          title: "基础资料",
          detail: `基金基础信息更新时间：${fund.updateAt}`,
          source: "funds"
        },
        {
          title: "持仓状态",
          detail: "尚未同步或补录季报持仓。",
          source: "holding_disclosures"
        }
      ],
      watchpoints: [
        {
          title: "补齐持仓",
          detail: "优先同步或手工补录最近季度前十大持仓，再启用行业和研报判断。",
          metric: "holding.rows"
        },
        {
          title: "回撤区间",
          detail: "继续观察净值走势和最大回撤是否扩大。",
          metric: "maxDrawdown"
        }
      ]
    };

    return buildInsightPayload({
      headline: `${fund.name}已导入基金池，当前主要可观察净值走势，持仓与研报仍待同步。`,
      confidence: 45,
      generatedAt: formatGeneratedAt(),
      dataScope: "历史净值、基础基金信息",
      sections
    });
  }
  const positive = holdingsList.filter((item) => item.change > 0).length;
  const reportList = buildReports(code);
  const alerts = buildAlerts(code).filter((alert) => alert.level !== "low");
  const primaryHolding = holdingsList[0];
  const secondaryHolding = holdingsList[1] || holdingsList[0];
  const momentumLabel = positive >= Math.ceil(holdingsList.length / 2) ? "改善" : "分化";
  const topReports = reportList.slice(0, 2);
  const sections = {
    trend: [
      {
        title: fund.dailyChange >= 0 ? "净值趋势偏强" : "净值处于震荡观察",
        detail:
          fund.dailyChange >= 0
            ? `当前估算变化为 ${formatPercent(fund.dailyChange)}，需要继续验证净值是否能维持在近月强势区间。`
            : `当前估算变化为 ${formatPercent(fund.dailyChange)}，短期更适合观察回撤收敛和重仓股企稳情况。`,
        level: fund.dailyChange >= 0 ? "positive" : "medium"
      },
      {
        title: `持仓动量${momentumLabel}`,
        detail: `前十大持仓中有 ${positive} 只近阶段表现为正，组合内部走势呈现${momentumLabel}特征。`,
        level: positive >= 4 ? "positive" : "medium"
      }
    ],
    risks: [
      {
        title: "头部持仓影响较强",
        detail: `前三大持仓合计 ${holdings.concentrationTop3.toFixed(2)}%，净值对 ${primaryHolding.name} 与 ${secondaryHolding.name} 的弹性较高。`,
        level: holdings.concentrationTop3 >= 30 ? "high" : "medium"
      },
      {
        title: "行业集中度",
        detail: `${topSector.sector} 暴露为 ${topSector.weight.toFixed(2)}%，需要跟踪相关赛道景气度和估值变化。`,
        level: topSector.weight >= 35 ? "high" : "medium"
      },
      ...alerts.slice(0, 2).map((alert) => ({
        title: alert.title,
        detail: alert.message,
        level: alert.level
      }))
    ],
    evidence: [
      {
        title: "持仓披露",
        detail: `${holdings.quarter} 披露日期 ${holdings.disclosureDate}，数据源：${holdings.source}`,
        source: "holding_disclosures"
      },
      {
        title: "第一大行业",
        detail: `${topSector.sector} 权重 ${topSector.weight.toFixed(2)}%`,
        source: "fund_holdings"
      },
      ...topReports.map((report) => ({
        title: report.matchLabel,
        detail: `${report.source}《${report.title}》：${report.summary}`,
        source: "research_reports"
      }))
    ],
    watchpoints: [
      {
        title: "重仓股同步",
        detail: `优先跟踪 ${holdingsList.slice(0, 3).map((item) => item.name).join("、")} 的走势变化。`,
        metric: "topHoldings"
      },
      {
        title: "研报观点变化",
        detail: topReports.length
          ? `重点验证 ${topReports.map((report) => report.matchLabel).join("、")} 的观点是否从估值修复转向盈利兑现。`
          : "当前暂无匹配研报，后续需补充行业、赛道或个股研报样本。",
        metric: "report.matchLabel"
      },
      {
        title: alerts.length ? "预警触发复核" : "预警规则观察",
        detail: alerts.length ? "当前已有预警触发，需确认是否来自单一行业或头部持仓。" : "暂无高优先级预警，继续跟踪净值强弱和行业景气度。",
        metric: "alerts"
      }
    ]
  };

  return buildInsightPayload({
    headline: `${fund.name}当前趋势偏${fund.dailyChange >= 0 ? "强" : "震荡"}，核心观察点在${topSector.sector}配置延续性`,
    confidence: fund.dailyChange >= 0 ? 78 : 64,
    generatedAt: formatGeneratedAt(),
    dataScope: `${holdings.quarter} 持仓、盘中估值、${reportList.length} 条赛道研报摘要`,
    sections
  });
}

function buildInsightPayload({ headline, confidence, generatedAt, dataScope, sections }) {
  return {
    headline,
    confidence,
    generatedAt,
    dataScope,
    sections,
    bullets: sections.trend.map((item) => `${item.title}：${item.detail}`),
    actions: sections.watchpoints.map((item) => `${item.title}：${item.detail}`),
    evidence: sections.evidence.map((item) => `${item.title}：${item.detail}`)
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
