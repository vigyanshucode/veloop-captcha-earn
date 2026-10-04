require('dotenv').config();
const net = require('net');

const port = 5000;
const http = require('http');

const checkServer = (tries = 0) => {
  if (tries > 15) {
    console.log('SERVER_CHECK_TIMEOUT');
    return;
  }
  const s = new net.Socket();
  s.setTimeout(600);
  s.on('connect', () => {
    s.destroy();
    console.log('PORT_OPEN_' + port);
    http.get('http://localhost:' + port + '/api/health', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { console.log('HEALTH_' + res.statusCode); process.stdout.write(d.slice(0, 200) + '\n'); });
    }).on('error', e => console.log('HEALTH_ERR_' + e.message));
  });
  s.on('error', () => { s.destroy(); setTimeout(() => checkServer(tries + 1), 800); });
  s.on('timeout', () => { s.destroy(); setTimeout(() => checkServer(tries + 1), 800); });
  s.connect(port, '127.0.0.1');
};
checkServer(0);
