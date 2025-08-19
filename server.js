const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置存储
let config = {
  apiKey: 'sk-fake-gpt-key-123456789',
  replyContent: 'Hello! I am a fake GPT model. This is a simulated response.'
};

// 请求记录存储
let requestLogs = [];

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

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
  
  next();
}

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
  
  const responseId = `msg_${uuidv4()}`;
  
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
        model: model,
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
    
    const words = config.replyContent.split('');
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
        text: config.replyContent
      }],
      model: model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: config.replyContent.length
      }
    };
    
    res.json(response);
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
  
  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);
  
  if (stream) {
    // 流式响应
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const words = config.replyContent.split('');
    let wordIndex = 0;
    
    const sendChunk = () => {
      if (wordIndex < words.length) {
        const chunk = {
          id: responseId,
          object: 'chat.completion.chunk',
          created: created,
          model: model,
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
          model: model,
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
      model: model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: config.replyContent
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: config.replyContent.length,
        total_tokens: 10 + config.replyContent.length
      }
    };
    
    res.json(response);
  }
});

// 配置管理接口
app.get('/api/config', (req, res) => {
  res.json({
    apiKey: config.apiKey,
    replyContent: config.replyContent
  });
});

app.post('/api/config', (req, res) => {
  const { apiKey, replyContent } = req.body;
  
  if (apiKey !== undefined) {
    config.apiKey = apiKey;
  }
  
  if (replyContent !== undefined) {
    config.replyContent = replyContent;
  }
  
  res.json({ success: true, config });
});

// 请求日志接口
app.get('/api/logs', (req, res) => {
  res.json(requestLogs);
});

app.delete('/api/logs', (req, res) => {
  requestLogs = [];
  res.json({ success: true });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Fake GPT server is running on port ${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}`);
  console.log(`OpenAI API endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`Anthropic API endpoint: http://localhost:${PORT}/v1/messages`);
});

module.exports = app;