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

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers: { ...DEFAULT_HEADERS, ...headers } });
  if (!response.ok) throw new Error(`Eastmoney request failed: ${response.status}`);
  const text = await response.text();
  return JSON.parse(text);
}

function stripHighlight(value) {
  return String(value).replace(/<[^>]+>/g, "");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
