# Electron-HTTP-Proxy 项目架构文档

## 项目概述

Electron-HTTP-Proxy 是一个基于 Electron 开发的 Mac 版 HTTP(S) 代理抓包工具，类似于简化版的 Fiddler。它能够监听本机的 HTTP(S) 请求，并提供请求/响应的查看、修改和替换功能。

**作者**: xiaodi0003  
**版本**: 0.1.0  
**技术栈**: Electron + React + UmiJS + AnyProxy + Ant Design Pro

---

## 核心能力

### 1. 请求监听与记录
- 实时监听本机所有 HTTP(S) 请求
- 最多保留 500 条请求记录
- 记录请求和响应的完整信息（URL、Headers、Body、状态码等）

### 2. 请求详情查看
- 查看每个请求的详细信息
- 支持查看请求方法、协议、Host、Path
- 支持查看响应状态码、Headers、Body

### 3. 动态代理与拦截
- 实时修改请求参数
- 实时修改响应结果
- 使用本地文件或远程资源替换响应内容
- 支持模拟请求延时

### 4. HTTPS 支持
- 支持 HTTPS 请求的代理和抓包
- 需要用户信任本程序提供的证书

---

## 技术架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 主进程                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  系统代理管理  │  │  AnyProxy服务 │  │  消息总线     │  │
│  │  (8000端口)   │  │  (8000端口)   │  │  (IPC通信)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                            ↕ IPC
┌─────────────────────────────────────────────────────────┐
│                    Electron 渲染进程                      │
│  ┌──────────────────────────────────────────────────┐  │
│  │           React + UmiJS 前端应用                   │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │  │
│  │  │ HTTP请求列表 │  │ 动态代理配置 │  │ 请求详情   │  │  │
│  │  │  (8001端口)  │  │            │  │           │  │  │
│  │  └────────────┘  └────────────┘  └────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────┐
│                    操作系统网络层                         │
│              所有 HTTP(S) 请求通过代理转发                │
└─────────────────────────────────────────────────────────┘
```

### 目录结构

```
z-proxy/
├── server/               # Electron 主进程 + 服务端代码（开发和生产环境共用）
│   ├── electron.js       # Electron 主进程入口（package.json 的 main 字段）
│   ├── index.js          # AnyProxy 服务启动
│   ├── rule.js           # AnyProxy 代理规则
│   ├── doProxy.js        # 代理处理逻辑
│   ├── messageBus.js     # 主进程与渲染进程 IPC 通信
│   ├── proxySettings.js  # 代理配置管理
│   ├── systemShell.js    # 系统代理设置（macOS networksetup 命令）
│   ├── store.js          # 数据持久化（electron-store）
│   └── utils.js          # 工具函数
│
├── src/                  # React 前端应用
│   ├── pages/
│   │   ├── HttpList/     # HTTP 请求列表页面
│   │   └── DynamicProxy/ # 动态代理配置页面
│   ├── models/           # Dva 数据模型
│   ├── layouts/          # 页面布局
│   ├── components/       # 公共组件
│   ├── locales/          # 国际化
│   └── utils/            # 工具函数
│
├── config/               # UmiJS 配置
│   ├── config.ts         # 主配置文件
│   ├── defaultSettings.ts # 默认设置
│   └── proxy.ts          # 开发代理配置
│
├── build/                # 前端构建产物（生产环境）
├── dist/                 # Electron 打包产物
└── public/               # 静态资源
```

**注意**: `electron/` 目录为历史遗留代码，已不再使用，实际运行的是 `server/` 目录下的代码。

---

## 核心模块详解

### 1. Electron 主进程 (server/electron.js)

**职责**:
- 创建应用窗口（1366x800）
- 启动 AnyProxy 代理服务（8000 端口）
- 设置系统 HTTP 代理
- 管理应用生命周期

**关键流程**:
```javascript
app.whenReady() 
  → 创建窗口 (createWindow)
  → 设置系统代理 (systemShell.setProxy)
  → 启动代理服务 (server.start)
  → 监听窗口事件
```

**窗口加载逻辑**:
- 开发环境: 加载 `http://localhost:8001/`（通过 PORT 环境变量判断）
- 生产环境: 加载 `build/index.html` 本地文件

**退出清理**:
- 应用退出时调用 `server.end()` 关闭代理服务
- 关闭所有窗口和服务

### 2. AnyProxy 代理服务 (server/index.js & server/rule.js)

**配置**:
- 代理端口: 8000
- Web 管理界面: 8002
- 强制 HTTPS 代理: 启用
- WebSocket 代理: 禁用

**代理规则** (server/rule.js):
- `beforeSendRequest`: 请求发送前拦截，记录请求信息，执行动态代理
- `beforeSendResponse`: 响应返回前拦截，记录响应信息，执行动态代理
- `beforeDealHttpsRequest`: HTTPS 请求处理
- `onError`: 请求错误处理
- `onConnectError`: HTTPS 连接错误处理

