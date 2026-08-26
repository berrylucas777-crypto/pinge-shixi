const loginView = document.querySelector('#loginView');
const onboardingView = document.querySelector('#onboardingView');
const resultsView = document.querySelector('#resultsView');
const loginForm = document.querySelector('#loginForm');
const emailInput = document.querySelector('#email');
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
const matchReadyState = document.querySelector('#matchReadyState');
const matchLoadingState = document.querySelector('#matchLoadingState');
const matchSuccessState = document.querySelector('#matchSuccessState');
const loadingMessage = document.querySelector('#loadingMessage');
const matchProgressBar = document.querySelector('#matchProgressBar');
const matchPercent = document.querySelector('#matchPercent');
const isDemoMode = new URLSearchParams(window.location.search).get('demo') === '1';

let toastTimer;
let sheetTrigger;
let activeFilter = '全部';
let matchTimer;

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

function showResults(email) {
  loginView.classList.add('is-hidden');
  onboardingView.classList.add('is-hidden');
  resultsView.classList.remove('is-hidden');
  avatarButton.classList.remove('is-hidden');
  avatarButton.textContent = email.trim().charAt(0).toUpperCase();
  restoreUnlockState();
  restoreIntentCards();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showOnboarding(email) {
  loginView.classList.add('is-hidden');
  resultsView.classList.add('is-hidden');
  onboardingView.classList.remove('is-hidden');
  onboardingView.classList.remove('is-matching', 'is-complete');
  matchReadyState.classList.remove('is-hidden');
  matchLoadingState.classList.add('is-hidden');
  matchSuccessState.classList.add('is-hidden');
  matchProgressBar.style.width = '0%';
  matchPercent.textContent = '0%';
  avatarButton.classList.remove('is-hidden');
  avatarButton.textContent = email.trim().charAt(0).toUpperCase();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startMatching() {
  window.clearInterval(matchTimer);
  matchReadyState.classList.add('is-hidden');
  matchSuccessState.classList.add('is-hidden');
  matchLoadingState.classList.remove('is-hidden');
  onboardingView.classList.add('is-matching');
  const startedAt = Date.now();
  const duration = 10000;
  const messages = [
    [0, '正在读取你的方向'],
    [2400, '比对学校、岗位和擅长点'],
    [5000, '计算彼此可以交换的经验'],
    [7600, '整理三位最合适的实习搭子'],
  ];
  matchTimer = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const progress = Math.min(100, Math.round((elapsed / duration) * 100));
    matchProgressBar.style.width = `${progress}%`;
    matchPercent.textContent = `${progress}%`;
    const currentMessage = [...messages].reverse().find(([time]) => elapsed >= time);
    if (currentMessage) loadingMessage.textContent = currentMessage[1];
    if (elapsed >= duration) {
      window.clearInterval(matchTimer);
      localStorage.setItem('pingo-matched', '1');
      matchLoadingState.classList.add('is-hidden');
      matchSuccessState.classList.remove('is-hidden');
      onboardingView.classList.remove('is-matching');
      onboardingView.classList.add('is-complete');
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
  const card = document.querySelector(isHelper ? '#helperMemberCard' : '#superMemberCard');
  const skill = document.querySelector(isHelper ? '#helperCardSkill' : '#superCardSkill');
  const tag = document.querySelector(isHelper ? '#helperCardTag' : '#superCardTag');
  if (!isHelper) {
    const table = document.querySelector('#memberTable');
    table.insertBefore(card, table.querySelector('.member-table-head').nextElementSibling);
  }
  card.dataset.published = 'true';
  card.dataset.tags = `${card.dataset.tags} ${topic}`;
  skill.textContent = isHelper ? `愿意免费分享：${topic}相关经验` : `正在寻找熟悉${topic}的同行指点`;
  tag.textContent = topic;
  card.classList.remove('is-hidden');
  localStorage.setItem(isHelper ? 'pingo-helper-topic' : 'pingo-super-topic', topic);
  const sourceButton = isHelper ? helpIntentButton : superIntentButton;
  sourceButton.querySelector('small').textContent = isHelper ? `已发布 · ${topic}` : `曝光中 · ${topic}`;
  if (!options.silent) {
    activeFilter = '全部';
    memberSearch.value = '';
    document.querySelectorAll('.filter-chip').forEach((item) => item.classList.toggle('is-active', item.dataset.filter === '全部'));
    setResultsView('explore');
  }
  filterMembers();
  if (!options.silent) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(isHelper ? '纯帮助卡已发布' : '超级卡已置顶曝光 24 小时');
  }
}

function restoreIntentCards() {
  const helperTopic = localStorage.getItem('pingo-helper-topic');
  const superTopic = localStorage.getItem('pingo-super-topic');
  if (helperTopic) publishIntentCard('helper', helperTopic, { silent: true });
  if (superTopic) publishIntentCard('super', superTopic, { silent: true });
}

function openIntentSheet(type) {
  const isHelper = type === 'helper';
  const topics = ['AI / 算法', '产品', '开发', '增长', '求职交流', '面试复盘'];
  const savedTopic = localStorage.getItem(isHelper ? 'pingo-helper-topic' : 'pingo-super-topic') || topics[0];
  openSheet(`
    <h2 id="sheetTitle">${isHelper ? '发布纯帮助卡' : '生成一张超级卡'}</h2>
    <p>${isHelper ? '即使经验不互补，也可以让有具体问题的人找到你。纯帮助不会占用你的三位匹配名额。' : '适合暂时没有经验可以交换、但问题足够具体的用户。超级卡会在自由探索顶部优先展示 24 小时。'}</p>
    ${isHelper ? '' : '<p class="super-sheet-note">演示版直接生成。正式机制可以设置每人 1 次免费体验，后续通过邀请或付费获得新的曝光次数。</p>'}
    <div class="sheet-choice-grid" role="group" aria-label="选择方向">
      ${topics.map((topic) => `<button class="sheet-choice${topic === savedTopic ? ' is-selected' : ''}" data-topic="${topic}">${topic}</button>`).join('')}
    </div>
    <button class="primary-button" id="publishIntent"><span>${isHelper ? '发布纯帮助卡' : '生成超级卡'}</span><span class="arrow">→</span></button>
  `);
  let selectedTopic = savedTopic;
  document.querySelectorAll('.sheet-choice').forEach((choice) => {
    choice.addEventListener('click', () => {
      selectedTopic = choice.dataset.topic;
      document.querySelectorAll('.sheet-choice').forEach((item) => item.classList.toggle('is-selected', item === choice));
    });
  });
  document.querySelector('#publishIntent').addEventListener('click', () => {
    closeSheet();
    publishIntentCard(type, selectedTopic);
  });
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    formError.textContent = '请输入可以接收匹配邮件的邮箱';
    emailInput.setAttribute('aria-invalid', 'true');
    emailInput.focus();
    return;
  }
  formError.textContent = '';
  emailInput.removeAttribute('aria-invalid');
  localStorage.setItem('pingo-email', email);
  showOnboarding(email);
});

