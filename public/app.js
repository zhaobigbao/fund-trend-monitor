const state = {
  funds: [],
  selectedCode: "",
  range: "1m",
  trend: [],
  search: "",
  listMode: "all",
  externalResults: [],
  holdings: null,
  stockTags: [],
  selectedStockCode: "",
  dataSources: [],
  searchTimer: null
};

const $ = (selector) => document.querySelector(selector);
const fundList = $("#fundList");
const canvas = $("#trendChart");
const ctx = canvas.getContext("2d");

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Request failed: ${url}`);
  return response.json();
}

function setTrendClass(element, value) {
  element.classList.toggle("positive", value > 0);
  element.classList.toggle("negative", value < 0);
}

function activeFunds() {
  return state.funds.filter((fund) => state.listMode === "all" || fund.watched);
}

function tagsText(tags = []) {
  return Array.isArray(tags) ? tags.join("，") : "";
}

function defaultHoldingQuarter() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const currentQuarter = Math.ceil(month / 3);
  let year = now.getFullYear();
  let quarter = currentQuarter - 1;
  if (quarter < 1) {
    year -= 1;
    quarter = 4;
  }
  return `${year}Q${quarter}`;
}

function renderFundList() {
  const rows = activeFunds();
  fundList.innerHTML = rows.length
    ? rows
        .map((fund) => {
          const active = fund.code === state.selectedCode ? "active" : "";
          const changeClass = fund.realtime.change >= 0 ? "positive" : "negative";
          return `
            <button class="fund-item ${active}" data-code="${fund.code}">
              <span class="watch-dot ${fund.watched ? "on" : ""}">${fund.watched ? "自选" : "观察"}</span>
              <strong>${fund.name}</strong>
              <div class="fund-meta"><span>${fund.code}</span><span>${fund.category}</span></div>
              <div class="fund-profile-line"><span>${fund.groupName || "默认"}</span><span>${tagsText(fund.tags) || "无标签"}</span></div>
              <div class="fund-numbers">
                <span>${fund.realtime.nav.toFixed(4)}</span>
                <span class="${changeClass}">${formatPercent(fund.realtime.change)}</span>
              </div>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-state">没有匹配的基金</div>`;
}