**工作原理**:
```
客户端请求 
  → AnyProxy 拦截 (beforeSendRequest)
  → 检查动态代理规则 (doProxy.proxyReq)
  → 发送到目标服务器
  → 接收响应 (beforeSendResponse)
  → 检查动态代理规则 (doProxy.proxyRes)
  → 返回给客户端
  → 通过 IPC 发送到渲染进程展示
```

### 3. 消息总线 (server/messageBus.js)

**功能**:
- 主进程与渲染进程之间的 IPC 通信
- 将请求/响应数据实时推送到前端页面
- 管理所有打开的窗口实例

**消息类型**:
- `req`: 请求信息（包含 id、url、method、headers、body）
- `res`: 响应信息（包含 id、statusCode、headers、body）

**通信机制**:
```javascript
// 主进程发送（广播到所有窗口）
serverMessage('req', { id, req: {...} })

// 渲染进程接收
ipcRenderer.on('req', (event, data) => {...})
```

**窗口管理**:
- `addWindow(window)`: 添加窗口到管理列表
- `removeWindow(window)`: 从管理列表移除窗口

### 4. 动态代理处理 (server/doProxy.js)

**功能**:
- 根据配置规则修改请求
- 根据配置规则修改响应
- 支持本地文件替换
- 支持远程资源替换
- 支持延时模拟

**代理配置存储**:
- 使用 electron-store 持久化配置
- 支持增删改查操作

### 5. 系统代理管理 (server/systemShell.js)

**功能**:
- 自动设置 macOS 系统 HTTP/HTTPS 代理
- 应用退出时自动清除代理设置

**实现方式**:
- 使用 `networksetup` 命令行工具（macOS 系统命令）
- 设置 HTTP 代理: `networksetup -setwebproxy "Wi-Fi" 127.0.0.1 8000`
- 设置 HTTPS 代理: `networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 8000`
- 删除代理: `networksetup -setwebproxystate "Wi-Fi" off`

**平台限制**:
- 目前仅支持 macOS 平台
- Windows 平台需要使用不同的系统命令

### 6. React 前端应用

#### 技术栈
- **框架**: React 16.8+
- **路由**: UmiJS (Hash 路由)
- **状态管理**: Dva (基于 Redux)
- **UI 组件**: Ant Design 4.x + Ant Design Pro
- **开发端口**: 8001

#### 主要页面

**HTTP 请求列表页面** (src/pages/HttpList):
- 展示所有抓取的 HTTP 请求
- 显示序号、状态码、方法、协议、Host、Path
- 点击查看请求详情
- 支持清空、暂停等操作（待实现）

**动态代理配置页面** (src/pages/DynamicProxy):
- 管理代理规则
- 支持添加、编辑、删除、复制规则
- 支持启用/禁用规则
- 配置匹配方式（From → To）

**请求详情弹窗** (HttpPackageDetail):
- 查看完整的请求和响应信息
- 支持 JSON 格式化展示
- 支持代码高亮

#### 数据流

```
AnyProxy 拦截请求/响应
  ↓
messageBus 通过 IPC 发送到渲染进程
  ↓
Dva Model (global.ts) 接收并存储
  ↓
React 组件订阅 Model 数据
  ↓
页面实时更新展示
```

---

## 工作原理

### 1. 代理监听原理

```
应用启动
  ↓
设置系统 HTTP 代理为 127.0.0.1:8000
  ↓
启动 AnyProxy 服务监听 8000 端口
  ↓
所有系统 HTTP(S) 请求自动转发到 AnyProxy
  ↓
AnyProxy 记录并转发请求
  ↓
将请求/响应信息推送到前端展示
```

### 2. HTTPS 代理原理

- AnyProxy 生成自签名 CA 证书
- 用户需要信任该证书
- AnyProxy 作为中间人解密 HTTPS 流量
- 记录明文请求/响应后重新加密转发

### 3. 动态代理原理

**请求拦截**:
```
beforeSendRequest 钩子
  ↓
检查是否有匹配的代理规则
  ↓
如果匹配，修改请求参数或直接返回本地文件
  ↓
否则正常转发请求
```

**响应拦截**:
```
beforeSendResponse 钩子
  ↓
检查是否有匹配的代理规则
  ↓
如果匹配，替换响应内容
  ↓
否则正常返回响应
```

---

## 数据存储

### electron-store
- 用于持久化动态代理配置
- 存储位置: `~/Library/Application Support/ElectronHttpProxy/`
- 数据格式: JSON

### 内存存储
- HTTP 请求/响应记录存储在内存中
- 最多保留 500 条记录（可配置）
- 应用重启后清空

---

## 端口使用

| 端口 | 用途 | 说明 |
|------|------|------|
| 8000 | AnyProxy 代理服务 | 系统代理指向此端口 |
| 8001 | React 开发服务器 | 仅开发环境使用 |
| 8002 | AnyProxy Web 管理界面 | 可选的 Web 管理界面 |
| 5858 | Electron 调试端口 | 用于调试主进程 |

---

