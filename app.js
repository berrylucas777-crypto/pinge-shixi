const loginView = document.querySelector('#loginView');
const resultsView = document.querySelector('#resultsView');
const loginForm = document.querySelector('#loginForm');
const needText = document.querySelector('#needText');
const personText = document.querySelector('#personText');
const contentConsent = document.querySelector('#contentConsent');
const formError = document.querySelector('#formError');
const avatarButton = document.querySelector('#avatarButton');
const infoSheet = document.querySelector('#infoSheet');
const sheetBackdrop = document.querySelector('#sheetBackdrop');
const sheetContent = document.querySelector('#sheetContent');
const toast = document.querySelector('#toast');
const demoUnlock = document.querySelector('#demoUnlock');
const matchesPanel = document.querySelector('#matchesPanel');
const explorePanel = document.querySelector('#explorePanel');
const matchesTab = document.querySelector('#matchesTab');
const exploreTab = document.querySelector('#exploreTab');
const memberSearch = document.querySelector('#memberSearch');
const memberRows = [...document.querySelectorAll('.member-row')];
const helpIntentButton = document.querySelector('#helpIntentButton');
const superIntentButton = document.querySelector('#superIntentButton');
const dashboardMatchEmpty = document.querySelector('#dashboardMatchEmpty');
const dashboardMatchLoading = document.querySelector('#dashboardMatchLoading');
const dashboardMatchReady = document.querySelector('#dashboardMatchReady');
const loadingMessage = document.querySelector('#loadingMessage');
const matchProgressBar = document.querySelector('#matchProgressBar');
const matchPercent = document.querySelector('#matchPercent');
const isDemoMode = new URLSearchParams(window.location.search).get('demo') === '1';
const firstMatchCard = document.querySelector('.match-card[data-index="0"]');
const listRegisterGate = document.querySelector('#listRegisterGate');
const seekerCount = document.querySelector('#seekerCount');
const exploreAllowance = document.querySelector('#exploreAllowance');
const matchAllowance = document.querySelector('#matchAllowance');
const exploreQuota = document.querySelector('#exploreQuota');
const rushCardButton = document.querySelector('#rushCardButton');
const matchRushButton = document.querySelector('#matchRushButton');
const matchEntitlementNote = document.querySelector('#matchEntitlementNote');
const advancedFilterButton = document.querySelector('#advancedFilterButton');
const rushMatchCards = [...document.querySelectorAll('.rush-match')];

let toastTimer;
let sheetTrigger;
let activeFilter = '全部';
let activeAdvancedFilters = { city: '全部', grade: '全部', major: '全部' };
let matchTimer;
let liveCountTimer;
const selectedIntakeTags = new Set();

function getNoonPeriodKey(date = new Date()) {
  const boundary = new Date(date);
  boundary.setHours(12, 0, 0, 0);
  if (date < boundary) boundary.setDate(boundary.getDate() - 1);
  return `${boundary.getFullYear()}-${String(boundary.getMonth() + 1).padStart(2, '0')}-${String(boundary.getDate()).padStart(2, '0')}`;
}

function ensureDailyState() {
  const period = getNoonPeriodKey();
  if (localStorage.getItem('pingo-daily-period') === period) return;
  localStorage.setItem('pingo-daily-period', period);
  localStorage.setItem('pingo-explore-viewed', '[]');
  localStorage.removeItem('pingo-rush-exposure-period');
  if (localStorage.getItem('pingo-match-period') && localStorage.getItem('pingo-match-period') !== period) {
    localStorage.removeItem('pingo-match-ready');
    localStorage.removeItem('pingo-email-sent');
    localStorage.removeItem('pingo-referral-complete');
  }
}

function hasRushCard() {
  return localStorage.getItem('pingo-rush-card') === '1';
}

function getExploreLimit() {
  return hasRushCard() ? 100 : 20;
}

function getViewedProfiles() {
  return new Set(getStoredList('pingo-explore-viewed'));
}

function syncOwnProfileMetadata() {
  ['#helperMemberCard', '#superMemberCard'].forEach((selector) => {
    const card = document.querySelector(selector);
    card.dataset.city = localStorage.getItem('pingo-city') || '';
    card.dataset.grade = localStorage.getItem('pingo-grade') || '';
    card.dataset.major = localStorage.getItem('pingo-major') || '';
  });
}

const legalDocuments = {
  terms: {
    title: '用户协议',
    body: `
      <p class="legal-status">当前为产品原型。运营主体、联系地址和生效日期须在正式上线前补充，并由中国大陆执业律师复核。</p>
      <h3>产品定位</h3><p>拼个实习提供同学之间的经历交流和联系撮合，不是招聘机构，也不提供录用、背调或能力认证。</p>
      <h3>用户责任</h3><p>用户应提交真实、合法且已脱敏的内容，不得伪造简历、冒用他人经历、骚扰诈骗，或上传雇主商业秘密和未公开资料。</p>
      <h3>公开资料</h3><p>完成注册后，你提供的昵称、经历、擅长方向和交流目标会进入“自由探索”，方便其他用户发现并联系你；平台不会在公开资料中展示学校或邮箱。</p>
      <h3>账号与服务</h3><p>平台可对违规内容采取隐藏、限制联系或停用账号等措施。付费服务的价格、有效期和退款规则应在购买前单独明示。</p>
    `,
  },
  privacy: {
    title: '隐私政策摘要',
    body: `
      <p class="legal-status">运营主体待正式上线前补充。本摘要不能替代上线版完整隐私政策。</p>
      <h3>必要信息</h3><p>邮箱用于注册、发送匹配结果和安全通知；经历、项目、标签和寻找目标用于生成匹配。未经双方同意，不向其他用户公开邮箱。</p>
      <h3>公开范围</h3><p>注册用户的昵称、经历、擅长方向和交流目标会用于匹配并展示在“自由探索”；学校和邮箱不会公开。活动邮件为独立可选授权，可随时关闭。</p>
      <h3>保存与删除</h3><p>正式上线前需明确各类数据的保存期限、第三方处理方、跨境情况和联系方式。用户应能撤回可选授权，并申请注销账号及删除数据。</p>
    `,
  },
  community: {
    title: '内容与社区规范',
    body: `
      <h3>鼓励</h3><p>交流岗位工作流、公开项目方法、求职准备和个人复盘；对不确定的信息清楚注明。</p>
      <h3>禁止</h3><p>伪造或买卖实习经历、代写简历、冒充他人；发布客户名单、内部数据、源代码、合同、账号凭证等保密信息；骚扰、歧视、诈骗或绕过平台安全机制。</p>
      <h3>处置</h3><p>用户可以举报或拉黑。平台应保留必要证据进行核查，并提供申诉渠道。</p>
    `,
  },
  algorithm: {
    title: 'AI 匹配说明',
    body: `
      <h3>主要依据</h3><p>匹配会参考项目方向、岗位兴趣、经验互补、交流目标和用户选择的标签，并生成便于理解的匹配理由。</p>
      <h3>它不代表什么</h3><p>匹配度只表示资料之间的相似与互补程度，不代表能力排名、经历真实性、背调结果、录用概率或平台推荐。</p>
      <h3>用户控制</h3><p>用户可以修改资料、举报异常结果或注销账号。正式版应提供人工反馈入口，并记录模型与规则版本。</p>
    `,
  },
  paid: {
    title: '加急卡规则',
    body: `
      <p class="legal-status">演示版不收费。正式收费前必须展示实际价格、有效期、权益范围、退款条件和客服渠道。</p>
      <h3>当前权益</h3><p>内测终身版包含每天查看 100 位成员详情、每天直接查看 5 位匹配对象，以及每天 1 次持续 24 小时的加急曝光。</p>
      <h3>权益边界</h3><p>加急曝光会以“加急卡”标识清楚展示，只增加曝光机会，不改变 AI 匹配分数，也不保证收到回复、获得面试、实习或 offer。</p>
    `,
  },
};

