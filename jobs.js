/* Job discovery shares authentication and the existing community workspace. */
(() => {
  const view = document.querySelector('#jobsView');
  const list = document.querySelector('#jobList');
  const detail = document.querySelector('#jobDetail');
  const dialog = document.querySelector('#jobDialog');
  const detailHome = detail.parentElement;
  const shell = document.querySelector('.site-shell');
  const toastHome = toast.parentElement;
  const search = document.querySelector('#jobSearch');
  const stages = { none: '未投递', applied: '已投递', interview: '面试中', offer: '已获 Offer', rejected: '已结束' };
  let jobs = [], personal = [], sources = [], selected = null, category = '', stage = 'all';
  let destination = 'discover', pendingAction = null, loaded = false, busy = false;
  let returnFocusId = null, scrollLock = null;
  const sharedJob = new URLSearchParams(location.search).get('job');
  let sharedOpened = false;
  const esc = escapeHtml;
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const icons = () => window.lucide?.createIcons();
  const date = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString('zh-CN', {month:'numeric',day:'numeric'}) : '待确认';
  const mark = j => `<span class="company-mark mark-${esc(j.source)}" aria-hidden="true">${esc(j.company.charAt(0))}</span>`;
  const state = id => personal.find(j => j.id === id) || {saved: false, stage:'none'};
  function region(location) {
    if (/中国大陆|上海|北京|深圳|广州|杭州|武汉|南京|成都|西安|苏州|天津|重庆|长沙|合肥|珠海|东莞|厦门|shanghai|beijing|shenzhen|hangzhou|mainland/i.test(location)) return 'china';
    if (/singapore|japan|tokyo|india|bengaluru|bangalore|hong kong|taiwan|korea|singapore|asia|亚洲/i.test(location)) return 'asia';
    if (/london|berlin|paris|dublin|amsterdam|europe|united kingdom|uk\b|germany|france|poland|lisbon|warsaw|zurich/i.test(location)) return 'europe';
    if (/united states|usa|u\.s\.|san francisco|new york|seattle|california|canada|toronto|brazil|austin|boston|san jose|mountain view|washington|denver|atlanta|sunnyvale|bellevue|palo alto|mexico|chicago/i.test(location)) return 'americas';
    return 'other';
  }
  function filtered() {
    const text = search.value.trim().toLowerCase();
    const location = document.querySelector('#jobLocation').value;
    const remote = document.querySelector('#remoteOnly').checked;
    return (destination === 'saved' ? personal.filter(j => j.saved || j.stage !== 'none') : jobs).filter(j =>
      (!text || `${j.title} ${j.company} ${j.location} ${j.category}`.toLowerCase().includes(text)) &&
      (!category || j.category === category) && (!location || region(j.location) === location) && (!remote || j.remote) &&
      (destination !== 'saved' || stage === 'all' || (stage === 'saved' ? j.saved : j.stage === stage))
    ).sort((a,b) => {
      const sort = document.querySelector('#jobSort').value;
      if (sort === 'company') return a.company.localeCompare(b.company, 'zh-CN');
      if (sort === 'domestic') {
        const rank = j => (region(j.location)==='china' ? 0 : 10) + (['AI / 数据','产品 / 设计','技术 / 工程'].includes(j.category) ? 0 : 1);
        if (rank(a)!==rank(b)) return rank(a)-rank(b);
      }
      return b.updated_at.localeCompare(a.updated_at);
    });
  }
  function updateNav() {
    document.querySelectorAll('.workspace-nav [data-destination]').forEach(button => {
      const active = button.dataset.destination === destination;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    });
    const count = personal.filter(j => j.saved || j.stage !== 'none').length;
    document.querySelector('#savedCount').textContent = count;
    document.querySelector('#savedCount').classList.toggle('is-hidden', !count);
    document.querySelector('#jobLogin').classList.toggle('is-hidden', Boolean(me?.user));
    avatarButton.classList.toggle('is-hidden', !me?.user);
    if (me?.user) avatarButton.textContent = (me.user.name || me.user.email).charAt(0).toUpperCase();
  }
  function render() {
    const focusId = dialog.open ? document.activeElement?.id : null;
    const detailScroll = dialog.open ? detail.querySelector('.detail-scroll')?.scrollTop : 0;
    const expanded = dialog.open && detail.querySelector('details')?.open;
    updateNav();
    const rows = filtered();
    const tracking = destination === 'saved';
    view.dataset.mode = destination;
    document.querySelector('#jobsTitle').textContent = tracking ? '每一步，都算数。' : '下一站，实习。';
    document.querySelector('#jobsSubtitle').textContent = tracking ? '收藏、投递、面试。把你的机会放在一起。' : '发现值得投递的机会，也找到一起准备的人。';
    document.querySelector('#trackerFilters').classList.toggle('is-hidden', !tracking);
    document.querySelectorAll('[data-stage]').forEach(button => {
      const key = button.dataset.stage;
      const count = personal.filter(j=>key==='all' ? j.saved || j.stage!=='none' : key==='saved' ? j.saved : j.stage===key).length;
      const label = key==='all' ? '全部' : key==='saved' ? '已收藏' : stages[key];
      button.textContent = `${label} ${count}`;
      button.setAttribute('aria-pressed', String(stage===key));
    });
    document.querySelector('#jobResultCount').textContent = `${rows.length} 个${tracking ? '我的机会' : '实习机会'}`;
    list.setAttribute('aria-busy','false');
    if (!rows.length) {
      closeDetail();
      const loggedOut = tracking && !me?.user;
      list.innerHTML = `<div class="jobs-empty">${icon(loggedOut ? 'bookmark' : 'search')}<h2>${loggedOut ? '把心动的机会留下来' : tracking ? '这里还没有机会' : '暂时没有符合条件的岗位'}</h2><p>${loggedOut ? '登录后，你的收藏和投递进展会保存在这里。' : !jobs.length && !tracking ? '岗位库还在更新，请稍后再来看看。' : '试试其他方向或地区，看看新的可能。'}</p><button id="jobsEmptyAction">${loggedOut ? '登录 / 注册' : '浏览全部机会'}</button></div>`;
      document.querySelector('#jobsEmptyAction').onclick = () => loggedOut ? login() : reset();
      selected = null;
      detail.innerHTML = `<div class="detail-placeholder">${icon('briefcase-business')}<h2>给下一步，留一点可能</h2><p>选中一个岗位，在这里查看完整信息。</p></div>`;
      icons(); return;
    }
    if (!rows.some(j => j.id === selected)) selected = rows[0].id;
    list.innerHTML = rows.map(j => {
      const action = state(j.id);
      return `<article class="job-card ${tracking && j.id === selected ? 'is-selected' : ''}"><button class="job-open" data-job-id="${esc(j.id)}" aria-label="查看 ${esc(j.company)} ${esc(j.title)}" ${tracking ? `aria-pressed="${j.id === selected}"` : 'aria-haspopup="dialog" aria-controls="jobDialog"'}><div class="company-line">${mark(j)}<span>${esc(j.company)}</span>${region(j.location)==='china'?'<span class="domestic-label">国内</span>':''}</div><h2>${esc(j.title)}</h2><div class="job-card-meta">${icon('map-pin')}<span>${esc(j.location.replace('中国大陆 · ',''))}</span></div><div class="job-card-bottom"><span class="job-tag">${esc(j.category)}</span><span>${!j.active ? '原站已下架' : action.stage !== 'none' ? stages[action.stage] : `${date(j.updated_at)} 发布 / 更新`}</span></div></button><button class="icon-command job-save" data-save-id="${esc(j.id)}" aria-label="${action.saved ? '取消收藏' : '收藏'} ${esc(j.title)}" title="${action.saved ? '取消收藏' : '收藏岗位'}" aria-pressed="${Boolean(action.saved)}">${icon('bookmark')}</button></article>`;
    }).join('');
    list.querySelectorAll('[data-job-id]').forEach(button => button.onclick = () => {
      selected = button.dataset.jobId;
      render();
      returnFocusId = selected;
      if (destination === 'discover' || matchMedia('(max-width:720px)').matches) openDetail();
      else focusCard();
    });
    list.querySelectorAll('[data-save-id]').forEach(button => button.onclick = () => action(button.dataset.saveId, {saved:!state(button.dataset.saveId).saved}));
    renderDetail(rows.find(j => j.id === selected)); icons();
    if (expanded && detail.querySelector('details')) detail.querySelector('details').open = true;
    if (detailScroll) detail.querySelector('.detail-scroll').scrollTop = detailScroll;
    if (focusId) document.getElementById(focusId)?.focus({preventScroll:true});
  }
  function renderDetail(j) {
    const s = state(j.id);
    const paragraphs = j.description.split(/\n\n+/).filter(Boolean);
    const paragraphHtml = rows => rows.map(p=>`<p>${esc(p)}</p>`).join('');
    detail.innerHTML = `<button id="jobDetailClose" class="detail-close">${icon('chevron-left')}返回岗位列表</button><div class="detail-scroll"><div class="detail-topline"><div class="detail-company">${mark(j)}${esc(j.company)}</div><span class="job-tag">${j.active ? '官网公开岗位' : '原站已下架'}</span></div><h2 id="jobDetailTitle">${esc(j.title)}</h2><div class="detail-facts"><span>${icon('map-pin')}${esc(j.location)}</span><span>${icon('briefcase-business')}实习</span>${j.remote ? `<span>${icon('laptop')}远程</span>` : ''}</div><div class="detail-social">${icon('messages-square')}<p><strong>找个搭子，一起准备</strong>项目互评 · 模拟面试 · 经验交流</p><button id="jobFindPeople">找准备搭子</button></div><div class="description-heading"><h3>岗位介绍</h3><span>企业原文</span></div><div class="job-description">${paragraphHtml(paragraphs.slice(0,5)) || '<p>完整职位要求请查看原站。</p>'}${paragraphs.length>5 ? `<details><summary>展开完整岗位介绍</summary>${paragraphHtml(paragraphs.slice(5))}</details>` : ''}</div><div class="detail-source">来源：${esc(j.company)} 招聘页 · ${date(j.checked_at)} 读取<br />薪资、资格及截止日期以企业原站为准。</div></div><div class="detail-actions">${j.active ? `<a class="apply-link" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">原站申请${icon('arrow-up-right')}</a>` : '<span class="job-tag">该岗位已结束招聘</span>'}<button id="detailSave" class="icon-command" aria-label="${s.saved ? '取消收藏' : '收藏岗位'}" title="${s.saved ? '取消收藏' : '收藏岗位'}" aria-pressed="${Boolean(s.saved)}">${icon(s.saved ? 'bookmark-check' : 'bookmark')}</button><button id="detailShare" class="icon-command" aria-label="复制岗位链接" title="复制岗位链接">${icon('share-2')}</button><label class="stage-select"><select id="applicationStage" aria-label="投递进展">${Object.entries(stages).map(([key,label])=>`<option value="${key}" ${s.stage===key?'selected':''}>${label}</option>`).join('')}</select></label></div>`;
    detail.classList.add('has-content');
    detail.querySelector('.detail-close').onclick = closeDetail;
    document.querySelector('#detailSave').onclick = () => action(j.id,{saved:!s.saved});
    document.querySelector('#applicationStage').onchange = event => action(j.id,{stage:event.target.value});
    document.querySelector('#detailShare').onclick = async () => {
      const link = new URL('/', location.origin); link.searchParams.set('job',j.id);
      try { await navigator.clipboard.writeText(`${j.company} · ${j.title}\n一起看看这个实习机会：${link}`); showToast('岗位分享链接已复制'); }
      catch { showToast('复制失败，请从原站复制链接'); }
    };
    document.querySelector('#jobFindPeople').onclick = () => {
      window.pingoJobContext = {company:j.company,title:j.title,url:j.url,category:j.category};
      closeDetail(); navigate('community');
    };
  }
  function focusCard() {
    [...list.querySelectorAll('[data-job-id]')].find(button => button.dataset.jobId === returnFocusId)?.focus({preventScroll:true});
  }
  function openDetail() {
    if (dialog.open) return;
    scrollLock = {body: document.body.style.overflow, shell: shell.style.overflow, x: scrollX, y: scrollY, top: shell.scrollTop};
    dialog.append(detail);
    // Native modal dialogs cover ordinary page layers, including the shared toast.
    dialog.append(toast);
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    shell.style.overflow = 'hidden';
    detail.querySelector('.detail-close').focus({preventScroll:true});
  }
  function closeDetail() {
    if (!dialog.open) return;
    dialog.close();
    detailHome.append(detail);
    toastHome.append(toast);
    document.body.style.overflow = scrollLock.body;
    shell.style.overflow = scrollLock.shell;
    shell.scrollTop = scrollLock.top;
    window.scrollTo(scrollLock.x, scrollLock.y);
    scrollLock = null;
    focusCard();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDetail();
  });
  function hide() { view.classList.add('is-hidden'); closeDetail(); }
  function login() { closeDetail(); showLogin(); document.querySelector('#jobLogin').classList.add('is-hidden'); emailInput.focus(); }
  async function loadPersonal() {
    personal = me?.user ? (await api('/api/jobs/mine')).jobs : [];
  }
  async function action(id, patch) {
    if (!me?.user) { pendingAction = {id,patch}; login(); return; }
    if (busy) return;
    busy = true;
    try {
      await api(`/api/jobs/${encodeURIComponent(id)}/action`, {method:'PATCH',body:JSON.stringify(patch)});
      await loadPersonal(); render();
      showToast(patch.stage !== undefined ? '投递进展已更新' : patch.saved ? '已收藏到我的机会' : '已取消收藏');
    } catch (error) { showToast(error.message); render(); }
    finally { busy=false; }
  }
  function reset() {
    search.value=''; category=''; stage='all'; document.querySelector('#jobLocation').value=''; document.querySelector('#remoteOnly').checked=false;
    document.querySelectorAll('[data-category]').forEach(b=>{b.classList.toggle('is-active',b.dataset.category==='');b.setAttribute('aria-pressed',String(b.dataset.category===''));});
    navigate('discover');
  }
  async function refresh() {
    list.setAttribute('aria-busy','true');
    try {
      const data = await api('/api/jobs'); jobs=data.jobs; sources=data.sources; loaded=true;
      if (sharedJob && !selected) selected = jobs.find(j=>j.id===sharedJob)?.id || null;
      const successful = sources.filter(s=>!s.error).length;
      document.querySelector('#sourceStatus').textContent = successful ? `${successful} 个企业来源` : '等待岗位同步';
      render();
    } catch (error) {
      list.setAttribute('aria-busy','false');
      list.innerHTML=`<div class="jobs-empty"><h2>岗位暂时没加载出来</h2><p>${esc(error.message)}</p><button id="retryJobs">重新加载</button></div>`;
      document.querySelector('#retryJobs').onclick=refresh;
    }
  }
  async function navigate(next) {
    if (next !== destination && next !== 'community') {
      document.querySelector('.site-shell').scrollTop=0;
      search.value=''; category=''; stage='all';
      document.querySelector('#jobLocation').value=''; document.querySelector('#remoteOnly').checked=false;
      document.querySelectorAll('[data-category]').forEach(b=>{b.classList.toggle('is-active',b.dataset.category==='');b.setAttribute('aria-pressed',String(b.dataset.category===''));});
      document.querySelectorAll('[data-stage]').forEach(b=>b.classList.toggle('is-active',b.dataset.stage==='all'));
    }
    destination=next; updateNav();
    if (next==='community') {
      hide();
      if (!me?.user) { login(); return; }
      if (!me.user.profile_complete) { showProfile(); return; }
      try {
        await loadMatches(); showResults();
        if(window.pingoJobContext) {
          activeFilter = {'技术 / 工程':'开发','AI / 数据':'AI','产品 / 设计':'产品','运营 / 市场':'增长'}[window.pingoJobContext.category] || '全部';
          document.querySelectorAll('#filterRow .filter-chip').forEach(chip => chip.classList.toggle('is-active', chip.dataset.filter === activeFilter));
          document.querySelector('#resultsTitle').textContent='一起准备这个机会';
          document.querySelector('#resultsLead').textContent=`${window.pingoJobContext.company} · ${window.pingoJobContext.title}`;
          setResultsView('explore');
          showToast(`一起准备 ${window.pingoJobContext.company} 的机会`);
        } else {
          document.querySelector('#resultsTitle').textContent='找个搭子，一起向前';
          document.querySelector('#resultsLead').textContent='交换真实项目经验。每周一、周三晚 9 点匹配。';
        }
      }
      catch(error) { showToast(error.message); }
      return;
    }
    hideAllViews(); view.classList.remove('is-hidden'); pinpinButton.classList.add('is-hidden'); updateNav();
    if (loaded) render(); else await refresh();
    if (sharedJob && !sharedOpened && next==='discover') {
      const target = [...list.querySelectorAll('[data-job-id]')].find(b=>b.dataset.jobId===sharedJob);
      if (target) { sharedOpened=true; target.scrollIntoView({block:'nearest'}); target.click(); }
    }
  }
  async function authChanged() {
    await loadPersonal(); updateNav();
    if (pendingAction) { const pending=pendingAction; pendingAction=null; await action(pending.id,pending.patch); }
    await navigate(destination);
  }
  document.querySelectorAll('[data-destination]').forEach(b=>b.addEventListener('click',()=>{
    if (!loginView.classList.contains('is-hidden')) pendingAction=null;
    if(b.dataset.destination==='community') window.pingoJobContext=null;
    navigate(b.dataset.destination);
  }));
  document.querySelector('#jobLogin').onclick=login;
  document.querySelector('#bottomCommunity').onclick=()=>navigate('community');
  document.querySelector('#jobSources').onclick=()=>{
    openSheet(`<h2 id="sheetTitle">岗位来源</h2><p>国内来自小米、字节跳动招聘官网；海外来自企业 Greenhouse 招聘页。展示近期公开机会，不代表完整招聘列表。</p>${sources.map(s=>`<div class="source-row"><strong>${esc(s.name || s.source)}</strong><small>${s.error?'本轮同步未成功，保留上次数据':`本轮 ${s.count} 个实习岗位${s.complete?'':' · 部分列表'}`}<br />${date(s.checked_at)} 同步</small></div>`).join('')||'<p>尚未完成首次同步。</p>'}<p>岗位会变化，是否仍在招聘及申请要求以企业原站为准。</p>`);
  };
  search.addEventListener('input',render);
  ['jobLocation','remoteOnly','jobSort'].forEach(id=>document.querySelector(`#${id}`).addEventListener('change',render));
  document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{
    category=b.dataset.category;
    document.querySelectorAll('[data-category]').forEach(el=>{el.classList.toggle('is-active',el===b);el.setAttribute('aria-pressed',String(el===b));});render();
  });
  document.querySelectorAll('[data-stage]').forEach(b=>b.onclick=()=>{stage=b.dataset.stage;document.querySelectorAll('[data-stage]').forEach(el=>el.classList.toggle('is-active',el===b));render();});
  window.PingoJobs={navigate,hide,authChanged,community:()=>destination==='community',signedOut:()=>{personal=[];pendingAction=null;navigate('discover');}};
  icons(); refresh();
})();
