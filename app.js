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
const pinpinButton = document.querySelector('#pinpinButton');
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
const matchCarouselIndicator = document.querySelector('#matchCarouselIndicator');
const quotaBar = document.querySelector('#quotaBar');
const filterCity = document.querySelector('#filterCity');
const filterGrade = document.querySelector('#filterGrade');
const filterMajor = document.querySelector('#filterMajor');
const proFilters = document.querySelector('#proFilters');

const TAG_OPTIONS = ['AI', '产品', '开发', '增长', '求职交流', 'ToB', 'Agent', 'VLM', '推荐', '安全'];
const PINPIN_REASONS = {
  details_quota: '今天的详情已经看完。开通拼拼卡，每天可以打开 100 位同学的档案。',
  more_matches: '周一或周三 21:00 匹配后，开通拼拼卡可以直接查看更多搭子。',
  boost: '无经验、求指导时，加急曝光能让你在 24 小时内被更多人看见。',
  filter: '城市、年级、专业的组合筛选是拼拼卡权益。同城加权本身对所有人免费。',
  generic: '拼拼卡是唯一付费项。加急曝光是其中一项能力，不是另一张卡。',
};

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
  loginView.classList.add('is-hidden');
  profileView.classList.add('is-hidden');
  archiveView.classList.add('is-hidden');
  resultsView.classList.add('is-hidden');
}

function showLogin() {
  hideAllViews();
  loginView.classList.remove('is-hidden');
  avatarButton.classList.add('is-hidden');
  pinpinButton.classList.add('is-hidden');
}

function showProfile() {
  hideAllViews();
  profileView.classList.remove('is-hidden');
  avatarButton.classList.remove('is-hidden');
  pinpinButton.classList.remove('is-hidden');
  avatarButton.textContent = (me?.user?.name || me?.user?.email || 'U').charAt(0).toUpperCase();
  fillProfileForm();
}

function showArchive() {
  hideAllViews();
  archiveView.classList.remove('is-hidden');
  avatarButton.classList.remove('is-hidden');
  pinpinButton.classList.remove('is-hidden');
  avatarButton.textContent = (me?.user?.name || me?.user?.email || 'U').charAt(0).toUpperCase();
  fillArchiveForm();
}

