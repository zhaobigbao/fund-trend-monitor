import { getDb } from "../storage/database.mjs";

export function listFundRecords() {
  return getDb()
    .prepare(
      `
      SELECT
        f.code, f.name, f.manager, f.category, f.risk, f.nav,
        f.daily_change AS dailyChange,
        f.quarterly_return AS quarterlyReturn,
        f.max_drawdown AS maxDrawdown,
        f.volatility, f.size, f.benchmark,
        f.update_at AS updateAt,
        COALESCE(p.group_name, '默认') AS groupName,
        COALESCE(p.tags, '') AS tags,
        COALESCE(p.note, '') AS note,
        p.updated_at AS profileUpdatedAt
      FROM funds f
      LEFT JOIN fund_pool_profiles p ON p.fund_code = f.code
      ORDER BY COALESCE(p.group_name, '默认'), f.code
    `
    )
    .all()
    .map(normalizeFundRecord);
}

export function getFundRecord(code) {
  const row = getDb()
    .prepare(
      `
      SELECT
        f.code, f.name, f.manager, f.category, f.risk, f.nav,
        f.daily_change AS dailyChange,
        f.quarterly_return AS quarterlyReturn,
        f.max_drawdown AS maxDrawdown,
        f.volatility, f.size, f.benchmark,
        f.update_at AS updateAt,
        COALESCE(p.group_name, '默认') AS groupName,
        COALESCE(p.tags, '') AS tags,
        COALESCE(p.note, '') AS note,
        p.updated_at AS profileUpdatedAt
      FROM funds f
      LEFT JOIN fund_pool_profiles p ON p.fund_code = f.code
      WHERE f.code = ?
    `
    )
    .get(code);
  return row ? normalizeFundRecord(row) : undefined;
}

export function upsertFundRecord(fund) {
  const database = getDb();
  database
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
  database.prepare("INSERT OR IGNORE INTO fund_pool_profiles (fund_code) VALUES (?)").run(fund.code);
}

export function getFundPoolProfile(code) {
  return normalizePoolProfile(
    getDb()
      .prepare(
        `
        SELECT
          fund_code AS fundCode,
          group_name AS groupName,
          tags,
          note,
          updated_at AS updatedAt
        FROM fund_pool_profiles
        WHERE fund_code = ?
      `
      )
      .get(code)
  );
}

export function upsertFundPoolProfile(code, profile) {
  const normalized = normalizeProfileInput(profile);
  getDb()
    .prepare(
      `
      INSERT INTO fund_pool_profiles (fund_code, group_name, tags, note, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(fund_code) DO UPDATE SET
        group_name = excluded.group_name,
        tags = excluded.tags,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `
    )
    .run(code, normalized.groupName, normalized.tags, normalized.note);

  return getFundPoolProfile(code);
}

export function removeFundRecord(code) {
  const database = getDb();
  const fund = getFundRecord(code);
  if (!fund) return null;

  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM sync_runs WHERE target LIKE ?").run(`%:${code}`);
    database.prepare("DELETE FROM funds WHERE code = ?").run(code);
    database.exec("COMMIT");
    return fund;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
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

export function getNavSyncSummary(code) {
  const summary = getDb()
    .prepare(
      `
      SELECT
        COUNT(*) AS recordCount,
        MIN(nav_date) AS firstNavDate,
        MAX(nav_date) AS latestNavDate,
        MAX(synced_at) AS latestSyncedAt
      FROM fund_nav_history
      WHERE fund_code = ?
    `
    )
    .get(code);

  const latestRecord = getDb()
    .prepare(
      `
      SELECT source
      FROM fund_nav_history
      WHERE fund_code = ?
      ORDER BY nav_date DESC
      LIMIT 1
    `
    )
    .get(code);

  const latestRun = getDb()
    .prepare(
      `
      SELECT status, message, synced_at AS syncedAt
      FROM sync_runs
      WHERE target LIKE ?
      ORDER BY synced_at DESC, id DESC
      LIMIT 1
    `
    )
    .get(`%${code}%`);

  return {
    recordCount: summary.recordCount,
    firstNavDate: summary.firstNavDate,
    latestNavDate: summary.latestNavDate,
    latestSyncedAt: summary.latestSyncedAt,
    source: latestRecord?.source || "",
    latestRun: latestRun || null
  };
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

export function listSyncRuns(limit = 12) {
  return getDb()
    .prepare(
      `
      SELECT
        id, source, target, status, message,
        synced_at AS syncedAt
      FROM sync_runs
      ORDER BY synced_at DESC, id DESC
      LIMIT ?
    `
    )
    .all(limit);
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

function normalizeFundRecord(row) {
  return {
    ...row,
    groupName: row.groupName || "默认",
    tags: parseTags(row.tags),
    note: row.note || "",
    profileUpdatedAt: row.profileUpdatedAt || ""
  };
}

function normalizePoolProfile(row) {
  if (!row) return null;
  return {
    ...row,
    groupName: row.groupName || "默认",
    tags: parseTags(row.tags),
    note: row.note || "",
    updatedAt: row.updatedAt || ""
  };
}

function normalizeProfileInput(profile = {}) {
  return {
    groupName: String(profile.groupName || "默认").trim().slice(0, 24) || "默认",
    tags: serializeTags(profile.tags),
    note: String(profile.note || "").trim().slice(0, 280)
  };
}

function parseTags(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeTags(value = "") {
  const tags = Array.isArray(value) ? value : String(value).split(/[，,]/);
  return tags
    .map((item) => String(item).trim().slice(0, 16))
    .filter(Boolean)
    .slice(0, 8)
    .join(",");
}
