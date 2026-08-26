const loginView = document.querySelector('#loginView');
const profileView = document.querySelector('#profileView');
const resultsView = document.querySelector('#resultsView');
const loginForm = document.querySelector('#loginForm');
const profileForm = document.querySelector('#profileForm');
const emailInput = document.querySelector('#email');
const otpInput = document.querySelector('#otpCode');
const inviteInput = document.querySelector('#inviteCode');
const formError = document.querySelector('#formError');
const profileError = document.querySelector('#profileError');
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
const inviteStrip = document.querySelector('#inviteStrip');

const TAG_OPTIONS = ['AI', '产品', '开发', '增长', '求职交流', 'ToB', 'Agent', 'VLM', '推荐', '安全'];
const TOKEN_KEY = 'pingo-token';

let toastTimer;
let sheetTrigger;
let activeFilter = '全部';
let token = localStorage.getItem(TOKEN_KEY) || '';
let me = null;
let matches = [];
let members = [];
let awaitingCode = false;
let selectedTags = [];

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
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => item.msg || item).join('；')
      : data.detail;
    throw new Error(detail || data.message || '请求失败，请稍后重试');
  }
  return data;
}

function setAuth(nextToken) {
  token = nextToken;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function hideAllViews() {
  loginView.classList.add('is-hidden');
  profileView.classList.add('is-hidden');
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

function showResults() {
  hideAllViews();
  resultsView.classList.remove('is-hidden');
  avatarButton.classList.remove('is-hidden');
  avatarButton.textContent = (me?.user?.name || me?.user?.email || 'U').charAt(0).toUpperCase();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function applyUnlock(unlock) {
  const emailDone = Boolean(unlock?.email_sent);
  const inviteDone = Boolean(unlock?.referral_complete);
  document.querySelector('#emailProgress').classList.toggle('is-done', emailDone);
  document.querySelector('#emailProgressLine').classList.toggle('is-done', emailDone);
  document.querySelector('#inviteProgress').classList.toggle('is-done', inviteDone);
  document.querySelector('#inviteProgressLine').classList.toggle('is-done', inviteDone);
  if (inviteDone && inviteStrip.dataset.complete !== 'true') {
    inviteStrip.dataset.complete = 'true';
    inviteStrip.innerHTML = `
      <div class="invite-visual" aria-hidden="true"><img src="assets/pingo-mascot.webp" alt=""></div>
      <div class="invite-copy"><h2>朋友来了，第 3 位搭子已解锁</h2><p>你们都获得了一位新的匹配。</p></div>
    `;
  }
}

function setResultsView(view) {
  const showMatches = view === 'matches';
  matchesPanel.classList.toggle('is-hidden', !showMatches);
  explorePanel.classList.toggle('is-hidden', showMatches);
  matchesTab.classList.toggle('is-selected', showMatches);
  exploreTab.classList.toggle('is-selected', !showMatches);
  matchesTab.setAttribute('aria-selected', String(showMatches));
  exploreTab.setAttribute('aria-selected', String(!showMatches));
  if (!showMatches) loadMembers();
}

function renderTags() {
  document.querySelector('#profileTags').innerHTML = TAG_OPTIONS.map((tag) => (
    `<button class="filter-chip${selectedTags.includes(tag) ? ' is-active' : ''}" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  )).join('');
}

function fillProfileForm() {
  const user = me?.user || {};
  profileForm.profileName.value = user.name || '';
  profileForm.profileRole.value = user.role || '';
  profileForm.profileSchool.value = user.school || '';
  profileForm.profileGrade.value = user.grade || '';
  profileForm.profileCity.value = user.city || '';
  profileForm.profileSkills.value = user.skills || '';
  profileForm.profileWants.value = user.wants || '';
  selectedTags = [...(user.tags || [])];
  renderTags();
}

function renderMatches() {
  const codeEl = document.querySelector('#referralCode');
  if (codeEl) codeEl.textContent = me?.user?.referral_code || '—';
  applyUnlock(me?.unlock);
  matchDeck.innerHTML = matches.map((item, index) => {
    const person = item.person;
    const tags = (item.shared_tags || person.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    if (index === 0 && item.unlocked) {
      return `
        <article class="match-card is-active" data-id="${person.id}" data-index="0">
          <div class="match-topline">
            <span class="match-number">第 1 位</span>
            <span class="match-score"><strong>${item.score}%</strong> 匹配</span>
          </div>
          <div class="person-row">
            <div class="person-avatar tone-${escapeHtml(person.tone)}">${escapeHtml(person.letter)}</div>
            <div>
              <h2>${escapeHtml(person.name)}</h2>
              <p>${escapeHtml([person.role, person.city].filter(Boolean).join(' · '))}</p>
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
            <span>${item.contacted ? '已发出认识邮件' : '发一封认识邮件'}</span>
            <span class="arrow" aria-hidden="true">→</span>
          </button>
        </article>
      `;
    }
    const lockedClass = item.unlocked ? 'is-unlocked' : 'is-locked';
    return `
      <article class="match-card ${lockedClass}" data-id="${person.id}" data-index="${index}" ${item.unlocked ? 'tabindex="0" role="button"' : ''}>
        <div class="locked-preview preview-${escapeHtml(person.tone)}">
          <span>${item.score}%</span>
          <div class="blur-avatar tone-${escapeHtml(person.tone)}">${escapeHtml(person.letter)}</div>
          <h2>${escapeHtml(person.name)}</h2>
          <p>${escapeHtml(person.role)}</p>
        </div>
        ${item.unlocked ? '' : `
          <div class="lock-copy">
            <div class="lock-icon" aria-hidden="true"></div>
            <h3>${index === 1 ? '发出第一封认识邮件' : '喊一个朋友来拼'}</h3>
            <p>${index === 1 ? '联系第 1 位搭子后解锁' : '好友完成注册后解锁'}</p>
          </div>
        `}
      </article>
    `;
  }).join('') || `<div class="empty-members">完善资料后即可生成匹配。</div>`;

  matchDeck.querySelectorAll('.contact-button').forEach((button) => {
    button.addEventListener('click', () => openContact(Number(button.dataset.id), button.dataset.name));
  });
  matchDeck.querySelectorAll('.match-card.is-unlocked').forEach((card) => {
    const open = () => openCandidate(Number(card.dataset.id));
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function renderMembers() {
  memberRowsEl.innerHTML = members.map((row) => `
    <button class="member-row" type="button" data-id="${row.id}">
      <span class="member-person"><i class="member-avatar tone-${escapeHtml(row.tone)}">${escapeHtml(row.letter)}</i><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml([row.school, row.grade].filter(Boolean).join(' · '))}</small></span></span>
      <span class="member-skill">${escapeHtml(row.skills)}</span>
      <span class="member-tags">${(row.tags || []).map((tag) => `<i>${escapeHtml(tag)}</i>`).join('')}</span>
    </button>
  `).join('');
  document.querySelector('#emptyMembers').classList.toggle('is-hidden', members.length > 0);
  memberRowsEl.querySelectorAll('.member-row').forEach((row) => {
    row.addEventListener('click', () => openMember(Number(row.dataset.id)));
  });
}

async function loadMe() {
  me = await api('/api/me');
  return me;
}

async function loadMatches() {
  const data = await api('/api/matches');
  matches = data.matches || [];
  if (me) me.unlock = data.unlock;
  renderMatches();
}

async function loadMembers() {
  memberRowsEl.innerHTML = '<div class="empty-members">加载中…</div>';
  const query = new URLSearchParams();
  if (memberSearch.value.trim()) query.set('q', memberSearch.value.trim());
  if (activeFilter && activeFilter !== '全部') query.set('tag', activeFilter);
  const data = await api(`/api/members?${query.toString()}`);
  members = data.members || [];
  renderMembers();
}

async function enterApp(payload) {
  me = payload;
  if (payload.token) setAuth(payload.token);
  avatarButton.classList.remove('is-hidden');
  if (!me.user.profile_complete) {
    showProfile();
    return;
  }
  await loadMatches();
  showResults();
}

function openContact(id, name) {
  const match = matches.find((item) => item.person.id === id);
  const personName = name || match?.person?.name || '搭子';
  const overlap = (match?.shared_tags || []).slice(0, 2).join('、') || '实习方向';
  const draft = `Hi ${personName}，\n\n我在「拼个实习」看到我们在${overlap}上很匹配。我目前在做 ${me.user.role || '实习项目'}，很想和你交换一下工作流、项目细节和面试准备经验。\n\n如果你愿意，我们可以先约 20 分钟线上聊聊。`;
  openSheet(`
    <h2 id="sheetTitle">先发一封不尴尬的邮件</h2>
    <p>已经根据你们的共同点写好开场，你可以直接修改。</p>
    <textarea class="email-draft" id="emailDraft">${escapeHtml(draft)}</textarea>
    <button class="primary-button" id="sendEmail"><span>发送并解锁第 2 位</span><span class="arrow">→</span></button>
  `);
  document.querySelector('#sendEmail').addEventListener('click', async () => {
    const body = document.querySelector('#emailDraft').value;
    try {
      const result = await api(`/api/matches/${id}/contact`, { method: 'POST', body: JSON.stringify({ body }) });
      matches = result.matches || matches;
      me.unlock = result.unlock;
      closeSheet();
      renderMatches();
      if (!result.sent) {
        await navigator.clipboard.writeText(body).catch(() => {});
        showToast('邮箱尚未接通，邮件已复制，请自行发送。第 2 位已解锁');
      } else {
        showToast('邮件已发出，第 2 位搭子已解锁');
      }
    } catch (error) {
      showToast(error.message);
    }
  });
}

function openCandidate(id) {
  const match = matches.find((item) => item.person.id === id);
  if (!match?.unlocked) return;
  const person = match.person;
  openSheet(`
    <h2 id="sheetTitle">${escapeHtml(person.name)}</h2>
    <p>${escapeHtml([person.role, person.city].filter(Boolean).join(' · '))}</p>
    <p><strong>为什么匹配：</strong>${escapeHtml(match.reason)}</p>
    <p><strong>可以交换：</strong>${escapeHtml(match.can_share)}</p>
    <button class="primary-button candidate-contact" ${match.contacted ? 'disabled' : ''}><span>${match.contacted ? '已发出认识邮件' : '发一封认识邮件'}</span><span class="arrow">→</span></button>
  `);
  const button = document.querySelector('.candidate-contact');
  if (!match.contacted) {
    button.addEventListener('click', () => {
      closeSheet();
      openContact(id, person.name);
    });
  }
}

function openMember(id) {
  const row = members.find((item) => item.id === id);
  if (!row) return;
  openSheet(`
    <h2 id="sheetTitle">${escapeHtml(row.name)}</h2>
    <p>${escapeHtml([row.school, row.grade].filter(Boolean).join(' · '))}</p>
    <p><strong>擅长：</strong>${escapeHtml(row.skills)}</p>
    <p><strong>方向：</strong>${escapeHtml((row.tags || []).join(' · '))}</p>
    <button class="primary-button explore-match-button"><span>看看我们是否适合拼</span><span class="arrow">→</span></button>
  `);
  document.querySelector('.explore-match-button').addEventListener('click', async () => {
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
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';
  const email = emailInput.value.trim();
  const inviteCode = inviteInput.value.trim();
  const submit = document.querySelector('#loginSubmit');
  submit.disabled = true;
  try {
    if (awaitingCode) {
      const data = await api('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code: otpInput.value.trim() }),
      });
      await enterApp(data);
      return;
    }
    const data = await api('/api/auth/enter', {
      method: 'POST',
      body: JSON.stringify({ email, invite_code: inviteCode }),
    });
    if (data.status === 'code_sent') {
      awaitingCode = true;
      document.querySelector('#codeField').classList.remove('is-hidden');
      document.querySelector('#loginHint').textContent = '验证码已发到邮箱，10 分钟内有效';
      document.querySelector('#loginSubmitLabel').textContent = '验证并进入';
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
  if (!selectedTags.length) {
    profileError.textContent = '请至少选择一个方向标签';
    return;
  }
  try {
    me = await api('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({
        name: profileForm.profileName.value.trim(),
        role: profileForm.profileRole.value.trim(),
        school: profileForm.profileSchool.value.trim(),
        grade: profileForm.profileGrade.value.trim(),
        city: profileForm.profileCity.value.trim(),
        skills: profileForm.profileSkills.value.trim(),
        wants: profileForm.profileWants.value.trim(),
        tags: selectedTags,
      }),
    });
    await loadMatches();
    showResults();
  } catch (error) {
    profileError.textContent = error.message;
  }
});

document.querySelector('#profileTags').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-tag]');
  if (!chip) return;
  const tag = chip.dataset.tag;
  selectedTags = selectedTags.includes(tag)
    ? selectedTags.filter((item) => item !== tag)
    : [...selectedTags, tag];
  renderTags();
});

document.querySelector('#brandButton').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
matchesTab.addEventListener('click', () => setResultsView('matches'));
exploreTab.addEventListener('click', () => setResultsView('explore'));

document.querySelector('#aboutButton').addEventListener('click', () => {
  openSheet(`
    <h2 id="sheetTitle">三步找到实习搭子</h2>
    <p>匹配不只看岗位名，更看你们正在做什么、彼此能补上什么。</p>
    <ol>
      <li><div><strong>留下你的方向</strong><br><span>岗位、项目、能分享的经验和想补上的缺口。</span></div></li>
      <li><div><strong>先看一位匹配</strong><br><span>免费查看最合适的人，以及这次匹配成立的原因。</span></div></li>
      <li><div><strong>完成两个小动作</strong><br><span>发出第一封邮件解锁第 2 位，邀请好友注册解锁第 3 位。</span></div></li>
    </ol>
  `);
});

document.querySelector('#privacyButton').addEventListener('click', () => {
  openSheet(`
    <h2 id="sheetTitle">隐私说明</h2>
    <p>邮箱和自我介绍只用于生成匹配、发送结果与建立联系。发出认识邮件时，对方会看到你的邮箱以便回复。</p>
    <p>账户菜单可退出当前登录。如需删除资料，把需求发到你登录使用的邮箱对应管理员即可处理。</p>
  `);
});

avatarButton.addEventListener('click', () => {
  const user = me?.user || {};
  openSheet(`
    <h2 id="sheetTitle">${escapeHtml(user.email || '当前用户')}</h2>
    <p>${escapeHtml(user.role || '完善资料后可查看匹配')}。发出第一封认识邮件解锁第 2 位，邀请一位朋友注册解锁第 3 位。</p>
    <button class="primary-button" id="editProfileButton"><span>修改资料</span><span class="arrow">→</span></button>
    <button class="text-button" id="logoutButton" style="margin-top:12px;width:100%;">退出账户</button>
  `);
  document.querySelector('#editProfileButton').addEventListener('click', () => {
    closeSheet();
    showProfile();
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
    showLogin();
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

renderTags();

(async function boot() {
  const params = new URLSearchParams(window.location.search);
  const invite = params.get('code') || params.get('invite');
  if (invite && !inviteInput.value) inviteInput.value = invite;
  if (!token) return;
  try {
    await loadMe();
    await enterApp(me);
  } catch {
    setAuth('');
  }
})();
