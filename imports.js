const sourceName = document.querySelector('#sourceName');
const sourceFormat = document.querySelector('#sourceFormat');
const sourceContent = document.querySelector('#sourceContent');
const importError = document.querySelector('#importError');
const importPreview = document.querySelector('#importPreview');
const normalizedRows = document.querySelector('#normalizedRows');
const previewCount = document.querySelector('#previewCount');
const previewSkipped = document.querySelector('#previewSkipped');
const batchRows = document.querySelector('#batchRows');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || '请求失败，请稍后重试');
  return data;
}

async function loadBatches() {
  try {
    const data = await request('/api/admin/imports/batches');
    const batches = data.batches || [];
    batchRows.innerHTML = batches.length ? batches.map((batch) => `
      <article class="import-batch"><strong>${escapeHtml(batch.source_name)}</strong><span>${escapeHtml(batch.source_format)} · 写入 ${batch.imported_count} 条${batch.skipped_count ? `，跳过 ${batch.skipped_count} 条` : ''}</span><small>${escapeHtml(batch.imported_by)} · ${escapeHtml(batch.created_at)} UTC</small></article>
    `).join('') : '<p class="review-empty">还没有同步记录。</p>';
  } catch (error) {
    batchRows.innerHTML = `<p class="form-error">${escapeHtml(error.message === '请先登录' ? '请先在产品首页登录资料管理员账号。' : error.message)}</p>`;
  }
}

document.querySelector('#previewImport').addEventListener('click', async () => {
  importError.textContent = '';
  try {
    const data = await request('/api/admin/imports/preview', {
      method: 'POST',
      body: JSON.stringify({ source_name: sourceName.value.trim(), source_format: sourceFormat.value, content: sourceContent.value }),
    });
    normalizedRows.value = JSON.stringify(data.rows, null, 2);
    previewCount.textContent = `${data.rows.length} 条待导入`;
    previewSkipped.textContent = data.skipped_count ? `已跳过 ${data.skipped_count} 条空白或不完整资料` : '';
    importPreview.classList.remove('is-hidden');
  } catch (error) {
    importError.textContent = error.message;
  }
});

document.querySelector('#commitImport').addEventListener('click', async (event) => {
  importError.textContent = '';
  if (!document.querySelector('#importConsent').checked) {
    importError.textContent = '请先确认资料的授权状态';
    return;
  }
  let rows;
  try {
    rows = JSON.parse(normalizedRows.value);
  } catch (_) {
    importError.textContent = '确认资料不是有效 JSON，请检查后再提交';
    return;
  }
  event.currentTarget.disabled = true;
  try {
    const data = await request('/api/admin/imports/commit', {
      method: 'POST',
      body: JSON.stringify({ source_name: sourceName.value.trim(), source_format: sourceFormat.value, consent_confirmed: true, rows }),
    });
    importError.textContent = `已写入 ${data.imported_count} 条资料${data.skipped_count ? `，跳过 ${data.skipped_count} 条` : ''}`;
    importPreview.classList.add('is-hidden');
    sourceContent.value = '';
    await loadBatches();
  } catch (error) {
    importError.textContent = error.message;
  } finally {
    event.currentTarget.disabled = false;
  }
});

document.querySelector('#refreshBatches').addEventListener('click', loadBatches);
loadBatches();

async function loadExperiences() {
  const region = document.querySelector('#experienceReviewRows');
  try {
    const status = document.querySelector('#experienceStatus').value;
    const data = await request('/api/admin/job-experiences?status=' + encodeURIComponent(status));
    region.innerHTML = data.experiences.length ? data.experiences.map(row =>
      '<article class="experience-entry"><div class="experience-meta"><strong>' + escapeHtml(row.company + ' · ' + row.role_title) + '</strong><span>' + row.year + ' 年 · ' + escapeHtml(row.category) + '</span></div>' +
      '<p class="experience-body">' + escapeHtml(row.body) + '</p>' +
      '<p class="experience-muted">' + row.reports.map(r => escapeHtml(r.reason) + ' × ' + r.n).join('；') + '</p>' +
      '<button class="text-button" data-review-id="' + row.id + '" data-status="published">通过并公开</button> ' +
      '<button class="text-button" data-review-id="' + row.id + '" data-status="rejected">不公开 / 下架</button></article>'
    ).join('') : '<p class="experience-muted">没有此状态的经历。</p>';
    region.querySelectorAll('[data-review-id]').forEach(button => button.onclick = async () => {
      if (!window.confirm(button.dataset.status === 'published' ? '确认内容适合公开？这不代表已核验任职。' : '确认不公开或下架这条内容？')) return;
      button.disabled = true;
      try {
        await request('/api/admin/job-experiences/' + button.dataset.reviewId, {method:'PATCH', body:JSON.stringify({status:button.dataset.status})});
        await loadExperiences();
      } catch (error) { button.disabled = false; region.insertAdjacentHTML('afterbegin', '<p role="alert">' + escapeHtml(error.message) + '</p>'); }
    });
  } catch (error) {
    region.innerHTML = '<p class="form-error">' + escapeHtml(error.message === '请先登录' ? '请先在产品首页登录资料管理员账号。' : error.message) + '</p>';
  }
}
document.querySelector('#experienceStatus').onchange = loadExperiences;
document.querySelector('#refreshExperiences').onclick = loadExperiences;
loadExperiences();