emailInput.addEventListener('input', () => {
  formError.textContent = '';
  emailInput.removeAttribute('aria-invalid');
});

document.querySelector('#brandButton').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
document.querySelector('#startMatchButton').addEventListener('click', startMatching);
document.querySelector('#viewMatchesButton').addEventListener('click', () => {
  const email = localStorage.getItem('pingo-email') || '当前用户';
  showResults(email);
});
matchesTab.addEventListener('click', () => setResultsView('matches'));
exploreTab.addEventListener('click', () => setResultsView('explore'));
helpIntentButton.addEventListener('click', () => openIntentSheet('helper'));
superIntentButton.addEventListener('click', () => openIntentSheet('super'));

document.querySelector('#aboutButton').addEventListener('click', () => {
  openSheet(`
    <h2 id="sheetTitle">三步找到实习搭子</h2>
    <p>匹配不只看岗位名，更看你们正在做什么、彼此能补上什么。</p>
    <ol>
      <li><div><strong>留下你的方向</strong><br><span>从群聊介绍或个人资料里提取岗位、项目与目标。</span></div></li>
      <li><div><strong>等待约 10 秒</strong><br><span>从现有名单中比对学校、方向和可以交换的经验。</span></div></li>
      <li><div><strong>完成两个小动作</strong><br><span>发出第一封邮件解锁第 2 位，邀请好友注册解锁第 3 位。</span></div></li>
    </ol>
    <p>当前页面使用演示数据，正式版本会接入真实匹配 API。</p>
  `);
});

document.querySelector('#privacyButton').addEventListener('click', () => {
  openSheet(`
    <h2 id="sheetTitle">隐私说明</h2>
    <p>你的邮箱和自我介绍只用于生成匹配、发送结果与建立联系。正式上线前应补充数据保存期限、删除入口和用户授权范围。</p>
    <p>群聊内容在导入匹配系统前，应获得必要授权并移除不参与用户的联系方式等敏感信息。</p>
  `);
});

avatarButton.addEventListener('click', () => {
  const email = localStorage.getItem('pingo-email') || '当前用户';
  const demoReset = isDemoMode
    ? '<button class="demo-unlock account-reset" id="resetMatchButton">重新体验匹配流程</button>'
    : '';
  openSheet(`
    <h2 id="sheetTitle">${email}</h2>
    <p>注册后可以查看自由探索列表。发出第一封认识邮件解锁第 2 位，邀请一位朋友注册解锁第 3 位。</p>
    <button class="primary-button" id="logoutButton"><span>退出演示账户</span><span class="arrow">→</span></button>
    ${demoReset}
  `);
  document.querySelector('#logoutButton').addEventListener('click', () => {
    localStorage.removeItem('pingo-email');
    localStorage.removeItem('pingo-email-sent');
    localStorage.removeItem('pingo-referral-complete');
    localStorage.removeItem('pingo-helper-topic');
    localStorage.removeItem('pingo-super-topic');
    localStorage.removeItem('pingo-matched');
    window.clearInterval(matchTimer);
    closeSheet();
    resultsView.classList.add('is-hidden');
    onboardingView.classList.add('is-hidden');
    loginView.classList.remove('is-hidden');
    avatarButton.classList.add('is-hidden');
  });
  document.querySelector('#resetMatchButton')?.addEventListener('click', () => {
    localStorage.removeItem('pingo-matched');
    window.clearInterval(matchTimer);
    closeSheet();
    showOnboarding(email);
  });
});

