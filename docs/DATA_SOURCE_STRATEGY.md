# 数据源策略与切换设计

本文档维护基金雷达后续真实数据源接入、数据源切换、板块实时走势和数据质量治理方案。

## 当前痛点

以 `000979` 这类主动权益基金为例，单一公开基金净值源只能解决“基金净值历史”和“基础资料”问题，无法完整支撑：

- 最新季度持仓明细
- 持仓股票所属行业、概念、赛道
- CPO、光模块、AI 算力等概念板块的当天实时走势
- 板块成份股与基金重仓股的交集
- 重仓股实时行情与涨跌贡献
- 多源数据之间的冲突校验

因此后续需要从“单数据源同步”升级为“多数据源能力矩阵 + 可切换数据源 + 数据质量标识”。

## 候选数据源分层

### 第一层：原型优先数据源

#### AKShare + 东方财富/天天基金/雪球/同花顺公开页面

适用场景：

- 基金历史净值
- 基金季度持仓
- 基金资产配置
- 东方财富行业板块实时行情
- 东方财富概念板块实时行情
- 概念板块成份股
- 概念板块分钟级走势

优点：

- 接入成本低，适合 MVP 快速补齐数据维度。
- 对“CPO概念”等主题板块支持较直接。
- 能用来验证产品链路：基金持仓 -> 股票标签 -> 概念板块 -> 当天走势。

限制：

- 多数底层来自网页或公开接口封装，稳定性和授权边界需要持续评估。
- 不适合作为正式商业产品的唯一长期数据源。
- 需要做缓存、限频、失败回退和来源提示。

### 第二层：量化/研究增强数据源

#### Tushare Pro

适用场景：

- 公募基金列表
- 公募基金净值
- 场内基金日线行情
- 公募基金股票持仓
- 股票、指数、财务和部分行业相关数据

优点：

- API 形态更标准，适合做结构化数据底座。
- 对基金净值和基金持仓的历史化能力更强。

限制：

- 需要 token 和积分权限。
- 对“当天概念板块实时走势”不应作为唯一来源，需要搭配实时行情源。

### 第三层：正式产品数据源

#### 同花顺 iFinD / Wind / Choice

适用场景：

- 实时行情
- 板块成分及报表
- 基金资料、基金持仓、指数、行业和概念数据
- 机构级投研与合规场景

优点：

- 数据覆盖广、稳定性更强，适合正式产品。
- 具备更清晰的授权与服务支持路径。

限制：

- 通常需要付费账号、客户端或专用 SDK。
- 接入前需要确认许可范围、调用限制、部署方式和是否允许对外展示。

## 推荐落地顺序

### 阶段一：数据源中心与 AKShare 概念板块

目标：

- 增加“数据源中心”，支持选择默认数据源。
- 引入 AKShare 作为可选原型数据源。
- 为基金详情页增加“板块实时雷达”。
- 对 `000979` 这类基金，至少能展示持仓映射到的 CPO、光模块、通信设备等概念/行业板块当天走势。

当前实现说明：

- 已先采用 Node 直接访问东方财富公开接口实现 MVP，不额外引入 Python/AKShare 运行时依赖。
- `eastmoney` 数据源已支持基金搜索、历史净值、基金持仓、行业/概念板块列表、板块成份股和板块分钟走势。
- 后续仍可把 AKShare 作为另一个 adapter 接入，与当前 `eastmoney` 数据源共存。

优先接入能力：

- 基金持仓：`fund_portfolio_hold_em`
- 开放式基金历史净值：`fund_open_fund_info_em`
- 概念板块实时行情：`stock_board_concept_name_em`
- 指定概念板块实时行情：`stock_board_concept_spot_em`
- 概念板块成份股：`stock_board_concept_cons_em`
- 概念板块分钟走势：`stock_board_concept_hist_min_em`
- 行业板块实时行情：`stock_board_industry_name_em`
- 个股实时行情：东方财富 push2 行情接口，用于估算重仓股贡献

### 阶段二：源级能力矩阵与基金级覆盖提示

目标：

- 每个数据源声明自己的能力：基金搜索、基金净值、基金持仓、股票标签、概念板块、行业板块、研报。
- 页面展示当前基金哪些数据来自哪个源，哪些缺失。
- 用户可以按模块切换数据源，例如“基金净值用东方财富，板块走势用 AKShare/东方财富概念板块”。

### 阶段三：商业数据源适配

目标：

- 预留 iFinD、Wind、Choice 的适配器接口。
- 用户有账号后只需要配置 token、SDK 路径或连接参数。
- 商业源优先级高于公开封装源，公开源作为回退。

## 数据源切换功能设计

### 前端入口

当前“数据源中心”收拢在基金详情页顶部“数据同步”弹窗中：

- 默认基金数据源
- 默认持仓数据源
- 默认股票标签源
- 默认行业/概念板块源
- 默认研报源
- 数据源健康状态
- 最近同步时间
- 能力覆盖标签

当前实现规则：

- 已接入源可以被保存为当前基金的模块来源。
- 候选源进入选择列表但置灰展示，等 adapter、token、SDK 或运行时配置补齐后再启用。
- 保存时由服务层校验 source 是否启用、是否具备该模块能力，前端不自行判断最终有效性。

