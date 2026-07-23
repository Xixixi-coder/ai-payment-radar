# 每日更新机制

## 现状结论

- 线上页面最后一条日报停在 `2026-07-17`，当前日期为 `2026-07-23`，说明日报链路已经断更。
- 仓库历史提交显示此前由 `AI Radar Bot <radar@jd.com>` 在每天 18 点左右直接提交日报，但仓库内没有 `.github/workflows` 或可复现脚本，外部 Bot 失败后不会在仓库内产生告警。
- 首页静态占位日期曾停留在旧日期，虽然 JavaScript 会渲染 `REPORT.date`，但无 JS 抓取或预览容易看到过期信息。

## 改造方案

- `.github/workflows/daily-update.yml`：每天北京时间 `18:05` 运行，也支持手动 `workflow_dispatch` 传入完整 `REPORT_JSON`。
- `scripts/update-daily-report.mjs`：生成或接收当日 `REPORT`，同步首页静态占位，写入 `archive/YYYY-MM-DD.html`，维护 `archive/index.json` 和 `archive/last-updated.json`。
- `scripts/verify-site.mjs`：检查日报是否过期、归档索引是否倒序、最新归档文件是否存在、首页占位是否与 `REPORT` 同步。
- `scripts/e2e-site.mjs`：启动本地静态服务，用 Playwright 验证首页 → 历史列表 → 最新归档页的完整链路。

## 本地命令

```bash
npm run daily:update -- --date 2026-07-23
npm run verify -- --today 2026-07-23 --max-age-days 0
npm run e2e -- --today 2026-07-23
```

## 内容策略

- 推荐生产方式：通过手动调度传入业务复核后的完整 `REPORT_JSON`。
- 自动兜底方式：未传 `REPORT_JSON` 时，脚本会从公开 Google News RSS 抓取 AI 支付/智能体支付相关线索生成日报草稿。
- 质量门禁：RSS 素材不足时脚本默认失败，避免用弱内容静默覆盖旧日报。
