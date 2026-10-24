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
  let pendingExperience = null;
  const experienceDrafts = new Map();
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
    document.querySelector('#jobsTitle').textContent = tracking ? '我的机会' : '发现实习';
    document.querySelector('#jobsSubtitle').textContent = tracking ? '收藏与投递进展' : '看招聘要求，也看做过的人怎么说。';
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
      return `<article class="job-card ${tracking && j.id === selected ? 'is-selected' : ''}"><button class="job-open" data-job-id="${esc(j.id)}" aria-label="查看 ${esc(j.company)} ${esc(j.title)}" ${tracking ? `aria-pressed="${j.id === selected}"` : 'aria-haspopup="dialog" aria-controls="jobDialog"'}><div class="company-line">${mark(j)}<span>${esc(j.company)}</span>${region(j.location)==='china'?'<span class="domestic-label">国内</span>':''}</div><h2>${esc(j.title)}</h2><div class="job-card-meta">${icon('map-pin')}<span>${esc(j.location.replace('中国大陆 · ',''))}</span></div>${j.experience_count ? `<span class="experience-availability">同公司同方向 · ${Number(j.experience_count)} 条经历</span>` : ''}<div class="job-card-bottom"><span class="job-tag">${esc(j.category)}</span><span>${!j.active ? '原站已下架' : action.stage !== 'none' ? stages[action.stage] : `${date(j.updated_at)} 发布 / 更新`}</span></div></button><button class="icon-command job-save" data-save-id="${esc(j.id)}" aria-label="${action.saved ? '取消收藏' : '收藏'} ${esc(j.title)}" title="${action.saved ? '取消收藏' : '收藏岗位'}" aria-pressed="${Boolean(action.saved)}">${icon('bookmark')}</button></article>`;
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
    detail.innerHTML = `<button id="jobDetailClose" class="detail-close">${icon('chevron-left')}返回岗位列表</button><div class="detail-scroll"><div class="detail-topline"><div class="detail-company">${mark(j)}${esc(j.company)}</div><span class="job-tag">${j.active ? '官网公开岗位' : '原站已下架'}</span></div><h2 id="jobDetailTitle">${esc(j.title)}</h2><div class="detail-facts"><span>${icon('map-pin')}${esc(j.location)}</span><span>${icon('briefcase-business')}实习</span>${j.remote ? `<span>${icon('laptop')}远程</span>` : ''}</div><section id="jobExperiences" class="job-experiences" aria-label="实际工作经历" data-job-id="${esc(j.id)}"><p class="experience-muted">正在读取工作经历…</p></section><div class="description-heading"><h3>企业 JD</h3><span>来自招聘官网</span></div><div class="job-description">${paragraphHtml(paragraphs.slice(0,5)) || '<p>完整职位要求请查看原站。</p>'}${paragraphs.length>5 ? `<details><summary>展开完整岗位介绍</summary>${paragraphHtml(paragraphs.slice(5))}</details>` : ''}</div><div class="detail-source">来源：${esc(j.company)} 招聘页 · ${date(j.checked_at)} 读取<br />薪资、资格及截止日期以企业原站为准。</div></div><div class="detail-actions">${j.active ? `<a class="apply-link" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">原站申请${icon('arrow-up-right')}</a>` : '<span class="job-tag">该岗位已结束招聘</span>'}<button id="detailSave" class="icon-command" aria-label="${s.saved ? '取消收藏' : '收藏岗位'}" title="${s.saved ? '取消收藏' : '收藏岗位'}" aria-pressed="${Boolean(s.saved)}">${icon(s.saved ? 'bookmark-check' : 'bookmark')}</button><button id="detailShare" class="icon-command" aria-label="复制岗位链接" title="复制岗位链接">${icon('share-2')}</button><label class="stage-select"><select id="applicationStage" aria-label="投递进展">${Object.entries(stages).map(([key,label])=>`<option value="${key}" ${s.stage===key?'selected':''}>${label}</option>`).join('')}</select></label></div>`;
    detail.classList.add('has-content');
    detail.querySelector('.detail-close').onclick = closeDetail;
    document.querySelector('#detailSave').onclick = () => action(j.id,{saved:!s.saved});
    document.querySelector('#applicationStage').onchange = event => action(j.id,{stage:event.target.value});
    document.querySelector('#detailShare').onclick = async () => {
      const link = new URL('/', location.origin); link.searchParams.set('job',j.id);
      try { await navigator.clipboard.writeText(`${j.company} · ${j.title}\n一起看看这个实习机会：${link}`); showToast('岗位分享链接已复制'); }
      catch { showToast('复制失败，请从原站复制链接'); }
    };
    if (dialog.open || destination === 'saved' && !matchMedia('(max-width:720px)').matches) loadExperiences(j);
  }
  async function loadExperiences(j) {
    const region = detail.querySelector('#jobExperiences');
    if (!j || !region || region.dataset.jobId !== j.id) return;
    try {
      const [publicData, ownData] = await Promise.all([
        api('/api/jobs/' + encodeURIComponent(j.id) + '/experiences'),
        me?.user ? api('/api/jobs/' + encodeURIComponent(j.id) + '/experiences/mine') : Promise.resolve({experiences: []})
      ]);
      if (!region.isConnected) return;
      const own = ownData.experiences;
      const statuses = {pending: '待审核', published: '已公开', rejected: '未通过 / 已下架'};
      const entries = publicData.experiences.concat(own.filter(e => e.status !== 'published'));
      region.innerHTML = '<div class="experience-heading"><h3>实际工作经历</h3><span>' + publicData.experiences.length + ' 条公开经历</span></div>' +
        '<p class="experience-muted">同公司 · 同方向的本人自述，未核验任职。不代表当前团队或这份 JD 的实际情况。</p>' +
        (entries.length ? entries.map(e => {
          const mine = own.find(row => row.id === e.id);
          return '<article class="experience-entry"><div class="experience-meta"><strong>' + esc(e.role_title) + '</strong><span>' + e.year + ' 年 · ' + (mine ? statuses[mine.status] : '本人自述') + '</span></div>' +
            '<p class="experience-body">' + esc(e.body) + '</p>' +
            (mine ? '<button class="experience-withdraw text-button" data-experience-id="' + e.id + '">撤回这条经历</button>' :
              '<details class="experience-report"><summary>举报</summary><form data-report-id="' + e.id + '"><select aria-label="举报原因"><option>包含隐私或机密</option><option>疑似虚假经历</option><option>攻击或广告</option><option>其他问题</option></select><button type="submit">提交举报</button></form></details>') + '</article>';
        }).join('') : '<p class="experience-empty">还没有这类工作的经历分享。当前只能参考企业 JD，不将招聘描述当作实际工作结论。</p>') +
        '<details class="experience-editor"><summary>我做过，写一条</summary><form id="experienceForm">' +
        '<div class="experience-fields"><label>当时的岗位<input name="role_title" maxlength="100" value="' + esc(j.title.slice(0,100)) + '"></label>' +
        '<label>经历年份<select name="year" aria-label="经历年份">' + Array.from({length: new Date().getFullYear() - 1999}, (_,i) => new Date().getFullYear() - i).map(y => '<option>' + y + '</option>').join('') + '</select></label></div>' +
        '<label>实际上做了什么<textarea name="body" rows="3" minlength="20" maxlength="1600" required placeholder="比如：日常主要做什么；与 JD 有什么落差；入职前最该问清哪件事。"></textarea></label>' +
        '<label class="experience-consent"><input name="confirmed" type="checkbox" required>这是本人经历，不含他人隐私、客户资料或未公开业务信息</label>' +
        '<p class="experience-muted">公开时不显示姓名和邮箱；具体经历仍可能让熟人识别你。内容审核不等于任职核验，提交后可撤回。</p>' +
        '<button class="experience-submit" type="submit">' + icon('send') + '提交审核</button></form></details>' +
        '<p class="experience-feedback" role="status"></p>';
      const editor = region.querySelector('.experience-editor');
      const form = region.querySelector('#experienceForm');
      const draft = experienceDrafts.get(j.id);
      if (draft) {
        for (const [key, value] of Object.entries(draft)) {
          if (form.elements[key]) {
            if (key === 'confirmed') form.elements[key].checked = value;
            else form.elements[key].value = value;
          }
        }
        editor.open = Boolean(draft.open && me?.user);
      }
      const captureDraft = () => experienceDrafts.set(j.id, {
        role_title: form.elements.role_title.value, year: form.elements.year.value,
        body: form.elements.body.value, confirmed: form.elements.confirmed.checked, open: editor.open
      });
      form.addEventListener('input', captureDraft);
      editor.addEventListener('toggle', captureDraft);
      editor.querySelector('summary').onclick = event => {
        if (me?.user) return;
        event.preventDefault();
        experienceDrafts.set(j.id, {open:true});
        pendingExperience = j.id;
        login();
      };
      form.onsubmit = async event => {
        event.preventDefault();
        const button = form.querySelector('button[type=submit]');
        button.disabled = true;
        try {
          await api('/api/jobs/' + encodeURIComponent(j.id) + '/experiences', {method:'POST', body:JSON.stringify({
            role_title: form.elements.role_title.value, year:Number(form.elements.year.value),
            body:form.elements.body.value, confirmed:form.elements.confirmed.checked
          })});
          experienceDrafts.delete(j.id);
          await loadExperiences(j);
          showToast('已提交审核，暂未公开');
        } catch (error) {
          region.querySelector('.experience-feedback').textContent = error.message;
          button.disabled = false;
        }
      };
      region.querySelectorAll('.experience-withdraw').forEach(button => button.onclick = async () => {
        if (!window.confirm('撤回后将从公开页面删除，确定撤回？')) return;
        button.disabled = true;
        try {
          await api('/api/job-experiences/' + button.dataset.experienceId, {method:'DELETE'});
          await loadExperiences(j);
          showToast('经历已撤回');
        } catch (error) { region.querySelector('.experience-feedback').textContent = error.message; button.disabled = false; }
      });
      region.querySelectorAll('[data-report-id]').forEach(form => form.onsubmit = async event => {
        event.preventDefault();
        if (!me?.user) { pendingExperience = j.id; login(); return; }
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          await api('/api/job-experiences/' + form.dataset.reportId + '/report', {method:'POST', body:JSON.stringify({reason:form.querySelector('select').value})});
          form.closest('details').open = false;
          region.querySelector('.experience-feedback').textContent = '举报已提交，待人工复核。';
        } catch (error) { region.querySelector('.experience-feedback').textContent = error.message; }
        finally { button.disabled = false; }
      });
      icons();
    } catch (error) {
      if (!region.isConnected) return;
      region.innerHTML = '<p class="experience-muted">工作经历暂时无法读取。</p><button class="text-button" id="retryExperiences">重新读取</button>';
      region.querySelector('button').onclick = () => loadExperiences(j);
    }
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
    loadExperiences(jobs.find(j => j.id === selected) || personal.find(j => j.id === selected));
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
    const preserveView = next === destination && !view.classList.contains('is-hidden');
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
    if (!preserveView) { hideAllViews(); view.classList.remove('is-hidden'); }
    pinpinButton.classList.add('is-hidden'); updateNav();
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
    if (pendingExperience) {
      const id = pendingExperience;
      pendingExperience = null;
      const button = [...list.querySelectorAll('[data-job-id]')].find(b => b.dataset.jobId === id);
      button?.click();
    }
  }
  document.querySelectorAll('[data-destination]').forEach(b=>b.addEventListener('click',()=>{
    if (!loginView.classList.contains('is-hidden')) { pendingAction=null; pendingExperience=null; }
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
  window.PingoJobs={navigate,hide,authChanged,community:()=>destination==='community',signedOut:()=>{personal=[];pendingAction=null;pendingExperience=null;experienceDrafts.clear();navigate('discover');}};
  icons(); refresh();
})();