基金详情页新增“来源覆盖”条：

- 净值：来源、最新日期、记录数
- 持仓：来源、披露季度、披露日期
- 板块：来源、更新时间、命中概念
- 研报：来源、样本数量、更新时间
- AI 结论：引用的数据范围

### API 设计

建议新增：

- `GET /api/data-sources`
- `PATCH /api/data-sources/defaults`
- `GET /api/funds/:code/source-coverage`
- `PATCH /api/funds/:code/source-bindings`
- `GET /api/funds/:code/sector-radar`
- `POST /api/funds/:code/sync-all`
- `POST /api/data-sources/:sourceId/test`

### 数据模型设计

建议新增：

- `data_sources`
  - `id`
  - `name`
  - `kind`
  - `enabled`
  - `priority`
  - `capabilities_json`
  - `config_json`
  - `health_status`
  - `last_checked_at`

- `data_source_defaults`
  - `domain`
  - `source_id`

- `fund_source_bindings`
  - `fund_code`
  - `domain`
  - `source_id`

- `sector_aliases`
  - `source_id`
  - `source_sector_name`
  - `normalized_name`
  - `sector_type`

- `sector_realtime_quotes`
  - `source_id`
  - `sector_code`
  - `sector_name`
  - `sector_type`
  - `latest_price`
  - `change_percent`
  - `turnover_rate`
  - `up_count`
  - `down_count`
  - `leading_stock`
  - `quoted_at`

- `sector_intraday_points`
  - `source_id`
  - `sector_code`
  - `sector_name`
  - `period`
  - `point_time`
  - `open`
  - `close`
  - `high`
  - `low`
  - `volume`
  - `amount`

- `sector_constituents`
  - `source_id`
  - `sector_code`
  - `sector_name`
  - `stock_code`
  - `stock_name`
  - `weight`
  - `updated_at`

## 适配器接口设计

每个数据源用 adapter 封装，不允许页面直接调用外部接口。

建议统一接口：

```js
{
  id: "akshare",
  name: "AKShare",
  capabilities: {
    fundSearch: true,
    fundNav: true,
    fundHoldings: true,
    stockTags: false,
    industryBoards: true,
    conceptBoards: true,
    boardIntraday: true,
    researchReports: false
  },
  searchFunds(keyword),
  getFundProfile(code),
  getFundNavHistory(code, options),
  getFundHoldings(code, options),
  listBoards(type),
  getBoardRealtime(boardNameOrCode),
  getBoardIntraday(boardNameOrCode, options),
  getBoardConstituents(boardNameOrCode),
  getHealth()
}
```

## 板块实时雷达设计

基金详情页的“板块实时雷达”不直接展示全市场板块，而是按当前基金持仓推导：

1. 读取基金最新季度持仓。
2. 根据股票标签库、概念板块成份股、行业板块成份股，生成候选板块。
3. 对候选板块拉取实时行情和分钟走势。
4. 计算基金持仓与板块成份股交集。
5. 按“持仓权重交集 + 板块热度 + 用户关注赛道”排序。

展示字段：

- 板块名称，例如 `CPO概念`
- 板块类型：概念 / 行业 / 自定义赛道
- 当天涨跌幅
- 分钟走势
- 上涨家数 / 下跌家数
- 领涨股票
- 与本基金重仓股交集
- 命中赛道关键词和持仓交集权重
- 数据源与更新时间

当前实现已从“首个关键词命中”升级为“持仓赛道权重打分”：

- 每只持仓会贡献行业、赛道和别名关键词，例如 `CPO/光模块` 会展开为 `CPO概念`、`光模块`、`光通信`、`通信设备`。
- 候选概念板块和行业板块按关键词匹配强度、持仓权重、板块类型和涨跌幅排序。
- 页面展示命中关键词和持仓交集权重，帮助用户理解 CPO、AI服务器、AI PCB、铜金属等板块为什么出现在雷达中。
- 外部实时源不可用时，优先读取最近一次缓存的板块行情、成份股和分钟走势；页面消息需要标明当前是缓存视图。

## 数据质量和合规约束

- 所有外部数据必须带 `source`、`syncedAt`、`quotedAt`。
- 页面必须标明基金持仓是季报披露数据，不是实时持仓。
- 重仓股贡献是基于季报披露权重的近似估算，不等同基金公司实时仓位或最终净值。
- 概念板块映射属于辅助分析，不等同于基金经理真实配置意图。
- 免费公开源只作为原型和个人研究用途，正式产品必须确认授权。
- 同一模块允许多源并存，但 AI 结论必须记录引用的数据源和数据范围。

## 调研依据

- AKShare 项目说明：数据来自公开数据源，项目定位为学术研究用途，正式产品需要自行评估商业风险。
- AKShare 基金持仓接口：`fund_portfolio_hold_em` 可获取天天基金网基金档案中的投资组合持仓。
- AKShare 概念板块接口：支持东方财富概念板块名称、实时行情、历史行情、分钟行情和板块成份。
- Tushare Pro 基金持仓接口：`fund_portfolio` 可作为更标准化的基金持仓历史数据源。
