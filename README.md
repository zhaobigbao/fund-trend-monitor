# 基金雷达

一个基金检测网站原型，用来查看基金实时估值走势、上季度持仓、持仓股票所属板块和赛道研报，并在后台生成 AI 趋势结论。

## 运行

需要 Node.js 22.5 或更高版本，以使用内置 SQLite 能力。

```bash
npm run init-db
npm run sync:funds
npm start
```

打开：

```text
http://127.0.0.1:4173
```

## 当前能力

- 基金列表与实时估值刷新
- 基金搜索与自选过滤
- 外部基金搜索与导入本地基金池
- 本地基金池分组、标签、备注和移除
- 1周、1月、3月净值走势图
- 上季度重仓股、披露日期、板块、赛道、阶段表现
- 本地补录季度持仓，补齐导入基金的持仓分析入口
- 股票标签库：维护重仓股行业、赛道和概念标签
- 同类基金收益、回撤、波动和综合评分对比
- 季度持仓变化追踪
- 板块暴露权重
- 按持仓个股、赛道、行业多维聚合研报摘要
- 预警规则展示
- 结构化 AI 趋势结论：趋势判断、风险提示、证据链与观察指标
- AI 结论历史回看，最近结论会落库并按内容去重
- SQLite 本地数据底座，自选基金和预警规则已落库
- 可同步公开基金历史净值，走势图优先使用真实净值历史
- 净值同步状态展示：来源、记录数、最新净值日
- 数据源中心：展示各模块来源覆盖状态
- 东方财富真实持仓同步与板块实时雷达，支持查看 CPO 等概念板块当天走势和重仓股交集

## 项目文档

开发新功能前先阅读：

- `docs/ARCHITECTURE.md`：整体架构设计规范，维护模块边界、接口规划和架构决策。
- `docs/DATA_SOURCE_STRATEGY.md`：真实数据源策略与切换设计，维护候选数据源、板块实时走势和数据源中心规划。
- `docs/DEV_PRACTICES.md`：开发实践经验总结，维护 coding 过程中的问题和可复用实现。

## 后续接入真实数据

`server.mjs` 里已经按业务资源拆分接口：

- `/api/fund-search?q=关键词`
- `/api/funds`
- `/api/funds?q=关键词`
- `/api/funds/import`
- `/api/funds/:code`
- `/api/funds/:code/profile`
- `/api/funds/:code/trend`
- `/api/funds/:code/holdings`
- `/api/funds/:code/holding-changes`
- `/api/funds/:code/stock-tags`
- `/api/funds/:code/sectors`
- `/api/funds/:code/peers`
- `/api/funds/:code/sync-status`
- `/api/funds/:code/sync-nav`
- `/api/funds/:code/reports`
- `/api/funds/:code/insight`
- `/api/funds/:code/insights`
- `/api/funds/:code/alerts`
- `/api/funds/:code/source-coverage`
- `/api/funds/:code/sector-radar`
- `/api/funds/:code/sync-all`
- `/api/data-sources`
- `/api/watchlists`
- `/api/watchlists/sync-nav`
- `/api/stocks`
- `/api/stocks/:code/tags`
- `/api/sync-runs`
- `/api/alerts`

后续可以把文件中的模拟数据替换为：

- 基金净值与估值数据源
- 基金季报持仓解析
- 股票行业、概念、赛道映射
- 研报索引与摘要服务
- 大模型总结服务

## 数据同步

同步当前本地基金池的历史净值：

```bash
npm run sync:funds
```

只同步指定基金：

```bash
npm run sync:funds -- --codes=110022,005827 --pages=2
```

搜索基金：

```bash
npm run sync:funds -- --search=易方达消费 --limit=5
```

当前外部数据适配器用于原型研究，正式产品需要确认数据源授权和使用合规性。
