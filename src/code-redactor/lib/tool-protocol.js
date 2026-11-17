const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const MAX_FRAME = 8 * 1024 * 1024;

function command(value) {
  if (!Array.isArray(value) || !value.length || value.length > 40 ||
      value.some((part) => typeof part !== 'string' || part.length > 4096 || part.includes('\0')) || !value[0]) {
    throw new Error('Enter a command as a JSON array of strings.');
  }
  return value;
}

class ToolProtocol extends EventEmitter {
  constructor(argv, cwd, protocol) {
    super();
    const [program, ...args] = command(argv);
    this.protocol = protocol;
    this.pending = new Map();
    this.sequence = 0;
    this.buffer = Buffer.alloc(0);
    this.stderr = '';
    this.child = spawn(program, args, { cwd: cwd || undefined, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk) => {
      try { this.receive(chunk); } catch (error) { this.close(error); }
    });
    this.child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-4000); });
    this.child.stdin.on('error', (error) => this.close(error));
    this.child.on('error', (error) => this.close(error));
    this.child.on('close', (code) => this.close(new Error(this.stderr.trim() || `Tool exited (${code}).`)));
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const delimited = this.protocol === 'mcp';
      const divider = this.buffer.indexOf(delimited ? '\n' : '\r\n\r\n');
      if (divider < 0) {
        if (this.buffer.length > (delimited ? MAX_FRAME : 8192)) throw new Error('Invalid protocol header.');
        return;
      }
      const start = delimited ? 0 : divider + 4;
      const size = delimited ? divider : Number(this.buffer.subarray(0, divider).toString().match(/^Content-Length:\s*(\d+)\s*$/im)?.[1]);
      if (!Number.isSafeInteger(size) || size > MAX_FRAME) throw new Error('Invalid protocol frame.');
      if (this.buffer.length < start + size) return;
      const body = this.buffer.subarray(start, start + size).toString('utf8').trim();
      this.buffer = this.buffer.subarray(start + size + (delimited ? 1 : 0));
      if (body) this.dispatch(JSON.parse(body));
    }
  }

  dispatch(message) {
    if (message.type === 'request' || (message.method && message.id != null)) {
      this.emit('request', message);
      return;
    }
    const key = this.protocol === 'dap' ? message.request_seq : message.id;
    const pending = this.pending.get(key);
    if (pending) {
      const error = message.error?.message || (message.success === false && (message.message || 'Adapter rejected the request.'));
      pending(error ? new Error(error) : null, this.protocol === 'dap' ? message.body : message.result);
    } else if (message.event || message.method) {
      this.emit('notification', message.event || message.method, message.body ?? message.params);
    }
  }

  send(message) {
    if (this.closed) throw this.closed;
    const body = JSON.stringify(this.protocol === 'dap' ? { seq: ++this.sequence, ...message } : { jsonrpc: '2.0', ...message });
    this.child.stdin.write(this.protocol === 'mcp' ? body + '\n' : `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  request(method, params, timeout = 20000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const settle = (error, result) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => settle(new Error(this.stderr.trim() || `${method} timed out.`)), timeout);
      this.pending.set(id, settle);
      try {
        if (this.protocol === 'dap') this.send({ seq: id, type: 'request', command: method, arguments: params });
        else this.send({ id, method, params });
      } catch (error) { settle(error); }
    });
  }

  close(error = new Error('Connection closed.')) {
    if (this.closed) return;
    this.closed = error;
    this.child.stdin.destroy();
    this.child.kill();
    for (const settle of this.pending.values()) settle(error);
    this.emit('closed', error);
  }
}

module.exports = { ToolProtocol, command };
