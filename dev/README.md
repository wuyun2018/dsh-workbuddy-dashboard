# dev/

开发期工具与探针。这里的东西不参与插件运行，也不会被打进 `npm pack`（`package.json` 的 `files` 只列 `lib`/`assets`/`docs`/`cordis.patch.yml`/`README.md`/`LICENSE`）。

## probes/

`probes/*.js` 是 CDP 注入脚本：由 `scripts/screenshot.mjs --eval-file` 在页面里执行，用来断言面板的几何与交互（锚定位、展开/收起、设置视图、贴边吸附、主题跟随等）。它们只操作本机 `scripts/harness.mjs` 起的假宿主页面或你自己的 DSH 页面，不含凭据，也不读网关数据。

单独跑一条：

```bash
# 1) 起假宿主（demo 数据 + mock 网关，prefs 不落盘）
node scripts/harness.mjs --demo --port 4010 --prefs :memory:

# 2) 注入探针并截图（本机需装 Edge）
node scripts/screenshot.mjs "http://127.0.0.1:4010/" out.png --size 1440x900 --eval-file dev/probes/probe-anchor-state.js
```

探针通过 `console.log` / 返回值把断言结果交给 `screenshot.mjs` 打印；`probe-anchor-state.js`、`probe-anchor-switch.js`、`probe-anchor-settings.js` 是锚定位与设置视图的主力探针，`probe-real-anchor.js` 用于真机（先取 `?token=` 再跑）。

## 为什么放在 `dev/probes/`

这些脚本早期和正式入口一起放在 `scripts/`，克隆者会以为仓库一半是测试。放到 `dev/probes/` 只改目录、不动历史：`scripts/` 现在只有 5 个正式入口——`harness.mjs`（假宿主）、`capture-fixtures.mjs`（抓真实网关并合成化）、`fixtures-sanitize.mjs`（生成/校验 `tests/fixtures`）、`screenshot.mjs`（CDP 截图）、`docs-shots.mjs`（重拍 `docs/*.png`）。
