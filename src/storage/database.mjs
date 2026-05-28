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
  migrateSchema(database);
  seedDatabase(database);
  backfillStockTags(database);
  backfillResearchReportTargets(database);
  seedResearchIntelligence(database);
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
      target_type TEXT NOT NULL DEFAULT 'sector',
      target_key TEXT NOT NULL DEFAULT '',
      stock_code TEXT NOT NULL DEFAULT '',
      track TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      summary TEXT NOT NULL,
      view TEXT NOT NULL,
      published_at TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS ai_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fund_code TEXT NOT NULL REFERENCES funds(code) ON DELETE CASCADE,
      headline TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      data_scope TEXT NOT NULL,
      sections_json TEXT NOT NULL,
      bullets_json TEXT NOT NULL,
      actions_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      signature TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'rules-v1',
      generated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_ai_insights_fund_created
      ON ai_insights (fund_code, created_at DESC, id DESC);
  `);
}

function migrateSchema(database) {
  const columns = new Set(database.prepare("PRAGMA table_info(research_reports)").all().map((column) => column.name));
  const migrations = [
    ["target_type", "ALTER TABLE research_reports ADD COLUMN target_type TEXT NOT NULL DEFAULT 'sector'"],
    ["target_key", "ALTER TABLE research_reports ADD COLUMN target_key TEXT NOT NULL DEFAULT ''"],
    ["stock_code", "ALTER TABLE research_reports ADD COLUMN stock_code TEXT NOT NULL DEFAULT ''"],
    ["track", "ALTER TABLE research_reports ADD COLUMN track TEXT NOT NULL DEFAULT ''"],
    ["published_at", "ALTER TABLE research_reports ADD COLUMN published_at TEXT NOT NULL DEFAULT ''"]
  ];

  for (const [column, sql] of migrations) {
    if (!columns.has(column)) database.exec(sql);
  }
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

function backfillResearchReportTargets(database) {
  database
    .prepare(
      `
      UPDATE research_reports
      SET
        target_type = CASE WHEN target_type = '' THEN 'sector' ELSE target_type END,
        target_key = CASE WHEN target_key = '' THEN sector ELSE target_key END,
        published_at = CASE WHEN published_at = '' THEN updated_at ELSE published_at END
      WHERE target_key = '' OR published_at = '' OR target_type = ''
    `
    )
    .run();
}

function seedResearchIntelligence(database) {
  const reports = [
    {
      sector: "食品饮料",
      targetType: "track",
      targetKey: "高端白酒",
      stockCode: "",
      track: "高端白酒",
      title: "高端白酒批价稳定性跟踪",
      source: "中原证券",
      summary: "飞天批价、渠道库存和宴席需求是白酒持仓胜率的主要验证点。",
      view: "谨慎乐观",
      publishedAt: "2026-05-24"
    },
    {
      sector: "食品饮料",
      targetType: "stock",
      targetKey: "600519",
      stockCode: "600519",
      track: "高端白酒",
      title: "贵州茅台现金流与分红韧性跟踪",
      source: "华东证券",
      summary: "龙头渠道利润和分红预期仍具防御属性，短期弹性取决于批价企稳。",
      view: "中性偏多",
      publishedAt: "2026-05-23"
    },
    {
      sector: "互联网",
      targetType: "stock",
      targetKey: "00700",
      stockCode: "00700",
      track: "AI应用",
      title: "腾讯控股 AI 应用与广告效率更新",
      source: "中信建投",
      summary: "视频号广告、云服务和大模型工具化是利润率再评估的核心线索。",
      view: "看多",
      publishedAt: "2026-05-22"
    },
    {
      sector: "电子",
      targetType: "track",
      targetKey: "半导体设备",
      stockCode: "",
      track: "半导体设备",
      title: "半导体设备国产替代订单延续",
      source: "国金证券",
      summary: "晶圆厂资本开支结构继续向本土设备倾斜，设备龙头订单能见度较高。",
      view: "看多",
      publishedAt: "2026-05-21"
    },
    {
      sector: "通信",
      targetType: "track",
      targetKey: "AI服务器",
      stockCode: "",
      track: "AI服务器",
      title: "AI 服务器供应链景气度跟踪",
      source: "广发证券",
      summary: "海外云厂商资本开支仍在扩张，服务器链条订单和交付节奏保持高景气。",
      view: "看多",
      publishedAt: "2026-05-20"
    }
  ];

  const insertReport = database.prepare(`
    INSERT INTO research_reports (
      sector, target_type, target_key, stock_code, track, title, source, summary, view, published_at, updated_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM research_reports WHERE title = ?)
  `);

  database.exec("BEGIN");
  try {
    for (const report of reports) {
      insertReport.run(
        report.sector,
        report.targetType,
        report.targetKey,
        report.stockCode,
        report.track,
        report.title,
        report.source,
        report.summary,
        report.view,
        report.publishedAt,
        "本周更新",
        report.title
      );
    }
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
