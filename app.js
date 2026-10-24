const loginView = document.querySelector('#loginView');
const profileView = document.querySelector('#profileView');
const archiveView = document.querySelector('#archiveView');
const resultsView = document.querySelector('#resultsView');
const loginForm = document.querySelector('#loginForm');
const profileForm = document.querySelector('#profileForm');
const archiveForm = document.querySelector('#archiveForm');
const emailInput = document.querySelector('#email');
const otpInput = document.querySelector('#otpCode');
const inviteInput = document.querySelector('#inviteCode');
const claimInviteButton = document.querySelector('#claimInvite');
const formError = document.querySelector('#formError');
const profileError = document.querySelector('#profileError');
const archiveError = document.querySelector('#archiveError');
const avatarButton = document.querySelector('#avatarButton');
const infoSheet = document.querySelector('#infoSheet');
const sheetBackdrop = document.querySelector('#sheetBackdrop');
const sheetContent = document.querySelector('#sheetContent');
const toast = document.querySelector('#toast');
const matchesPanel = document.querySelector('#matchesPanel');
const explorePanel = document.querySelector('#explorePanel');
const matchesTab = document.querySelector('#matchesTab');
const exploreTab = document.querySelector('#exploreTab');
const memberSearch = document.querySelector('#memberSearch');
const matchDeck = document.querySelector('#matchDeck');
const memberRowsEl = document.querySelector('#memberRows');
const referralCodeEl = document.querySelector('#referralCode');
const matchCarouselIndicator = document.querySelector('#matchCarouselIndicator');
const filterCity = document.querySelector('#filterCity');
const filterGrade = document.querySelector('#filterGrade');
const filterMajor = document.querySelector('#filterMajor');

const TAG_OPTIONS = ['AI', '产品', '开发', '增长', '求职交流', 'ToB', 'Agent', 'VLM', '推荐', '安全'];

let toastTimer;
let sheetTrigger;
let activeFilter = '全部';
let me = null;
let matches = [];
let members = [];
let awaitingCode = false;
let selectedTags = [];
let selectedLearnTags = [];
let filterOptions = { cities: [], grades: [], majors: [] };
let pool = { count: 0, waiting: true, next_match_label: '周一 21:00', match_hour: 21, schedule_label: '每周一、周三 21:00' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2300);
}

function openSheet(content) {
  sheetTrigger = document.activeElement;
  sheetContent.innerHTML = content;
  infoSheet.classList.remove('is-hidden');
  sheetBackdrop.classList.remove('is-hidden');
  document.body.style.overflow = 'hidden';
  document.querySelector('#closeSheet').focus();
}

function closeSheet() {
  infoSheet.classList.add('is-hidden');
  sheetBackdrop.classList.add('is-hidden');
  document.body.style.overflow = '';
  if (sheetTrigger instanceof HTMLElement) sheetTrigger.focus();
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Pingo-Client': '1',
    ...(options.headers || {}),
  };
  const response = await fetch(path, { credentials: 'include', ...options, headers });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (response.status === 401) {
    localStorage.removeItem('pingo-token');
    throw new Error(data.detail || '请先登录');
  }
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => item.msg || item).join('；')
      : data.detail;
    throw new Error(detail || data.message || '请求失败，请稍后重试');
  }
  return data;
}

function clearLocalAuth() {
  localStorage.removeItem('pingo-token');
}

function setAuth(nextToken) {
  if (!nextToken) clearLocalAuth();
}

function hideAllViews() {
  window.PingoJobs?.hide();
  loginView.classList.add('is-hidden');
  profileView.classList.add('is-hidden');
  archiveView.classList.add('is-hidden');
  resultsView.classList.add('is-hidden');
}

function showLogin() {
  hideAllViews();
  loginView.classList.remove('is-hidden');
  avatarButton.classList.add('is-hidden');
}

function showProfile() {
  hideAllViews();
  profileView.classList.remove('is-hidden');
  avatarButton.classList.remove('is-hidden');
  avatarButton.textContent = (me?.user?.name || me?.user?.email || 'U').charAt(0).toUpperCase();
  fillProfileForm();
}

function showArchive() {
  hideAllViews();
  archiveView.classList.remove('is-hidden');
  avatarButton.classList.remove('is-hidden');
  avatarButton.textContent = (me?.user?.name || me?.user?.email || 'U').charAt(0).toUpperCase();
  fillArchiveForm();
}

