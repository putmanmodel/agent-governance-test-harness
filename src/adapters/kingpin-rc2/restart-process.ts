import { fork } from 'node:child_process';
export function startRestartChild(entry: URL, root: string, mode: 'create' | 'reopen', args: string[] = []) {
  const child = fork(entry, [root, mode, ...args], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let diagnostic = '', failure: Error | undefined;
  const queued = new Map<string, any>(), pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const fail = (error: Error) => { failure = error; for (const p of pending.values()) p.reject(error); pending.clear(); };
  child.stderr!.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-8192); });
  const exited = new Promise<{ pid: number; code: number | null; signal: string | null }>(resolve => {
    child.once('error', error => { fail(error); resolve({ pid: child.pid ?? -1, code: null, signal: 'spawn-error' }); });
    child.once('exit', (code, signal) => { fail(new Error(`Restart child exited: ${code ?? signal}; ${diagnostic}`)); resolve({ pid: child.pid!, code, signal }); });
  });
  child.on('message', (m: any) => {
    const p = pending.get(m.type);
    if (p) { pending.delete(m.type); m.error ? p.reject(new Error(m.error)) : p.resolve(m); }
    else queued.set(m.type, m);
  });
  const wait = (type: string): Promise<any> => {
    if (failure) return Promise.reject(failure);
    if (queued.has(type)) { const value = queued.get(type); queued.delete(type); return Promise.resolve(value); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(type); reject(new Error(`Restart child timeout: ${type}`)); }, 30000);
      pending.set(type, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
  };
  const rpc = (type: string, fields = {}) => { const response = wait(type); child.send({ type, ...fields }); return response; };
  return { ready: () => wait('ready'), rpc, wait, send: (type: string) => child.send({ type }),
    kill: () => child.kill('SIGKILL'), exited, async close() {
    if (child.connected) child.send({ type: 'close' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try { return await exited; } finally { clearTimeout(timer); }
  } };
}
