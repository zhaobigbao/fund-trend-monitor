import { funds, holdingDisclosures, holdingRows, initialWatchlist, reports } from "../data/mockData.mjs";

const watchlistCodes = new Set(initialWatchlist);

export function listFunds(query = "") {
  const keyword = query.trim().toLowerCase();
  return funds
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
  return funds.find((item) => item.code === code) || funds[0];
}

export function listWatchlist() {
  return listFunds().filter((fund) => fund.watched);
}

export function updateWatchlist(code, watched) {
  const fund = funds.find((item) => item.code === code);
  if (!fund) return { code, watched: false, funds: listWatchlist(), error: "Fund not found" };
  if (watched) watchlistCodes.add(fund.code);
  else watchlistCodes.delete(fund.code);
  return { code: fund.code, watched: watchlistCodes.has(fund.code), funds: listWatchlist() };
}

export function seededNoise(seed, index) {
  const x = Math.sin(seed * 73.41 + index * 11.17) * 10000;
  return x - Math.floor(x);
}

export function buildTrend(code, range = "1m") {
  const fund = getFund(code);
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
  const rows = (holdingRows[fund.code] || holdingRows["110022"]).map(
    ([name, stockCode, weight, sector, track, change, note], index) => ({
      rank: index + 1,
      name,
      stockCode,
      weight,
      sector,
      track,
      change,
      note
    })
  );

  return {
    fundCode: fund.code,
    ...holdingDisclosures[fund.code],
    rows,
    concentrationTop3: Number(rows.slice(0, 3).reduce((sum, item) => sum + item.weight, 0).toFixed(2)),
    concentrationTop10: Number(rows.reduce((sum, item) => sum + item.weight, 0).toFixed(2))
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

export function buildReports(code) {
  const sectors = buildSectorExposure(code).map((item) => item.sector);
  return sectors.flatMap((sector) =>
    (reports[sector] || []).map(([title, source, summary, view]) => ({
      sector,
      title,
      source,
      summary,
      view,
      heat: Math.round(62 + seededNoise(sector.length, title.length) * 31),
      updatedAt: "本周更新"
    }))
  );
}

export function buildAlerts(code) {
  const fund = getFund(code);
  const realtime = buildRealtime(code);
  const sectors = buildSectorExposure(code);
  const holdings = buildHoldings(code);
  const alerts = [];

  if (Math.abs(realtime.change) >= 1.2) {
    alerts.push({
      level: Math.abs(realtime.change) >= 1.8 ? "high" : "medium",
      title: "盘中波动放大",
      message: `当前估算变化为 ${formatPercent(realtime.change)}，建议结合重仓股同步观察。`,
      trigger: "abs(realtime.change) >= 1.2%"
    });
  }

  if (sectors[0]?.weight >= 35) {
    alerts.push({
      level: "high",
      title: "行业集中度偏高",
      message: `${sectors[0].sector} 权重达到 ${sectors[0].weight.toFixed(2)}%，组合受单一赛道影响较大。`,
      trigger: "topSector.weight >= 35%"
    });
  }

  if (holdings.concentrationTop3 >= 30) {
    alerts.push({
      level: "medium",
      title: "前三重仓影响较强",
      message: `前三大持仓合计 ${holdings.concentrationTop3.toFixed(2)}%，净值对头部股票弹性较高。`,
      trigger: "concentrationTop3 >= 30%"
    });
  }

  if (fund.maxDrawdown <= -15) {
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
  const positive = holdingsList.filter((item) => item.change > 0).length;
  const reportList = buildReports(code);
  const alerts = buildAlerts(code).filter((alert) => alert.level !== "low");

  return {
    headline: `${fund.name}当前趋势偏${fund.dailyChange >= 0 ? "强" : "震荡"}，核心观察点在${topSector.sector}配置延续性`,
    confidence: fund.dailyChange >= 0 ? 78 : 64,
    generatedAt: new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai"
    }).format(new Date()),
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