function showResults() {
  hideAllViews();
  resultsView.classList.remove('is-hidden');
  avatarButton.classList.remove('is-hidden');
  avatarButton.textContent = (me?.user?.name || me?.user?.email || 'U').charAt(0).toUpperCase();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setResultsView(view) {
  const showMatches = view === 'matches';
  matchesPanel.classList.toggle('is-hidden', !showMatches);
  explorePanel.classList.toggle('is-hidden', showMatches);
  matchesTab.classList.toggle('is-selected', showMatches);
  exploreTab.classList.toggle('is-selected', !showMatches);
  matchesTab.setAttribute('aria-selected', String(showMatches));
  exploreTab.setAttribute('aria-selected', String(!showMatches));
  if (!showMatches) loadMembers().catch(error => showToast(error.message));
}

function renderTags(containerId, selected, attr) {
  const el = document.querySelector(containerId);
  if (!el) return;
  el.innerHTML = TAG_OPTIONS.map((tag) => (
    `<button class="filter-chip${selected.includes(tag) ? ' is-active' : ''}" type="button" data-${attr}="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  )).join('');
}

function fillProfileForm() {
  const user = me?.user || {};
  if (profileForm.profileIntro) profileForm.profileIntro.value = user.intro || user.experience || user.looking_for || '';
}

function fillArchiveForm() {
  const user = me?.user || {};
  archiveForm.archiveName.value = user.name || '';
  archiveForm.archiveRole.value = user.role || '';
  archiveForm.archiveCity.value = user.city || '';
  archiveForm.archiveGrade.value = user.grade || '';
  archiveForm.archiveMajor.value = user.major || '';
  archiveForm.archiveSchool.value = user.school || '';
  archiveForm.archiveExperience.value = user.experience || user.skills || '';
  archiveForm.archiveLooking.value = user.looking_for || user.wants || '';
  archiveForm.archiveSameCity.checked = user.prefer_same_city !== false;
  selectedTags = [...(user.tags || [])];
  selectedLearnTags = [...(user.learn_tags || [])];
  renderTags('#archiveSkillTags', selectedTags, 'tag');
  renderTags('#archiveLearnTags', selectedLearnTags, 'learn');
}

function contactCta(person, contacted) {
  return contacted ? '已发出认识邮件' : '发一封认识邮件';
}

function hintHtml(person) {
  const hints = [];
  if (person.same_city) hints.push('同城');
  if (person.similar_background) hints.push('背景相近');
  return hints.length ? `<div class="hint-row">${hints.map((item) => `<span class="hint-chip">${item}</span>`).join('')}</div>` : '';
}

function renderMatchCarousel() {
  if (!matchCarouselIndicator) return;
  const cards = [...matchDeck.querySelectorAll('.match-card')].slice(0, 3);
  if (cards.length < 2) {
    matchCarouselIndicator.innerHTML = '';
    matchCarouselIndicator.classList.add('is-hidden');
    matchDeck.onscroll = null;
    return;
  }
  matchCarouselIndicator.classList.remove('is-hidden');
  matchCarouselIndicator.innerHTML = cards.map((_, index) => (
    `<button type="button" class="carousel-dot${index === 0 ? ' is-active' : ''}" aria-label="查看第 ${index + 1} 位匹配" aria-current="${index === 0 ? 'true' : 'false'}"></button>`
  )).join('');
  const dots = [...matchCarouselIndicator.querySelectorAll('.carousel-dot')];
  const sync = () => {
    const activeIndex = cards.reduce((closest, card, index) => (
      Math.abs(card.offsetLeft - matchDeck.scrollLeft) < Math.abs(cards[closest].offsetLeft - matchDeck.scrollLeft) ? index : closest
    ), 0);
    dots.forEach((dot, index) => {
      const active = index === activeIndex;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-current', String(active));
    });
  };
  matchDeck.onscroll = () => requestAnimationFrame(sync);
  dots.forEach((dot, index) => dot.addEventListener('click', () => {
    cards[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }));
  sync();
}

function formatCountdown(iso) {
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return '';
  const left = Math.max(0, end - Date.now());
  const total = Math.floor(left / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${mins} 分钟`;
  return `${Math.max(1, mins)} 分钟`;
}

function renderCountdown() {
  const el = document.querySelector('#poolCountdown');
  if (!el) return;
  const when = formatCountdown(pool.next_match_at);
  const schedule = pool.schedule_label || '每周一、周三 21:00';
  el.textContent = when ? `下次匹配还有 ${when} · ${schedule}` : schedule;
}

function renderPoolRally(data) {
  pool = { ...pool, ...(data || {}) };
  const el = document.querySelector('#poolRally');
  if (!el) return;
  const count = Number(pool.count || 0);
  el.innerHTML = `现在已经有 <strong>${count}</strong> 人参与进来，就差你了`;
  renderCountdown();
}

function poolWaitCard() {
  const count = Number(pool.count || 0);
  const when = formatCountdown(pool.next_match_at) || pool.next_match_label || '下次 21:00';
  const pass = me?.pool_pass;
  if (pass?.paused) {
    return `
      <article class="match-card is-active pool-wait">
        <p class="pool-kicker">这 4 轮用完了</p>
        <h2>去邮箱点确认，才能再进接下来 4 轮。</h2>
        <p>不确认的话，不会再被配出去，也不会再配到你。确认信会连着发 3 天。</p>
        <button class="primary-button" id="renewPool" type="button"><span>我已确认，再参加 4 轮</span><span class="arrow">→</span></button>
      </article>
    `;
  }
  const left = pass ? `这 4 轮还剩 ${pass.rounds_left} 次。` : '';
  const early = me?.user?.profile_complete
    ? '<button class="text-button early-match-button" id="earlyMatch" type="button">现在就要匹配</button>'
    : '';
  return `
    <article class="match-card is-active pool-wait">
      <p class="pool-kicker">${escapeHtml(pool.schedule_label || '每周一、周三 21:00')}</p>
      <h2>现在已经有 ${count} 人参与进来，就差你了。</h2>
      <p>${left}配的是能互相教的人。距离下次还有 ${escapeHtml(when)}。</p>
      <div class="pool-meter"><strong>${count}</strong> 人已进池</div>
      ${early}
    </article>
  `;
}

function earlyMatchHint() {
  const count = Number(pool.count || 0);
  const hint = pool.early_match;
  if (hint?.text) return hint;
  if (count > 25) return { level: 'ready', count, text: '现在匹配人数充足，可以提前优先匹配。' };
  if (count >= 10) return { level: 'choice', count, text: `池里现在有 ${count} 人。可以现在配，也可以再等等，人会更多。` };
  return { level: 'wait', count, text: `池里现在只有 ${count} 人。建议再等等，周一、周三晚上人会多一些。` };
}

function openEarlyMatchSheet() {
  const hint = earlyMatchHint();
  const nowLabel = '现在就配';
  const nowSecondary = '还是现在配';
  let actions = '';
  if (hint.level === 'ready') {
    actions = `
      <button class="primary-button" id="confirmEarlyMatch" type="button"><span>${nowLabel}</span><span class="arrow">→</span></button>
      <button class="text-button early-dismiss" id="waitForPool" type="button">再等等</button>
    `;
  } else if (hint.level === 'choice') {
    actions = `
      <button class="primary-button" id="confirmEarlyMatch" type="button"><span>${nowLabel}</span><span class="arrow">→</span></button>
      <button class="text-button early-dismiss" id="waitForPool" type="button">再等等，人会更多</button>
    `;
  } else {
    actions = `
      <button class="primary-button" id="waitForPool" type="button"><span>再等等</span><span class="arrow">→</span></button>
      <button class="text-button early-dismiss" id="confirmEarlyMatch" type="button">${nowSecondary}</button>
    `;
  }
  openSheet(`
    <h2 id="sheetTitle">现在就要匹配</h2>
    <p>${escapeHtml(hint.text)}</p>
    ${actions}
  `);
  document.querySelector('#waitForPool')?.addEventListener('click', closeSheet);
  document.querySelector('#confirmEarlyMatch')?.addEventListener('click', confirmEarlyMatch);
}

async function confirmEarlyMatch() {
  const button = document.querySelector('#confirmEarlyMatch');
  if (button) button.disabled = true;
  try {
    const data = await api('/api/matches/early', { method: 'POST' });
    matches = data.matches || [];
    if (data.pool) {
      me = { ...me, pool: data.pool };
      renderPoolRally(data.pool);
    }
    closeSheet();
    renderMatches();
    showToast(matches.length ? '已经按现在的池子配好了' : '现在还配不到人，先等等');
  } catch (error) {
    if (button) button.disabled = false;
    showToast(error.message);
  }
}

async function renewPool() {
  const button = document.querySelector('#renewPool');
  if (button) button.disabled = true;
  try {
    const data = await api('/api/pool/renew', { method: 'POST' });
    me.pool_pass = data.pool_pass;
    me.pool = data.pool;
    renderPoolRally(data.pool);
    await loadMatches();
    showToast('已确认，接下来再给你 4 轮');
  } catch (error) {
    if (button) button.disabled = false;
    showToast(error.message);
  }
}

function renderMatches() {
  const codeEl = document.querySelector('#referralCode');
  if (codeEl) codeEl.textContent = me?.user?.referral_code || '—';
  const dataLabel = document.querySelector('#dataLabel');
  if (dataLabel) dataLabel.textContent = matches.length ? '本轮匹配' : '攒人中';
  const lead = document.querySelector('#resultsLead');
  if (lead && me?.pool_pass) {
    lead.textContent = me.pool_pass.paused
      ? '这 4 轮用完了。去邮箱点确认，才能再进接下来 4 轮。'
      : `这 4 轮还剩 ${me.pool_pass.rounds_left} 次。周一、周三晚上 9 点各配一次。`;
  }
  matchDeck.classList.toggle('has-five', matches.length >= 5);
  if (!matches.length) {
    matchDeck.innerHTML = poolWaitCard();
    document.querySelector('#renewPool')?.addEventListener('click', renewPool);
    document.querySelector('#earlyMatch')?.addEventListener('click', openEarlyMatchSheet);
    renderMatchCarousel();
    return;
  }
  matchDeck.innerHTML = matches.map((item, index) => {
    const person = item.person;
    const tags = (item.shared_tags || person.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    const meta = [person.role, person.city, person.grade].filter(Boolean).join(' · ');
    if (index === 0) {
      return `
        <article class="match-card is-active" data-id="${person.id}" data-index="0">
          <div class="match-topline">
            <span class="match-number">第 ${item.rank || 1} 位</span>
            <span class="match-score"><strong>${item.score}%</strong> 匹配</span>
          </div>
          <div class="person-row">
            <div class="person-avatar tone-${escapeHtml(person.tone)}">${escapeHtml(person.letter)}</div>
            <div>
              <h2>${escapeHtml(person.name)}</h2>
              <p>${escapeHtml(meta)}</p>
              ${hintHtml(person)}
            </div>
          </div>
          <div class="match-reason">
            <p>${escapeHtml(item.reason)}</p>
          </div>
          <div class="tag-row">${tags}</div>
          <div class="exchange-grid">
            <div><span>他可以分享</span><p>${escapeHtml(item.can_share)}</p></div>
            <div><span>他想了解</span><p>${escapeHtml(item.wants)}</p></div>
          </div>
          <button class="primary-button contact-button" data-id="${person.id}" data-name="${escapeHtml(person.name)}" ${item.contacted ? 'disabled' : ''}>
            <span>${contactCta(person, item.contacted)}</span>
            <span class="arrow" aria-hidden="true">→</span>
          </button>
        </article>
      `;
    }
    return `
      <article class="match-card is-unlocked" data-id="${person.id}" data-index="${index}" tabindex="0" role="button">
        <div class="locked-preview preview-${escapeHtml(person.tone)}">
          <span>${item.score}%</span>
          <div class="blur-avatar tone-${escapeHtml(person.tone)}">${escapeHtml(person.letter)}</div>
          <h2>${escapeHtml(person.name)}</h2>
          <p>${escapeHtml(person.role)}</p>
        </div>
      </article>
    `;
  }).join('') || `<div class="empty-members">写下经历后即可生成匹配。</div>`;

  matchDeck.querySelectorAll('.contact-button').forEach((button) => {
    button.addEventListener('click', () => openContact(Number(button.dataset.id), button.dataset.name));
  });
  matchDeck.querySelectorAll('.match-card[data-id]').forEach((card) => {
    if (card.classList.contains('is-active')) return;
    const open = () => openPersonDetail(Number(card.dataset.id));
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
  renderMatchCarousel();
}

function personMeta(row) {
  return [row.city, row.grade, row.major].filter(Boolean).join(' · ');
}

function renderMembers() {
  memberRowsEl.innerHTML = members.map((row) => `
    <button class="member-row" type="button" data-id="${row.id}">
      <span class="member-person"><i class="member-avatar tone-${escapeHtml(row.tone)}">${escapeHtml(row.letter)}</i><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(personMeta(row) || '方向待补充')}${row.same_city ? ' · 同城' : ''}</small></span></span>
      <span class="member-skill">${escapeHtml(row.skills)}</span>
      <span class="member-tags">${(row.tags || []).map((tag) => `<i>${escapeHtml(tag)}</i>`).join('')}</span>
    </button>
  `).join('');
  document.querySelector('#emptyMembers').classList.toggle('is-hidden', members.length > 0);
  memberRowsEl.querySelectorAll('.member-row').forEach((row) => {
    row.addEventListener('click', () => openPersonDetail(Number(row.dataset.id)));
  });
}

function fillSelect(select, values, current, placeholder) {
  const selected = current || '';
  select.innerHTML = `<option value="">${placeholder}</option>` + values.map((value) => (
    `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`
  )).join('');
}

function syncMemberFilters(filters) {
  filterOptions = filters || filterOptions;
  fillSelect(filterCity, filterOptions.cities || [], filterCity.value, '全部城市');
  fillSelect(filterGrade, filterOptions.grades || [], filterGrade.value, '全部年级');
  fillSelect(filterMajor, filterOptions.majors || [], filterMajor.value, '全部专业');
}

async function loadMe() {
  me = await api('/api/me');
  if (me?.pool) {
    pool = { ...pool, ...me.pool };
    renderPoolRally(me.pool);
  }
  return me;
}

async function loadMatches() {
  const data = await api('/api/matches');
  matches = data.matches || [];
  if (data.pool) {
    pool = { ...pool, ...data.pool };
    renderPoolRally(data.pool);
  }
  renderMatches();
}

async function loadMembers() {
  memberRowsEl.innerHTML = '<div class="empty-members">加载中…</div>';
  const query = new URLSearchParams();
  if (memberSearch.value.trim()) query.set('q', memberSearch.value.trim());
  if (activeFilter && activeFilter !== '全部') query.set('tag', activeFilter);
  if (filterCity.value) query.set('city', filterCity.value);
  if (filterGrade.value) query.set('grade', filterGrade.value);
  if (filterMajor.value) query.set('major', filterMajor.value);
  const data = await api(`/api/members?${query.toString()}`);
  members = data.members || [];
  syncMemberFilters(data.filters);
  renderMembers();
}

async function enterApp(payload) {
  me = payload;
  if (me?.pool) {
    pool = { ...pool, ...me.pool };
    renderPoolRally(me.pool);
  }
  clearLocalAuth();
  avatarButton.classList.remove('is-hidden');
  if (window.PingoJobs) {
    await window.PingoJobs.authChanged();
    return;
  }
  if (!me.user.profile_complete) {
    showProfile();
    return;
  }
  await loadMatches();
  showResults();
}

function openContact(id, name) {
  const match = matches.find((item) => item.person.id === id);
  const person = match?.person || {};
  const personName = name || person.name || '搭子';
  const overlap = (match?.shared_tags || []).slice(0, 2).join('、') || '实习方向';
  const context = window.pingoJobContext;
  const draft = context
    ? `Hi ${personName}，\n\n我正在了解 ${context.company} 的 ${context.title}，想找同方向的人一起交流项目和面试准备。\n岗位链接：${context.url}\n\n你有兴趣一起聊聊吗？`
    : `Hi ${personName}，\n\n我在「拼个实习」看到我们在${overlap}上很匹配。我目前在做 ${me.user.role || '实习项目'}，很想和你交换一下工作流、项目细节和面试准备经验。\n\n如果你愿意，我们可以先约 20 分钟线上聊聊。`;
  openSheet(`
    <h2 id="sheetTitle">先发一封不尴尬的邮件</h2>
    <p>已经根据你们的共同点写好开场，你可以直接修改。</p>
    <textarea class="email-draft" id="emailDraft">${escapeHtml(draft)}</textarea>
    <p class="sheet-note">发出去后，对方会看到你的登录邮箱 ${escapeHtml(me?.user?.email || '')}，可以直接回信。</p>
    <button class="primary-button" id="sendEmail"><span>发送认识邮件</span><span class="arrow">→</span></button>
  `);
  document.querySelector('#sendEmail').addEventListener('click', async () => {
    const body = document.querySelector('#emailDraft').value;
    try {
      const result = await api(`/api/matches/${id}/contact`, { method: 'POST', body: JSON.stringify({ body }) });
      matches = result.matches || matches;
      renderMatches();
      if (!result.sent) {
        try {
          await navigator.clipboard.writeText(body);
          closeSheet();
          showToast('邮件未发送，草稿已复制');
        } catch {
          showToast('邮件未发送，请保留或手动复制草稿');
        }
      } else {
        closeSheet();
        showToast('认识邮件已发出');
      }
    } catch (error) {
      showToast(error.message);
    }
  });
}

function openCandidate(id) {
  openPersonDetail(id);
}

function openReport(id, name) {
  openSheet(`
    <h2 id="sheetTitle">举报资料</h2>
    <p>请告诉我们 ${escapeHtml(name || '这位成员')} 的资料哪里需要复核。我们会人工查看，不会向对方展示举报人信息。</p>
    <label for="reportReason">原因</label>
    <select id="reportReason">
      <option value="资料疑似不实">资料疑似不实</option>
      <option value="包含不当内容">包含不当内容</option>
      <option value="侵犯他人隐私">侵犯他人隐私</option>
      <option value="其他需要复核">其他需要复核</option>
    </select>
    <label for="reportDetail">补充说明（选填）</label>
    <textarea class="email-draft" id="reportDetail" maxlength="1000" placeholder="例如：哪一段内容需要核实"></textarea>
    <button class="primary-button" id="submitReport" type="button"><span>提交举报</span><span class="arrow">→</span></button>
  `);
  document.querySelector('#submitReport').addEventListener('click', async () => {
    const submit = document.querySelector('#submitReport');
    submit.disabled = true;
    try {
      await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          target_user_id: id,
          reason: document.querySelector('#reportReason').value,
          detail: document.querySelector('#reportDetail').value.trim(),
        }),
      });
      closeSheet();
      showToast('已提交，我们会尽快复核');
    } catch (error) {
      submit.disabled = false;
      showToast(error.message);
    }
  });
}

function personSheetHtml(person, extra = '') {
  const meta = [person.role, person.city, person.grade, person.major].filter(Boolean).join(' · ');
  return `
    <h2 id="sheetTitle">${escapeHtml(person.name)}</h2>
    <p>${escapeHtml(meta)}</p>
    ${hintHtml(person)}
    ${person.experience ? `<p><strong>经历与项目：</strong>${escapeHtml(person.experience)}</p>` : ''}
    ${person.looking_for ? `<p><strong>想找 / 想学：</strong>${escapeHtml(person.looking_for)}</p>` : ''}
    ${person.skills ? `<p><strong>擅长：</strong>${escapeHtml(person.skills)}</p>` : ''}
    ${extra}
    <button class="text-button report-button" type="button">举报这份资料</button>
  `;
}

async function openPersonDetail(id) {
  try {
    const data = await api(`/api/members/${id}`);
    const person = data.person;
    const match = matches.find((item) => item.person.id === id);
    const extra = match
      ? `<p><strong>为什么匹配：</strong>${escapeHtml(match.reason)}</p>
         <button class="primary-button candidate-contact"><span>${contactCta(person, match.contacted)}</span><span class="arrow">→</span></button>`
      : `<button class="primary-button explore-match-button"><span>看看我们是否适合拼</span><span class="arrow">→</span></button>`;
    openSheet(personSheetHtml(person, extra));
    document.querySelector('.candidate-contact')?.addEventListener('click', () => {
      closeSheet();
      openContact(id, person.name);
    });
    document.querySelector('.explore-match-button')?.addEventListener('click', async () => {
      try {
        const result = await api(`/api/members/${id}/prefer`, { method: 'POST' });
        matches = result.matches || matches;
        closeSheet();
        setResultsView('matches');
        renderMatches();
        document.querySelector('#matchDeck').scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('已加入下一轮匹配偏好');
      } catch (error) {
        showToast(error.message);
      }
    });
    document.querySelector('.report-button')?.addEventListener('click', () => openReport(id, person.name));
  } catch (error) {
    showToast(error.message);
  }
}

function openMember(id) {
  openPersonDetail(id);
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';
  const email = emailInput.value.trim();
  const inviteCode = inviteInput.value.trim();
  const acceptTerms = document.querySelector('#acceptTerms')?.checked === true;
  if (!acceptTerms) {
    formError.textContent = '请确认已满 18 周岁并同意用户协议与隐私政策';
    return;
  }
  const submit = document.querySelector('#loginSubmit');
  submit.disabled = true;
  try {
    if (awaitingCode) {
      const data = await api('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
          email,
          code: otpInput.value.trim(),
          remember: document.querySelector('#rememberMe')?.checked !== false,
        }),
      });
      await enterApp(data);
      return;
    }
    const data = await api('/api/auth/enter', {
      method: 'POST',
      body: JSON.stringify({
        email,
        invite_code: inviteCode,
        remember: document.querySelector('#rememberMe')?.checked !== false,
        accept_terms: acceptTerms,
      }),
    });
    if (data.status === 'code_sent') {
      awaitingCode = true;
      document.querySelector('#codeField').classList.remove('is-hidden');
      document.querySelector('#loginHint').textContent = '验证码已发到邮箱，10 分钟内有效';
      document.querySelector('#loginSubmitLabel').textContent = '验证并继续';
      otpInput.focus();
      showToast('验证码已发送');
      return;
    }
    await enterApp(data);
  } catch (error) {
    formError.textContent = error.message;
    emailInput.setAttribute('aria-invalid', 'true');
  } finally {
    submit.disabled = false;
  }
});

