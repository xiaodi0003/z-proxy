const fs = require('fs');
const mime = require('mime');
const path = require('path');
const http = require('http');
const https = require('https');
const {getProtocol, getPort, getDomain, getPath} = require('./utils.js');
const pSettings = require('./proxySettings.js');
const { handleHarReplay } = require('./harReplay.js');

// Attach HAR data to setting when needed
function attachHarData(setting) {
  if (setting && setting.to && setting.to.startsWith('har://')) {
    const harData = pSettings.getHarData(setting.id);
    if (harData) {
      // Return a new object with harData attached, don't modify original
      return { ...setting, harData };
    }
  }
  return setting;
}

// Create proxy agent for backend proxy
function createProxyAgent(backendProxy, targetProtocol) {
  const { type, host, port, username, password } = backendProxy;
  
  if (type === 'http') {
    // For HTTP proxy, use different agent based on target protocol
    let proxyUrl = `http://${host}:${port}`;
    if (username && password) {
      proxyUrl = `http://${username}:${password}@${host}:${port}`;
    }
    
    console.log(`Using HTTP proxy for ${targetProtocol} request: ${proxyUrl}`);
    
    if (targetProtocol === 'https:') {
      // For HTTPS targets, use https-proxy-agent
      const HttpsProxyAgent = require('https-proxy-agent');
      return new HttpsProxyAgent(proxyUrl);
    } else {
      // For HTTP targets, create a simple HTTP agent with proxy
      const url = require('url');
      const proxyOpts = url.parse(proxyUrl);
      
      // Create custom HTTP agent that connects through proxy
      class HttpProxyAgent extends http.Agent {
        createConnection(options, callback) {
          const proxyReq = http.request({
            host: proxyOpts.hostname,
            port: proxyOpts.port,
            method: 'CONNECT',
            path: `${options.host || options.hostname}:${options.port}`,
            headers: proxyOpts.auth ? {
              'Proxy-Authorization': 'Basic ' + Buffer.from(proxyOpts.auth).toString('base64')
            } : {}
          });
          
          proxyReq.on('connect', (res, socket) => {
            callback(null, socket);
          });
          
          proxyReq.on('error', callback);
          proxyReq.end();
        }
      }
      
      return new HttpProxyAgent();
    }
  } else if (type === 'socks5') {
    // Create a proper Agent class for SOCKS5
    const SocksClient = require('socks').SocksClient;
    const tls = require('tls');
    const Agent = targetProtocol === 'https:' ? https.Agent : http.Agent;
    const isHttps = targetProtocol === 'https:';
    
    console.log(`Using SOCKS5 proxy for ${targetProtocol} request: ${host}:${port}`);
    
    // Create custom agent that extends http.Agent or https.Agent
    class SocksAgent extends Agent {
      createConnection(options, callback) {
        const socksOptions = {
          proxy: {
            host: host,
            port: parseInt(port, 10),
            type: 5,
            userId: username,
            password: password
          },
          command: 'connect',
          destination: {
            host: options.host || options.hostname,
            port: options.port
          }
        };
        
        SocksClient.createConnection(socksOptions, (err, info) => {
          if (err) {
            callback(err);
          } else {
            // For HTTPS, wrap the socket with TLS
            if (isHttps) {
              const tlsSocket = tls.connect({
                socket: info.socket,
                servername: options.servername || options.host || options.hostname,
                rejectUnauthorized: options.rejectUnauthorized !== false
              });
              
              tlsSocket.on('error', callback);
              tlsSocket.on('secureConnect', () => {
                callback(null, tlsSocket);
              });
            } else {
              // For HTTP, use the socket directly
              callback(null, info.socket);
            }
          }
        });
      }
    }
    
    return new SocksAgent();
  }
  
  return null;
}

async function sleep(setting) {
  if (setting && setting.delay && !isNaN(setting.delay)) {
    return new Promise(r => {
      setTimeout(() => r(true), setting.delay);
    });
  }
  return true;
}

function discernLocalhost(req) {
  const options = req.requestOptions;
  if (options.hostname === 'll') {
    options.hostname = 'localhost';
  }
}

// Cache enabled settings to avoid repeated filtering
let enabledSettingsCache = null;

function getEnabledSettings() {
  if (enabledSettingsCache) {
    return enabledSettingsCache;
  }
  
  enabledSettingsCache = pSettings.getProxySettings().filter(s => s.enabled);
  return enabledSettingsCache;
}

// Clear cache when settings change
pSettings.onSettingsChange(() => {
  enabledSettingsCache = null;
});

exports.proxyReq = async function(requestDetail) {
  discernLocalhost(requestDetail);
  let setting = getEnabledSettings().find(s => findSetting(s, requestDetail));
  if (setting) {
    // Attach HAR data only when needed (for har:// protocol)
    // attachHarData returns a new object if harData is attached
    setting = attachHarData(setting);
    requestDetail._req.proxySetting = setting;
    await sleep(setting);
    
    // Handle backend proxy by setting agent in requestOptions (for both reqHook and normal proxy)
    if (setting.backendProxy) {
      // Ensure protocol has colon suffix
      const protocol = requestDetail.protocol.endsWith(':') 
        ? requestDetail.protocol 
        : requestDetail.protocol + ':';
      const agent = createProxyAgent(setting.backendProxy, protocol);
      if (agent) {
        requestDetail.requestOptions.agent = agent;
      }
    }
    
    if (setting.reqHook) {
      // 优先使用reqHook的url，所以直接返回
      return doReqHook(setting, requestDetail);
    }
    const target = getTarget(setting, requestDetail);
    
    return exeProxy(target, requestDetail);
  }
  return requestDetail;
}

