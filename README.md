# 基金雷达

一个基金检测网站原型，用来查看基金实时估值走势、上季度持仓、持仓股票所属板块和赛道研报，并在后台生成 AI 趋势结论。

## 运行

```bash
npm start
```

打开：

```text
http://127.0.0.1:4173
```

## 当前能力

- 基金列表与实时估值刷新
- 基金搜索与自选过滤
- 1周、1月、3月净值走势图
- 上季度重仓股、披露日期、板块、赛道、阶段表现
- 板块暴露权重
- 按持仓行业聚合研报摘要
- 预警规则展示
- AI 风格的趋势结论、置信度、证据来源与操作观察点

## 项目文档

开发新功能前先阅读：

- `docs/ARCHITECTURE.md`：整体架构设计规范，维护模块边界、接口规划和架构决策。
- `docs/DEV_PRACTICES.md`：开发实践经验总结，维护 coding 过程中的问题和可复用实现。

## 后续接入真实数据

`server.mjs` 里已经按业务资源拆分接口：

- `/api/funds`
- `/api/funds?q=关键词`
- `/api/funds/:code/trend`
- `/api/funds/:code/holdings`
- `/api/funds/:code/sectors`
- `/api/funds/:code/reports`
- `/api/funds/:code/insight`
- `/api/funds/:code/alerts`
- `/api/watchlists`
- `/api/alerts`

后续可以把文件中的模拟数据替换为：

- 基金净值与估值数据源
- 基金季报持仓解析
- 股票行业、概念、赛道映射
- 研报索引与摘要服务
- 大模型总结服务