emailInput.addEventListener('input', () => {
  formError.textContent = '';
  emailInput.removeAttribute('aria-invalid');
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  profileError.textContent = '';
  try {
    me = await api('/api/me/onboard', {
      method: 'POST',
      body: JSON.stringify({
        experience: profileForm.profileIntro.value.trim(),
        looking_for: profileForm.profileIntro.value.trim(),
        intro: profileForm.profileIntro.value.trim(),
        content_confirmed: document.querySelector('#profileContentConsent')?.checked === true,
      }),
    });
    if (window.PingoJobs) await window.PingoJobs.navigate('community');
    else { await loadMatches(); showResults(); }
  } catch (error) {
    profileError.textContent = error.message;
  }
});

archiveForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  archiveError.textContent = '';
  try {
    me = await api('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({
        name: archiveForm.archiveName.value.trim(),
        role: archiveForm.archiveRole.value.trim(),
        city: archiveForm.archiveCity.value.trim(),
        grade: archiveForm.archiveGrade.value.trim(),
        major: archiveForm.archiveMajor.value.trim(),
        school: archiveForm.archiveSchool.value.trim(),
        experience: archiveForm.archiveExperience.value.trim(),
        looking_for: archiveForm.archiveLooking.value.trim(),
        prefer_same_city: archiveForm.archiveSameCity.checked,
        tags: selectedTags,
        learn_tags: selectedLearnTags,
        skills: archiveForm.archiveExperience.value.trim().slice(0, 80),
        wants: archiveForm.archiveLooking.value.trim().slice(0, 80),
      }),
    });
    await loadMatches();
    showResults();
    showToast('档案已保存');
  } catch (error) {
    archiveError.textContent = error.message;
  }
});

