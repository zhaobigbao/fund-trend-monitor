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
        h.rank, h.name, h.stock_code AS stockCode, h.weight,
        COALESCE(t.sector, h.sector) AS sector,
        COALESCE(t.track, h.track) AS track,
        h.change_value AS change,
        h.note
      FROM fund_holdings h
      LEFT JOIN stock_sector_tags t ON t.stock_code = h.stock_code
      WHERE h.fund_code = ? AND h.quarter = ?
      ORDER BY h.rank
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

export function replaceCurrentHoldings(code, disclosure, rows) {
  const database = getDb();
  const existingDisclosure = getHoldingDisclosure(code);
  const normalizedRows = rows.map(normalizeHoldingInput).filter(Boolean).slice(0, 10);

  const upsertDisclosure = database.prepare(`
    INSERT INTO holding_disclosures (fund_code, quarter, disclosure_date, source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(fund_code) DO UPDATE SET
      quarter = excluded.quarter,
      disclosure_date = excluded.disclosure_date,
      source = excluded.source
  `);

  const deleteHoldings = database.prepare("DELETE FROM fund_holdings WHERE fund_code = ? AND quarter = ?");
  const insertHolding = database.prepare(`
    INSERT INTO fund_holdings (
      fund_code, quarter, rank, name, stock_code, weight, sector, track, change_value, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const deletePrevious = database.prepare("DELETE FROM previous_fund_holdings WHERE fund_code = ? AND quarter = ?");
  const insertPrevious = database.prepare(`
    INSERT INTO previous_fund_holdings (fund_code, quarter, name, stock_code, weight)
    SELECT fund_code, quarter, name, stock_code, weight
    FROM fund_holdings
    WHERE fund_code = ? AND quarter = ?
  `);
  const insertStock = database.prepare(`
    INSERT INTO stocks (code, name, market, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(code) DO UPDATE SET
      name = COALESCE(NULLIF(stocks.name, ''), excluded.name)
  `);
  const insertTag = database.prepare(`
    INSERT OR IGNORE INTO stock_sector_tags (stock_code, sector, track, concepts, source)
    VALUES (?, ?, ?, '', 'holding')
  `);

  database.exec("BEGIN");
  try {
    if (existingDisclosure?.quarter && existingDisclosure.quarter !== disclosure.quarter) {
      deletePrevious.run(code, existingDisclosure.quarter);
      insertPrevious.run(code, existingDisclosure.quarter);
    }

    upsertDisclosure.run(code, disclosure.quarter, disclosure.disclosureDate, disclosure.source);
    deleteHoldings.run(code, disclosure.quarter);
    normalizedRows.forEach((row, index) => {
      insertStock.run(row.stockCode, row.name, inferMarket(row.stockCode));
      insertTag.run(row.stockCode, row.sector, row.track);
      insertHolding.run(code, disclosure.quarter, index + 1, row.name, row.stockCode, row.weight, row.sector, row.track, row.change, row.note);
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    fundCode: code,
    ...disclosure,
    rows: normalizedRows.map((row, index) => ({ rank: index + 1, ...row }))
  };
}

export function listStockTagsByCodes(codes) {
  const uniqueCodes = [...new Set(codes.filter(Boolean))];
  if (!uniqueCodes.length) return [];
  const placeholders = uniqueCodes.map(() => "?").join(", ");
  return getDb()
    .prepare(
      `
      SELECT
        s.code,
        s.name,
        s.market,
        t.sector,
        t.track,
        COALESCE(t.concepts, '') AS concepts,
        t.source,
        t.updated_at AS updatedAt
      FROM stocks s
      LEFT JOIN stock_sector_tags t ON t.stock_code = s.code
      WHERE s.code IN (${placeholders})
      ORDER BY s.code
    `
    )
    .all(...uniqueCodes)
    .map(normalizeStockTagRecord);
}

export function listStockTagRecords(query = "") {
  const keyword = query.trim().toLowerCase();
  return getDb()
    .prepare(
      `
      SELECT
        s.code,
        s.name,
        s.market,
        t.sector,
        t.track,
        COALESCE(t.concepts, '') AS concepts,
        t.source,
        t.updated_at AS updatedAt
      FROM stocks s
      LEFT JOIN stock_sector_tags t ON t.stock_code = s.code
      ORDER BY COALESCE(t.sector, '未分类'), s.code
    `
    )
    .all()
    .map(normalizeStockTagRecord)
    .filter((item) => {
      if (!keyword) return true;
      return [item.code, item.name, item.sector, item.track, item.concepts.join(",")].some((value) => String(value).toLowerCase().includes(keyword));
    });
}

export function upsertStockTagRecord(stockCode, input = {}) {
  const normalized = normalizeStockTagInput(stockCode, input);
  const database = getDb();
  database
    .prepare(
      `
      INSERT INTO stocks (code, name, market, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(code) DO UPDATE SET
        name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE stocks.name END,
        market = CASE WHEN excluded.market <> '' THEN excluded.market ELSE stocks.market END,
        updated_at = CURRENT_TIMESTAMP
    `
    )
    .run(normalized.code, normalized.name, normalized.market);

  database
    .prepare(
      `
      INSERT INTO stock_sector_tags (stock_code, sector, track, concepts, source, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(stock_code) DO UPDATE SET
        sector = excluded.sector,
        track = excluded.track,
        concepts = excluded.concepts,
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
    `
    )
    .run(normalized.code, normalized.sector, normalized.track, normalized.concepts, normalized.source);

  return listStockTagsByCodes([normalized.code])[0];
}

export function listReportsBySectors(sectors) {
  if (!sectors.length) return [];
  return listReportsBySignals({ sectors });
}

export function listReportsBySignals({ sectors = [], tracks = [], stockCodes = [] } = {}) {
  const sectorSet = new Set(sectors.filter(Boolean));
  const trackSet = new Set(tracks.filter(Boolean));
  const stockCodeSet = new Set(stockCodes.filter(Boolean));
  if (!sectorSet.size && !trackSet.size && !stockCodeSet.size) return [];

  return getDb()
    .prepare(
      `
      SELECT
        id,
        sector,
        target_type AS targetType,
        target_key AS targetKey,
        stock_code AS stockCode,
        track,
        title,
        source,
        summary,
        view,
        published_at AS publishedAt,
        updated_at AS updatedAt
      FROM research_reports
      ORDER BY id
    `
    )
    .all()
    .map(normalizeResearchReport)
    .filter((report) => isReportMatched(report, { sectorSet, trackSet, stockCodeSet }));
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

export function listDataSourceRecords() {
  return getDb()
    .prepare(
      `
      SELECT
        id, name, kind, enabled, priority,
        capabilities_json AS capabilitiesJson,
        config_json AS configJson,
        health_status AS healthStatus,
        last_checked_at AS lastCheckedAt
      FROM data_sources
      ORDER BY priority, id
    `
    )
    .all()
    .map(normalizeDataSourceRecord);
}

export function listDataSourceDefaultRecords() {
  return getDb()
    .prepare(
      `
      SELECT domain, source_id AS sourceId
      FROM data_source_defaults
      ORDER BY domain
    `
    )
    .all();
}

export function upsertDataSourceDefault(domain, sourceId) {
  getDb()
    .prepare(
      `
      INSERT INTO data_source_defaults (domain, source_id)
      VALUES (?, ?)
      ON CONFLICT(domain) DO UPDATE SET source_id = excluded.source_id
    `
    )
    .run(domain, sourceId);
}

export function getFundSourceBinding(code, domain) {
  return getDb()
    .prepare(
      `
      SELECT source_id AS sourceId
      FROM fund_source_bindings
      WHERE fund_code = ? AND domain = ?
    `
    )
    .get(code, domain)?.sourceId;
}

export function upsertFundSourceBinding(code, domain, sourceId) {
  getDb()
    .prepare(
      `
      INSERT INTO fund_source_bindings (fund_code, domain, source_id)
      VALUES (?, ?, ?)
      ON CONFLICT(fund_code, domain) DO UPDATE SET source_id = excluded.source_id
    `
    )
    .run(code, domain, sourceId);
}

export function updateDataSourceHealth(id, status) {
  getDb()
    .prepare(
      `
      UPDATE data_sources
      SET health_status = ?, last_checked_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    )
    .run(status, id);
}

export function upsertSectorRealtimeQuote(sourceId, quote) {
  getDb()
    .prepare(
      `
      INSERT INTO sector_realtime_quotes (
        source_id, sector_code, sector_name, sector_type, latest_price,
        change_percent, turnover_rate, up_count, down_count,
        leading_stock, leading_stock_code, quoted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, sector_code) DO UPDATE SET
        sector_name = excluded.sector_name,
        sector_type = excluded.sector_type,
        latest_price = excluded.latest_price,
        change_percent = excluded.change_percent,
        turnover_rate = excluded.turnover_rate,
        up_count = excluded.up_count,
        down_count = excluded.down_count,
        leading_stock = excluded.leading_stock,
        leading_stock_code = excluded.leading_stock_code,
        quoted_at = excluded.quoted_at
    `
    )
    .run(
      sourceId,
      quote.code,
      quote.name,
      quote.type,
      quote.latestPrice,
      quote.changePercent,
      quote.turnoverRate,
      quote.upCount,
      quote.downCount,
      quote.leadingStock,
      quote.leadingStockCode,
      quote.quotedAt
    );
}

export function replaceSectorConstituents(sourceId, sectorCode, sectorName, rows) {
  const database = getDb();
  const deleteRows = database.prepare("DELETE FROM sector_constituents WHERE source_id = ? AND sector_code = ?");
  const insertRow = database.prepare(`
    INSERT INTO sector_constituents (
      source_id, sector_code, sector_name, stock_code, stock_name, latest_price, change_percent, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  database.exec("BEGIN");
  try {
    deleteRows.run(sourceId, sectorCode);
    for (const row of rows) {
      insertRow.run(sourceId, sectorCode, sectorName, row.stockCode, row.stockName, row.latestPrice, row.changePercent);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function replaceSectorIntradayPoints(sourceId, sectorCode, period, points) {
  const database = getDb();
  const deleteRows = database.prepare("DELETE FROM sector_intraday_points WHERE source_id = ? AND sector_code = ? AND period = ?");
  const insertRow = database.prepare(`
    INSERT INTO sector_intraday_points (
      source_id, sector_code, period, point_time, open, close, high, low, volume, amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec("BEGIN");
  try {
    deleteRows.run(sourceId, sectorCode, period);
    for (const point of points) {
      insertRow.run(sourceId, sectorCode, period, point.time, point.open, point.close, point.high, point.low, point.volume, point.amount);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listSectorRealtimeQuoteRecords(sourceId) {
  return getDb()
    .prepare(
      `
      SELECT
        source_id AS sourceId,
        sector_code AS code,
        sector_name AS name,
        sector_type AS type,
        latest_price AS latestPrice,
        change_percent AS changePercent,
        turnover_rate AS turnoverRate,
        up_count AS upCount,
        down_count AS downCount,
        leading_stock AS leadingStock,
        leading_stock_code AS leadingStockCode,
        quoted_at AS quotedAt
      FROM sector_realtime_quotes
      WHERE source_id = ?
      ORDER BY quoted_at DESC, sector_code
    `
    )
    .all(sourceId);
}

export function listSectorConstituentRecords(sourceId, sectorCodes) {
  if (!sectorCodes.length) return [];
  const placeholders = sectorCodes.map(() => "?").join(",");
  return getDb()
    .prepare(
      `
      SELECT
        source_id AS sourceId,
        sector_code AS sectorCode,
        sector_name AS sectorName,
        stock_code AS stockCode,
        stock_name AS stockName,
        latest_price AS latestPrice,
        change_percent AS changePercent,
        updated_at AS updatedAt
      FROM sector_constituents
      WHERE source_id = ? AND sector_code IN (${placeholders})
      ORDER BY sector_code, stock_code
    `
    )
    .all(sourceId, ...sectorCodes);
}

export function listSectorIntradayPointRecords(sourceId, sectorCodes, period = "1d") {
  if (!sectorCodes.length) return [];
  const placeholders = sectorCodes.map(() => "?").join(",");
  return getDb()
    .prepare(
      `
      SELECT
        source_id AS sourceId,
        sector_code AS sectorCode,
        period,
        point_time AS time,
        open,
        close,
        high,
        low,
        volume,
        amount
      FROM sector_intraday_points
      WHERE source_id = ? AND period = ? AND sector_code IN (${placeholders})
      ORDER BY sector_code, point_time
    `
    )
    .all(sourceId, period, ...sectorCodes);
}

export function listCachedStockQuoteRecords(sourceId, stockCodes) {
  if (!stockCodes.length) return [];
  const placeholders = stockCodes.map(() => "?").join(",");
  return getDb()
    .prepare(
      `
      SELECT
        source_id AS sourceId,
        stock_code AS stockCode,
        stock_name AS stockName,
        latest_price AS latestPrice,
        change_percent AS changePercent,
        updated_at AS updatedAt
      FROM sector_constituents
      WHERE source_id = ? AND stock_code IN (${placeholders})
      ORDER BY updated_at DESC, sector_code
    `
    )
    .all(sourceId, ...stockCodes);
}

export function saveAiInsightRecord(code, insight) {
  const latest = getLatestAiInsightRecord(code);
  if (latest?.signature === insight.signature) return latest;

  getDb()
    .prepare(
      `
      INSERT INTO ai_insights (
        fund_code, headline, confidence, data_scope, sections_json,
        bullets_json, actions_json, evidence_json, signature, source, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      code,
      insight.headline,
      insight.confidence,
      insight.dataScope,
      JSON.stringify(insight.sections || {}),
      JSON.stringify(insight.bullets || []),
      JSON.stringify(insight.actions || []),
      JSON.stringify(insight.evidence || []),
      insight.signature,
      insight.source || "rules-v1",
      insight.generatedAt
    );

  return getLatestAiInsightRecord(code);
}

export function getLatestAiInsightRecord(code) {
  const row = getDb()
    .prepare(
      `
      SELECT
        id,
        fund_code AS fundCode,
        headline,
        confidence,
        data_scope AS dataScope,
        sections_json AS sectionsJson,
        bullets_json AS bulletsJson,
        actions_json AS actionsJson,
        evidence_json AS evidenceJson,
        signature,
        source,
        generated_at AS generatedAt,
        created_at AS createdAt
      FROM ai_insights
      WHERE fund_code = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    )
    .get(code);
  return row ? normalizeAiInsightRecord(row) : null;
}

export function listAiInsightRecords(code, limit = 8) {
  return getDb()
    .prepare(
      `
      SELECT
        id,
        fund_code AS fundCode,
        headline,
        confidence,
        data_scope AS dataScope,
        sections_json AS sectionsJson,
        bullets_json AS bulletsJson,
        actions_json AS actionsJson,
        evidence_json AS evidenceJson,
        signature,
        source,
        generated_at AS generatedAt,
        created_at AS createdAt
      FROM ai_insights
      WHERE fund_code = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `
    )
    .all(code, limit)
    .map(normalizeAiInsightRecord);
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

function normalizeDataSourceRecord(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    enabled: Boolean(row.enabled),
    priority: row.priority,
    capabilities: parseJson(row.capabilitiesJson, {}),
    config: parseJson(row.configJson, {}),
    healthStatus: row.healthStatus,
    lastCheckedAt: row.lastCheckedAt || ""
  };
}

function normalizeAiInsightRecord(row) {
  return {
    id: row.id,
    fundCode: row.fundCode,
    headline: row.headline,
    confidence: row.confidence,
    dataScope: row.dataScope,
    sections: parseJson(row.sectionsJson, {}),
    bullets: parseJson(row.bulletsJson, []),
    actions: parseJson(row.actionsJson, []),
    evidence: parseJson(row.evidenceJson, []),
    signature: row.signature,
    source: row.source,
    generatedAt: row.generatedAt,
    createdAt: row.createdAt
  };
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

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function normalizeStockTagRecord(row) {
  return {
    code: row.code,
    name: row.name || "",
    market: row.market || "",
    sector: row.sector || "未分类",
    track: row.track || "待标注",
    concepts: parseTags(row.concepts),
    source: row.source || "unknown",
    updatedAt: row.updatedAt || ""
  };
}

function normalizeResearchReport(row) {
  return {
    id: row.id,
    sector: row.sector,
    targetType: row.targetType || "sector",
    targetKey: row.targetKey || row.sector,
    stockCode: row.stockCode || "",
    track: row.track || "",
    title: row.title,
    source: row.source,
    summary: row.summary,
    view: row.view,
    publishedAt: row.publishedAt || "",
    updatedAt: row.updatedAt || ""
  };
}

function isReportMatched(report, { sectorSet, trackSet, stockCodeSet }) {
  if (report.targetType === "stock") return stockCodeSet.has(report.stockCode || report.targetKey);
  if (report.targetType === "track") return trackSet.has(report.track || report.targetKey);
  return sectorSet.has(report.sector || report.targetKey);
}

function normalizeStockTagInput(stockCode, input = {}) {
  const code = String(stockCode || input.code || "").trim().slice(0, 16);
  return {
    code,
    name: String(input.name || "").trim().slice(0, 40),
    market: String(input.market || inferMarket(code)).trim().slice(0, 8),
    sector: String(input.sector || "未分类").trim().slice(0, 24) || "未分类",
    track: String(input.track || "待标注").trim().slice(0, 32) || "待标注",
    concepts: serializeTags(input.concepts || ""),
    source: String(input.source || "manual").trim().slice(0, 24) || "manual"
  };
}

function normalizeHoldingInput(row = {}) {
  const name = String(row.name || "").trim().slice(0, 40);
  const stockCode = String(row.stockCode || row.code || "").trim().slice(0, 16);
  if (!name || !stockCode) return null;

  return {
    name,
    stockCode,
    weight: clampNumber(row.weight, 0, 100),
    sector: String(row.sector || "未分类").trim().slice(0, 24) || "未分类",
    track: String(row.track || "待标注").trim().slice(0, 32) || "待标注",
    change: clampNumber(row.change, -100, 100),
    note: String(row.note || "").trim().slice(0, 80)
  };
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(min, Number(number.toFixed(2))));
}

function inferMarket(stockCode) {
  if (/^\d{5}$/.test(stockCode)) return "HK";
  if (/^(6|9)/.test(stockCode)) return "SH";
  if (/^(0|3|2)/.test(stockCode)) return "SZ";
  return "";
}
