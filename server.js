const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const session = require('express-session');
const fs = require('fs');

const app = express();

// 配置存储
let config = {
  apiKey: 'sk-fake-gpt-key-123456789',
  models: {
    'gpt-3.5-turbo': {
      name: 'gpt-3.5-turbo',
      replyContent: 'Hello! This is a fake GPT-3.5 response.',
      responseDelay: 1000,
      replyMode: 'preset'
    },
    'gpt-4': {
      name: 'gpt-4',
      replyContent: 'Hello! This is a fake GPT-4 response.',
      responseDelay: 1500,
      replyMode: 'preset'
    },
    'claude-3-sonnet': {
      name: 'claude-3-sonnet',
      replyContent: 'Hello! This is a fake Claude-3 Sonnet response.',
      responseDelay: 1200,
      replyMode: 'preset'
    }
  },
  defaultModel: 'gpt-3.5-turbo'
};

// 获取模型配置的辅助函数
function getModelConfig(modelName) {
  if (config.models[modelName]) {
    return config.models[modelName];
  }
  // 如果找不到指定模型，返回默认模型
  return config.models[config.defaultModel] || Object.values(config.models)[0];
}

// 管理员密码（生产环境中应使用环境变量）
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// 请求记录存储
let requestLogs = [];

// 日志持久化路径
const LOGS_DIR = path.join(__dirname, 'logs');
const LOGS_FILE = path.join(LOGS_DIR, 'request_logs.json');

function ensureLogsStorage() {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch (err) {
    console.error('创建日志目录失败:', err);
  }
}

function loadLogsFromFile() {
  try {
    ensureLogsStorage();
    if (fs.existsSync(LOGS_FILE)) {
      const data = fs.readFileSync(LOGS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        requestLogs = parsed;
      }
    }
  } catch (err) {
    console.error('读取日志文件失败:', err);
    requestLogs = [];
  }
}

function saveLogsToFile() {
  try {
    ensureLogsStorage();
    fs.writeFile(LOGS_FILE, JSON.stringify(requestLogs, null, 2), 'utf8', (err) => {
      if (err) {
        console.error('写入日志文件失败:', err);
      }
    });
  } catch (err) {
    console.error('保存日志失败:', err);
  }
}

// 启动时加载持久化日志
loadLogsFromFile();

// 身份验证中间件
function requireAuth(req, res, next) {
  // 先检查会话超时
  checkSessionTimeout(req, res, () => {
    if (req.session && req.session.authenticated) {
      return next();
    } else {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Please login to access this resource'
      });
    }
  });
}

// 检查是否已登录的中间件（用于重定向）
function checkAuth(req, res, next) {
  // 先检查会话超时
  checkSessionTimeout(req, res, () => {
    if (req.session && req.session.authenticated) {
      req.isAuthenticated = true;
    } else {
      req.isAuthenticated = false;
    }
    next();
  });
}

// 中间件
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? true : 'http://localhost:3000',
  credentials: true
}));
app.use(bodyParser.json());

// 会话管理
app.use(session({
  secret: process.env.SESSION_SECRET || 'fake-gpt-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // 生产环境使用HTTPS时设置为true
    httpOnly: true,
    maxAge: 2 * 60 * 60 * 1000, // 2小时会话超时
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

// 会话超时检查中间件
function checkSessionTimeout(req, res, next) {
  if (req.session && req.session.authenticated) {
    const now = new Date();
    const loginTime = new Date(req.session.loginTime);
    const sessionDuration = now - loginTime;
    const maxSessionDuration = 2 * 60 * 60 * 1000; // 2小时
    
    if (sessionDuration > maxSessionDuration) {
      req.session.destroy();
      return res.status(401).json({
        success: false,
        message: '会话已过期，请重新登录'
      });
    }
  }
  next();
}
// 静态文件服务配置
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '1h', // 生产环境缓存1天，开发环境1小时
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        // 对HTML文件设置较短的缓存时间
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
        // 设置连接保活
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Keep-Alive', 'timeout=30, max=100');
        // 设置安全头
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
    }
}));



// OpenAI API Key验证中间件
function validateApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  
  const token = authHeader.substring(7);
  if (token !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  next();
}

// Anthropic API Key验证中间件
function validateAnthropicApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ 
      error: {
        type: 'authentication_error',
        message: 'Missing required header: x-api-key'
      }
    });
  }
  
  if (apiKey !== config.apiKey) {
    return res.status(401).json({ 
      error: {
        type: 'authentication_error',
        message: 'Invalid API key'
      }
    });
  }
  
  next();
}