claimInviteButton.addEventListener('click', () => {
  inviteInput.value = 'PINGO-START';
  claimInviteButton.textContent = '内测邀请码已领取';
  claimInviteButton.classList.add('is-claimed');
  showToast('邀请码已填写，注册后可在账户页查看自己的邀请码');
});

document.querySelector('#archiveSkillTags').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-tag]');
  if (!chip) return;
  const tag = chip.dataset.tag;
  selectedTags = selectedTags.includes(tag)
    ? selectedTags.filter((item) => item !== tag)
    : [...selectedTags, tag];
  renderTags('#archiveSkillTags', selectedTags, 'tag');
});

document.querySelector('#archiveLearnTags').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-learn]');
  if (!chip) return;
  const tag = chip.dataset.learn;
  selectedLearnTags = selectedLearnTags.includes(tag)
    ? selectedLearnTags.filter((item) => item !== tag)
    : [...selectedLearnTags, tag];
  renderTags('#archiveLearnTags', selectedLearnTags, 'learn');
});

document.querySelector('#brandButton').addEventListener('click', () => window.PingoJobs?.navigate('discover'));
matchesTab.addEventListener('click', () => setResultsView('matches'));
exploreTab.addEventListener('click', () => setResultsView('explore'));

document.querySelector('#aboutButton').addEventListener('click', () => {
  openSheet(`
    <h2 id="sheetTitle">怎么配对</h2>
    <p>不找跟你一模一样的人。找能跟你换项目经验的人。</p>
    <ol>
      <li><div><strong>先写清楚</strong><br><span>做过什么、想补什么就行。不用完整简历。</span></div></li>
      <li><div><strong>一周两次</strong><br><span>周一、周三晚上 9 点。人少就不硬塞。</span></div></li>
      <li><div><strong>连着 4 轮</strong><br><span>用完会发邮件。点确认，才能再进接下来 4 轮。不点就不再配。</span></div></li>
    </ol>
  `);
});