function getStoredList(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

function openLegalDocument(kind) {
  const legalDocument = legalDocuments[kind];
  if (!legalDocument) return;
  openSheet(`
    <h2 id="sheetTitle">${legalDocument.title}</h2>
    <div class="legal-document">${legalDocument.body}</div>
    <button class="sheet-secondary" data-open-legal-center>返回法律中心</button>
  `);
}

function openLegalCenter() {
  openSheet(`
    <h2 id="sheetTitle">法律与安全中心</h2>
    <p>把规则放在关键动作旁边，也集中放在这里方便随时查看。</p>
    <div class="legal-list">
      <button data-legal="terms">用户协议 <span>→</span></button>
      <button data-legal="privacy">隐私政策摘要 <span>→</span></button>
      <button data-legal="community">内容与社区规范 <span>→</span></button>
      <button data-legal="algorithm">AI 匹配说明 <span>→</span></button>
      <button data-legal="paid">加急卡规则 <span>→</span></button>
    </div>
    <p class="legal-status">运营主体待正式上线前补充。上线真实数据和收费功能前，应完成律师审核、隐私影响评估与数据授权留痕。</p>
  `);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2300);
}

function escapeHtml(value = '') {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
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

function updateEntitlementUI() {
  ensureDailyState();
  const rushActive = hasRushCard();
  const viewedCount = getViewedProfiles().size;
  const remaining = Math.max(0, getExploreLimit() - viewedCount);
  exploreAllowance.textContent = String(remaining);
  matchAllowance.textContent = rushActive ? '5' : '1';
  exploreQuota.textContent = `今日还可查看 ${remaining} 位成员详情 · 每天 12:00 刷新`;
  rushCardButton.classList.toggle('is-active', rushActive);
  rushCardButton.querySelector('strong').textContent = rushActive ? '加急卡已解锁' : '加急卡';
  rushCardButton.querySelector('small').textContent = rushActive ? '终身权益生效中' : '¥9.8 内测终身版';
  rushCardButton.querySelector('i').textContent = rushActive ? '权益详情 →' : '查看权益 →';
  advancedFilterButton.classList.toggle('is-unlocked', rushActive);
}

function applyRushCardState() {
  const rushActive = hasRushCard();
  dashboardMatchReady.classList.toggle('has-rush-card', rushActive);
  rushMatchCards.forEach((card) => card.classList.toggle('is-hidden', !rushActive));
  if (rushActive && isRegistered() && !dashboardMatchReady.classList.contains('is-hidden')) {
    [1, 2, 3, 4].forEach((index) => unlockCard(index, { instant: true }));
    markProgress('email');
    markProgress('invite');
  }
  const city = localStorage.getItem('pingo-city');
  matchEntitlementNote.querySelector('span').textContent = rushActive
    ? `今天已直接开放 5 位匹配${city ? `，已优先参考 ${city} 同城` : ''}`
    : `今天已为你找到 1 位直接匹配${city ? `，已优先参考 ${city} 同城` : ''}`;
  matchRushButton.classList.toggle('is-hidden', rushActive);
  updateEntitlementUI();
}

function startMockLiveBoard() {
  let count = 4286;
  seekerCount.textContent = count.toLocaleString('zh-CN');
  window.clearInterval(liveCountTimer);
  liveCountTimer = window.setInterval(() => {
    if (Math.random() > 0.42) count += 1;
    seekerCount.textContent = count.toLocaleString('zh-CN');
  }, 12000);
}

function activateRushCard() {
  localStorage.setItem('pingo-rush-card', '1');
  closeSheet();
  applyRushCardState();
  filterMembers();
  showToast('加急卡已解锁，终身权益已生效');
}

function openRushCardSheet(source = 'dashboard') {
  const rushActive = hasRushCard();
  openSheet(`
    <h2 id="sheetTitle">${rushActive ? '加急卡已生效' : '加急卡'}</h2>
    <p>${rushActive ? '你的内测终身权益正在生效，每天中午 12:00 自动刷新。' : '一次解锁，把更多时间留给真正值得认识的人。'}</p>
    <div class="rush-price"><strong>¥9.8</strong><span>内测终身版</span></div>
    <div class="rush-benefits">
      <div><strong>100</strong><span>每天查看成员详情</span></div>
      <div><strong>5</strong><span>每天直接匹配对象</span></div>
      <div><strong>1 次</strong><span>每天加急曝光 24 小时</span></div>
    </div>
    <p class="legal-status">演示版不会扣款。正式支付接入后，购买前会展示完整权益、退款规则和运营主体。</p>
    ${rushActive ? '<button class="primary-button" id="closeRushCard"><span>知道了</span><span class="arrow">→</span></button>' : `<button class="primary-button" id="activateRushCard"><span>${isRegistered() ? '演示解锁加急卡' : '注册后解锁加急卡'}</span><span class="arrow">→</span></button>`}
    <button class="sheet-secondary" data-legal="paid">查看加急卡规则</button>
  `);
  document.querySelector('#closeRushCard')?.addEventListener('click', closeSheet);
  document.querySelector('#activateRushCard')?.addEventListener('click', () => {
    if (!isRegistered()) {
      closeSheet();
      openRegistrationGate('rush');
      return;
    }
    activateRushCard();
  });
  infoSheet.dataset.source = source;
}

function openAdvancedFilters() {
  if (!isRegistered()) {
    openRegistrationGate('list');
    return;
  }
  if (!hasRushCard()) {
    openRushCardSheet('filters');
    return;
  }
  openSheet(`
    <h2 id="sheetTitle">精确筛选</h2>
    <p>按城市、年级和专业方向缩小范围。学校不会在公开列表中展示。</p>
    <label class="sheet-field-label" for="filterCity">城市</label>
    <select class="sheet-select" id="filterCity"><option>全部</option><option>上海</option><option>北京</option><option>杭州</option><option>南京</option><option>武汉</option><option>合肥</option><option>哈尔滨</option></select>
    <label class="sheet-field-label" for="filterGrade">年级</label>
    <select class="sheet-select" id="filterGrade"><option>全部</option><option>大三</option><option>大四</option><option>研一</option><option>研二</option></select>
    <label class="sheet-field-label" for="filterMajor">专业方向</label>
    <select class="sheet-select" id="filterMajor"><option>全部</option><option>计算机</option><option>软件工程</option><option>信息安全</option><option>信息管理</option><option>市场营销</option><option>工商管理</option><option>自动化</option><option>经济学</option></select>
    <button class="primary-button" id="applyAdvancedFilters"><span>应用筛选</span><span class="arrow">→</span></button>
    <button class="sheet-secondary" id="clearAdvancedFilters">清除精筛</button>
  `);
  document.querySelector('#filterCity').value = activeAdvancedFilters.city;
  document.querySelector('#filterGrade').value = activeAdvancedFilters.grade;
  document.querySelector('#filterMajor').value = activeAdvancedFilters.major;
  document.querySelector('#applyAdvancedFilters').addEventListener('click', () => {
    activeAdvancedFilters = {
      city: document.querySelector('#filterCity').value,
      grade: document.querySelector('#filterGrade').value,
      major: document.querySelector('#filterMajor').value,
    };
    closeSheet();
    filterMembers();
    const activeCount = Object.values(activeAdvancedFilters).filter((value) => value !== '全部').length;
    advancedFilterButton.firstChild.textContent = activeCount ? `精筛 ${activeCount} 项 ` : '城市 / 年级 / 专业 ';
  });
  document.querySelector('#clearAdvancedFilters').addEventListener('click', () => {
    activeAdvancedFilters = { city: '全部', grade: '全部', major: '全部' };
    closeSheet();
    advancedFilterButton.firstChild.textContent = '城市 / 年级 / 专业 ';
    filterMembers();
  });
}

function isRegistered() {
  return localStorage.getItem('pingo-matched') === '1' && Boolean(localStorage.getItem('pingo-email'));
}

function applyRegisteredState(email) {
  dismissOnboardingModal();
  avatarButton.classList.remove('is-hidden');
  avatarButton.textContent = email.trim().charAt(0).toUpperCase();
  firstMatchCard.classList.remove('is-gated');
  document.querySelector('#firstMatchGate')?.classList.add('is-hidden');
  document.querySelector('#registerProgress')?.classList.add('is-done');
  restoreUnlockState();
  restoreIntentCards();
  syncOwnProfileMetadata();
  applyRushCardState();
  filterMembers();
}

function openOnboarding() {
  if (!needText.value) needText.value = localStorage.getItem('pingo-need') || '';
  if (!personText.value) personText.value = localStorage.getItem('pingo-person') || '';
  loginView.classList.remove('is-hidden');
  document.body.style.overflow = 'hidden';
  window.setTimeout(() => needText.focus(), 100);
}

function dismissOnboardingModal() {
  loginView.classList.add('is-hidden');
  document.body.style.overflow = '';
}

function showMatchEmpty() {
  dashboardMatchEmpty.classList.remove('is-hidden');
  dashboardMatchLoading.classList.add('is-hidden');
  dashboardMatchReady.classList.add('is-hidden');
}

function showMatchReady() {
  dashboardMatchEmpty.classList.add('is-hidden');
  dashboardMatchLoading.classList.add('is-hidden');
  dashboardMatchReady.classList.remove('is-hidden');
  if (!isRegistered()) {
    firstMatchCard.classList.add('is-gated');
    document.querySelector('#firstMatchGate')?.classList.remove('is-hidden');
  }
  applyRushCardState();
}

function startMatching() {
  window.clearInterval(matchTimer);
  dismissOnboardingModal();
  dashboardMatchEmpty.classList.add('is-hidden');
  dashboardMatchReady.classList.add('is-hidden');
  dashboardMatchLoading.classList.remove('is-hidden');
  matchProgressBar.style.transform = 'scaleX(0)';
  matchPercent.textContent = '0%';
  setResultsView('matches');
  const startedAt = Date.now();
  const duration = 10000;
  const messages = [
    [0, '正在读取你的经历和项目'],
    [2400, '比对项目方向、岗位和擅长点'],
    [5000, '计算彼此可以交换的经验'],
    [7600, hasRushCard() ? '整理五位最合适的实习搭子' : '整理今天最合适的实习搭子'],
  ];
  matchTimer = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const progress = Math.min(100, Math.round((elapsed / duration) * 100));
    matchProgressBar.style.transform = `scaleX(${progress / 100})`;
    matchPercent.textContent = `${progress}%`;
    const currentMessage = [...messages].reverse().find(([time]) => elapsed >= time);
    if (currentMessage) loadingMessage.textContent = currentMessage[1];
    if (elapsed >= duration) {
      window.clearInterval(matchTimer);
      localStorage.setItem('pingo-match-ready', '1');
      localStorage.setItem('pingo-match-period', getNoonPeriodKey());
      showMatchReady();
      showToast(hasRushCard() ? '匹配完成，五位搭子已找到' : '今日匹配已找到');
    }
  }, 100);
}

