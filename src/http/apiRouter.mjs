import {
  buildAlerts,
  buildHoldingChanges,
  buildHoldings,
  buildInsight,
  buildPeerComparison,
  buildRealtime,
  buildReports,
  buildSectorExposure,
  buildSyncStatus,
  buildTrend,
  listFunds,
  listWatchlist,
  updateWatchlist
} from "../services/fundAnalytics.mjs";
import { importExternalFund, listRecentSyncRuns, searchExternalFunds, syncFundNav, syncWatchlistNav } from "../services/fundImportService.mjs";
import { updateFundHoldings } from "../services/fundHoldingService.mjs";
import { removeFundFromPool, updateFundProfile } from "../services/fundPoolService.mjs";
import { listFundStockTags, listStocks, updateStockTag } from "../services/stockTagService.mjs";
import { json, notFound, readJson } from "./respond.mjs";

export function createApiRouter() {
  return async function handleApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (!path.startsWith("/api/")) return false;

    if (req.method === "GET" && path === "/api/funds") {
      return json(res, listFunds(url.searchParams.get("q") || ""));
    }

    if (req.method === "GET" && path === "/api/sync-runs") {
      return json(res, listRecentSyncRuns(Number(url.searchParams.get("limit") || 12)));
    }

    if (req.method === "GET" && path === "/api/stocks") {
      return json(res, listStocks(url.searchParams.get("q") || ""));
    }

    const stockTagMatch = path.match(/^\/api\/stocks\/([^/]+)\/tags$/);
    if (stockTagMatch) {
      const [, stockCode] = stockTagMatch;
      if (req.method === "PATCH") {
        const body = await readJson(req);
        return json(res, updateStockTag(stockCode, body));
      }
      return notFound(res);
    }

    if (req.method === "GET" && path === "/api/fund-search") {
      return json(res, await searchExternalFunds(url.searchParams.get("q") || "", Number(url.searchParams.get("limit") || 8)));
    }

    if (req.method === "POST" && path === "/api/funds/import") {
      const body = await readJson(req);
      return json(res, await importExternalFund(String(body.code || ""), { syncNav: body.syncNav !== false }));
    }

    const fundRootMatch = path.match(/^\/api\/funds\/([^/]+)$/);
    if (fundRootMatch) {
      const [, code] = fundRootMatch;
      if (req.method === "DELETE") return json(res, removeFundFromPool(code));
      return notFound(res);
    }

    if (req.method === "GET" && path === "/api/watchlists") {
      return json(res, listWatchlist());
    }

    if (req.method === "POST" && path === "/api/watchlists/sync-nav") {
      const body = await readJson(req);
      return json(res, await syncWatchlistNav({ pages: Number(body.pages || 1), pageSize: Number(body.pageSize || 90) }));
    }

    if (req.method === "POST" && path === "/api/watchlists") {
      const body = await readJson(req);
      return json(res, updateWatchlist(String(body.code || ""), Boolean(body.watched)));
    }

    if (req.method === "GET" && path === "/api/alerts") {
      const code = url.searchParams.get("code");
      return json(res, code ? buildAlerts(code) : listFunds().flatMap((fund) => buildAlerts(fund.code).map((alert) => ({ ...alert, code: fund.code, fundName: fund.name }))));
    }

    const fundMatch = path.match(/^\/api\/funds\/([^/]+)\/([^/]+)$/);
    if (fundMatch) {
      const [, code, resource] = fundMatch;
      if (req.method === "POST" && resource === "sync-nav") {
        const body = await readJson(req);
        return json(res, await syncFundNav(code, { pages: Number(body.pages || 1), pageSize: Number(body.pageSize || 90) }));
      }
      if (req.method === "PATCH" && resource === "profile") {
        const body = await readJson(req);
        return json(res, updateFundProfile(code, body));
      }
      if (req.method === "PUT" && resource === "holdings") {
        const body = await readJson(req);
        return json(res, updateFundHoldings(code, body));
      }
      if (req.method !== "GET") return notFound(res);
      if (resource === "trend") return json(res, buildTrend(code, url.searchParams.get("range") || "1m"));
      if (resource === "holdings") return json(res, buildHoldings(code));
      if (resource === "holding-changes") return json(res, buildHoldingChanges(code));
      if (resource === "stock-tags") return json(res, listFundStockTags(code));
      if (resource === "sectors") return json(res, buildSectorExposure(code));
      if (resource === "peers") return json(res, buildPeerComparison(code));
      if (resource === "sync-status") return json(res, buildSyncStatus(code));
      if (resource === "reports") return json(res, buildReports(code));
      if (resource === "insight") return json(res, buildInsight(code));
      if (resource === "alerts") return json(res, buildAlerts(code));
      if (resource === "realtime") return json(res, buildRealtime(code));
    }

    return notFound(res);
  };
}