document.querySelector('#privacyButton').addEventListener('click', () => {
  openSheet(`
    <h2 id="sheetTitle">隐私说明</h2>
    <p>邮箱和自我介绍只用于生成匹配、发送结果与建立联系。发出认识邮件时，对方会看到你的邮箱以便回复。</p>
    <p>工作经历投稿会保存到你的账号，审核后以不显示姓名、邮箱的方式公开。年份、岗位与内容本身仍可能让熟人识别你，请勿包含可识别个人或未公开业务的信息；你可随时撤回。</p>
    <p>登录后会把会话写在 HttpOnly Cookie 里，默认 30 天免登录。退出账户会立即作废。</p>
  `);
});

avatarButton.addEventListener('click', () => {
  const user = me?.user || {};
  openSheet(`
    <h2 id="sheetTitle">${escapeHtml(user.email || '当前用户')}</h2>
    <p>${escapeHtml(user.role || '先写下经历，再查看匹配')}。学校只用于后台匹配，不会出现在别人看到的卡片上。</p>
    <div class="code-box"><span>我的邀请码</span><strong id="accountReferralCode">${escapeHtml(user.referral_code || '—')}</strong><button class="text-button" id="copyAccountReferral" type="button">复制</button></div>
    <button class="primary-button" id="editProfileButton"><span>我的档案</span><span class="arrow">→</span></button>
    ${me?.is_data_admin ? '<button class="text-button" id="openImportConsole" style="margin-top:12px;width:100%;">内容管理</button>' : ''}
    <button class="text-button" id="deleteAccountButton" style="margin-top:12px;width:100%;color:#a33;">注销并删除账户</button>
    <button class="text-button" id="logoutButton" style="margin-top:12px;width:100%;">退出账户</button>
  `);
  document.querySelector('#editProfileButton').addEventListener('click', () => {
    closeSheet();
    showArchive();
  });
  document.querySelector('#copyAccountReferral')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(user.referral_code || '').catch(() => {});
    showToast('邀请码已复制');
  });
  document.querySelector('#openImportConsole')?.addEventListener('click', () => { window.location.href = '/imports'; });
  document.querySelector('#deleteAccountButton').addEventListener('click', () => {
    openSheet(`
      <h2 id="sheetTitle">确认注销并删除账户？</h2>
      <p>档案、会话、匹配记录和联系请求将从平台删除。该操作无法撤销。</p>
      <button class="primary-button" id="confirmDeleteAccount"><span>确认永久删除</span><span class="arrow">→</span></button>
      <button class="text-button" id="cancelDeleteAccount" style="margin-top:12px;width:100%;">取消</button>
    `);
    document.querySelector('#cancelDeleteAccount').addEventListener('click', closeSheet);
    document.querySelector('#confirmDeleteAccount').addEventListener('click', async () => {
      try {
        await api('/api/me', { method: 'DELETE' });
        me = null;
        matches = [];
        closeSheet();
        window.PingoJobs?.signedOut();
        showToast('账户与平台数据已删除');
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  document.querySelector('#logoutButton').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setAuth('');
    me = null;
    matches = [];
    awaitingCode = false;
    closeSheet();
    window.PingoJobs?.signedOut();
  });
});

document.querySelector('#shareButton')?.addEventListener('click', async () => {
  const code = referralCodeEl.textContent;
  const shareData = {
    title: '来拼个实习搭子',
    text: `我在「拼个实习」找到了很合适的同行，使用邀请码 ${code} 查看你的匹配。`,
    url: me?.app_url || window.location.href,
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
      showToast('邀请文案和链接已复制');
    }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('暂时无法分享，请稍后重试');
  }
});

