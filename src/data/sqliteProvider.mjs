import { getDb } from "../storage/database.mjs";

export function listFundRecords() {
  return getDb()
    .prepare(
      `
      SELECT
        code, name, manager, category, risk, nav,
        daily_change AS dailyChange,
        quarterly_return AS quarterlyReturn,
        max_drawdown AS maxDrawdown,
        volatility, size, benchmark,
        update_at AS updateAt
      FROM funds
      ORDER BY code
    `
    )
    .all();
}

export function getFundRecord(code) {
  return getDb()
    .prepare(
      `
      SELECT
        code, name, manager, category, risk, nav,
        daily_change AS dailyChange,
        quarterly_return AS quarterlyReturn,
        max_drawdown AS maxDrawdown,
        volatility, size, benchmark,
        update_at AS updateAt
      FROM funds
      WHERE code = ?
    `
    )
    .get(code);
}

export function listWatchlistCodes() {
  return new Set(getDb().prepare("SELECT fund_code AS code FROM watchlists ORDER BY created_at").all().map((row) => row.code));
}

export function setWatchlistCode(code, watched) {
  const database = getDb();
  if (watched) database.prepare("INSERT OR IGNORE INTO watchlists (fund_code) VALUES (?)").run(code);
  else database.prepare("DELETE FROM watchlists WHERE fund_code = ?").run(code);
}

export function getHoldingDisclosure(code) {
  return getDb()
    .prepare(
      `
      SELECT
        fund_code AS fundCode,
        quarter,
        disclosure_date AS disclosureDate,
        source
      FROM holding_disclosures
      WHERE fund_code = ?
    `
    )
    .get(code);
}

export function listHoldingRows(code, quarter) {
  return getDb()
    .prepare(
      `
      SELECT
        rank, name, stock_code AS stockCode, weight, sector, track,
        change_value AS change, note
      FROM fund_holdings
      WHERE fund_code = ? AND quarter = ?
      ORDER BY rank
    `
    )
    .all(code, quarter);
}

export function listPreviousHoldingRows(code, quarter) {
  return getDb()
    .prepare(
      `
      SELECT
        name, stock_code AS stockCode, weight
      FROM previous_fund_holdings
      WHERE fund_code = ? AND quarter = ?
      ORDER BY weight DESC
    `
    )
    .all(code, quarter);
}

export function listReportsBySectors(sectors) {
  if (!sectors.length) return [];
  const placeholders = sectors.map(() => "?").join(", ");
  return getDb()
    .prepare(
      `
      SELECT sector, title, source, summary, view, updated_at AS updatedAt
      FROM research_reports
      WHERE sector IN (${placeholders})
      ORDER BY sector, id
    `
    )
    .all(...sectors);
}

export function listAlertRules() {
  return getDb()
    .prepare(
      `
      SELECT id, name, metric, operator, threshold, level, enabled
      FROM alert_rules
      WHERE enabled = 1
      ORDER BY id
    `
    )
    .all();
}
