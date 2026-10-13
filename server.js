const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY = 250 * 1024 * 1024;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.md':'text/markdown; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.mp4':'video/mp4', '.webm':'video/webm', '.mp3':'audio/mpeg', '.wav':'audio/wav' };

function safeName(value, fallback='file') {
  const name = path.basename(String(value || fallback)).replace(/[^a-zA-Z0-9._-]/g, '_');
  return name || fallback;
}
function git(args) {
  return new Promise((resolve, reject) => execFile('git', args, { cwd: ROOT, windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).trim())) : resolve(stdout.trim())));
}
function parseMultipart(buffer, boundary) {
  const marker = Buffer.from(`--${boundary}`), result = [];
  let start = buffer.indexOf(marker) + marker.length;
  while (start >= marker.length && start < buffer.length) {
    if (buffer.slice(start, start + 2).toString() === '--') break;
    start += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd < 0) break;
    const headers = buffer.slice(start, headerEnd).toString('utf8');
    const next = buffer.indexOf(marker, headerEnd + 4);
    if (next < 0) break;
    const data = buffer.slice(headerEnd + 4, next - 2);
    const name = headers.match(/name="([^"]+)"/)?.[1];
    const filename = headers.match(/filename="([^"]*)"/)?.[1];
    result.push({ name, filename, data }); start = next + marker.length;
  }
  return result;
}
async function archive(req, res) {
  const type = req.headers['content-type'] || '', boundary = type.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.slice(1).find(Boolean);
  if (!boundary) return json(res, 400, { error:'缺少 multipart boundary' });
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) return json(res, 413, { error:'单次归档内容超过 250MB' }); chunks.push(chunk); }
  const parts = parseMultipart(Buffer.concat(chunks), boundary), recordPart = parts.find(part => part.name === 'record');
  if (!recordPart) return json(res, 400, { error:'缺少记录信息' });
  let record; try { record = JSON.parse(recordPart.data.toString('utf8')); } catch { return json(res, 400, { error:'记录信息格式错误' }); }
  const created = new Date(record.createdAt); if (Number.isNaN(created.getTime())) return json(res, 400, { error:'记录时间无效' });
  const pad = value => String(value).padStart(2, '0');
  const datePath = [created.getFullYear(), pad(created.getMonth()+1), pad(created.getDate())];
  const timeId = `${pad(created.getHours())}-${pad(created.getMinutes())}-${pad(created.getSeconds())}-${safeName(record.id, 'record')}`;
  const relativeBase = path.posix.join('records', ...datePath.map(String), timeId), base = path.join(ROOT, ...relativeBase.split('/'));
  fs.mkdirSync(base, { recursive:true });
  const media = { documents:[], images:[], videos:[], audios:[] };
  for (const part of parts.filter(item => item.filename && media[item.name])) {
    const folder = part.name, index = media[folder].length + 1, filename = `${pad(index)}-${safeName(part.filename)}`;
    const relative = path.posix.join(relativeBase, folder, filename), target = path.join(ROOT, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive:true }); fs.writeFileSync(target, part.data); media[folder].push({ name:part.filename, size:part.data.length, path:relative });
  }
  const manifest = { ...record, media };
  fs.writeFileSync(path.join(base, 'record.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(base, 'content.md'), `# ${record.title || '未命名记录'}\n\n- 时间：${record.createdAt}\n- 标签：${(record.tags || []).join('、')}\n\n${record.text || ''}\n`);
  try {
    await git(['add', '--', relativeBase]);
    await git(['commit', '-m', `record: ${record.createdAt} ${record.title || record.id}`]);
  } catch (error) {
    if (!/nothing to commit/i.test(error.message)) return json(res, 500, { error:`Git 提交失败：${error.message}` });
  }
  let pushed = false, pushError = '';
  try { const remotes = await git(['remote']); if (remotes.split(/\s+/).filter(Boolean).length) { await git(['push']); pushed = true; } }
  catch (error) { pushError = error.message; }
  json(res, 201, { saved:true, pushed, path:relativeBase, pushError });
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function serve(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname), relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = path.resolve(ROOT, relative); if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(target).pipe(res);
}
const server = http.createServer((req, res) => { if (req.method === 'POST' && req.url === '/api/records') archive(req, res).catch(error => json(res, 500, { error:error.message })); else if (req.method === 'GET') serve(req, res); else { res.writeHead(405); res.end('Method not allowed'); } });
server.listen(PORT, '127.0.0.1', () => console.log(`lifeRecorder: http://127.0.0.1:${PORT}`));
