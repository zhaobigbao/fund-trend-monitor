import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { funds, holdingDisclosures, holdingRows, initialWatchlist, previousHoldingRows, reports } from "../data/mockData.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(__dirname, "..", "..");
const defaultDbPath = join(projectRoot, "data", "fund-radar.sqlite");

let db;

export function getDb() {
  if (!db) {
    const dbPath = process.env.FUND_RADAR_DB || defaultDbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON");
    initializeDatabase(db);
  }
  return db;
}

export function initializeDatabase(database = getDb()) {
  createSchema(database);
  seedDatabase(database);
  backfillStockTags(database);
  return database;
}

function createSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS funds (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      manager TEXT NOT NULL,
      category TEXT NOT NULL,
      risk TEXT NOT NULL,
      nav REAL NOT NULL,
      daily_change REAL NOT NULL,
      quarterly_return REAL NOT NULL,
      max_drawdown REAL NOT NULL,
      volatility REAL NOT NULL,
      size TEXT NOT NULL,
      benchmark TEXT NOT NULL,
      update_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS holding_disclosures (
      fund_code TEXT PRIMARY KEY REFERENCES funds(code) ON DELETE CASCADE,
      quarter TEXT NOT NULL,
      disclosure_date TEXT NOT NULL,
      source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fund_pool_profiles (
      fund_code TEXT PRIMARY KEY REFERENCES funds(code) ON DELETE CASCADE,
      group_name TEXT NOT NULL DEFAULT '默认',
      tags TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fund_holdings (
      fund_code TEXT NOT NULL REFERENCES funds(code) ON DELETE CASCADE,
      quarter TEXT NOT NULL,
      rank INTEGER NOT NULL,
      name TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      weight REAL NOT NULL,
      sector TEXT NOT NULL,
      track TEXT NOT NULL,
      change_value REAL NOT NULL,
      note TEXT NOT NULL,
      PRIMARY KEY (fund_code, quarter, stock_code)
    );

    CREATE TABLE IF NOT EXISTS stocks (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      market TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_sector_tags (
      stock_code TEXT PRIMARY KEY REFERENCES stocks(code) ON DELETE CASCADE,
      sector TEXT NOT NULL,
      track TEXT NOT NULL,
      concepts TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fund_nav_history (
      fund_code TEXT NOT NULL REFERENCES funds(code) ON DELETE CASCADE,
      nav_date TEXT NOT NULL,
      unit_nav REAL NOT NULL,
      accumulated_nav REAL,
      daily_growth REAL,
      subscription_status TEXT,
      redemption_status TEXT,
      source TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (fund_code, nav_date)
    );

    CREATE TABLE IF NOT EXISTS previous_fund_holdings (
      fund_code TEXT NOT NULL REFERENCES funds(code) ON DELETE CASCADE,
      quarter TEXT NOT NULL,
      name TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY (fund_code, quarter, stock_code)
    );

    CREATE TABLE IF NOT EXISTS research_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sector TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      summary TEXT NOT NULL,
      view TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '本周更新'
    );

    CREATE TABLE IF NOT EXISTS watchlists (
      fund_code TEXT PRIMARY KEY REFERENCES funds(code) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      metric TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold REAL NOT NULL,
      level TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedDatabase(database) {
  if (database.prepare("SELECT COUNT(*) AS count FROM funds").get().count > 0) return;

  const insertFund = database.prepare(`
    INSERT INTO funds (
      code, name, manager, category, risk, nav, daily_change, quarterly_return,
      max_drawdown, volatility, size, benchmark, update_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDisclosure = database.prepare(`
    INSERT INTO holding_disclosures (fund_code, quarter, disclosure_date, source)
    VALUES (?, ?, ?, ?)
  `);

  const insertHolding = database.prepare(`
    INSERT INTO fund_holdings (
      fund_code, quarter, rank, name, stock_code, weight, sector, track, change_value, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPreviousHolding = database.prepare(`
    INSERT INTO previous_fund_holdings (fund_code, quarter, name, stock_code, weight)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertReport = database.prepare(`
    INSERT INTO research_reports (sector, title, source, summary, view)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertWatchlist = database.prepare("INSERT INTO watchlists (fund_code) VALUES (?)");

  const insertPoolProfile = database.prepare("INSERT OR IGNORE INTO fund_pool_profiles (fund_code) VALUES (?)");

  const insertRule = database.prepare(`
    INSERT INTO alert_rules (id, name, metric, operator, threshold, level)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  database.exec("BEGIN");
  try {
    for (const fund of funds) {
      insertFund.run(
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

      const disclosure = holdingDisclosures[fund.code];
      insertDisclosure.run(fund.code, disclosure.quarter, disclosure.disclosureDate, disclosure.source);

      (holdingRows[fund.code] || []).forEach(([name, stockCode, weight, sector, track, change, note], index) => {
        insertHolding.run(fund.code, disclosure.quarter, index + 1, name, stockCode, weight, sector, track, change, note);
      });

      const previousQuarter = previousQuarterOf(disclosure.quarter);
      (previousHoldingRows[fund.code] || []).forEach(([name, stockCode, weight]) => {
        insertPreviousHolding.run(fund.code, previousQuarter, name, stockCode, weight);
      });

      insertPoolProfile.run(fund.code);
    }

    for (const [sector, sectorReports] of Object.entries(reports)) {
      for (const [title, source, summary, view] of sectorReports) insertReport.run(sector, title, source, summary, view);
    }

    for (const code of initialWatchlist) insertWatchlist.run(code);

    insertRule.run("realtime-change", "盘中波动放大", "absRealtimeChange", ">=", 1.2, "medium");
    insertRule.run("sector-concentration", "行业集中度偏高", "topSectorWeight", ">=", 35, "high");
    insertRule.run("top3-concentration", "前三重仓影响较强", "concentrationTop3", ">=", 30, "medium");
    insertRule.run("max-drawdown", "历史回撤较深", "maxDrawdown", "<=", -15, "medium");

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function backfillStockTags(database) {
  const rows = database
    .prepare(
      `
      SELECT stock_code AS stockCode, name, sector, track
      FROM fund_holdings
      WHERE stock_code <> ''
      ORDER BY fund_code, quarter, rank
    `
    )
    .all();
  if (!rows.length) return;

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
    for (const row of rows) {
      insertStock.run(row.stockCode, row.name, inferMarket(row.stockCode));
      insertTag.run(row.stockCode, row.sector || "未分类", row.track || "待标注");
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function previousQuarterOf(quarter) {
  const match = quarter.match(/^(\d{4})Q([1-4])$/);
  if (!match) return "上一季度";
  const year = Number(match[1]);
  const q = Number(match[2]);
  return q === 1 ? `${year - 1}Q4` : `${year}Q${q - 1}`;
}

function inferMarket(stockCode) {
  if (/^\d{5}$/.test(stockCode)) return "HK";
  if (/^(6|9)/.test(stockCode)) return "SH";
  if (/^(0|3|2)/.test(stockCode)) return "SZ";
  return "";
}

export function databaseExists() {
  return existsSync(process.env.FUND_RADAR_DB || defaultDbPath);
}
