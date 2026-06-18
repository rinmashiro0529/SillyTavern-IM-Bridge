# SillyTavern-IM-Bridge

SillyTavern server plugin: bridge ST chats to instant messaging channels (currently Telegram).

## 安装

1. 在 SillyTavern 的 `config.yaml` 设置 `enableServerPlugins: true`。
2. 进入 SillyTavern 的 `plugins/` 目录：
   ```sh
   cd plugins
   git clone https://github.com/rinmashiro0529/SillyTavern-IM-Bridge.git st-im-bridge
   ```
   仓库已包含构建好的 `dist/index.js`，无需 `npm install`。
3. 重启 SillyTavern。
4. 在 SillyTavern 中安装配套 UI 扩展：[SillyTavern-IM-Bridge-UI](https://github.com/rinmashiro0529/SillyTavern-IM-Bridge-UI)。

## 路径与端口

- 路由前缀：`/api/plugins/st-im-bridge/*`
- 默认 ST 内部回调地址：`http://127.0.0.1:8000`。如 ST 端口不是 8000，启动 ST 前导出环境变量：
  ```sh
  export SILLYTAVERN_INTERNAL_BASE_URL=http://127.0.0.1:<port>
  ```

## 多账号

每个 SillyTavern 用户（`req.user.profile.handle`）对应独立的 bridge 账号、独立的 bot token、独立的会话状态与压缩配置。管理员可以查看/启停他人账号的 bot。

## 鉴权

复用 SillyTavern 自身的登录态：所有路由位于 ST `requireLoginMiddleware` 之后，写操作需要带 `x-csrf-token` 头（由 `GET /csrf-token` 获取）。

## 端到端验证

1. 启用 plugin，重启 ST，确认日志出现 `[st-im-bridge] init complete`。
2. `curl --cookie <ST 会话 cookie> http://localhost:8000/api/plugins/st-im-bridge/probe` 返回 204。
   > 提示：cookie 含登录态，避免直接粘贴到 shell 命令行（会进 history）。建议把 cookie 写入受限权限的文件用 `--cookie @cookies.txt` 读入，或先 `read -s COOKIE` 再 `curl --cookie "$COOKIE" ...`。
3. 安装 UI 扩展，打开抽屉，填入 Telegram bot token，点击「保存 Token」「启动」。
4. Telegram 私聊 bot：`/help`、`/chars`、`/now`、`/compress`、`/cmodel` 等命令应当与原 bridge 行为一致。

## 数据

SQLite 数据文件位于 `<plugin 根目录>/data/app.db`。表结构与原独立服务兼容，新增 `accounts.st_user_handle/role` 列与 `account_configs` 表。

## 许可

MIT
