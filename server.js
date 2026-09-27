// server.js
const express = require('express');
const { google } = require('googleapis');
const cookieSession = require('cookie-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 请在环境变量或此处配置你的 Google OAuth 凭据
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: ['secret-key-gmail-cleaner'],
  maxAge: 24 * 60 * 60 * 1000 // 24 小时
}));

app.use(express.static(path.join(__dirname, 'public')));

// 1. 发起 Google 授权登录
app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.modify'
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
  res.redirect(url);
});

// 2. OAuth 回调地址
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    req.session.tokens = tokens;
    res.redirect('/');
  } catch (error) {
    console.error('OAuth 失败:', error);
    res.status(500).send('授权失败');
  }
});

// 检查登录状态
app.get('/api/user', (req, res) => {
  if (req.session && req.session.tokens) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// 退出登录
app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// 3. 筛选并清理邮件 API
app.post('/api/clean-emails', async (req, res) => {
  if (!req.session || !req.session.tokens) {
    return res.status(401).json({ error: '未授权，请先登录' });
  }

  try {
    oauth2Client.setCredentials(req.session.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Gmail 查询语法：is:read -is:starred -is:sent
    // 含义：已读、未加星标（无Flag）、排除已发送邮件
    const q = 'is:read -is:starred -is:sent';

    let totalDeleted = 0;
    let pageToken = null;

    do {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: q,
        maxResults: 500,
        pageToken: pageToken
      });

      const messages = response.data.messages || [];
      if (messages.length === 0) break;

      const messageIds = messages.map(m => m.id);

      // 批量移动到垃圾桶（Trash）或永久删除
      // 使用 batchDelete 彻底删除，或 batchModify 移动至垃圾桶
      await gmail.users.messages.batchDelete({
        userId: 'me',
        requestBody: {
          ids: messageIds
        }
      });

      totalDeleted += messageIds.length;
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    res.json({ success: true, count: totalDeleted });
  } catch (error) {
    console.error('清理邮件失败:', error);
    res.status(500).json({ error: '清理邮件过程中出错: ' + error.message });
  }
});

// 页面路由
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`);
});