// 记录请求的中间件
function logRequest(req, res, next) {
  const logEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body,
    ip: req.ip || req.connection.remoteAddress
  };
  
  requestLogs.unshift(logEntry);
  
  // 只保留最近100条记录
  if (requestLogs.length > 100) {
    requestLogs = requestLogs.slice(0, 100);
  }
  // 保存到文件
  saveLogsToFile();
  
  next();
}

// 登录页面路由
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 主页路由（需要身份验证）
app.get('/', checkAuth, (req, res) => {
  if (!req.isAuthenticated) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 登录API
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({
      success: false,
      message: '请输入密码'
    });
  }
  
  if (password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.loginTime = new Date().toISOString();
    
    res.json({
      success: true,
      message: '登录成功'
    });
  } else {
    res.status(401).json({
      success: false,
      message: '密码错误'
    });
  }
});

// 登出API
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: '登出失败'
      });
    }
    
    res.json({
      success: true,
      message: '已成功登出'
    });
  });
});

// 检查登录状态API
app.get('/api/auth/status', (req, res) => {
  res.json({
    authenticated: !!(req.session && req.session.authenticated),
    loginTime: req.session ? req.session.loginTime : null
  });
});

// Anthropic兼容的消息接口
app.post('/v1/messages', validateAnthropicApiKey, logRequest, (req, res) => {
  const { messages, stream = false, model = 'claude-3-sonnet-20240229', max_tokens = 1000 } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: {
        type: 'invalid_request_error',
        message: 'Invalid request: messages field is required and must be an array'
      }
    });
  }
  
  // 获取对应模型的配置
  const modelConfig = getModelConfig(model);
  
  const responseId = `msg_${uuidv4()}`;
  
  // 根据回复模式决定响应内容
  let responseContent;
  if (modelConfig.replyMode === 'echo') {
    // 返回完整的请求JSON
    responseContent = JSON.stringify(req.body, null, 2);
  } else {
    // 返回预设内容
    responseContent = modelConfig.replyContent;
  }
  
  // 应用响应延迟
  const processResponse = () => {
    if (stream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // 发送开始事件
      res.write(`event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: responseId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: modelConfig.name,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 }
        }
      })}\n\n`);
      
      // 发送内容块开始
      res.write(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      })}\n\n`);
      
      const words = responseContent.split('');
      let wordIndex = 0;
      
      const sendChunk = () => {
        if (wordIndex < words.length) {
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: words[wordIndex] }
          })}\n\n`);
          
          wordIndex++;
          setTimeout(sendChunk, 50);
        } else {
          // 发送内容块结束
          res.write(`event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: 0
          })}\n\n`);
          
          // 发送消息结束
          res.write(`event: message_stop\ndata: ${JSON.stringify({
            type: 'message_stop'
          })}\n\n`);
          
          res.end();
        }
      };
      
      sendChunk();
    } else {
      // 非流式响应
      const response = {
        id: responseId,
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'text',
          text: responseContent
        }],
        model: modelConfig.name,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: responseContent.length
        }
      };
      
      res.json(response);
    }
  };
  
  // 如果设置了响应延迟，则延迟执行
  if (modelConfig.responseDelay > 0) {
    setTimeout(processResponse, modelConfig.responseDelay);
  } else {
    processResponse();
  }
});

// OpenAI兼容的聊天完成接口
app.post('/v1/chat/completions', validateApiKey, logRequest, (req, res) => {
  const { messages, stream = false, model = 'gpt-3.5-turbo' } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: messages field is required and must be an array',
        type: 'invalid_request_error'
      }
    });
  }
  
  // 获取对应模型的配置
  const modelConfig = getModelConfig(model);
  
  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);
  
  // 根据回复模式决定响应内容
  let responseContent;
  if (modelConfig.replyMode === 'echo') {
    // 返回完整的请求JSON
    responseContent = JSON.stringify(req.body, null, 2);
  } else {
    // 返回预设内容
    responseContent = modelConfig.replyContent;
  }
  
  // 应用响应延迟
  const processResponse = () => {
    if (stream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const words = responseContent.split('');
      let wordIndex = 0;
      
      const sendChunk = () => {
        if (wordIndex < words.length) {
          const chunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created: created,
            model: modelConfig.name,
            choices: [{
              index: 0,
              delta: {
                content: words[wordIndex]
              },
              finish_reason: null
            }]
          };
          
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          wordIndex++;
          setTimeout(sendChunk, 50); // 50ms延迟模拟打字效果
        } else {
          // 发送结束chunk
          const endChunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created: created,
            model: modelConfig.name,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: 'stop'
            }]
          };
          
          res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      };
      
      sendChunk();
    } else {
      // 非流式响应
      const response = {
        id: responseId,
        object: 'chat.completion',
        created: created,
        model: modelConfig.name,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: responseContent
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: responseContent.length,
          total_tokens: 10 + responseContent.length
        }
      };
      
      res.json(response);
    }
  };
  
  // 如果设置了响应延迟，则延迟执行
  if (modelConfig.responseDelay > 0) {
    setTimeout(processResponse, modelConfig.responseDelay);
  } else {
    processResponse();
  }
});

