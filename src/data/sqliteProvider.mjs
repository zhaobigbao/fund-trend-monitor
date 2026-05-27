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

export function upsertFundRecord(fund) {
  getDb()
    .prepare(
      `
      INSERT INTO funds (
        code, name, manager, category, risk, nav, daily_change,
        quarterly_return, max_drawdown, volatility, size, benchmark, update_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        manager = excluded.manager,
        category = excluded.category,
        risk = excluded.risk,
        nav = excluded.nav,
        daily_change = excluded.daily_change,
        update_at = excluded.update_at
    `
    )
    .run(
      fund.code,
      fund.name,
      fund.manager,
      fund.category,
      fund.risk,
      fund.nav,
      fund.dailyChange,
      fund.quarterlyReturn,
      fund.maxDrawdown,
      fund.volatility,
      fund.size,
      fund.benchmark,
      fund.updateAt
    );
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

export function listNavHistory(code, limit = 60) {
  return getDb()
    .prepare(
      `
      SELECT
        fund_code AS fundCode,
        nav_date AS navDate,
        unit_nav AS unitNav,
        accumulated_nav AS accumulatedNav,
        daily_growth AS dailyGrowth,
        subscription_status AS subscriptionStatus,
        redemption_status AS redemptionStatus,
        source,
        synced_at AS syncedAt
      FROM fund_nav_history
      WHERE fund_code = ?
      ORDER BY nav_date DESC
      LIMIT ?
    `
    )
    .all(code, limit)
    .reverse();
}

export function upsertNavHistory(code, records) {
  const database = getDb();
  const statement = database.prepare(
    `
    INSERT INTO fund_nav_history (
      fund_code, nav_date, unit_nav, accumulated_nav, daily_growth,
      subscription_status, redemption_status, source, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(fund_code, nav_date) DO UPDATE SET
      unit_nav = excluded.unit_nav,
      accumulated_nav = excluded.accumulated_nav,
      daily_growth = excluded.daily_growth,
      subscription_status = excluded.subscription_status,
      redemption_status = excluded.redemption_status,
      source = excluded.source,
      synced_at = CURRENT_TIMESTAMP
  `
  );

  database.exec("BEGIN");
  try {
    for (const record of records) {
      statement.run(
        code,
        record.navDate,
        record.unitNav,
        record.accumulatedNav,
        record.dailyGrowth,
        record.subscriptionStatus,
        record.redemptionStatus,
        record.source
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function updateFundNavSnapshot(code, record) {
  if (!record) return;
  getDb()
    .prepare(
      `
      UPDATE funds
      SET nav = ?, daily_change = ?, update_at = ?
      WHERE code = ?
    `
    )
    .run(record.unitNav, record.dailyGrowth || 0, record.navDate, code);
}

export function recordSyncRun(source, target, status, message) {
  getDb().prepare("INSERT INTO sync_runs (source, target, status, message) VALUES (?, ?, ?, ?)").run(source, target, status, message);
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