let searchTimer;
memberSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadMembers, 180);
});
document.querySelectorAll('#filterRow .filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    activeFilter = chip.dataset.filter;
    document.querySelectorAll('#filterRow .filter-chip').forEach((item) => item.classList.toggle('is-active', item === chip));
    loadMembers();
  });
});

[filterCity, filterGrade, filterMajor].forEach((select) => {
  select.addEventListener('change', loadMembers);
});

renderTags('#archiveSkillTags', selectedTags, 'tag');
renderTags('#archiveLearnTags', selectedLearnTags, 'learn');

document.querySelector('#closeSheet').addEventListener('click', closeSheet);
sheetBackdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', (event) => {
  if (infoSheet.classList.contains('is-hidden')) return;
  if (event.key === 'Escape') closeSheet();
  if (event.key === 'Tab') {
    const focusable = [...infoSheet.querySelectorAll('button, textarea, input, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

(async function boot() {
  clearLocalAuth();
  const params = new URLSearchParams(window.location.search);
  const invite = params.get('code') || params.get('invite');
  if (invite && !inviteInput.value) inviteInput.value = invite;
  try {
    const publicConfig = await api('/api/config');
    renderPoolRally(publicConfig.pool);
    setInterval(renderCountdown, 30000);
  } catch {
    renderPoolRally(pool);
  }
  try {
    await loadMe();
    await enterApp(me);
  } catch {
    window.PingoJobs?.navigate('discover');
  }
})();