// 配置管理接口（需要身份验证）
app.get('/api/config', requireAuth, (req, res) => {
  res.json({
    apiKey: config.apiKey,
    models: config.models,
    defaultModel: config.defaultModel
  });
});

app.post('/api/config', requireAuth, (req, res) => {
  const { apiKey, models, defaultModel } = req.body;
  
  if (apiKey !== undefined) {
    config.apiKey = apiKey;
  }
  
  if (models !== undefined) {
    // 验证模型配置格式
    const validModels = {};
    for (const [modelName, modelConfig] of Object.entries(models)) {
      if (modelConfig.name && modelConfig.replyContent !== undefined && modelConfig.responseDelay !== undefined) {
        validModels[modelName] = {
          name: modelConfig.name,
          replyContent: modelConfig.replyContent,
          responseDelay: Math.max(0, parseInt(modelConfig.responseDelay) || 0),
          replyMode: modelConfig.replyMode || 'preset'
        };
      }
    }
    config.models = validModels;
  }
  
  if (defaultModel !== undefined && config.models[defaultModel]) {
    config.defaultModel = defaultModel;
  }
  
  res.json({ success: true, config });
});

// 请求日志接口（需要身份验证）
app.get('/api/logs', requireAuth, (req, res) => {
  res.json(requestLogs);
});

// 清空请求日志接口（需要身份验证）
app.delete('/api/logs', requireAuth, (req, res) => {
  requestLogs = [];
  saveLogsToFile();
  res.json({ success: true });
});

// 下载请求日志接口（需要身份验证）
app.get('/api/logs/download', requireAuth, (req, res) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `fake-gpt-logs-${timestamp}.json`;
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json({
    exportTime: new Date().toISOString(),
    totalLogs: requestLogs.length,
    logs: requestLogs
  });
});

// 健康检查端点（公开访问，用于连接检测）
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    port: PORT,
    env: process.env.NODE_ENV || 'development'
  });
});

// 根路径健康检查（用于Zeabur等平台的健康检查）
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// SPA fallback - 对于非API路由返回index.html（必须放在所有路由定义之后）
app.get('*', (req, res, next) => {
    // 跳过API路由和健康检查
    if (req.path.startsWith('/api/') || req.path.startsWith('/v1/') || req.path === '/health') {
        return next();
    }
    // 对于其他路由，返回index.html（用于SPA路由）
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});


// 启动服务器
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// WebSocket服务器
const wss = new WebSocket.Server({ server });

// WebSocket连接管理
const clients = new Set();

wss.on('connection', (ws) => {
    console.log('新的WebSocket连接建立');
    clients.add(ws);
    
    // 发送欢迎消息
    ws.send(JSON.stringify({ type: 'connected', message: '连接已建立' }));
    
    // 心跳检测
    const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        } else {
            clearInterval(heartbeat);
        }
    }, 30000); // 每30秒发送一次心跳
    
    // 处理pong响应
    ws.on('pong', () => {
        console.log('收到客户端pong响应');
    });
    
    // 处理消息
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
        } catch (error) {
            console.error('WebSocket消息解析错误:', error);
        }
    });
    
    // 连接关闭处理
    ws.on('close', () => {
        console.log('WebSocket连接关闭');
        clients.delete(ws);
        clearInterval(heartbeat);
    });
    
    // 错误处理
    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
        clients.delete(ws);
        clearInterval(heartbeat);
    });
});

// 广播消息给所有连接的客户端
function broadcast(message) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

server.listen(PORT, '0.0.0.0', () => {
    const host = process.env.NODE_ENV === 'production' ? (process.env.ZEABUR_URL || `0.0.0.0:${PORT}`) : `localhost:${PORT}`;
    console.log(`Fake GPT server is running on port ${PORT}`);
    console.log(`Admin panel: http://${host}`);
    console.log(`OpenAI API endpoint: http://${host}/v1/chat/completions`);
    console.log(`Anthropic API endpoint: http://${host}/v1/messages`);
    console.log(`WebSocket server is running on ws://${host}`);
});

// 服务器连接保活设置
server.keepAliveTimeout = 65000; // 65秒
server.headersTimeout = 66000; // 66秒，比keepAliveTimeout稍长

// 优雅关闭处理
process.on('SIGTERM', () => {
    console.log('收到SIGTERM信号，正在优雅关闭服务器...');
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('收到SIGINT信号，正在优雅关闭服务器...');
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});

module.exports = app;