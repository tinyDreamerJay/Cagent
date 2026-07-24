# 工程规范 & 运维

## 开发流程

### 启动开发服务器

```bash
# 安装所有依赖
npm run install:all

# 分别启动（推荐，避免端口冲突）
# 终端 1 — 后端（端口 4120）
npm run dev:server

# 终端 2 — 前端（端口 5173）
npm run dev:client

# 浏览器访问 http://localhost:5173
```

### 不要用 npm run dev 同时启动

`npm run dev` 用 concurrently 同时启动 server + client + electron，会导致：
- server (tsx watch) 和 electron（内嵌 server）抢 4120 端口
- electron 起不来

## 构建打包

### 构建前端

```bash
cd client && npm run build
```

输出在 `client/dist/`。

### 打包 Electron 应用

```bash
npm run build      # 构建前端
npm run package    # electron-builder 打包
```

输出在 `release/win-unpacked/`（Cagent.exe + 依赖文件）。

### 打包配置

`package.json` 中的 `build` 字段：

```json
{
  "appId": "com.cagent.app",
  "productName": "Cagent",
  "files": [
    "electron/*.cjs",
    "client/dist/**/*",
    "node_modules/**/*"
  ],
  "win": {
    "target": "dir",
    "signAndEditExecutable": false
  }
}
```

- `target: "dir"` 仅生成解包目录，不生成 NSIS 安装包。
- `signAndEditExecutable: false` 让目录版不依赖下载 `winCodeSign`；当前发布流程不做 Windows 代码签名或 EXE 资源编辑。
- 因此应用图标以 `electron/icon.svg` 和网页图标为准，Windows EXE 的资源图标不作为发布验证条件。

## 已知问题

### winCodeSign 符号链接错误

```
ERROR: Cannot create symbolic link : 客户端没有所需的特权
```

electron-builder 打包时下载的 winCodeSign 压缩包包含 macOS 符号链接，
Windows 上解压会失败。**不影响 asar 打包**，只是无法生成安装包。

当前对策：使用 `target: "dir"` 和 `signAndEditExecutable: false`，跳过安装包步骤以及对 EXE 的签名/资源编辑。

### Vite base 路径

打包后 Electron 用 `file://` 协议加载页面，**Vite 必须设置 `base: './'`**，
否则 JS/CSS 无法加载（绝对路径在 file:// 下无效）。

### 端口冲突

Cagent.exe 启动时如果 4120 端口被占用，内嵌 server 直接崩溃，
Electron 窗口白屏。

桌面快捷方式的启动脚本（launch-cagent.ps1）在启动前自动清理端口。

### 多实例

如果多次双击快捷方式，会启动多个 Cagent.exe 实例。
每个实例都尝试监听 4120 端口，只有第一个成功。
启动脚本已加入单实例处理（启动前杀掉旧进程）。

## 提交前检查

- 不提交 `.env*`、`node_modules/`、`dist/`、`release/`（`.gitignore` 已配置）
- 修改 `electron/server.cjs` 后，确认 `server/src/` 中的对应逻辑也同步
- 修改前端后运行 `cd client && npm run build` 确保能正常构建
- 构建后的 `vite.config.ts` 中 `base: './'` 不能被误删

## 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥（系统级，应用内也可设置） |
| `OPENAI_API_KEY` | OpenAI API 密钥（备用） |
| `CAGENT_TEST_API_KEY` | 仅供需要真实 provider 的本地测试使用；不得写入脚本、文档或 Git |
| `PORT` | 服务端口（默认 4120） |
