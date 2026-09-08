const https = require('https');
const http = require('http');

const MAX_RESPONSE_BODY_SIZE = 50 * 1024 * 1024;

function rpcCall(ls, endpoint, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: '127.0.0.1',
      port: ls.port,
      path: `/exa.language_server_pb.LanguageServerService/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': ls.csrfToken,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: timeoutMs,
      rejectUnauthorized: false,
    };

    const transport = ls.useTls ? https : http;
    const req = transport.request(options, (res) => {
      const chunks = [];
      let bodySize = 0;
      res.on('data', (chunk) => {
        bodySize += chunk.length;
        if (bodySize > MAX_RESPONSE_BODY_SIZE) {
          req.destroy();
          reject(new Error(`RPC response exceeded ${MAX_RESPONSE_BODY_SIZE} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`RPC HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Failed to parse RPC response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`RPC timeout: ${endpoint}`));
    });
    req.write(postData);
    req.end();
  });
}

function metaBody(extra = {}) {
  return {
    metadata: {
      ideName: 'antigravity',
      extensionName: 'antigravity',
      ideVersion: '2.11.0',
      locale: 'en',
    },
    ...extra,
  };
}

module.exports = { rpcCall, metaBody };
