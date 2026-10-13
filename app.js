const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const DB_NAME = 'life-recorder-db';
const STORE = 'records';
const PAGE_SIZE = 8;
let db, selectedFiles = { documents: [], images: [], videos: [], audios: [] };
let mediaRecorder, recordChunks = [], visibleCount = PAGE_SIZE;
let activeType = 'all';
let detailItems = [], detailIndex = -1;
let swipeState = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbAction(mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const saveRecord = (record) => dbAction('readwrite', store => store.put(record));
const getRecord = (id) => dbAction('readonly', store => store.get(id));
const getRecords = () => dbAction('readonly', store => store.getAll());

function showView(name) {
  $$('.view').forEach(view => view.classList.add('hidden'));
  $(`#${name}View`).classList.remove('hidden');
  $$('.nav-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === name));
  if (name === 'timeline') renderTimeline();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.style.background = error ? '#a84c3c' : '';
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function fileKey(file) { return `${file.name}-${file.size}-${file.lastModified}`; }
function addFiles(type, files) {
  const current = selectedFiles[type];
  [...files].forEach(file => {
    if (!current.some(item => fileKey(item) === fileKey(file))) current.push(file);
  });
  renderPreviews();
}

function renderPreviews() {
  const area = $('#previewArea');
  area.innerHTML = '';
  Object.entries(selectedFiles).forEach(([type, files]) => files.forEach(file => {
    const chip = document.createElement('div');
    chip.className = `preview-chip ${type === 'audios' ? 'audio-chip' : ''}`;
    if (type === 'images') {
      const img = document.createElement('img'); img.src = URL.createObjectURL(file); img.onload = () => URL.revokeObjectURL(img.src); chip.append(img);
    } else if (type === 'videos') {
      const video = document.createElement('video'); video.src = URL.createObjectURL(file); video.muted = true; video.onloadeddata = () => { video.currentTime = .1; }; chip.append(video);
    } else chip.innerHTML = `<span class="upload-icon">${type === 'documents' ? '▤' : '♫'}</span>`;
    const label = document.createElement('small'); label.textContent = file.name; chip.append(label); area.append(chip);
  }));
  area.classList.toggle('hidden', !Object.values(selectedFiles).some(files => files.length));
}

async function toggleRecording() {
  const button = $('#recordAudioBtn');
  if (mediaRecorder?.state === 'recording') { mediaRecorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia) return toast('当前浏览器不支持录音', true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => e.data.size && recordChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const type = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(recordChunks, { type });
      const voiceFile = new File([blob], `recording-${Date.now()}.webm`, { type });
      voiceFile.isVoiceRecording = true;
      selectedFiles.audios.push(voiceFile);
      stream.getTracks().forEach(track => track.stop());
      button.classList.remove('recording'); $('#recordHint').textContent = '点击开始，再次点击结束'; renderPreviews();
    };
    mediaRecorder.start(); button.classList.add('recording'); $('#recordHint').textContent = '正在录音，点击结束';
  } catch { toast('无法使用麦克风，请检查权限或使用 localhost', true); }
}

function resetForm() {
  $('#recordForm').reset();
  selectedFiles = { documents: [], images: [], videos: [], audios: [] };
  renderPreviews();
}

function mediaFromFiles(files) {
  return Promise.all(files.map(async file => ({ name: file.name, type: file.type, size: file.size, blob: file, source: file.isVoiceRecording ? 'voice' : 'upload' })));
}

async function submitRecord(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true; button.textContent = '正在发布…';
  try {
    const now = new Date();
    const record = {
      id: `${now.toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`,
      title: $('#titleInput').value.trim(), text: $('#textInput').value.trim(),
      tags: $('#tagsInput').value.split(/[,，]/).map(v => v.trim()).filter(Boolean),
      createdAt: now.toISOString(),
      media: {
        documents: await mediaFromFiles(selectedFiles.documents),
        images: await mediaFromFiles(selectedFiles.images),
        videos: await mediaFromFiles(selectedFiles.videos),
        audios: await mediaFromFiles(selectedFiles.audios)
      },
      githubStatus: 'local'
    };
    await saveRecord(record);
    if ($('#githubToggle').checked) {
      try {
        const result = await archiveRecordToLocalGit(record);
        record.githubStatus = result.pushed ? 'published' : 'local-git'; await saveRecord(record);
        toast(result.pushed ? '已归档到本地 Git 并推送 GitHub' : '已归档到本地 Git；尚未配置 GitHub remote', !result.pushed);
      } catch (error) { record.githubStatus = 'failed'; await saveRecord(record); toast(`浏览器已保存；Git 归档失败：${error.message}`, true); }
    } else toast('记录已保存到本地浏览器');
    resetForm(); showView('timeline');
  } catch (error) { toast(`发布失败：${error.message}`, true); }
  finally { button.disabled = false; button.textContent = '发布记录'; }
}

function recordHasType(record, type) {
  if (type === 'all') return true;
  if (type === 'text') return Boolean(record.text);
  if (type === 'document') return Boolean(record.media.documents?.length);
  if (type === 'voice') return Boolean(record.media.audios?.some(item => item.source === 'voice' || /^recording-\d+\.webm$/i.test(item.name || '')));
  if (type === 'audio') return Boolean(record.media.audios?.some(item => item.source !== 'voice' && !/^recording-\d+\.webm$/i.test(item.name || '')));
  return Boolean(record.media[`${type}s`]?.length);
}
function localDateKey(iso) {
  const d = new Date(iso), y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function displayDate(iso) {
  const d = new Date(iso); return { day: String(d.getDate()).padStart(2,'0'), month: `${d.getFullYear()} / ${String(d.getMonth()+1).padStart(2,'0')}`, time: d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) };
}
function escapeHTML(value='') { const div=document.createElement('div'); div.textContent=value; return div.innerHTML; }

async function getFilteredRecords() {
  let records = await getRecords();
  const date = $('#dateFilter').value, direction = $('#sortSelect').value;
  records = records.filter(r => recordHasType(r, activeType) && (!date || localDateKey(r.createdAt) === date));
  records.sort((a,b) => direction === 'asc' ? new Date(a.createdAt)-new Date(b.createdAt) : new Date(b.createdAt)-new Date(a.createdAt));
  return records;
}

async function renderTimeline() {
  const records = await getFilteredRecords();
  $('#recordCount').textContent = records.length;
  const timeline = $('#timeline'); timeline.innerHTML = '';
  if (!records.length) {
    timeline.append($('#emptyTemplate').content.cloneNode(true));
    timeline.querySelector('.empty-create').onclick = () => showView('publish');
    $('#loadMoreBtn').classList.add('hidden'); return;
  }
  const shown = records.slice(0, visibleCount), groups = Object.groupBy ? Object.groupBy(shown, r => localDateKey(r.createdAt)) : shown.reduce((a,r)=>((a[localDateKey(r.createdAt)] ||= []).push(r),a),{});
  Object.entries(groups).forEach(([key, items]) => {
    const dateInfo = displayDate(items[0].createdAt), group = document.createElement('section'); group.className = 'date-group';
    group.innerHTML = `<div class="date-label"><strong>${dateInfo.day}</strong><span>${dateInfo.month}</span></div><div class="record-list"></div>`;
    items.forEach(record => group.querySelector('.record-list').append(createCard(record)));
    timeline.append(group);
  });
  $('#loadMoreBtn').classList.toggle('hidden', records.length <= visibleCount);
}

function createCard(record) {
  const card = document.createElement('article'); card.className = 'record-card'; card.dataset.id = record.id;
  const info = displayDate(record.createdAt), body = document.createElement('div'); body.className = 'card-body';
  body.innerHTML = `<div class="card-meta"><time datetime="${record.createdAt}">${info.time}</time><span>${record.githubStatus==='published'?'GitHub ✓':'本地'}</span></div><h3>${escapeHTML(record.title)}</h3><div class="tags">${record.tags.map(t=>`<span class="tag">#${escapeHTML(t)}</span>`).join('')}</div>`;

  const gallery = document.createElement('div'); gallery.className = 'timeline-gallery';
  record.media.documents?.forEach((item, index) => {
    const frame = document.createElement('div'); frame.className = 'gallery-item document-item'; frame.dataset.kind = 'document'; frame.dataset.itemIndex = index;
    frame.innerHTML = `<span class="gallery-type">文档</span><div class="document-icon">▤</div><strong>${escapeHTML(item.name)}</strong>`; gallery.append(frame);
  });
  if (record.text) {
    const textItem = document.createElement('div'); textItem.className = 'gallery-item text-item'; textItem.dataset.kind = 'text'; textItem.dataset.itemIndex = '0';
    textItem.innerHTML = `<span class="gallery-type">文本</span><p>${escapeHTML(record.text)}</p>`; gallery.append(textItem);
  }
  record.media.images?.forEach((item, index) => {
    const frame = document.createElement('div'); frame.className = 'gallery-item'; frame.dataset.kind = 'image'; frame.dataset.itemIndex = index;
    const image = document.createElement('img'); image.alt = item.name || record.title; frame.append(image); gallery.append(frame); observeMedia(image, item.blob);
  });
  record.media.videos?.forEach((item, index) => {
    const frame = document.createElement('div'); frame.className = 'gallery-item video-item'; frame.dataset.kind = 'video'; frame.dataset.itemIndex = index;
    const video = document.createElement('video'); video.preload = 'metadata'; frame.append(video); gallery.append(frame); observeMedia(video, item.blob);
  });
  record.media.audios?.forEach((item, index) => {
    const voice = item.source === 'voice' || /^recording-\d+\.webm$/i.test(item.name || '');
    const frame = document.createElement('div'); frame.className = 'gallery-item audio-item'; frame.dataset.kind = voice ? 'voice' : 'audio'; frame.dataset.itemIndex = index;
    frame.innerHTML = `<div class="audio-label"><span>${voice ? '●' : '♫'}</span><strong>${voice ? '语音' : '音频'}</strong></div>`;
    const audio = document.createElement('audio'); audio.preload = 'metadata'; frame.append(audio); gallery.append(frame); observeMedia(audio, item.blob);
  });
  if (!gallery.children.length) gallery.innerHTML = '<div class="gallery-item text-item"><span class="gallery-type">记录</span><p>暂无内容</p></div>';

  card.append(body, gallery);
  gallery.onclick = event => {
    const item = event.target.closest('.gallery-item');
    if (item?.dataset.kind) openDetail(record.id, item.dataset.kind, Number(item.dataset.itemIndex));
  };
  return card;
}

const lazyObserver = new IntersectionObserver(entries => entries.forEach(entry => {
  if (!entry.isIntersecting) return;
  const el = entry.target, blob = el._blob; el.src = URL.createObjectURL(blob);
  const readyEvent = el.tagName === 'IMG' ? 'load' : 'loadedmetadata';
  el.addEventListener(readyEvent, () => URL.revokeObjectURL(el.src), { once:true });
  lazyObserver.unobserve(el);
}), { rootMargin: '250px' });
function observeMedia(element, blob) { element._blob = blob; lazyObserver.observe(element); }

function itemsFromRecord(record) {
  const items = [];
  record.media.documents?.forEach((value, itemIndex) => items.push({ record, kind: 'document', itemIndex, value }));
  if (record.text) items.push({ record, kind: 'text', itemIndex: 0, value: record.text });
  record.media.images?.forEach((value, itemIndex) => items.push({ record, kind: 'image', itemIndex, value }));
  record.media.videos?.forEach((value, itemIndex) => items.push({ record, kind: 'video', itemIndex, value }));
  record.media.audios?.forEach((value, itemIndex) => {
    const voice = value.source === 'voice' || /^recording-\d+\.webm$/i.test(value.name || '');
    items.push({ record, kind: voice ? 'voice' : 'audio', itemIndex, value });
  });
  return items;
}
async function openDetail(id, kind = 'text', itemIndex = 0) {
  const records = await getFilteredRecords();
  detailItems = records.flatMap(itemsFromRecord);
  detailIndex = detailItems.findIndex(item => item.record.id === id && item.kind === kind && item.itemIndex === itemIndex);
  if (detailIndex < 0) return;
  renderDetailItem();
  if (!$('#detailDialog').open) $('#detailDialog').showModal();
}
function renderDetailItem() {
  $$('#detailContent [data-object-url]').forEach(el => URL.revokeObjectURL(el.dataset.objectUrl));
  const current = detailItems[detailIndex], { record, kind, value } = current, info = displayDate(record.createdAt), content = $('#detailContent');
  const labels = { document: '文档', text: '文本', image: '图片', video: '视频', audio: '音频', voice: '语音' };
  content.innerHTML = `<article class="detail single-detail"><div class="detail-meta"><time>${localDateKey(record.createdAt)} · ${info.time}</time><span>${detailIndex + 1} / ${detailItems.length}</span></div><h2>${escapeHTML(record.title)}</h2><div class="detail-item"><span class="detail-kind">${labels[kind]}</span></div><div class="tags">${record.tags.map(t=>`<span class="tag">#${escapeHTML(t)}</span>`).join('')}</div></article>`;
  const host = content.querySelector('.detail-item');
  if (kind === 'text') host.insertAdjacentHTML('beforeend', `<p class="detail-text">${escapeHTML(value)}</p>`);
  else if (kind === 'document') {
    host.insertAdjacentHTML('beforeend', `<div class="detail-document"><div>▤</div><strong>${escapeHTML(value.name)}</strong><small>${Math.ceil(value.size / 1024)} KB</small></div>`);
  } else {
    const type = kind === 'image' ? 'img' : kind === 'video' ? 'video' : 'audio';
    const el = document.createElement(type); el.src = URL.createObjectURL(value.blob); el.dataset.objectUrl = el.src; el.alt = value.name || record.title;
    if (type !== 'img') el.controls = true; if (type === 'video') el.autoplay = true; host.append(el);
  }
  $('#prevDetail').disabled = detailIndex === 0;
  $('#nextDetail').disabled = detailIndex === detailItems.length - 1;
}
function moveDetail(step) {
  const next = detailIndex + step;
  if (next < 0 || next >= detailItems.length) return;
  detailIndex = next; renderDetailItem();
}
function closeDetail() {
  $$('#detailContent [data-object-url]').forEach(el => URL.revokeObjectURL(el.dataset.objectUrl)); $('#detailDialog').close(); detailItems = []; detailIndex = -1; swipeState = null;
}
function touchPoint(event) { return event.changedTouches?.[0] || event.touches?.[0]; }
function startDetailSwipe(event) {
  if (event.touches.length !== 1 || event.target.closest('video, audio, button, input, [role="slider"]')) { swipeState = null; return; }
  const point = touchPoint(event);
  swipeState = { x: point.clientX, y: point.clientY, time: Date.now(), direction: null };
}
function trackDetailSwipe(event) {
  if (!swipeState || event.touches.length !== 1) return;
  const point = touchPoint(event), dx = point.clientX - swipeState.x, dy = point.clientY - swipeState.y;
  if (!swipeState.direction && Math.max(Math.abs(dx), Math.abs(dy)) > 10) swipeState.direction = Math.abs(dx) > Math.abs(dy) * 1.25 ? 'horizontal' : 'vertical';
  if (swipeState.direction === 'horizontal') event.preventDefault();
}
function endDetailSwipe(event) {
  if (!swipeState) return;
  const point = touchPoint(event), dx = point.clientX - swipeState.x, dy = point.clientY - swipeState.y, elapsed = Date.now() - swipeState.time;
  const horizontal = swipeState.direction === 'horizontal' && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.25 && elapsed < 900;
  swipeState = null;
  if (horizontal) moveDetail(dx < 0 ? 1 : -1);
}

function loadSettings() {
  const config = JSON.parse(sessionStorage.getItem('githubConfig') || '{}');
  $('#ownerInput').value=config.owner||''; $('#repoInput').value=config.repo||''; $('#branchInput').value=config.branch||'main'; $('#tokenInput').value=config.token||'';
}
function saveSettings(event) {
  event.preventDefault();
  const config={owner:$('#ownerInput').value.trim(),repo:$('#repoInput').value.trim(),branch:$('#branchInput').value.trim()||'main',token:$('#tokenInput').value.trim()};
  sessionStorage.setItem('githubConfig',JSON.stringify(config)); toast('GitHub 设置已保存到当前会话');
}
function clearSettings(){sessionStorage.removeItem('githubConfig');$('#settingsForm').reset();$('#branchInput').value='main';toast('会话凭据已清除');}

async function archiveRecordToLocalGit(record) {
  const form = new FormData();
  form.append('record', JSON.stringify({ id: record.id, title: record.title, text: record.text, tags: record.tags, createdAt: record.createdAt }));
  for (const type of ['documents', 'images', 'videos', 'audios']) {
    for (const item of record.media[type] || []) form.append(type, item.blob, item.name);
  }
  const response = await fetch('/api/records', { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `本地服务返回 ${response.status}`);
  return result;
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer(), bytes = new Uint8Array(buffer), size = 0x8000; let binary='';
  for(let i=0;i<bytes.length;i+=size) binary += String.fromCharCode(...bytes.subarray(i,i+size));
  return btoa(binary);
}
async function githubPut(config, path, content, message) {
  const safePath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${safePath}`,{method:'PUT',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${config.token}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:JSON.stringify({message,branch:config.branch,content})});
  if(!response.ok){let detail='';try{detail=(await response.json()).message}catch{}throw new Error(`${response.status} ${detail}`)} return response.json();
}
async function uploadRecordToGithub(record) {
  const config=JSON.parse(sessionStorage.getItem('githubConfig')||'{}');
  if(!config.owner||!config.repo||!config.token) throw new Error('请先填写 GitHub 设置');
  const d=new Date(record.createdAt),base=`records/${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${record.id}`;
  const manifest={...record,media:{images:[],videos:[],audios:[]}};
  for(const type of ['images','videos','audios']) for(let i=0;i<record.media[type].length;i++){
    const item=record.media[type][i],folder=type,path=`${base}/${folder}/${String(i+1).padStart(2,'0')}-${item.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    await githubPut(config,path,await blobToBase64(item.blob),`record: add ${record.id} ${type} ${i+1}`);
    manifest.media[type].push({name:item.name,type:item.type,size:item.size,path});
  }
  const json=new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'});
  await githubPut(config,`${base}/record.json`,await blobToBase64(json),`record: add entry ${record.id}`);
}

async function init() {
  db = await openDB(); loadSettings();
  $('#dateFilter').value = localDateKey(new Date().toISOString());
  $$('.nav-tab').forEach(tab => tab.onclick=()=>showView(tab.dataset.view));
  $('#newRecordBtn').onclick=()=>showView('publish'); $('#closeComposer').onclick=()=>showView('timeline');
  $('#documentInput').onchange=e=>addFiles('documents',e.target.files); $('#imageInput').onchange=e=>addFiles('images',e.target.files); $('#videoInput').onchange=e=>addFiles('videos',e.target.files); $('#audioInput').onchange=e=>addFiles('audios',e.target.files);
  $('#recordAudioBtn').onclick=toggleRecording; $('#clearFormBtn').onclick=resetForm; $('#recordForm').onsubmit=submitRecord;
  $('#settingsForm').onsubmit=saveSettings; $('#clearSettingsBtn').onclick=clearSettings;
  $$('.filter').forEach(button=>button.onclick=()=>{activeType=button.dataset.type;visibleCount=PAGE_SIZE;$$('.filter').forEach(b=>b.classList.toggle('active',b===button));renderTimeline()});
  $('#dateFilter').onchange=()=>{visibleCount=PAGE_SIZE;renderTimeline()}; $('#sortSelect').onchange=renderTimeline;
  $('#resetFilter').onclick=()=>{$('#dateFilter').value=localDateKey(new Date().toISOString());$('#sortSelect').value='desc';activeType='all';$$('.filter').forEach((b,i)=>b.classList.toggle('active',i===0));renderTimeline()};
  $('#loadMoreBtn').onclick=()=>{visibleCount+=PAGE_SIZE;renderTimeline()}; $('#closeDialog').onclick=closeDetail;
  $('#prevDetail').onclick=()=>moveDetail(-1); $('#nextDetail').onclick=()=>moveDetail(1);
  $('#detailDialog').onclick=e=>{if(e.target===$('#detailDialog'))closeDetail()};
  const detailContent = $('#detailContent');
  detailContent.addEventListener('touchstart', startDetailSwipe, { passive:true });
  detailContent.addEventListener('touchmove', trackDetailSwipe, { passive:false });
  detailContent.addEventListener('touchend', endDetailSwipe, { passive:true });
  detailContent.addEventListener('touchcancel', ()=>{swipeState=null}, { passive:true });
  document.addEventListener('keydown', e=>{if(!$('#detailDialog').open)return;if(e.key==='ArrowLeft')moveDetail(-1);if(e.key==='ArrowRight')moveDetail(1)});
  await renderTimeline();
}
init().catch(error=>toast(`初始化失败：${error.message}`,true));
