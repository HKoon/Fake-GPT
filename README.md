# Fake GPT API 模拟器

一个可以在 Zeabur 部署的假 GPT 模拟模型，提供 OpenAI 兼容的 `/v1/chat/completions` 接口。

## 功能特性

- 🤖 **OpenAI 兼容接口**: 完全兼容 OpenAI 的 `/v1/chat/completions` API
- 🌊 **流式和非流式输出**: 支持 `stream=true/false` 参数
- 🎛️ **管理面板**: 简洁美观的 Web 管理界面
- 📝 **请求日志**: 记录和显示所有 API 请求
- 🔑 **API Key 管理**: 可自定义 API Key
- 💬 **自定义回复**: 可设置固定的回复内容
- ☁️ **Zeabur 部署**: 一键部署到 Zeabur 平台

## 快速开始

### 本地运行

1. 克隆项目
```bash
git clone <your-repo-url>
cd fake-gpt
```

2. 安装依赖
```bash
npm install
```

3. 启动服务
```bash
npm start
```

4. 访问管理面板
```
http://localhost:3000
```

### Zeabur 部署

1. 将代码推送到 GitHub 仓库
2. 在 [Zeabur](https://zeabur.com) 创建新项目
3. 连接 GitHub 仓库
4. Zeabur 会自动检测并部署 Node.js 应用
5. 部署完成后访问分配的域名

## API 使用

### 端点
```
POST /v1/chat/completions
```

### 请求示例

**非流式请求:**
```bash
curl -X POST "https://your-domain.zeabur.app/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-fake-gpt-key-123456789" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": false
  }'
```

**流式请求:**
```bash
curl -X POST "https://your-domain.zeabur.app/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-fake-gpt-key-123456789" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": true
  }'
```

### 响应格式

**非流式响应:**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-3.5-turbo",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! I am a fake GPT model."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

**流式响应:**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1677652288,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"content":"H"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1677652288,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"content":"e"},"finish_reason":null}]}

...

data: [DONE]
```

## 管理面板功能

### 配置设置
- **API Key**: 设置用于验证的 API Key
- **回复内容**: 设置固定的回复内容

### 请求日志
- 查看所有 API 请求的详细信息
- 包含请求时间、方法、URL、Headers 和 Body
- 支持清空日志功能

### 日志持久化
- 日志会持久化到本地文件：`logs/request_logs.json`
- 默认仅保留最近 100 条请求记录（与内存中的行为一致）
- 手动清空日志后会同步清空持久化文件
- 注意：在某些云平台（如无持久化存储的容器环境）重启后文件可能不保留，请按需接入持久化存储（如挂载卷或外部数据库）

### API 信息
- 显示当前 API 端点
- 提供测试用的 curl 命令

## 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `PORT` | 服务器端口 | `3000` |

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript
- **部署**: Zeabur

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 注意事项

⚠️ **重要**: 这是一个模拟工具，仅用于测试和开发目的。请勿在生产环境中使用真实的敏感数据。

- 所有请求都会被记录
- API Key 验证是基础的字符串匹配
- 回复内容是固定的，不会进行真实的 AI 处理
- 适用于 API 集成测试、前端开发调试等场景