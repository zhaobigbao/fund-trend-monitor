const SOURCE_NAME = "eastmoney";
const DEFAULT_HEADERS = {
  Referer: "https://fund.eastmoney.com/",
  "User-Agent": "Mozilla/5.0"
};

export async function searchFunds(keyword, limit = 10) {
  const url = new URL("https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx");
  url.searchParams.set("m", "1");
  url.searchParams.set("key", keyword);

  const payload = await fetchJson(url);
  return (payload.Datas || []).slice(0, limit).map((item) => ({
    code: item.CODE || item.FCODE || item._id,
    name: stripHighlight(item.NAME || item.SHORTNAME || ""),
    category: item.CATEGORYDESC || "基金",
    nav: numberOrNull(item.FundBaseInfo?.DWJZ),
    navDate: item.FundBaseInfo?.FSRQ || "",
    source: SOURCE_NAME
  }));
}

export async function fetchNavHistory(code, { pages = 2, pageSize = 120 } = {}) {
  const records = [];
  for (let pageIndex = 1; pageIndex <= pages; pageIndex += 1) {
    const url = new URL("https://api.fund.eastmoney.com/f10/lsjz");
    url.searchParams.set("fundCode", code);
    url.searchParams.set("pageIndex", String(pageIndex));
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("startDate", "");
    url.searchParams.set("endDate", "");

    const payload = await fetchJson(url, { Referer: "https://fundf10.eastmoney.com/" });
    const rows = payload.Data?.LSJZList || [];
    records.push(
      ...rows.map((row) => ({
        navDate: row.FSRQ,
        unitNav: Number(row.DWJZ),
        accumulatedNav: numberOrNull(row.LJJZ),
        dailyGrowth: numberOrNull(row.JZZZL),
        subscriptionStatus: row.SGZT || "",
        redemptionStatus: row.SHZT || "",
        source: SOURCE_NAME
      }))
    );
    if (rows.length < pageSize) break;
  }

  return records
    .filter((record) => record.navDate && Number.isFinite(record.unitNav))
    .sort((a, b) => a.navDate.localeCompare(b.navDate));
}

export async function fetchFundPortfolioHoldings(code, { year = currentYear(), month = currentQuarterEndMonth() } = {}) {
  const url = new URL("https://fundf10.eastmoney.com/FundArchivesDatas.aspx");
  url.searchParams.set("type", "jjcc");
  url.searchParams.set("code", code);
  url.searchParams.set("topline", "10");
  url.searchParams.set("year", String(year));
  url.searchParams.set("month", String(month));

  const text = await fetchText(url, { Referer: "https://fundf10.eastmoney.com/" });
  const content = decodeEscapedHtml(text.match(/content:"([\s\S]*?)",arryear/)?.[1] || text);
  const label = stripTags(content.match(/<h4[\s\S]*?<\/h4>/)?.[0] || "");
  const quarter = label.match(/(\d{4})年([1-4])季度/) ? `${RegExp.$1}Q${RegExp.$2}` : `${year}Q${Math.ceil(Number(month) / 3)}`;
  const disclosureDate = content.match(/截止至：<font[^>]*>([^<]+)/)?.[1] || "";
  const table = content.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || "";
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((match) => parseHoldingRow(match[1]))
    .filter(Boolean)
    .slice(0, 10);

  if (!rows.length && month !== currentQuarterEndMonth()) {
    return fetchFundPortfolioHoldings(code, { year, month: currentQuarterEndMonth() });
  }

  return {
    fundCode: code,
    quarter,
    disclosureDate,
    source: SOURCE_NAME,
    rows
  };
}

export async function listConceptBoards() {
  return fetchBoardList("concept");
}

export async function listIndustryBoards() {
  return fetchBoardList("industry");
}

export async function fetchBoardConstituents(boardCode) {
  const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
  setSearchParams(url, {
    pn: "1",
    pz: "120",
    po: "1",
    np: "1",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: "2",
    invt: "2",
    fid: "f3",
    fs: `b:${boardCode}`,
    fields: "f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f15,f16,f17,f18"
  });

  const payload = await fetchJson(url, { Referer: "https://quote.eastmoney.com/" });
  return (payload.data?.diff || []).map((item) => ({
    stockCode: item.f12,
    stockName: item.f14,
    latestPrice: numberOrNull(item.f2),
    changePercent: numberOrNull(item.f3),
    volume: numberOrNull(item.f5),
    amount: numberOrNull(item.f6)
  }));
}

