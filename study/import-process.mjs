import { spawn } from 'node:child_process';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {...options, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('This step took too long. You can retry it.')); }, 30 * 60 * 1000);
    child.stdout.on('data', data => { output = (output + data).slice(-8192); options.onProgress?.(String(data)); });
    child.stderr.on('data', () => {});
    child.once('error', () => { clearTimeout(timer); reject(Error(`Could not start ${command.split('/').at(-1)}. Check the import prerequisites in README.`)); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(Error(`${command.split('/').at(-1)} failed. Check the import prerequisites, then retry.`)); });
  });
}
