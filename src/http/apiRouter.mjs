import {
  buildAlerts,
  buildHoldings,
  buildInsight,
  buildRealtime,
  buildReports,
  buildSectorExposure,
  buildTrend,
  listFunds,
  listWatchlist,
  updateWatchlist
} from "../services/fundAnalytics.mjs";
import { json, notFound, readJson } from "./respond.mjs";

export function createApiRouter() {
  return async function handleApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (!path.startsWith("/api/")) return false;

    if (req.method === "GET" && path === "/api/funds") {
      return json(res, listFunds(url.searchParams.get("q") || ""));
    }

    if (req.method === "GET" && path === "/api/watchlists") {
      return json(res, listWatchlist());
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
    if (req.method === "GET" && fundMatch) {
      const [, code, resource] = fundMatch;
      if (resource === "trend") return json(res, buildTrend(code, url.searchParams.get("range") || "1m"));
      if (resource === "holdings") return json(res, buildHoldings(code));
      if (resource === "sectors") return json(res, buildSectorExposure(code));
      if (resource === "reports") return json(res, buildReports(code));
      if (resource === "insight") return json(res, buildInsight(code));
      if (resource === "alerts") return json(res, buildAlerts(code));
      if (resource === "realtime") return json(res, buildRealtime(code));
    }

    return notFound(res);
  };
}