function renderExternalResults() {
  const panel = $("#externalSearchPanel");
  const results = $("#externalResults");
  panel.hidden = state.search.trim().length < 2;
  if (panel.hidden) return;

  results.innerHTML = state.externalResults.length
    ? state.externalResults
        .map(
          (fund) => `
            <article class="external-result">
              <div>
                <strong>${fund.name}</strong>
                <span>${fund.code} · ${fund.navDate || "暂无日期"} · ${fund.source}</span>
              </div>
              <button data-import-code="${fund.code}" ${fund.imported ? "disabled" : ""}>${fund.imported ? "已导入" : "导入"}</button>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">暂无外部结果</div>`;
}

function renderMetrics(fund, realtime) {
  $("#fundName").textContent = `${fund.name}（${fund.code}）`;
  $("#liveNav").textContent = realtime.nav.toFixed(4);
  $("#liveTime").textContent = realtime.time;
  $("#liveChange").textContent = formatPercent(realtime.change);
  $("#quarterReturn").textContent = formatPercent(fund.quarterlyReturn);
  $("#fundSize").textContent = fund.size;
  $("#fundRisk").textContent = `${fund.manager} · ${fund.risk}`;
  $("#maxDrawdown").textContent = formatPercent(fund.maxDrawdown);
  $("#volatility").textContent = `${fund.volatility.toFixed(1)}%`;
  $("#benchmark").textContent = fund.benchmark;
  $("#watchToggle").textContent = fund.watched ? "移出自选" : "加自选";
  setTrendClass($("#liveChange"), realtime.change);
  setTrendClass($("#quarterReturn"), fund.quarterlyReturn);
  setTrendClass($("#maxDrawdown"), fund.maxDrawdown);
}

function renderPoolProfile(fund) {
  $("#poolGroupInput").value = fund.groupName || "默认";
  $("#poolTagsInput").value = tagsText(fund.tags);
  $("#poolNoteInput").value = fund.note || "";
  $("#poolStatus").textContent = fund.profileUpdatedAt ? `上次保存 ${fund.profileUpdatedAt}` : "本地基金池信息";
}

function drawChart() {
  if (!state.trend.length) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const padding = { top: 22, right: 22, bottom: 34, left: 58 };
  const width = rect.width - padding.left - padding.right;
  const height = rect.height - padding.top - padding.bottom;
  const values = state.trend.map((item) => item.value);
  const min = Math.min(...values) * 0.995;
  const max = Math.max(...values) * 1.005;
  const scaleX = (index) => padding.left + (index / Math.max(1, state.trend.length - 1)) * width;
  const scaleY = (value) => padding.top + (1 - (value - min) / (max - min || 1)) * height;

  ctx.strokeStyle = "#e4eaf2";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#657184";
  ctx.font = "12px system-ui";
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(rect.width - padding.right, y);
    ctx.stroke();
    const label = (max - ((max - min) / 4) * i).toFixed(3);
    ctx.fillText(label, 10, y + 4);
  }

  const gradient = ctx.createLinearGradient(0, padding.top, 0, rect.height - padding.bottom);
  gradient.addColorStop(0, "rgba(37, 99, 235, 0.25)");
  gradient.addColorStop(1, "rgba(15, 118, 110, 0.02)");

  ctx.beginPath();
  state.trend.forEach((point, index) => {
    const x = scaleX(index);
    const y = scaleY(point.value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(scaleX(state.trend.length - 1), rect.height - padding.bottom);
  ctx.lineTo(scaleX(0), rect.height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  state.trend.forEach((point, index) => {
    const x = scaleX(index);
    const y = scaleY(point.value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 3;
  ctx.stroke();

  const last = state.trend[state.trend.length - 1];
  const x = scaleX(state.trend.length - 1);
  const y = scaleY(last.value);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function renderHoldings(holdingData) {
  state.holdings = holdingData;
  $("#holdingQuarter").textContent = holdingData.quarter;
  $("#holdingMeta").textContent = `披露日期 ${holdingData.disclosureDate} · ${holdingData.source}`;
  $("#holdingSummary").textContent = `前三重仓 ${holdingData.concentrationTop3.toFixed(2)}% · 当前展示持仓合计 ${holdingData.concentrationTop10.toFixed(2)}%`;
  $("#holdingRows").innerHTML = holdingData.rows.length
    ? holdingData.rows
    .map(
      (row) => `
        <tr>
          <td><strong>${row.name}</strong><span class="stock-code">${row.stockCode}</span></td>
          <td>${row.weight.toFixed(2)}%</td>
          <td><span class="tag">${row.sector}</span></td>
          <td>${row.track}</td>
          <td class="${row.change >= 0 ? "positive" : "negative"}">${formatPercent(row.change)}</td>
        </tr>
      `
    )
    .join("")
    : `<tr><td colspan="5" class="table-empty">暂无持仓数据</td></tr>`;
  renderHoldingEditor(holdingData);
}

function renderHoldingEditor(holdingData) {
  const hasRows = holdingData.rows.length > 0;
  $("#holdingQuarterInput").value = hasRows ? holdingData.quarter : defaultHoldingQuarter();
  $("#holdingDateInput").value = /^\d{4}-\d{2}-\d{2}$/.test(holdingData.disclosureDate) ? holdingData.disclosureDate : "";
  $("#holdingSourceInput").value = hasRows ? holdingData.source : "本地补录";
  $("#holdingRowsInput").value = hasRows
    ? holdingData.rows
        .map((row) => [row.name, row.stockCode, row.weight, row.sector, row.track, row.change, row.note].join(","))
        .join("\n")
    : "";
  $("#holdingEditStatus").textContent = hasRows ? `${holdingData.rows.length} 条持仓，可继续编辑` : "暂无持仓，可本地补录";
}

function renderSyncStatus(status) {
  $("#syncLabel").textContent = status.label;
  $("#syncSource").textContent = status.source;
  $("#syncRecords").textContent = status.recordCount ? `${status.recordCount} 条` : "0 条";
  $("#syncLatestDate").textContent = status.latestNavDate || "暂无";
  $("#syncMessage").textContent = status.message;
  $("#syncMessage").className = `sync-message ${status.status}`;
  $("#syncNowButton").disabled = false;
  $("#syncNowButton").textContent = status.status === "pending" ? "同步净值" : "刷新净值";
}

function renderSyncRuns(runs) {
  $("#syncTaskSummary").textContent = runs.length ? `最近 ${runs.length} 条同步记录` : "暂无同步记录";
  $("#syncRunList").innerHTML = runs.length
    ? runs
        .map(
          (run) => `
            <article class="sync-run ${run.status}">
              <div>
                <strong>${run.fundName}</strong>
                <span>${run.target} · ${run.source}</span>
              </div>
              <div>
                <b>${run.status === "success" ? "成功" : "失败"}</b>
                <span>${run.message}</span>
                <small>${run.syncedAt}</small>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">暂无同步记录</div>`;
}

function renderPeers(peerData) {
  $("#peerRank").textContent = `第 ${peerData.selectedRank}/${peerData.peerCount}`;
  $("#peerMeta").textContent = `对比基准 ${peerData.benchmark} · 综合评分由季度收益、回撤、波动和行业相似度估算`;
  $("#peerRows").innerHTML = peerData.rows
    .map(
      (row) => `
        <article class="peer-row ${row.selected ? "selected" : ""}">
          <div>
            <strong>${row.rank}. ${row.name}</strong>
            <span>${row.code} · ${row.manager} · ${row.topSector} ${row.topSectorWeight.toFixed(1)}%</span>
          </div>
          <div class="peer-metrics">
            <span class="${row.quarterlyReturn >= 0 ? "positive" : "negative"}">${formatPercent(row.quarterlyReturn)}</span>
            <span class="negative">${formatPercent(row.maxDrawdown)}</span>
            <span>${row.volatility.toFixed(1)}%</span>
            <b>${row.score}</b>
          </div>
        </article>
      `
    )
    .join("");
}

function renderHoldingChanges(changeData) {
  $("#changeQuarter").textContent = `${changeData.previousQuarter} → ${changeData.quarter}`;
  $("#changeSummary").textContent = `增持 ${changeData.summary.increaseWeight.toFixed(2)}% · 减持 ${changeData.summary.decreaseWeight.toFixed(2)}% · 新进 ${changeData.summary.newCount} · 退出 ${changeData.summary.exitCount}`;
  $("#holdingChangeRows").innerHTML = changeData.rows.length
    ? changeData.rows
    .slice(0, 6)
    .map(
      (row) => `
        <article class="change-row ${row.delta >= 0 ? "up" : "down"}">
          <div>
            <strong>${row.name}</strong>
            <span>${row.stockCode} · ${row.changeType} · ${row.track}</span>
          </div>
          <div class="change-weight">
            <span>${row.previousWeight.toFixed(2)}% → ${row.weight.toFixed(2)}%</span>
            <b class="${row.delta >= 0 ? "positive" : "negative"}">${formatPercent(row.delta)}</b>
          </div>
        </article>
      `
    )
    .join("")
    : `<div class="empty-state">暂无季度持仓变化</div>`;
}

function renderSectors(sectors) {
  if (!sectors.length) {
    $("#sectorBars").innerHTML = `<div class="empty-state">暂无行业暴露数据</div>`;
    return;
  }
  const max = Math.max(...sectors.map((item) => item.weight), 1);
  $("#sectorBars").innerHTML = sectors
    .map(
      (item) => `
        <div class="sector-row">
          <span class="sector-name">${item.sector}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(item.weight / max) * 100}%"></span></span>
          <span class="sector-weight">${item.weight.toFixed(1)}%</span>
        </div>
      `
    )
    .join("");
}

function renderReports(reports) {
  $("#reportList").innerHTML = reports.length
    ? reports
    .map(
      (report) => `
        <article class="report-card">
          <div class="report-meta"><span>${report.matchLabel || report.sector}</span><span>热度 ${report.heat}</span></div>
          <p class="report-title">${report.title}</p>
          <p class="report-summary">${report.summary}</p>
          <div class="report-meta">
            <span>${report.source} · ${report.view}</span>
            <span>匹配权重 ${Number(report.matchWeight || 0).toFixed(2)}% · ${report.publishedAt || report.updatedAt}</span>
          </div>
        </article>
      `
    )
    .join("")
    : `<div class="empty-state">暂无匹配研报</div>`;
}

function renderSourceCoverage(coverage) {
  $("#sourceCoverageRows").innerHTML = coverage.domains
    .map(
      (item) => `
        <article class="source-coverage-row ${item.status}">
          <div>
            <strong>${item.label}</strong>
            <span>${item.detail}</span>
          </div>
          <div>
            <b>${item.sourceName}</b>
            <small>${sourceStatusText(item.status)}</small>
          </div>
        </article>
      `
    )
    .join("");
  $("#sourceSyncStatus").textContent = `当前基金 ${coverage.fundName} · 默认板块源 ${coverage.defaults.sectorBoard || "eastmoney"}`;
}

function sourceStatusText(status) {
  if (status === "ready") return "可用";
  if (status === "needsHoldings") return "待持仓";
  if (status === "partial") return "部分";
  return "待同步";
}

function renderSectorRadar(radar) {
  $("#sectorRadarStatus").textContent = radar.boards.length ? `${radar.boards.length} 个板块` : "待同步";
  $("#sectorRadarMeta").textContent = `${radar.source} · ${radar.holdingQuarter} · ${radar.generatedAt} · ${radar.message}`;
  $("#sectorRadarList").innerHTML = radar.boards.length
    ? radar.boards
        .map(
          (board) => `
            <article class="sector-radar-card">
              <div class="sector-radar-head">
                <div>
                  <strong>${board.name}</strong>
                  <span>${board.type === "concept" ? "概念板块" : "行业板块"} · ${board.code}</span>
                </div>
                <b class="${board.changePercent >= 0 ? "positive" : "negative"}">${formatPercent(board.changePercent || 0)}</b>
              </div>
              <div class="sector-radar-chart">
                ${renderSparkline(board.intraday || [])}
              </div>
              <div class="sector-radar-meta">
                <span>上涨 ${board.upCount || 0} · 下跌 ${board.downCount || 0}</span>
                <span>领涨 ${board.leadingStock || "--"}</span>
              </div>
              <div class="sector-radar-holdings">
                ${
                  board.intersections.length
                    ? board.intersections.map((item) => `<span>${item.name} ${item.weight.toFixed(2)}% / ${formatPercent(item.changePercent || 0)}</span>`).join("")
                    : "<span>暂无重仓交集</span>"
                }
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">${radar.message}</div>`;
}

function renderSparkline(points) {
  if (!points.length) return `<div class="sparkline-empty"></div>`;
  const values = points.map((point) => point.close).filter((value) => Number.isFinite(value));
  if (values.length < 2) return `<div class="sparkline-empty"></div>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 220;
  const height = 54;
  const d = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / (max - min || 1)) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="板块分钟走势"><path d="${d}"></path></svg>`;
}

function renderStockTags(tagData) {
  state.stockTags = tagData.rows || [];
  if (!state.stockTags.some((row) => row.stockCode === state.selectedStockCode)) {
    state.selectedStockCode = state.stockTags[0]?.stockCode || "";
  }

  $("#stockTagSummary").textContent = state.stockTags.length ? `${state.stockTags.length} 只` : "待补录";
  $("#stockTagSelect").innerHTML = state.stockTags.length
    ? state.stockTags.map((row) => `<option value="${row.stockCode}">${row.name} ${row.stockCode}</option>`).join("")
    : `<option value="">暂无持仓股票</option>`;
  $("#stockTagSelect").value = state.selectedStockCode;
  $("#stockTagRows").innerHTML = state.stockTags.length
    ? state.stockTags
        .map(
          (row) => `
            <article class="stock-tag-row ${row.stockCode === state.selectedStockCode ? "selected" : ""}" data-stock-code="${row.stockCode}">
              <div>
                <strong>${row.name}</strong>
                <span>${row.stockCode} · 权重 ${row.weight.toFixed(2)}% · ${row.tagSource}</span>
              </div>
              <div>
                <b>${row.sector}</b>
                <span>${row.track}${row.concepts.length ? ` · ${row.concepts.join("，")}` : ""}</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">暂无持仓股票标签</div>`;
  renderStockTagForm();
}

function renderStockTagForm() {
  const row = state.stockTags.find((item) => item.stockCode === state.selectedStockCode);
  $("#stockSectorInput").value = row?.sector || "";
  $("#stockTrackInput").value = row?.track || "";
  $("#stockConceptsInput").value = row?.concepts?.join("，") || "";
  $("#stockTagStatus").textContent = row ? `标签来源 ${row.tagSource} · ${row.tagUpdatedAt || "待更新"}` : "当前持仓股票标签";
  $("#saveStockTagButton").disabled = !row;
}

function renderAlerts(alerts) {
  $("#alertList").innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card ${alert.level}">
          <strong>${alert.title}</strong>
          <p>${alert.message}</p>
          <span>${alert.trigger}</span>
        </article>
      `
    )
    .join("");
}

function renderInsight(insight) {
  $("#confidence").textContent = `置信度 ${insight.confidence}`;
  $("#insightMeta").textContent = `${insight.generatedAt} 生成 · ${insight.dataScope}`;
  $("#insightHeadline").textContent = insight.headline;
  const sections = insight.sections || {
    trend: (insight.bullets || []).map((detail) => ({ title: "趋势", detail })),
    risks: [],
    evidence: (insight.evidence || []).map((detail) => ({ title: "证据", detail })),
    watchpoints: (insight.actions || []).map((detail) => ({ title: "观察", detail }))
  };
  renderInsightItems("#trendInsightList", sections.trend, "trend");
  renderInsightItems("#riskInsightList", sections.risks, "risk");
  renderInsightItems("#evidenceInsightList", sections.evidence, "evidence");
  renderInsightItems("#watchInsightList", sections.watchpoints, "watch");
}

function renderInsightItems(selector, items = [], type) {
  $(selector).innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="insight-item ${type} ${item.level || ""}">
              <div>
                <strong>${item.title}</strong>
                <p>${item.detail}</p>
              </div>
              ${item.source || item.metric ? `<span>${item.source || item.metric}</span>` : ""}
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">暂无数据</div>`;
}

function renderInsightHistory(history = []) {
  $("#insightHistorySummary").textContent = history.length ? `最近 ${history.length} 条` : "暂无记录";
  $("#insightHistoryList").innerHTML = history.length
    ? history
        .map(
          (item) => `
            <article class="insight-history-item">
              <div>
                <strong>${item.headline}</strong>
                <span>${item.createdAt || item.generatedAt} · ${item.dataScope}</span>
              </div>
              <b>置信度 ${item.confidence}</b>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">暂无历史结论</div>`;
}

async function loadFunds() {
  const query = state.search ? `?q=${encodeURIComponent(state.search)}` : "";
  state.funds = await fetchJson(`/api/funds${query}`);
  if (!state.selectedCode && state.funds.length) state.selectedCode = state.funds[0].code;
  renderFundList();
}

async function loadExternalSearch() {
  const keyword = state.search.trim();
  if (keyword.length < 2) {
    state.externalResults = [];
    renderExternalResults();
    return;
  }

  $("#externalStatus").textContent = "搜索中";
  try {
    state.externalResults = await fetchJson(`/api/fund-search?q=${encodeURIComponent(keyword)}`);
    $("#externalStatus").textContent = `${state.externalResults.length} 条结果`;
  } catch {
    state.externalResults = [];
    $("#externalStatus").textContent = "搜索失败";
  }
  renderExternalResults();
}

async function loadSyncRuns() {
  const runs = await fetchJson("/api/sync-runs?limit=8");
  renderSyncRuns(runs);
}

async function loadFund(code = state.selectedCode) {
  if (!code) return;
  state.selectedCode = code;
  renderFundList();
  $("#chartStatus").textContent = "同步中";

  const fund = state.funds.find((item) => item.code === code) || (await fetchJson(`/api/funds?q=${encodeURIComponent(code)}`))[0];
  const [trend, syncStatus, realtime, holdings, peers, holdingChanges, stockTags, sectors, reports, insight, alerts, sourceCoverage, sectorRadar] = await Promise.all([
    fetchJson(`/api/funds/${code}/trend?range=${state.range}`),
    fetchJson(`/api/funds/${code}/sync-status`),
    fetchJson(`/api/funds/${code}/realtime`),
    fetchJson(`/api/funds/${code}/holdings`),
    fetchJson(`/api/funds/${code}/peers`),
    fetchJson(`/api/funds/${code}/holding-changes`),
    fetchJson(`/api/funds/${code}/stock-tags`),
    fetchJson(`/api/funds/${code}/sectors`),
    fetchJson(`/api/funds/${code}/reports`),
    fetchJson(`/api/funds/${code}/insight`),
    fetchJson(`/api/funds/${code}/alerts`),
    fetchJson(`/api/funds/${code}/source-coverage`),
    fetchJson(`/api/funds/${code}/sector-radar`)
  ]);

  state.trend = trend;
  renderSyncStatus(syncStatus);
  renderMetrics(fund, realtime);
  renderPoolProfile(fund);
  renderHoldings(holdings);
  renderPeers(peers);
  renderHoldingChanges(holdingChanges);
  renderStockTags(stockTags);
  renderSourceCoverage(sourceCoverage);
  renderSectors(sectors);
  renderReports(reports);
  renderSectorRadar(sectorRadar);
  renderInsight(insight);
  const insightHistory = await fetchJson(`/api/funds/${code}/insights?limit=5`);
  renderInsightHistory(insightHistory);
  renderAlerts(alerts);
  drawChart();
  $("#chartStatus").textContent = "已更新";
}

async function refreshRealtime() {
  if (!state.selectedCode) return;
  const fund = state.funds.find((item) => item.code === state.selectedCode);
  try {
    const realtime = await fetchJson(`/api/funds/${state.selectedCode}/realtime`);
    if (fund) renderMetrics(fund, realtime);
  } catch (error) {
    console.warn("Realtime refresh skipped", error);
  }
}

async function toggleWatchlist() {
  const fund = state.funds.find((item) => item.code === state.selectedCode);
  if (!fund) return;
  await fetchJson("/api/watchlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: fund.code, watched: !fund.watched })
  });
  await loadFunds();
  await loadFund(state.selectedCode);
}

async function savePoolProfile() {
  const fund = state.funds.find((item) => item.code === state.selectedCode);
  if (!fund) return;
  const button = $("#savePoolProfileButton");
  button.disabled = true;
  button.textContent = "保存中";
  $("#poolStatus").textContent = "正在保存";
  try {
    const result = await fetchJson(`/api/funds/${fund.code}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupName: $("#poolGroupInput").value,
        tags: $("#poolTagsInput").value,
        note: $("#poolNoteInput").value
      })
    });
    if (!result.ok) throw new Error(result.error || "保存失败");
    await loadFunds();
    await loadFund(fund.code);
    $("#poolStatus").textContent = "已保存";
  } catch (error) {
    $("#poolStatus").textContent = "保存失败，请稍后重试";
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "保存管理信息";
  }
}

function parseHoldingRows(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|,|，/).map((part) => part.trim());
      return {
        name: parts[0] || "",
        stockCode: parts[1] || "",
        weight: Number(parts[2] || 0),
        sector: parts[3] || "未分类",
        track: parts[4] || "待标注",
        change: Number(parts[5] || 0),
        note: parts.slice(6).join("，")
      };
    })
    .filter((row) => row.name && row.stockCode);
}

async function saveHoldings() {
  if (!state.selectedCode) return;
  const button = $("#saveHoldingsButton");
  const rows = parseHoldingRows($("#holdingRowsInput").value);
  button.disabled = true;
  button.textContent = "保存中";
  $("#holdingEditStatus").textContent = "正在保存持仓";
  try {
    const result = await fetchJson(`/api/funds/${state.selectedCode}/holdings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quarter: $("#holdingQuarterInput").value,
        disclosureDate: $("#holdingDateInput").value,
        source: $("#holdingSourceInput").value,
        rows
      })
    });
    if (!result.ok) throw new Error(result.error || "保存失败");
    await loadFund(state.selectedCode);
    await loadSyncRuns();
    $("#holdingEditStatus").textContent = "持仓已保存";
  } catch (error) {
    $("#holdingEditStatus").textContent = "保存失败，请检查季度和持仓明细";
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "保存持仓";
  }
}

async function saveStockTag() {
  const row = state.stockTags.find((item) => item.stockCode === state.selectedStockCode);
  if (!row) return;
  const button = $("#saveStockTagButton");
  button.disabled = true;
  button.textContent = "保存中";
  $("#stockTagStatus").textContent = "正在保存股票标签";
  try {
    const result = await fetchJson(`/api/stocks/${row.stockCode}/tags`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: row.name,
        sector: $("#stockSectorInput").value,
        track: $("#stockTrackInput").value,
        concepts: $("#stockConceptsInput").value
      })
    });
    if (!result.ok) throw new Error(result.error || "保存失败");
    await loadFund(state.selectedCode);
    await loadSyncRuns();
    $("#stockTagStatus").textContent = "股票标签已保存";
  } catch (error) {
    $("#stockTagStatus").textContent = "保存失败，请稍后重试";
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "保存股票标签";
  }
}

async function removeCurrentFund() {
  const fund = state.funds.find((item) => item.code === state.selectedCode);
  if (!fund) return;
  const confirmed = window.confirm(`确认从本地基金池移除 ${fund.name}（${fund.code}）？`);
  if (!confirmed) return;

  const button = $("#removeFundButton");
  button.disabled = true;
  button.textContent = "移除中";
  try {
    const result = await fetchJson(`/api/funds/${fund.code}`, { method: "DELETE" });
    if (!result.ok) throw new Error(result.error || "移除失败");
    state.search = "";
    $("#fundSearch").value = "";
    state.selectedCode = "";
    await loadFunds();
    if (state.funds.length) await loadFund(state.funds[0].code);
    else {
      renderFundList();
      $("#fundName").textContent = "暂无基金";
      $("#chartStatus").textContent = "等待导入";
    }
    await loadSyncRuns();
  } catch (error) {
    $("#poolStatus").textContent = "移除失败，请稍后重试";
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "移除本地基金";
  }
}

async function importFund(code) {
  $("#externalStatus").textContent = "导入中";
  const fund = await fetchJson("/api/funds/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, syncNav: true })
  });
  state.selectedCode = fund.code;
  await loadFunds();
  await loadExternalSearch();
  await loadFund(fund.code);
}

async function syncCurrentFundNav() {
  if (!state.selectedCode) return;
  const button = $("#syncNowButton");
  button.disabled = true;
  button.textContent = "同步中";
  $("#chartStatus").textContent = "同步中";
  try {
    await fetchJson(`/api/funds/${state.selectedCode}/sync-nav`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: 1, pageSize: 90 })
    });
    await loadFunds();
    await loadFund(state.selectedCode);
    await loadSyncRuns();
  } catch (error) {
    $("#syncMessage").textContent = "同步失败，请稍后重试。";
    $("#syncMessage").className = "sync-message stale";
    button.disabled = false;
    button.textContent = "重试同步";
    console.error(error);
  }
}

async function syncCurrentFundRealData() {
  if (!state.selectedCode) return;
  const button = $("#syncRealDataButton");
  button.disabled = true;
  button.textContent = "同步中";
  $("#sourceSyncStatus").textContent = "正在同步基金持仓与板块实时数据";
  try {
    const result = await fetchJson(`/api/funds/${state.selectedCode}/sync-all`, { method: "POST" });
    $("#sourceSyncStatus").textContent = `真实数据同步完成：${result.quarter} · ${result.syncedHoldings} 条持仓`;
    await loadFund(state.selectedCode);
    await loadSyncRuns();
  } catch (error) {
    $("#sourceSyncStatus").textContent = "真实数据同步失败，请稍后重试";
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "同步持仓/板块";
  }
}

async function syncWatchlistNav() {
  const button = $("#syncWatchlistButton");
  button.disabled = true;
  button.textContent = "同步中";
  $("#syncTaskSummary").textContent = "正在同步全部自选基金";
  try {
    const result = await fetchJson("/api/watchlists/sync-nav", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: 1, pageSize: 90 })
    });
    $("#syncTaskSummary").textContent = `自选同步完成：成功 ${result.success}，失败 ${result.failed}`;
    await loadFunds();
    await loadFund(state.selectedCode);
    await loadSyncRuns();
  } catch (error) {
    $("#syncTaskSummary").textContent = "自选同步失败，请稍后重试。";
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "同步全部自选";
  }
}