## 开发与构建

### 开发模式

```bash
# 1. 安装依赖
yarn

# 2. 生成 AnyProxy CA 证书（首次运行需要）
yarn run anyproxy-ca
# 然后在系统中信任该证书，才能抓取 HTTPS 请求

# 3. 启动前端开发服务器 (8001端口)
yarn run start
# 或
yarn run start:dev

# 4. 启动 Electron 应用（新开一个终端）
yarn run start-electron
# 这会设置 PORT=8001 环境变量，让 Electron 加载开发服务器

# 5. 一键启动（推荐）
yarn run start-all
# 同时启动前端开发服务器和 Electron 应用
```

### 生产构建

```bash
# 1. 构建前端（输出到 build/ 目录）
yarn run build

# 2. 打包 Electron 应用（仅 Mac，输出到 dist/ 目录）
yarn run package

# 3. 一键构建并打包
yarn run build-package
```

### 打包配置

打包时只包含以下文件（见 package.json 的 build.files）:
- `build/**/*` - 前端构建产物
- `server/**/*` - Electron 主进程和服务端代码

不包含:
- `src/` - 前端源码
- `electron/` - 历史遗留代码
- `node_modules/` - 依赖会被自动处理

### 证书管理

```bash
# 生成 AnyProxy CA 证书
yarn run anyproxy-ca

# 证书位置（macOS）
~/.anyproxy/certificates/

# 信任证书步骤
# 1. 打开"钥匙串访问"应用
# 2. 导入证书文件
# 3. 双击证书，设置为"始终信任"
```

---

## 技术特点

### 优势
1. **跨平台能力**: 基于 Electron，理论上可支持 Windows/Linux（待实现）
2. **实时监听**: 无需手动刷新，自动捕获所有请求
3. **动态代理**: 支持实时修改请求和响应，无需重启
4. **本地化**: 所有数据存储在本地，保护隐私
5. **开发友好**: 使用现代前端技术栈，易于扩展
6. **自动化**: 启动时自动设置系统代理，退出时自动清理

### 待优化
1. **性能**: 抓包列表渲染性能需要优化（虚拟滚动）
2. **功能**: 缺少过滤、搜索、导出等功能
3. **跨平台**: 目前仅支持 Mac，系统代理设置需要适配 Windows
4. **稳定性**: 错误处理和日志记录需要完善
5. **代码清理**: `electron/` 目录为历史遗留代码，可以删除

---

## 未来规划

### 系统层面
- [ ] 自动识别可用端口
- [ ] 自动配置代理（减少手动操作）
- [ ] 完善日志系统

### 展示层面
- [ ] 支持表单提交的抓包
- [ ] 图片预览功能
- [ ] 自定义应用图标

### 性能优化
- [ ] 抓包列表虚拟滚动
- [ ] 大数据量优化

### 操作功能
- [ ] 请求过滤和搜索
- [ ] 暂停/恢复抓包
- [ ] 清空记录
- [ ] 配置最大记录数
- [ ] 重复发送请求
- [ ] 导出请求数据

### 动态代理
- [ ] 可视化配置延迟
- [ ] 更多匹配规则（正则、通配符等）
- [ ] 规则导入/导出

### 打包部署
- [ ] 支持 Windows 平台
- [ ] 一键启动（前端+客户端）
- [ ] 自动更新功能

---

## 常见问题

### 1. 为什么有 `electron/` 和 `server/` 两个目录？

`electron/` 目录是历史遗留代码，实际运行的是 `server/` 目录。从 `package.json` 可以看到：
- `"main": "server/electron.js"` - Electron 入口指向 server 目录
- `"build.files": ["build/**/*", "server/**/*"]` - 打包时只包含 server 目录

建议删除 `electron/` 目录以避免混淆。

### 2. 如何调试 Electron 主进程？

```bash
yarn run start-electron
# 主进程调试端口: 5858
# 在 Chrome 中打开: chrome://inspect
```

### 3. 为什么 HTTPS 请求抓不到？

需要信任 AnyProxy 的 CA 证书：
1. 运行 `yarn run anyproxy-ca` 生成证书
2. 在系统"钥匙串访问"中导入并信任证书
3. 重启应用

### 4. 如何修改代理端口？

修改 `server/electron.js` 和 `server/index.js` 中的 `serverPort` 变量（默认 8000）。

---

## 总结

Electron-HTTP-Proxy 是一个功能完整的 HTTP(S) 代理抓包工具，采用 Electron + React 技术栈，通过 AnyProxy 实现代理功能。项目架构清晰，模块划分合理，具有良好的扩展性。

**核心特点**:
- 使用 `server/` 目录作为 Electron 主进程和服务端代码
- 通过 IPC 消息总线实现主进程与渲染进程通信
- 使用 AnyProxy 的钩子函数实现请求/响应拦截
- 通过 macOS 系统命令自动设置代理

目前已实现核心的抓包和动态代理功能，后续可以在性能优化、功能完善和跨平台支持方面继续改进。