function setResultsView(view) {
  const showMatches = view === 'matches';
  matchesPanel.classList.toggle('is-hidden', !showMatches);
  explorePanel.classList.toggle('is-hidden', showMatches);
  matchesTab.classList.toggle('is-selected', showMatches);
  exploreTab.classList.toggle('is-selected', !showMatches);
  matchesTab.setAttribute('aria-selected', String(showMatches));
  exploreTab.setAttribute('aria-selected', String(!showMatches));
}

function markProgress(step) {
  const progress = document.querySelector(`#${step}Progress`);
  const line = document.querySelector(`#${step}ProgressLine`);
  progress?.classList.add('is-done');
  line?.classList.add('is-done');
}

function unlockCard(index, options = {}) {
  const card = document.querySelector(`.match-card[data-index="${index}"]`);
  if (!card || card.classList.contains('is-unlocked')) return;
  card.classList.remove('is-locked');
  card.classList.add('is-unlocking');
  window.setTimeout(() => {
    card.classList.add('is-unlocked');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `查看第 ${index + 1} 位候选人详情`);
    if (options.focus) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      card.focus({ preventScroll: true });
    }
  }, options.instant ? 0 : 460);
}

function restoreUnlockState() {
  if (localStorage.getItem('pingo-email-sent') === '1') {
    unlockCard(1, { instant: true });
    markProgress('email');
  }
  if (localStorage.getItem('pingo-referral-complete') === '1') {
    unlockCard(2, { instant: true });
    markProgress('invite');
    showReferralComplete();
  }
}

function showReferralComplete() {
  const inviteStrip = document.querySelector('#inviteStrip');
  if (!inviteStrip || inviteStrip.dataset.complete === 'true') return;
  inviteStrip.dataset.complete = 'true';
  inviteStrip.innerHTML = `
    <div class="invite-visual" aria-hidden="true"><img src="assets/pingo-mascot.webp" alt=""></div>
    <div class="invite-copy"><h2>朋友来了，第 3 位搭子已解锁</h2><p>你们都获得了一位新的匹配。</p></div>
  `;
}