function showResults() {
  hideAllViews();
  resultsView.classList.remove('is-hidden');
  avatarButton.classList.remove('is-hidden');
  pinpinButton.classList.remove('is-hidden');
  avatarButton.textContent = (me?.user?.name || me?.user?.email || 'U').charAt(0).toUpperCase();
  renderQuota();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function quota() {
  return me?.quota || {};
}

function isPro() {
  return Boolean(me?.user?.is_pro || quota().is_pro);
}

function renderQuota() {
  const data = quota();
  if (!quotaBar) return;
  const used = data.details_used ?? 0;
  const limit = data.details_limit ?? 20;
  const refresh = data.next_refresh_label || pool.next_match_label || '每天 21:00';
  quotaBar.innerHTML = `
    <span>今日详情 <strong>${used}/${limit}</strong></span>
    <span>下次刷新 <strong>${escapeHtml(refresh)}</strong></span>
    <span>${isPro() ? '拼拼卡已开通' : `内测 ${data.pinpin_sold || 0}/${data.pinpin_cap || 500}`}</span>
    ${isPro() ? '' : '<button class="text-button" type="button" id="quotaPinpin">开通拼拼卡</button>'}
  `;
  document.querySelector('#quotaPinpin')?.addEventListener('click', () => openPinpinSheet('generic'));
  pinpinButton.textContent = isPro() ? '拼拼卡权益' : '拼拼卡';
}

function pinpinTableHtml() {
  return `
    <table class="pinpin-table">
      <thead><tr><th>能力</th><th>普通用户</th><th>拼拼卡</th></tr></thead>
      <tbody>
        <tr><td>自由探索详情</td><td>每天 20 人</td><td>每天 100 人</td></tr>
        <tr><td>匹配</td><td>周一、周三 21:00</td><td>同一批，可看 5 人</td></tr>
        <tr><td>第 2、3 位匹配</td><td>邀请好友解锁</td><td>直接查看</td></tr>
        <tr><td>加急曝光</td><td>无</td><td>每天 1 次，24 小时</td></tr>
        <tr><td>筛选</td><td>基础标签</td><td>城市、年级、专业</td></tr>
      </tbody>
    </table>
  `;
}

function bindPinpinBuy() {
  document.querySelector('#simulatePinpin')?.addEventListener('click', buyPinpin);
}

async function buyPinpin() {
  const button = document.querySelector('#simulatePinpin');
  if (button) button.disabled = true;
  try {
    const data = await api('/api/pinpin/simulate', { method: 'POST' });
    me = data;
    matches = data.matches || matches;
    closeSheet();
    renderQuota();
    renderMatches();
    if (explorePanel && !explorePanel.classList.contains('is-hidden')) loadMembers();
    showToast(data.quota?.already ? '拼拼卡已经开通过' : '测试权益已开通');
  } catch (error) {
    showToast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function manualPaymentHtml(payment, order) {
  const submitted = order?.status === 'pending';
  const approved = order?.status === 'approved';
  if (approved) return '<p class="pinpin-note">这张拼拼卡已经开通。</p>';
  return `
    <div class="manual-payment">
      ${submitted ? `<div class="manual-payment-amount">已提交核验</div>
        <p class="pinpin-note">核对到账后会开通权益，并发送邮件到 ${escapeHtml(me?.user?.email || '你的登录邮箱')}。</p>` : `<div class="manual-payment-amount">¥10</div>
        <img class="payment-qr" src="${escapeHtml(payment.qr_url)}" alt="微信收款码">
        <p class="pinpin-note">扫码付款后，填写付款时显示的微信昵称。系统会用你的登录邮箱和昵称让我们核对，无需加微信或上传截图。</p>`}
      ${order?.order_code ? `<p class="payment-order-code">订单号 <strong>${escapeHtml(order.order_code)}</strong> <button class="text-button" type="button" id="copyPaymentOrder">复制</button></p>` : ''}
      <label class="payment-nickname-label" for="paymentNickname">${submitted ? '需要更正时，更新付款微信昵称' : '付款微信昵称'}</label>
      <input id="paymentNickname" maxlength="64" autocomplete="off" placeholder="例如：小王同学" value="${escapeHtml(order?.payer_nickname || '')}">
      <button class="primary-button" id="submitManualPayment" type="button"><span>${submitted ? '更新付款昵称' : '我已付款，提交核验'}</span><span class="arrow">→</span></button>
      ${payment.contact ? `<p class="pinpin-note">核验遇到问题：${escapeHtml(payment.contact)}</p>` : ''}
    </div>
  `;
}

function bindManualPayment(reason, order) {
  document.querySelector('#copyPaymentOrder')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(order.order_code);
      showToast('订单号已复制');
    } catch {
      showToast('请手动复制订单号');
    }
  });
  document.querySelector('#submitManualPayment')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const payerNickname = document.querySelector('#paymentNickname').value.trim();
    if (!payerNickname) {
      showToast('请填写付款时显示的微信昵称');
      return;
    }
    button.disabled = true;
    try {
      await api('/api/pinpin/manual-order', { method: 'POST', body: JSON.stringify({ payer_nickname: payerNickname }) });
      showToast('已提交核验，开通后会邮件通知你');
      await openPinpinSheet(reason);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function openPinpinSheet(reason = 'more_matches') {
  const data = quota();
  const copy = PINPIN_REASONS[reason] || PINPIN_REASONS.more_matches;
  const canExploreFree = (data.details_used || 0) < (data.details_limit || 20);
  let manual = null;
  if (!isPro()) {
    try {
      manual = await api('/api/pinpin/manual-order');
    } catch (error) {
      showToast(error.message);
    }
  }
  const payment = manual?.payment;
  const order = manual?.order;
  const open = data.pinpin_open !== false;
  openSheet(`
    <h2 id="sheetTitle">拼拼卡 · 内测终身版</h2>
    <p>${escapeHtml(copy)}</p>
    ${pinpinTableHtml()}
    <p class="pinpin-note">首批内测用户 ¥10，终身解锁<strong>当前</strong>拼拼卡基础权益。不包含以后可能上线的 AI 匹配、邮件增强等增值服务。</p>
    <p class="pinpin-note">名额 ${data.pinpin_sold || 0}/${data.pinpin_cap || 500}。</p>
    ${!isPro() && canExploreFree ? '<button class="text-button free-explore-button" id="freeExploreFromPinpin" type="button">暂不，先免费探索更多资料</button>' : ''}
    ${isPro() ? '<button class="primary-button" disabled><span>已开通</span></button>' : payment?.enabled
      ? manualPaymentHtml(payment, order)
      : open
      ? '<button class="primary-button" id="simulatePinpin"><span>仅供测试环境开通</span><span class="arrow">→</span></button>'
      : '<button class="primary-button" disabled><span>真实支付接入中</span></button>'}
  `);
  bindPinpinBuy();
  if (payment?.enabled) bindManualPayment(reason, order);
  document.querySelector('#freeExploreFromPinpin')?.addEventListener('click', () => {
    closeSheet();
    setResultsView('explore');
    explorePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function applyUnlock(unlock) {
  const emailDone = Boolean(unlock?.email_sent);
  const inviteDone = Boolean(unlock?.referral_complete);
  document.querySelector('#emailProgress').classList.toggle('is-done', emailDone || isPro());
  document.querySelector('#emailProgressLine').classList.toggle('is-done', emailDone || isPro());
  document.querySelector('#inviteProgress').classList.toggle('is-done', inviteDone || isPro());
  document.querySelector('#inviteProgressLine').classList.toggle('is-done', inviteDone || isPro());
  const strip = document.querySelector('#inviteStrip');
  if (!strip) return;
  if (isPro()) {
    const data = quota();
    strip.innerHTML = `
      <div class="invite-visual" aria-hidden="true"><img src="assets/pingo-mascot.webp" alt=""></div>
      <div class="invite-copy">
        <h2>加急曝光</h2>
        <p>${data.boost_active ? '你正在被优先看见，24 小时有效。' : '每天一次，持续 24 小时。适合「无经验，求大佬」这类需求。'}</p>
      </div>
      <div class="invite-action">
        <button class="primary-button" id="boostButton" ${data.can_boost ? '' : 'disabled'}>
          <span>${data.boost_active ? '加急曝光进行中' : data.can_boost ? '开启今天的加急曝光' : '今天已经用过'}</span>
          <span class="arrow" aria-hidden="true">→</span>
        </button>
      </div>
    `;
    document.querySelector('#boostButton')?.addEventListener('click', activateBoost);
    return;
  }
  if (inviteDone && strip.dataset.complete !== 'true') {
    strip.dataset.complete = 'true';
    strip.innerHTML = `
      <div class="invite-visual" aria-hidden="true"><img src="assets/pingo-mascot.webp" alt=""></div>
      <div class="invite-copy"><h2>朋友来了，第 3 位搭子已解锁</h2><p>你们都获得了一位新的匹配。想看更多，也可以开通拼拼卡。</p></div>
      <div class="invite-action"><button class="primary-button" id="moreMatchesButton"><span>查看更多匹配</span><span class="arrow">→</span></button></div>
    `;
    document.querySelector('#moreMatchesButton')?.addEventListener('click', () => openPinpinSheet('more_matches'));
  }
}

async function activateBoost() {
  try {
    const data = await api('/api/pinpin/boost', { method: 'POST' });
    if (data.paywall) {
      openPinpinSheet('boost');
      return;
    }
    me = data.me || me;
    if (data.quota) me.quota = data.quota;
    renderQuota();
    renderMatches();
    showToast('加急曝光已开启，24 小时内优先被看见');
  } catch (error) {
    showToast(error.message);
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
  if (person.boost_active) hints.push('加急曝光中');
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
  return `
    <article class="match-card is-active pool-wait">
      <p class="pool-kicker">${escapeHtml(pool.schedule_label || '每周一、周三 21:00')}</p>
      <h2>现在已经有 ${count} 人参与进来，就差你了。</h2>
      <p>${left}配的是能互相教的人。距离下次还有 ${escapeHtml(when)}。</p>
      <div class="pool-meter"><strong>${count}</strong> 人已进池</div>
    </article>
  `;
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
  applyUnlock(me?.unlock);
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
    renderMatchCarousel();
    return;
  }
  matchDeck.innerHTML = matches.map((item, index) => {
    const person = item.person;
    const tags = (item.shared_tags || person.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    const meta = [person.role, person.city, person.grade].filter(Boolean).join(' · ');
    if (index === 0 && item.unlocked) {
      return `
        <article class="match-card is-active" data-id="${person.id}" data-index="0">
          <div class="match-topline">
            <span class="match-number">第 ${item.rank || 1} 位</span>
            <span class="match-score"><strong>${item.score}%</strong> 匹配</span>
          </div>
          <div class="person-row">
            <div class="person-avatar tone-${escapeHtml(person.tone)}">${escapeHtml(person.letter)}</div>
            <div>
              <h2>${escapeHtml(person.name)}${person.boost_active ? '<span class="boost-badge">加急</span>' : ''}</h2>
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
    const lockedClass = item.unlocked ? 'is-unlocked' : 'is-locked';
    const lockTitle = index === 1 ? '发出第一封认识邮件' : '喊一个朋友来拼';
    const lockCopy = index === 1
      ? '联系第 1 位搭子后解锁，或开通拼拼卡直接查看'
      : '好友完成注册后解锁，或开通拼拼卡直接查看';
    return `
      <article class="match-card ${lockedClass}" data-id="${person.id}" data-index="${index}" data-unlocked="${item.unlocked ? '1' : '0'}" tabindex="0" role="button">
        <div class="locked-preview preview-${escapeHtml(person.tone)}">
          <span>${item.score}%</span>
          <div class="blur-avatar tone-${escapeHtml(person.tone)}">${escapeHtml(person.letter)}</div>
          <h2>${escapeHtml(person.name)}</h2>
          <p>${escapeHtml(person.role)}</p>
        </div>
        ${item.unlocked ? '' : `
          <div class="lock-copy">
            <div class="lock-icon" aria-hidden="true"></div>
            <h3>${lockTitle}</h3>
            <p>${lockCopy}</p>
            <button class="text-button pinpin-lock-button" type="button">开通拼拼卡直接查看</button>
          </div>
        `}
      </article>
    `;
  }).join('') || `<div class="empty-members">写下经历后即可生成匹配。</div>`;

  matchDeck.querySelectorAll('.contact-button').forEach((button) => {
    button.addEventListener('click', () => openContact(Number(button.dataset.id), button.dataset.name));
  });
  matchDeck.querySelectorAll('.pinpin-lock-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openPinpinSheet('more_matches');
    });
  });
  matchDeck.querySelectorAll('.match-card[data-id]').forEach((card) => {
    if (card.classList.contains('is-active')) return;
    const open = () => {
      if (card.dataset.unlocked === '1') openPersonDetail(Number(card.dataset.id));
      else openPinpinSheet('more_matches');
    };
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
      <span class="member-person"><i class="member-avatar tone-${escapeHtml(row.tone)}">${escapeHtml(row.letter)}</i><span><strong>${escapeHtml(row.name)}${row.boost_active ? '<span class="boost-badge">加急</span>' : ''}</strong><small>${escapeHtml(personMeta(row) || '方向待补充')}${row.same_city ? ' · 同城' : ''}</small></span></span>
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

function syncProFilters(filters) {
  filterOptions = filters || filterOptions;
  const pro = Boolean(filters?.pro || isPro());
  fillSelect(filterCity, filterOptions.cities || [], filterCity.value, '全部城市');
  fillSelect(filterGrade, filterOptions.grades || [], filterGrade.value, '全部年级');
  fillSelect(filterMajor, filterOptions.majors || [], filterMajor.value, '全部专业');
  proFilters.classList.toggle('is-locked', !pro);
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
  if (me) {
    me.unlock = data.unlock;
    if (data.quota) me.quota = data.quota;
  }
  renderQuota();
  renderMatches();
}

async function loadMembers() {
  memberRowsEl.innerHTML = '<div class="empty-members">加载中…</div>';
  const query = new URLSearchParams();
  if (memberSearch.value.trim()) query.set('q', memberSearch.value.trim());
  if (activeFilter && activeFilter !== '全部') query.set('tag', activeFilter);
  if (isPro()) {
    if (filterCity.value) query.set('city', filterCity.value);
    if (filterGrade.value) query.set('grade', filterGrade.value);
    if (filterMajor.value) query.set('major', filterMajor.value);
  }
  const data = await api(`/api/members?${query.toString()}`);
  members = data.members || [];
  if (data.quota) {
    me = me || {};
    me.quota = data.quota;
    renderQuota();
  }
  syncProFilters(data.filters);
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
  if (!me.user.profile_complete) {
    showProfile();
    return;
  }
  await loadMatches();
  showResults();
}

function showSecondMatchUnlocked(message) {
  renderMatches();
  openSheet(`
    <h2 id="sheetTitle">第 2 位已解锁</h2>
    <p>${escapeHtml(message)}</p>
    <button class="primary-button" id="viewSecondMatch" type="button"><span>先看看第 2 位匹配</span><span class="arrow">→</span></button>
  `);
  document.querySelector('#viewSecondMatch').addEventListener('click', () => {
    closeSheet();
    const card = matchDeck.querySelector('[data-index="1"]');
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.focus({ preventScroll: true });
  });
}

function openContact(id, name) {
  const match = matches.find((item) => item.person.id === id);
  const person = match?.person || {};
  const personName = name || person.name || '搭子';
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
      if (!result.sent) {
        await navigator.clipboard.writeText(body).catch(() => {});
        showSecondMatchUnlocked('邮件内容已复制。你可以稍后发送，先继续看看下一位匹配。');
      } else {
        showSecondMatchUnlocked('认识邮件已发出。先继续看看下一位匹配。');
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
    <h2 id="sheetTitle">${escapeHtml(person.name)}${person.boost_active ? '<span class="boost-badge">加急</span>' : ''}</h2>
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
    if (data.quota) {
      me = me || {};
      me.quota = data.quota;
      renderQuota();
    }
    if (data.paywall) {
      openPinpinSheet(data.reason || 'details_quota');
      return;
    }
    const person = data.person;
    const match = matches.find((item) => item.person.id === id);
    const extra = match
      ? `<p><strong>为什么匹配：</strong>${escapeHtml(match.reason)}</p>
         <button class="primary-button candidate-contact"><span>${contactCta(person, match.contacted)}</span><span class="arrow">→</span></button>`
      : `<button class="primary-button explore-match-button"><span>看看我们是否适合拼</span><span class="arrow">→</span></button>`;
    openSheet(personSheetHtml(person, extra));
    if (data.quota?.just_hit_limit && !isPro()) {
      showToast('今天的 20 个详情已看完，明天 21:00 后再看');
    }
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
      document.querySelector('#loginSubmitLabel').textContent = '验证并加入匹配池';
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
    await loadMatches();
    showResults();
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

document.querySelector('#brandButton').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
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
    ${isPro() ? '' : '<button class="text-button" id="openPinpinFromAccount" style="margin-top:12px;width:100%;">查看拼拼卡</button>'}
    ${me?.is_payment_admin ? '<button class="text-button" id="openPaymentReview" style="margin-top:12px;width:100%;">内测核账</button>' : ''}
    ${me?.is_data_admin ? '<button class="text-button" id="openImportConsole" style="margin-top:12px;width:100%;">资料同步</button>' : ''}
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
  document.querySelector('#openPinpinFromAccount')?.addEventListener('click', () => openPinpinSheet('more_matches'));
  document.querySelector('#openPaymentReview')?.addEventListener('click', () => { window.location.href = '/review'; });
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
        showLogin();
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

[filterCity, filterGrade, filterMajor].forEach((select) => {
  select.addEventListener('mousedown', (event) => {
    if (isPro()) return;
    event.preventDefault();
    openPinpinSheet('filter');
  });
  select.addEventListener('change', () => {
    if (isPro()) loadMembers();
  });
});

proFilters.addEventListener('click', () => {
  if (!isPro()) openPinpinSheet('filter');
});

pinpinButton.addEventListener('click', () => openPinpinSheet(isPro() ? 'generic' : 'generic'));

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
    showLogin();
  }
})();
