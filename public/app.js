const state = {
  funds: [],
  selectedCode: "",
  range: "1m",
  trend: [],
  search: "",
  listMode: "all"
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
  $("#holdingQuarter").textContent = holdingData.quarter;
  $("#holdingMeta").textContent = `披露日期 ${holdingData.disclosureDate} · ${holdingData.source}`;
  $("#holdingSummary").textContent = `前三重仓 ${holdingData.concentrationTop3.toFixed(2)}% · 当前展示持仓合计 ${holdingData.concentrationTop10.toFixed(2)}%`;
  $("#holdingRows").innerHTML = holdingData.rows
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
    .join("");
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
  $("#holdingChangeRows").innerHTML = changeData.rows
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
    .join("");
}

function renderSectors(sectors) {
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
  $("#reportList").innerHTML = reports
    .map(
      (report) => `
        <article class="report-card">
          <div class="report-meta"><span>${report.sector}</span><span>热度 ${report.heat}</span></div>
          <p class="report-title">${report.title}</p>
          <p class="report-summary">${report.summary}</p>
          <div class="report-meta"><span>${report.source} · ${report.view}</span><span>${report.updatedAt}</span></div>
        </article>
      `
    )
    .join("");
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
  $("#insightBullets").innerHTML = insight.bullets.map((item) => `<div class="insight-item">${item}</div>`).join("");
  $("#actionList").innerHTML = insight.actions.map((item) => `<div class="action-item">${item}</div>`).join("");
  $("#evidenceList").innerHTML = insight.evidence.map((item) => `<div class="evidence-item">${item}</div>`).join("");
}

async function loadFunds() {
  const query = state.search ? `?q=${encodeURIComponent(state.search)}` : "";
  state.funds = await fetchJson(`/api/funds${query}`);
  if (!state.selectedCode && state.funds.length) state.selectedCode = state.funds[0].code;
  renderFundList();
}

async function loadFund(code = state.selectedCode) {
  state.selectedCode = code;
  renderFundList();
  $("#chartStatus").textContent = "同步中";

  const fund = state.funds.find((item) => item.code === code) || (await fetchJson(`/api/funds?q=${encodeURIComponent(code)}`))[0];
  const [trend, realtime, holdings, peers, holdingChanges, sectors, reports, insight, alerts] = await Promise.all([
    fetchJson(`/api/funds/${code}/trend?range=${state.range}`),
    fetchJson(`/api/funds/${code}/realtime`),
    fetchJson(`/api/funds/${code}/holdings`),
    fetchJson(`/api/funds/${code}/peers`),
    fetchJson(`/api/funds/${code}/holding-changes`),
    fetchJson(`/api/funds/${code}/sectors`),
    fetchJson(`/api/funds/${code}/reports`),
    fetchJson(`/api/funds/${code}/insight`),
    fetchJson(`/api/funds/${code}/alerts`)
  ]);

  state.trend = trend;
  renderMetrics(fund, realtime);
  renderHoldings(holdings);
  renderPeers(peers);
  renderHoldingChanges(holdingChanges);
  renderSectors(sectors);
  renderReports(reports);
  renderInsight(insight);
  renderAlerts(alerts);
  drawChart();
  $("#chartStatus").textContent = "已更新";
}

async function refreshRealtime() {
  if (!state.selectedCode) return;
  const fund = state.funds.find((item) => item.code === state.selectedCode);
  const realtime = await fetchJson(`/api/funds/${state.selectedCode}/realtime`);
  if (fund) renderMetrics(fund, realtime);
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

fundList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-code]");
  if (button) loadFund(button.dataset.code);
});

$("#fundSearch").addEventListener("input", async (event) => {
  state.search = event.target.value;
  await loadFunds();
});

$("#watchToggle").addEventListener("click", toggleWatchlist);

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
  setInterval(refreshRealtime, 3000);
}

boot().catch((error) => {
  console.error(error);
  $("#chartStatus").textContent = "加载失败";
});