function publishIntentCard(type, topic, options = {}) {
  const isHelper = type === 'helper';
  const storagePrefix = isHelper ? 'pingo-helper' : 'pingo-super';
  const card = document.querySelector(isHelper ? '#helperMemberCard' : '#superMemberCard');
  const skill = document.querySelector(isHelper ? '#helperCardSkill' : '#superCardSkill');
  const tag = document.querySelector(isHelper ? '#helperCardTag' : '#superCardTag');
  const customTagElement = document.querySelector(isHelper ? '#helperCustomTag' : '#superCustomTag');
  const customTag = (options.customTag || '').trim();
  const content = (options.content || '').trim();
  if (!isHelper) {
    const table = document.querySelector('#memberTable');
    table.insertBefore(card, table.querySelector('.member-table-head').nextElementSibling);
  }
  card.dataset.published = 'true';
  card.dataset.tags = `${isHelper ? '帮助 求职 AI 产品 开发 增长' : '求大佬 求职 AI 产品 开发 增长'} ${topic} ${customTag}`.trim();
  skill.textContent = content || (isHelper ? `愿意免费分享：${topic}相关经验` : `正在寻找熟悉${topic}的同行指点`);
  tag.textContent = topic;
  customTagElement.textContent = customTag;
  customTagElement.classList.toggle('is-hidden', !customTag);
  card.classList.remove('is-hidden');
  localStorage.setItem(`${storagePrefix}-topic`, topic);
  localStorage.setItem(`${storagePrefix}-custom-tag`, customTag);
  localStorage.setItem(`${storagePrefix}-content`, content);
  const sourceButton = isHelper ? helpIntentButton : superIntentButton;
  sourceButton.querySelector('small').textContent = isHelper ? `已发布 · ${topic}` : `加急中 · ${topic}`;
  if (!options.silent) {
    activeFilter = '全部';
    memberSearch.value = '';
    document.querySelectorAll('.filter-chip').forEach((item) => item.classList.toggle('is-active', item.dataset.filter === '全部'));
    setResultsView('explore');
  }
  filterMembers();
  if (!options.silent) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(isHelper ? '纯帮助卡已发布' : options.updated ? '加急曝光内容已更新，结束时间不变' : '加急曝光已生效 24 小时');
  }
}

function restoreIntentCards() {
  const helperTopic = localStorage.getItem('pingo-helper-topic');
  const superTopic = localStorage.getItem('pingo-super-topic');
  if (helperTopic) publishIntentCard('helper', helperTopic, {
    silent: true,
    customTag: localStorage.getItem('pingo-helper-custom-tag') || '',
    content: localStorage.getItem('pingo-helper-content') || '',
  });
  if (superTopic) publishIntentCard('super', superTopic, {
    silent: true,
    customTag: localStorage.getItem('pingo-super-custom-tag') || '',
    content: localStorage.getItem('pingo-super-content') || '',
  });
}

function openIntentSheet(type) {
  const isHelper = type === 'helper';
  const exposureUsedToday = !isHelper && localStorage.getItem('pingo-rush-exposure-period') === getNoonPeriodKey();
  const storagePrefix = isHelper ? 'pingo-helper' : 'pingo-super';
  const topics = ['AI / 算法', '产品', '开发', '增长', '求职交流', '面试复盘'];
  const savedTopic = localStorage.getItem(`${storagePrefix}-topic`) || topics[0];
  const savedCustomTag = localStorage.getItem(`${storagePrefix}-custom-tag`) || '';
  const profileContent = localStorage.getItem(isHelper ? 'pingo-need' : 'pingo-person') || '';
  const savedContent = localStorage.getItem(`${storagePrefix}-content`) || profileContent;
  openSheet(`
    <h2 id="sheetTitle">${isHelper ? '发布纯帮助卡' : '发布加急曝光'}</h2>
    <p>${isHelper ? '即使经验不互补，也可以让有具体问题的人找到你。纯帮助不会占用你的匹配名额。' : '适合暂时没有经验可以交换、但问题足够具体的用户。加急卡会在自由探索顶部优先展示 24 小时。'}</p>
    ${isHelper ? '' : `<p class="super-sheet-note"><strong>${exposureUsedToday ? '今日加急曝光已使用。' : '今日 1 次加急曝光。'}</strong>${exposureUsedToday ? '可以编辑正在展示的内容，但不会重新计算 24 小时。' : '只增加展示机会，不会提高匹配分数，也不保证回复、实习或 offer。'}</p>`}
    <div class="sheet-choice-grid" role="group" aria-label="选择方向">
      ${topics.map((topic) => `<button class="sheet-choice${topic === savedTopic ? ' is-selected' : ''}" data-topic="${topic}">${topic}</button>`).join('')}
    </div>
    <label class="sheet-field-label" for="intentCustomTag">自定义标签 <span>选填</span></label>
    <input id="intentCustomTag" type="text" maxlength="16" placeholder="例如：保险科技、RAG、AIGC">
    <label class="sheet-field-label" for="intentContent">${isHelper ? '你愿意分享什么' : '你希望得到什么帮助'}</label>
    <textarea class="profile-textarea" id="intentContent" maxlength="300" placeholder="先把内容说具体，别人更容易判断是否能帮到你"></textarea>
    <p class="field-note">已自动带入你档案中的${isHelper ? '经历与项目' : '寻找目标'}，确认或修改后即可发布。</p>
    ${isHelper ? '' : '<label class="check-row" for="promotionAcknowledge"><input id="promotionAcknowledge" type="checkbox"><span>我知道这是带“推广”标识的曝光服务，不会提高匹配分数或保证求职结果。 <button type="button" class="inline-legal" data-legal="paid">查看规则</button></span></label>'}
    <p class="form-error" id="intentError" role="alert"></p>
    <button class="primary-button" id="publishIntent"><span>${isHelper ? '发布纯帮助卡' : exposureUsedToday ? '更新加急卡内容' : '确认加急 24 小时'}</span><span class="arrow">→</span></button>
  `);
  document.querySelector('#intentCustomTag').value = savedCustomTag;
  document.querySelector('#intentContent').value = savedContent;
  let selectedTopic = savedTopic;
  document.querySelectorAll('.sheet-choice').forEach((choice) => {
    choice.addEventListener('click', () => {
      selectedTopic = choice.dataset.topic;
      document.querySelectorAll('.sheet-choice').forEach((item) => item.classList.toggle('is-selected', item === choice));
    });
  });
  document.querySelector('#publishIntent').addEventListener('click', () => {
    const customTag = document.querySelector('#intentCustomTag').value.trim().replace(/^#/, '');
    const content = document.querySelector('#intentContent').value.trim();
    if (content !== '无' && content.length < 8) {
      document.querySelector('#intentError').textContent = '再具体写一点你的经历或希望交流的内容';
      document.querySelector('#intentContent').focus();
      return;
    }
    if (!isHelper && !document.querySelector('#promotionAcknowledge').checked) {
      document.querySelector('#intentError').textContent = '请先确认你已了解推广权益边界';
      return;
    }
    localStorage.setItem('pingo-public-profile', '1');
    if (!isHelper && !exposureUsedToday) localStorage.setItem('pingo-rush-exposure-period', getNoonPeriodKey());
    closeSheet();
    publishIntentCard(type, selectedTopic, { customTag, content, updated: exposureUsedToday });
  });
}

function openRegistrationGate(context = 'match') {
  const matchCopy = context === 'match' && localStorage.getItem('pingo-match-ready') === '1';
  const rushCopy = context === 'rush';
  openSheet(`
    <h2 id="sheetTitle">${rushCopy ? '先注册，再解锁加急卡' : matchCopy ? '注册后揭晓最高匹配' : '注册后查看完整名单'}</h2>
    <p>${rushCopy ? '注册用于保存终身权益和每日额度。演示版注册后会继续展示加急卡页面。' : matchCopy ? '三位搭子已经匹配完成。完成必要注册即可揭晓第一位，并开放完整名单。' : '当前可以浏览每个筛选的前三位成员。完成必要注册后即可查看完整名单。'}</p>
    <form id="registrationForm" novalidate>
      <label for="registrationEmail">邮箱</label>
      <input id="registrationEmail" type="email" autocomplete="email" placeholder="name@example.com" required>
      <label for="registrationInvite">邀请码 <span>选填</span></label>
      <input id="registrationInvite" type="text" autocomplete="off" placeholder="例如 PINGO-8K2M">
      <div class="consent-group">
        <h3>注册所必需</h3>
        <label class="check-row" for="requiredConsent"><input id="requiredConsent" type="checkbox"><span>我已满 18 周岁，同意资料进入“自由探索”，并同意<button type="button" class="inline-legal" data-legal="terms">《用户协议》</button><button type="button" class="inline-legal" data-legal="privacy">《隐私政策》</button><button type="button" class="inline-legal" data-legal="community">《社区规范》</button>。</span></label>
      </div>
      <div class="consent-group">
        <h3>可选授权 <em>默认不勾选，不影响注册</em></h3>
        <label class="check-row" for="marketingConsent"><input id="marketingConsent" type="checkbox"><span>接收每周匹配和活动邮件。</span></label>
      </div>
      <p class="form-error" id="registrationError" role="alert"></p>
      <button class="primary-button" type="submit"><span>注册并继续</span><span class="arrow">→</span></button>
    </form>
  `);
  document.querySelector('#registrationForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const emailInput = document.querySelector('#registrationEmail');
    const email = emailInput.value.trim();
    const error = document.querySelector('#registrationError');
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      error.textContent = '请输入可以接收匹配结果的邮箱';
      emailInput.focus();
      return;
    }
    if (!document.querySelector('#requiredConsent').checked) {
      error.textContent = '请确认已满 18 周岁并同意必要条款';
      return;
    }
    localStorage.setItem('pingo-email', email);
    localStorage.setItem('pingo-matched', '1');
    localStorage.setItem('pingo-consent-version', 'prototype-2026-08-26');
    localStorage.setItem('pingo-consent-at', new Date().toISOString());
    localStorage.setItem('pingo-public-profile', '1');
    localStorage.setItem('pingo-marketing', document.querySelector('#marketingConsent').checked ? '1' : '0');
    closeSheet();
    applyRegisteredState(email);
    if (localStorage.getItem('pingo-match-ready') === '1') showMatchReady();
    showToast(rushCopy ? '注册成功，可以解锁加急卡了' : matchCopy ? '注册成功，最高匹配已揭晓' : '注册成功，完整名单已开放');
    if (rushCopy) window.setTimeout(() => openRushCardSheet('registration'), 220);
  });
}