fundList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-code]");
  if (button) loadFund(button.dataset.code);
});

$("#externalResults").addEventListener("click", (event) => {
  const button = event.target.closest("[data-import-code]");
  if (button) importFund(button.dataset.importCode);
});

$("#fundSearch").addEventListener("input", async (event) => {
  state.search = event.target.value;
  await loadFunds();
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadExternalSearch, 350);
});

$("#watchToggle").addEventListener("click", toggleWatchlist);
$("#savePoolProfileButton").addEventListener("click", savePoolProfile);
$("#removeFundButton").addEventListener("click", removeCurrentFund);
$("#saveHoldingsButton").addEventListener("click", saveHoldings);
$("#saveStockTagButton").addEventListener("click", saveStockTag);
$("#syncNowButton").addEventListener("click", syncCurrentFundNav);
$("#syncRealDataButton").addEventListener("click", syncCurrentFundRealData);
$("#syncWatchlistButton").addEventListener("click", syncWatchlistNav);

$("#stockTagSelect").addEventListener("change", (event) => {
  state.selectedStockCode = event.target.value;
  renderStockTags({ rows: state.stockTags });
});

$("#stockTagRows").addEventListener("click", (event) => {
  const row = event.target.closest("[data-stock-code]");
  if (!row) return;
  state.selectedStockCode = row.dataset.stockCode;
  renderStockTags({ rows: state.stockTags });
});

document.querySelectorAll(".list-mode").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".list-mode").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.listMode = button.dataset.mode;
    renderFundList();
  });
});

document.querySelectorAll(".range-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".range-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.range = button.dataset.range;
    loadFund(state.selectedCode);
  });
});

window.addEventListener("resize", drawChart);

async function boot() {
  await loadFunds();
  await loadFund(state.selectedCode);
  await loadSyncRuns();
  setInterval(refreshRealtime, 3000);
}

boot().catch((error) => {
  console.error(error);
  $("#chartStatus").textContent = "加载失败";
});