exports.proxyRes = function(requestDetail, responseDetail) {
  const setting = requestDetail._req && requestDetail._req.proxySetting;
  if (setting) {
    if (setting.resHook) {
      return doResHook(setting, requestDetail, responseDetail);
    }
  }
  return responseDetail;
}

function findSetting(setting, req) {
  const {type, from} = setting;
    
  switch(type) {
    case 'exact':
      if (req.url === from) {
        return true;
      }
      break;
    case 'prefix':
      if (req.url.startsWith(from)) {
        return true;
      }
      break;
    case 'regex':
      if (new RegExp(from).test(req.url)) {
        return true;
      }
      break;
    default:
      break;
  }
  return false;
}

function getTarget(setting, req) {
  const {type, from, to} = setting;

  switch(type) {
    case 'exact':
    case 'prefix':
      return req.url.replace(from, to);
    case 'regex':
      return req.url.replace(new RegExp(from), to);
    default:
      break;
  }
  return req.url;
}

async function doReqHook(setting, req) {
  try {
    reqHook = null;
    eval(setting.reqHookCode);
    if ('function' === typeof reqHook) {
      const {url, headers, body} = await reqHook({
        url: req.url,
        headers: req.requestOptions.headers,
        body: req.requestData.toString()
      });
      exeProxy(url, req);
      req.requestOptions.headers = headers;
      // Handle different body types properly
      let newRequestData;
      if (Buffer.isBuffer(body)) {
        newRequestData = body;
      // } else if (typeof body === 'object') {
      //   newRequestData = Buffer.from(JSON.stringify(body));
      } else if (typeof body === 'string') {
        newRequestData = Buffer.from(body);
      } else {
        newRequestData = Buffer.from(String(body));
      }
      req.requestData = newRequestData;
    }
  } catch (e) {
    console.error(e);
  }
  return req;
}

async function doResHook(setting, req, res) {
  try {
    resHook = null;
    eval(setting.resHookCode);
    if ('function' === typeof resHook) {
      const {code, headers, body} = await resHook({
        url: req.url,
        headers: req.requestOptions.headers,
        body: req.requestData.toString()
      }, {
        code: res.response.statusCode,
        headers: res.response.header,
        body: res.response.body.toString()
      });
      res.response.statusCode = code;
      res.response.header = headers;
      res.response.body = body;
    }
  } catch (e) {
    console.error(e);
  }
  return res;
}

// Handle direct connection to target server without any proxy
function handleDirectConnection(target, requestDetail) {
  const newRequestOptions = requestDetail.requestOptions;
  requestDetail.protocol = getProtocol(target);
  // requestDetail.url = traget;
  // newRequestOptions.url = target;
  newRequestOptions.hostname = getDomain(target);
  newRequestOptions.port = getPort(target);
  newRequestOptions.path = getPath(target);
  newRequestOptions.headers.Host = newRequestOptions.hostname;
  newRequestOptions.headers.Origin = requestDetail.protocol + '://' + newRequestOptions.hostname;
  return requestDetail;
}

async function exeProxy(target, requestDetail) {
  // Handle har:// protocol
  if (target.startsWith('har://')) {
    const setting = requestDetail._req.proxySetting;
    return handleHarReplay(setting, requestDetail);
  }
  
  // Handle file:// protocol
  if (target.startsWith('file://')) {
    return new Promise(resolve => {
      let fileName = target;
      
      // Remove query string first
      fileName = fileName.replace(/\?.*/, '');
      
      // Parse file:// URL correctly for both Windows and Unix
      if (fileName.startsWith('file:///')) {
        // Windows: file:///C:/path or Unix: file:///path
        fileName = fileName.substring(7); // Remove 'file://'
      } else if (fileName.startsWith('file://')) {
        // Fallback for file:// format
        fileName = fileName.substring(7); // Remove 'file://'
      }
      
      // On Windows, ensure proper path format
      if (process.platform === 'win32' && fileName.startsWith('/')) {
        // Remove leading slash for Windows absolute paths like /C:/path
        if (fileName.match(/^\/[a-zA-Z]:/)) {
          fileName = fileName.substring(1);
        }
      }
      
      if (fileName.endsWith('/')) {
        fileName += 'index.html';
      }
      
      fs.readFile(fileName, function(err, data) {
        if (err) {
          resolve({
            response: {
              statusCode: 404,
              header: { 'Content-Type': 'text/plain' },
              body: err.message
            }
          });
        } else {
          resolve({
            response: {
              statusCode: 200,
              header: { 'Content-Type': mime.getType(path.basename(fileName)) },
              body: data
            }
          });
        }
      });
    });
  }
  
  // Update the target URL (agent is already set in proxyReq if backend proxy is configured)
  return handleDirectConnection(target, requestDetail);
}