function openContactRequest(name, options = {}) {
  const draft = `Hi ${name}，\n\n我在「拼个实习」看到我们在项目方向和求职目标上比较匹配，想和你交换一下工作流、数据细节和面试准备经验。\n\n如果你愿意，我们可以先约 20 分钟线上聊聊。`;
  openSheet(`
    <h2 id="sheetTitle">向 ${name} 发联系请求</h2>
    <p>对方接受前，双方的邮箱和其他联系方式都不会公开。</p>
    <textarea class="email-draft" id="contactDraft" maxlength="600">${draft}</textarea>
    <p class="form-error" id="contactError" role="alert"></p>
    <button class="primary-button" id="sendContactRequest"><span>通过平台发送联系请求</span><span class="arrow">→</span></button>
  `);
  document.querySelector('#sendContactRequest').addEventListener('click', () => {
    const message = document.querySelector('#contactDraft').value.trim();
    if (message.length < 10) {
      document.querySelector('#contactError').textContent = '再多写一点，让对方知道为什么想认识';
      return;
    }
    const requests = getStoredList('pingo-contact-requests').filter((request) => request.name !== name);
    requests.push({ name, message, sentAt: new Date().toISOString() });
    localStorage.setItem('pingo-contact-requests', JSON.stringify(requests));
    if (options.unlockSecond) {
      localStorage.setItem('pingo-email-sent', '1');
      unlockCard(1, { focus: true });
      markProgress('email');
    }
    closeSheet();
    showToast(options.unlockSecond ? '联系请求已发送，第 2 位搭子已解锁' : '联系请求已发送，等待对方接受');
  });
}

function openReportSheet(name = '') {
  const target = name || '平台内容';
  const reasons = ['虚假经历', '骚扰诈骗', '泄露公司信息', '其他'];
  openSheet(`
    <h2 id="sheetTitle">举报或拉黑</h2>
    <p>针对“${target}”选择最接近的原因。演示版会在本机记录并隐藏该成员。</p>
    <div class="sheet-choice-grid" id="reportReasons">
      ${reasons.map((reason) => `<button class="sheet-choice" data-report-reason="${reason}">${reason}</button>`).join('')}
    </div>
    <p class="form-error" id="reportError" role="alert"></p>
    <div class="report-actions">
      <button class="sheet-secondary" id="submitReport">提交举报</button>
      ${name ? '<button class="danger-button" id="blockMember">拉黑并隐藏</button>' : ''}
    </div>
  `);
  let selectedReason = '';
  document.querySelectorAll('[data-report-reason]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedReason = button.dataset.reportReason;
      document.querySelectorAll('[data-report-reason]').forEach((item) => item.classList.toggle('is-selected', item === button));
    });
  });
  const saveReport = (block) => {
    if (!selectedReason && !block) {
      document.querySelector('#reportError').textContent = '请选择举报原因';
      return;
    }
    if (selectedReason) {
      const reports = getStoredList('pingo-reports');
      reports.push({ target, reason: selectedReason, createdAt: new Date().toISOString() });
      localStorage.setItem('pingo-reports', JSON.stringify(reports));
    }
    if (block && name) {
      const blocked = new Set(getStoredList('pingo-blocked-members'));
      blocked.add(name);
      localStorage.setItem('pingo-blocked-members', JSON.stringify([...blocked]));
    }
    closeSheet();
    filterMembers();
    showToast(block ? '已拉黑并隐藏该成员' : '举报已提交，感谢反馈');
  };
  document.querySelector('#submitReport').addEventListener('click', () => saveReport(false));
  document.querySelector('#blockMember')?.addEventListener('click', () => saveReport(true));
}