export async function fetchBoardIntraday(boardCode) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/trends2/get");
  setSearchParams(url, {
    secid: `90.${boardCode}`,
    fields1: "f1,f2,f3,f4,f5,f6,f7,f8",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58",
    ndays: "1",
    iscr: "0",
    iscca: "0"
  });

  const payload = await fetchJson(url, { Referer: "https://quote.eastmoney.com/" });
  return (payload.data?.trends || []).map((line) => {
    const [time, open, close, high, low, volume, amount] = String(line).split(",");
    return {
      time,
      open: numberOrNull(open),
      close: numberOrNull(close),
      high: numberOrNull(high),
      low: numberOrNull(low),
      volume: numberOrNull(volume),
      amount: numberOrNull(amount)
    };
  });
}

export async function checkHealth() {
  const boards = await listConceptBoards();
  return { ok: boards.length > 0, checkedAt: new Date().toISOString() };
}

async function fetchBoardList(type) {
  const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
  setSearchParams(url, {
    pn: "1",
    pz: "500",
    po: "1",
    np: "1",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: "2",
    invt: "2",
    fid: "f3",
    fs: type === "industry" ? "m:90+t:2" : "m:90+t:3",
    fields: "f12,f14,f2,f3,f4,f8,f104,f105,f128,f140"
  });

  const payload = await fetchJson(url, { Referer: "https://quote.eastmoney.com/" });
  const quotedAt = formatQuotedAt();
  return (payload.data?.diff || []).map((item) => ({
    code: item.f12,
    name: item.f14,
    type,
    latestPrice: numberOrNull(item.f2),
    changePercent: numberOrNull(item.f3),
    changeValue: numberOrNull(item.f4),
    turnoverRate: numberOrNull(item.f8),
    upCount: Number(item.f104 || 0),
    downCount: Number(item.f105 || 0),
    leadingStock: item.f128 || "",
    leadingStockCode: item.f140 || "",
    quotedAt,
    source: SOURCE_NAME
  }));
}

async function fetchJson(url, headers = {}) {
  const text = await fetchText(url, headers);
  return JSON.parse(text);
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers: { ...DEFAULT_HEADERS, ...headers } });
  if (!response.ok) throw new Error(`Eastmoney request failed: ${response.status}`);
  return response.text();
}

function parseHoldingRow(html) {
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => stripTags(match[1]));
  if (cells.length < 8) return null;
  const stockCode = cells[1].padStart(cells[1].length === 4 ? 5 : cells[1].length, "0");
  const weight = numberOrNull(String(cells[6]).replace("%", ""));
  if (!stockCode || !cells[2] || !Number.isFinite(weight)) return null;
  const tags = inferHoldingTags(stockCode, cells[2]);
  return {
    name: cells[2],
    stockCode,
    weight,
    sector: tags.sector,
    track: tags.track,
    change: 0,
    note: "东方财富基金档案同步"
  };
}

function inferHoldingTags(stockCode, name) {
  const opticalCodes = new Set(["300502", "300308", "300394", "301205", "300620", "603083", "601138", "002463"]);
  const pcbCodes = new Set(["300476", "002916", "002938", "002463"]);
  const hkTechCodes = new Set(["00700", "03690", "09988", "02899"]);
  if (opticalCodes.has(stockCode)) return { sector: "通信", track: "CPO/光模块" };
  if (pcbCodes.has(stockCode)) return { sector: "电子", track: "AI PCB" };
  if (hkTechCodes.has(stockCode)) return { sector: stockCode === "02899" ? "有色金属" : "互联网", track: stockCode === "02899" ? "铜金属" : "港股科技" };
  if (/铜|紫金|矿业/.test(name)) return { sector: "有色金属", track: "铜金属" };
  return { sector: "待分类", track: "待标注" };
}

function setSearchParams(url, params) {
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
}

function decodeEscapedHtml(value) {
  return String(value)
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/\\n/g, "")
    .replace(/\\t/g, "");
}

function stripHighlight(value) {
  return String(value).replace(/<[^>]+>/g, "");
}

function stripTags(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function currentYear() {
  const now = new Date();
  return now.getMonth() + 1 <= 3 ? now.getFullYear() - 1 : now.getFullYear();
}

function currentQuarterEndMonth() {
  const month = new Date().getMonth() + 1;
  if (month <= 3) return 12;
  if (month <= 6) return 3;
  if (month <= 9) return 6;
  return 9;
}

function formatQuotedAt() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  })
    .format(new Date())
    .replace(/\//g, "-");
}