document.querySelectorAll('.contact-button').forEach((button) => {
  button.addEventListener('click', () => {
    const name = button.dataset.name;
    const draft = `Hi ${name}，\n\n我在「拼个实习」看到我们在 ToB AI 项目和求职方向上很匹配。我的项目主要是为保险公司提供 AI 营销服务，很想和你交换一下工作流、数据细节和面试准备经验。\n\n如果你愿意，我们可以先约 20 分钟线上聊聊。`;
    openSheet(`
      <h2 id="sheetTitle">先发一封不尴尬的邮件</h2>
      <p>已经根据你们的共同点写好开场，你可以直接修改。</p>
      <textarea class="email-draft" id="emailDraft">${draft}</textarea>
      <button class="primary-button" id="copyEmail"><span>复制邮件并解锁第 2 位</span><span class="arrow">→</span></button>
    `);
    document.querySelector('#copyEmail').addEventListener('click', async () => {
      await navigator.clipboard.writeText(document.querySelector('#emailDraft').value);
      localStorage.setItem('pingo-email-sent', '1');
      closeSheet();
      unlockCard(1, { focus: true });
      markProgress('email');
      showToast('邮件已复制，第 2 位搭子已解锁');
    });
  });
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
  let visibleCount = 0;
  memberRows.forEach((row) => {
    if (row.classList.contains('intent-member-row') && row.dataset.published !== 'true') {
      row.classList.add('is-hidden');
      return;
    }
    const haystack = `${row.textContent} ${row.dataset.tags}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesFilter = activeFilter === '全部' || row.dataset.tags.includes(activeFilter);
    const visible = matchesQuery && matchesFilter;
    row.classList.toggle('is-hidden', !visible);
    if (visible) visibleCount += 1;
  });
  document.querySelector('#emptyMembers').classList.toggle('is-hidden', visibleCount > 0);
}

memberSearch.addEventListener('input', filterMembers);
document.querySelectorAll('.filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    activeFilter = chip.dataset.filter;
    document.querySelectorAll('.filter-chip').forEach((item) => item.classList.toggle('is-active', item === chip));
    filterMembers();
  });
});

memberRows.forEach((row) => {
  row.addEventListener('click', () => {
    const name = row.dataset.name;
    const school = row.querySelector('.member-person small').textContent;
    const skill = row.querySelector('.member-skill').textContent;
    const tags = [...row.querySelectorAll('.member-tags i')].map((tag) => tag.textContent).join(' · ');
    openSheet(`
      <h2 id="sheetTitle">${name}</h2>
      <p>${school}</p>
      <p><strong>擅长：</strong>${skill}</p>
      <p><strong>方向：</strong>${tags}</p>
      <button class="primary-button explore-match-button"><span>看看我们是否适合拼</span><span class="arrow">→</span></button>
    `);
    document.querySelector('.explore-match-button').addEventListener('click', () => {
      closeSheet();
      setResultsView('matches');
      document.querySelector('#matchDeck').scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('已加入下一轮匹配偏好');
    });
  });
});

document.querySelectorAll('.match-card.is-locked').forEach((card) => {
  const openCandidate = () => {
    if (card.classList.contains('is-unlocked')) {
      const isChen = card.dataset.index === '1';
      const name = isChen ? '陈默' : '周野';
      openSheet(`
        <h2 id="sheetTitle">${name}</h2>
        <p>${isChen ? 'AI 产品实习生 · 北京' : '推荐算法实习生 · 杭州'}</p>
        <p><strong>为什么匹配：</strong>${isChen ? '她擅长从客户访谈拆解产品需求，你能补上模型能力边界和工程交付流程。' : '他在做内容推荐与特征工程，与你的多模态理解和 ToB 数据闭环经验互补。'}</p>
        <p><strong>可以交换：</strong>${isChen ? '需求优先级、客户沟通、AI 产品面试复盘。' : '召回与排序实验、特征工程、离线评测设计。'}</p>
        <button class="primary-button candidate-contact" data-name="${name}"><span>发一封认识邮件</span><span class="arrow">→</span></button>
      `);
      document.querySelector('.candidate-contact').addEventListener('click', async () => {
        await navigator.clipboard.writeText(`Hi ${name}，我在「拼个实习」看到了我们的匹配结果，想和你交换一下项目工作流和求职经验。如果你愿意，我们可以先约 20 分钟线上聊聊。`);
        closeSheet();
        showToast('认识邮件已复制');
      });
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
  [
    'pingo-email',
    'pingo-email-sent',
    'pingo-referral-complete',
    'pingo-helper-topic',
    'pingo-super-topic',
    'pingo-matched',
  ].forEach((key) => localStorage.removeItem(key));
}

const savedEmail = localStorage.getItem('pingo-email');
if (savedEmail) {
  if (localStorage.getItem('pingo-matched') === '1') showResults(savedEmail);
  else showOnboarding(savedEmail);
}