function openProfileSettings() {
  const settings = [
    ['pingo-marketing', '匹配与活动邮件', '接收每周匹配和产品活动通知'],
  ];
  openSheet(`
    <h2 id="sheetTitle">资料与授权</h2>
    <p>公开资料范围遵循用户协议；活动邮件可以随时关闭。</p>
    ${settings.map(([key, title, description]) => `
      <div class="profile-setting">
        <span><strong>${title}</strong><small>${description}</small></span>
        <button class="toggle${localStorage.getItem(key) === '1' ? ' is-on' : ''}" data-setting="${key}" role="switch" aria-checked="${localStorage.getItem(key) === '1'}" aria-label="${title}"></button>
      </div>
    `).join('')}
    <button class="danger-button" id="deleteAccountButton">注销并删除数据</button>
  `);
  document.querySelectorAll('[data-setting]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const enabled = !toggle.classList.contains('is-on');
      toggle.classList.toggle('is-on', enabled);
      toggle.setAttribute('aria-checked', String(enabled));
      localStorage.setItem(toggle.dataset.setting, enabled ? '1' : '0');
      showToast('授权设置已保存');
    });
  });
  document.querySelector('#deleteAccountButton').addEventListener('click', () => {
    openSheet(`
      <h2 id="sheetTitle">确认删除全部数据？</h2>
      <p>演示版会删除这台设备上的账号、经历、匹配、联系请求、授权和发布记录。正式版还需要向服务端提交删除请求并反馈处理结果。</p>
      <button class="danger-button" id="confirmDeleteAccount">确认注销并删除</button>
      <button class="sheet-secondary" id="cancelDeleteAccount">取消</button>
    `);
    document.querySelector('#confirmDeleteAccount').addEventListener('click', () => {
      Object.keys(localStorage).filter((key) => key.startsWith('pingo-')).forEach((key) => localStorage.removeItem(key));
      window.location.reload();
    });
    document.querySelector('#cancelDeleteAccount').addEventListener('click', openProfileSettings);
  });
}

function openProfileEditor() {
  const currentNeed = localStorage.getItem('pingo-need') || '';
  const currentPerson = localStorage.getItem('pingo-person') || '';
  const currentCity = localStorage.getItem('pingo-city') || '';
  const currentGrade = localStorage.getItem('pingo-grade') || '';
  const currentMajor = localStorage.getItem('pingo-major') || '';
  const currentSchool = localStorage.getItem('pingo-school') || '';
  openSheet(`
    <h2 id="sheetTitle">编辑我的档案</h2>
    <p>这两项会用于匹配、个人资料和发布帮助卡，更新后立即生效。</p>
    <form id="profileForm" novalidate>
      <label class="sheet-field-label" for="profileNeed">我的经历与项目</label>
      <textarea class="profile-textarea" id="profileNeed" maxlength="500" placeholder="填写你的经历、负责的项目和擅长的部分"></textarea>
      <label class="sheet-field-label" for="profilePerson">我想找的人 / 想学习的项目</label>
      <textarea class="profile-textarea" id="profilePerson" maxlength="500" placeholder="填写你想找什么样的人，以及想了解或学习的项目"></textarea>
      <div class="profile-detail-grid">
        <label for="profileCity"><span>所在城市</span><input id="profileCity" type="text" maxlength="20" placeholder="例如：上海"></label>
        <label for="profileGrade"><span>年级</span><select class="sheet-select" id="profileGrade"><option value="">暂不填写</option><option>大一</option><option>大二</option><option>大三</option><option>大四</option><option>研一</option><option>研二</option><option>研三</option><option>已毕业</option></select></label>
        <label for="profileMajor"><span>专业</span><input id="profileMajor" type="text" maxlength="30" placeholder="例如：计算机"></label>
        <label for="profileSchool"><span>学校 <em>仅用于私密匹配</em></span><input id="profileSchool" type="text" maxlength="40" placeholder="不会在公开资料展示"></label>
      </div>
      <p class="form-error" id="profileError" role="alert"></p>
      <button class="primary-button" type="submit"><span>保存我的档案</span><span class="arrow">→</span></button>
    </form>
  `);
  const profileNeed = document.querySelector('#profileNeed');
  const profilePerson = document.querySelector('#profilePerson');
  profileNeed.value = currentNeed;
  profilePerson.value = currentPerson;
  document.querySelector('#profileCity').value = currentCity;
  document.querySelector('#profileGrade').value = currentGrade;
  document.querySelector('#profileMajor').value = currentMajor;
  document.querySelector('#profileSchool').value = currentSchool;
  document.querySelector('#profileForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const need = profileNeed.value.trim();
    const person = profilePerson.value.trim();
    const error = document.querySelector('#profileError');
    if (need !== '无' && need.length < 8) {
      error.textContent = '请具体填写经历与项目；如果没有，可以填写“无”';
      profileNeed.focus();
      return;
    }
    if (person.length < 8) {
      error.textContent = '再具体说一点你想找的人或想学习的项目';
      profilePerson.focus();
      return;
    }
    localStorage.setItem('pingo-need', need);
    localStorage.setItem('pingo-person', person);
    localStorage.setItem('pingo-city', document.querySelector('#profileCity').value.trim());
    localStorage.setItem('pingo-grade', document.querySelector('#profileGrade').value);
    localStorage.setItem('pingo-major', document.querySelector('#profileMajor').value.trim());
    localStorage.setItem('pingo-school', document.querySelector('#profileSchool').value.trim());
    needText.value = need;
    personText.value = person;
    syncOwnProfileMetadata();

    const helperTopic = localStorage.getItem('pingo-helper-topic');
    const helperContent = localStorage.getItem('pingo-helper-content');
    if (helperTopic && (!helperContent || helperContent === currentNeed)) {
      publishIntentCard('helper', helperTopic, {
        silent: true,
        customTag: localStorage.getItem('pingo-helper-custom-tag') || '',
        content: need,
      });
    }
    const superTopic = localStorage.getItem('pingo-super-topic');
    const superContent = localStorage.getItem('pingo-super-content');
    if (superTopic && (!superContent || superContent === currentPerson)) {
      publishIntentCard('super', superTopic, {
        silent: true,
        customTag: localStorage.getItem('pingo-super-custom-tag') || '',
        content: person,
      });
    }

    closeSheet();
    applyRushCardState();
    filterMembers();
    showToast('个人档案已更新');
  });
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const need = needText.value.trim();
  const person = personText.value.trim();
  if (need !== '无' && need.length < 8) {
    formError.textContent = '请具体填写经历和项目经历；如果没有，可以填写“无”';
    needText.setAttribute('aria-invalid', 'true');
    needText.focus();
    return;
  }
  if (person.length < 8) {
    formError.textContent = '再具体说一点你想找什么样的人';
    personText.setAttribute('aria-invalid', 'true');
    personText.focus();
    return;
  }
  if (!contentConsent.checked) {
    formError.textContent = '请先确认经历已脱敏且内容合法';
    contentConsent.focus();
    return;
  }
  formError.textContent = '';
  needText.removeAttribute('aria-invalid');
  personText.removeAttribute('aria-invalid');
  localStorage.setItem('pingo-need', need);
  localStorage.setItem('pingo-person', person);
  localStorage.setItem('pingo-intake-tags', JSON.stringify([...selectedIntakeTags]));
  localStorage.setItem('pingo-content-consent-version', 'prototype-2026-08-26');
  localStorage.setItem('pingo-content-consent-at', new Date().toISOString());
  startMatching();
});

needText.addEventListener('input', () => {
  formError.textContent = '';
  needText.removeAttribute('aria-invalid');
});
personText.addEventListener('input', () => {
  formError.textContent = '';
  personText.removeAttribute('aria-invalid');
});
contentConsent.addEventListener('change', () => {
  if (contentConsent.checked) formError.textContent = '';
});
document.querySelectorAll('#intakeTags button').forEach((button) => {
  button.addEventListener('click', () => {
    const tag = button.dataset.tag;
    if (selectedIntakeTags.has(tag)) selectedIntakeTags.delete(tag);
    else selectedIntakeTags.add(tag);
    button.classList.toggle('is-selected', selectedIntakeTags.has(tag));
  });
});

document.querySelector('#brandButton').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
document.querySelector('#onboardingDismiss').addEventListener('click', dismissOnboardingModal);
document.querySelector('#dashboardStartButton').addEventListener('click', openOnboarding);
document.querySelector('#firstMatchGate').addEventListener('click', () => openRegistrationGate('match'));
listRegisterGate.addEventListener('click', () => openRegistrationGate('list'));
matchesTab.addEventListener('click', () => setResultsView('matches'));
exploreTab.addEventListener('click', () => setResultsView('explore'));
helpIntentButton.addEventListener('click', () => isRegistered() ? openIntentSheet('helper') : openRegistrationGate('list'));
superIntentButton.addEventListener('click', () => {
  if (!isRegistered()) openRegistrationGate('rush');
  else if (!hasRushCard()) openRushCardSheet('exposure');
  else openIntentSheet('super');
});
rushCardButton.addEventListener('click', () => openRushCardSheet('dashboard'));
matchRushButton.addEventListener('click', () => openRushCardSheet('matches'));
advancedFilterButton.addEventListener('click', openAdvancedFilters);

document.querySelector('#aboutButton').addEventListener('click', () => {
  openSheet(`
    <h2 id="sheetTitle">三步找到实习搭子</h2>
    <p>匹配不只看岗位名，更看你们正在做什么、彼此能补上什么。</p>
    <ol>
      <li><div><strong>先写两句话</strong><br><span>填写你的经历、项目经历，以及你想找什么样的人，不需要先注册。</span></div></li>
      <li><div><strong>等待约 10 秒</strong><br><span>从现有名单中比对方向、经历和可以交换的经验。</span></div></li>
      <li><div><strong>注册揭晓第一位</strong><br><span>最高匹配先以蒙版展示，注册后查看完整资料。</span></div></li>
    </ol>
    <p>当前页面使用演示数据，正式版本会接入真实匹配 API。</p>
  `);
});

document.querySelector('#legalCenterButton').addEventListener('click', openLegalCenter);
document.querySelector('#privacyButton').addEventListener('click', () => openLegalDocument('privacy'));
document.querySelector('#reportButton').addEventListener('click', () => openReportSheet());

avatarButton.addEventListener('click', () => {
  const email = localStorage.getItem('pingo-email') || '当前用户';
  const profileNeed = localStorage.getItem('pingo-need') || '还没有填写经历与项目';
  const profilePerson = localStorage.getItem('pingo-person') || '还没有填写寻找目标';
  const profileMeta = [localStorage.getItem('pingo-city'), localStorage.getItem('pingo-grade'), localStorage.getItem('pingo-major')].filter(Boolean).join(' · ') || '城市、年级和专业尚未补充';
  const privateSchool = localStorage.getItem('pingo-school') || '尚未填写';
  const demoReset = isDemoMode
    ? '<button class="demo-unlock account-reset" id="resetMatchButton">重新体验匹配流程</button>'
    : '';
  openSheet(`
    <h2 id="sheetTitle">我的档案</h2>
    <p class="account-email">${escapeHtml(email)}</p>
    <div class="profile-summary">
      <section><span>基础信息</span><p>${escapeHtml(profileMeta)}</p></section>
      <section><span>我的经历与项目</span><p>${escapeHtml(profileNeed)}</p></section>
      <section><span>我想找的人 / 想学习的项目</span><p>${escapeHtml(profilePerson)}</p></section>
      <section class="private-profile"><span>学校 · 仅用于私密匹配</span><p>${escapeHtml(privateSchool)}</p></section>
    </div>
    <button class="primary-button" id="profileEditButton"><span>编辑我的档案</span><span class="arrow">→</span></button>
    <button class="sheet-secondary" id="profileSettingsButton">通知与账户设置</button>
    <button class="sheet-secondary" id="legalSettingsButton">法律与安全中心</button>
    ${demoReset}
  `);
  document.querySelector('#profileEditButton').addEventListener('click', openProfileEditor);
  document.querySelector('#profileSettingsButton').addEventListener('click', openProfileSettings);
  document.querySelector('#legalSettingsButton').addEventListener('click', openLegalCenter);
  document.querySelector('#resetMatchButton')?.addEventListener('click', () => {
    Object.keys(localStorage).filter((key) => key.startsWith('pingo-')).forEach((key) => localStorage.removeItem(key));
    window.location.reload();
  });
});

document.querySelectorAll('.contact-button').forEach((button) => {
  button.addEventListener('click', () => openContactRequest(button.dataset.name, { unlockSecond: true }));
});

document.querySelector('#shareButton').addEventListener('click', async () => {
  const code = document.querySelector('#referralCode').textContent;
  const shareData = {
    title: '来拼个实习搭子',
    text: `我在「拼个实习」找到了很合适的同行，使用邀请码 ${code} 查看你的匹配。`,
    url: window.location.href,
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

if (isDemoMode) {
  demoUnlock.classList.remove('is-hidden');
}

demoUnlock.addEventListener('click', () => {
  localStorage.setItem('pingo-referral-complete', '1');
  unlockCard(2, { focus: true });
  markProgress('invite');
  showReferralComplete();
  showToast('好友已注册，第 3 位搭子已解锁');
});

function filterMembers() {
  const query = memberSearch.value.trim().toLowerCase();
  const registered = isRegistered();
  const blockedMembers = new Set(getStoredList('pingo-blocked-members'));
  const matchedRows = [];
  memberRows.forEach((row) => {
    if (blockedMembers.has(row.dataset.name)) {
      row.classList.add('is-hidden');
      return;
    }
    if (row.classList.contains('intent-member-row') && row.dataset.published !== 'true') {
      row.classList.add('is-hidden');
      return;
    }
    if (row.classList.contains('intent-member-row') && localStorage.getItem('pingo-public-profile') !== '1') {
      row.classList.add('is-hidden');
      return;
    }
    const haystack = `${row.textContent} ${row.dataset.tags}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesFilter = activeFilter === '全部' || row.dataset.tags.includes(activeFilter);
    const matchesCity = activeAdvancedFilters.city === '全部' || row.dataset.city === activeAdvancedFilters.city;
    const matchesGrade = activeAdvancedFilters.grade === '全部' || row.dataset.grade === activeAdvancedFilters.grade;
    const matchesMajor = activeAdvancedFilters.major === '全部' || row.dataset.major === activeAdvancedFilters.major;
    if (matchesQuery && matchesFilter && matchesCity && matchesGrade && matchesMajor) matchedRows.push(row);
    else row.classList.add('is-hidden');
  });
  matchedRows.forEach((row, index) => row.classList.toggle('is-hidden', !registered && index >= 3));
  listRegisterGate.classList.toggle('is-hidden', registered || matchedRows.length <= 3);
  document.querySelector('#emptyMembers').classList.toggle('is-hidden', matchedRows.length > 0);
}

memberSearch.addEventListener('input', filterMembers);
document.querySelectorAll('.filter-chip[data-filter]').forEach((chip) => {
  chip.addEventListener('click', () => {
    activeFilter = chip.dataset.filter;
    document.querySelectorAll('.filter-chip[data-filter]').forEach((item) => item.classList.toggle('is-active', item === chip));
    filterMembers();
  });
});

memberRows.forEach((row) => {
  row.addEventListener('click', () => {
    if (!isRegistered()) {
      openRegistrationGate('list');
      return;
    }
    const name = row.dataset.name;
    if (!name.startsWith('我的')) {
      const viewedProfiles = getViewedProfiles();
      if (!viewedProfiles.has(name) && viewedProfiles.size >= getExploreLimit()) {
        openRushCardSheet('explore-limit');
        return;
      }
      viewedProfiles.add(name);
      localStorage.setItem('pingo-explore-viewed', JSON.stringify([...viewedProfiles]));
      updateEntitlementUI();
    }
    const skill = row.querySelector('.member-skill').textContent;
    const tags = [...row.querySelectorAll('.member-tags i')].map((tag) => tag.textContent).join(' · ');
    openSheet(`
      <h2 id="sheetTitle">${name}</h2>
      <p><strong>擅长：</strong>${skill}</p>
      <p><strong>方向：</strong>${tags}</p>
      ${name.startsWith('我的') ? '<p class="legal-status">这是你主动发布的公开卡片。</p>' : '<button class="primary-button member-contact-button"><span>发送联系请求</span><span class="arrow">→</span></button><button class="sheet-secondary member-report-button">举报或拉黑</button>'}
    `);
    document.querySelector('.member-contact-button')?.addEventListener('click', () => openContactRequest(name));
    document.querySelector('.member-report-button')?.addEventListener('click', () => openReportSheet(name));
  });
});

const candidateDetails = {
  1: { name: '小陈同学', role: 'AI 产品实习生 · 北京', reason: '她擅长从客户访谈拆解产品需求，你能补上模型能力边界和工程交付流程。', exchange: '需求优先级、客户沟通、AI 产品面试复盘。' },
  2: { name: '一一', role: '推荐算法实习生 · 杭州', reason: '她在做内容推荐与特征工程，与你的多模态理解和 ToB 数据闭环经验互补。', exchange: '召回与排序实验、特征工程、离线评测设计。' },
  3: { name: '小林', role: 'Agent 全栈实习生 · 上海', reason: '他熟悉 Agent 工作流和 RAG 工程，能够与你交换从模型能力到产品交付的完整链路。', exchange: 'Agent 编排、RAG 评测、全栈工程落地。' },
  4: { name: '小雨', role: '增长产品实习生 · 南京', reason: '她擅长商业化和增长实验，可以补充你的 AI 产品在获客与转化侧的经验。', exchange: '增长实验、数据分析、商业化策略。' },
};

document.querySelectorAll('.match-card.is-locked').forEach((card) => {
  const openCandidate = () => {
    if (card.classList.contains('is-unlocked')) {
      const candidate = candidateDetails[card.dataset.index];
      if (!candidate) return;
      openSheet(`
        <h2 id="sheetTitle">${candidate.name}</h2>
        <p>${candidate.role}</p>
        <p><strong>为什么匹配：</strong>${candidate.reason}</p>
        <p><strong>可以交换：</strong>${candidate.exchange}</p>
        <button class="primary-button candidate-contact" data-name="${candidate.name}"><span>发送联系请求</span><span class="arrow">→</span></button>
        <button class="sheet-secondary candidate-report">举报或拉黑</button>
      `);
      document.querySelector('.candidate-contact').addEventListener('click', () => openContactRequest(candidate.name));
      document.querySelector('.candidate-report').addEventListener('click', () => openReportSheet(candidate.name));
    }
  };
  card.addEventListener('click', openCandidate);
  card.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && card.classList.contains('is-unlocked')) {
      event.preventDefault();
      openCandidate();
    }
  });
});

document.querySelector('#closeSheet').addEventListener('click', closeSheet);
sheetBackdrop.addEventListener('click', closeSheet);
sheetContent.addEventListener('click', (event) => {
  const legalButton = event.target.closest('[data-legal]');
  if (legalButton) {
    event.preventDefault();
    openLegalDocument(legalButton.dataset.legal);
    return;
  }
  if (event.target.closest('[data-open-legal-center]')) openLegalCenter();
});
document.addEventListener('click', (event) => {
  const legalButton = event.target.closest('[data-legal]');
  if (legalButton && !sheetContent.contains(legalButton)) {
    event.preventDefault();
    openLegalDocument(legalButton.dataset.legal);
  }
});
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

if (isDemoMode) {
  Object.keys(localStorage).filter((key) => key.startsWith('pingo-')).forEach((key) => localStorage.removeItem(key));
}

ensureDailyState();
startMockLiveBoard();
syncOwnProfileMetadata();
updateEntitlementUI();

const savedEmail = localStorage.getItem('pingo-email');
if (isRegistered() && savedEmail) {
  applyRegisteredState(savedEmail);
  if (localStorage.getItem('pingo-match-ready') === '1') showMatchReady();
  else showMatchEmpty();
} else {
  avatarButton.classList.add('is-hidden');
  if (localStorage.getItem('pingo-match-ready') === '1') showMatchReady();
  else showMatchEmpty();
  filterMembers();
  openOnboarding();
}
