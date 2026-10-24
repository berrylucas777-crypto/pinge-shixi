# 拼个实习

帮助实习求职者对照企业 JD 与过来人的实际工作经历，判断岗位是否适合自己。当前仓库包含可运行的前端、FastAPI 服务、SQLite 数据库迁移、邮箱验证码登录和生产部署脚本；旧搭子匹配作为独立功能保留，不视为岗位经验的可信来源。

## 当前产品判断与验证

核心任务是减少“JD 与日常工作不一致”的信息差，不是让同时竞争同一岗位的人组队投递。信息相关性（做过什么）与利益冲突（是否正竞争同一个机会）应分开判断；优先邀请已经结束一段实习、愿意复盘的人。跨经历互补可能有帮助，但不是天然分享动机。

先覆盖 AI、产品、开发中的一个细分方向，人工邀请 10 位有亲历的人，收集约 20 条具体工作记录。记录应回答日常任务、JD 落差、入职前要问的问题。以上是拟议验证规模，不是已有内容数量；不靠爬取他人身份、虚构经历或强制分享换阅读来填充。

让 20 位正在找实习的人用这些记录评估真实候选岗位，追问“改变了什么决定、面试多问了什么”。记录是否读完、有没有具体决策变化、是否愿意带来下一份经历。供给指标是邀请到有效投稿的转化、匿名后仍不愿写的原因与返稿成本；阅读量与注册量不能替代这些指标。若内容不能改变决定，先改内容颗粒度，不扩功能。

浏览岗位、工作经历、收藏与投递记录保持免费。新拼拼卡默认暂停售卖，保留已购权益及已有订单核验。下一阶段只有在有明确供给后才试验单次付费答疑：先确认回答者做过相关工作、愿意回答及交付范围，再小规模测试价格与报酬；不先上无限咨询、终身内容会员或承诺 offer。潜在企业业务不得以删负面经历、买评价或隐藏风险为条件。

外部参照：IZA Discussion Paper 16840 的实验发现竞争会抑制对高能力同伴的岗位信息分享，但不能据此直接证明本产品需求；Glassdoor 的透明度政策把内容审核与事实认定区分开，且不允许付费删评价。这里采用同样的信任边界，不声称已验证中国实习市场的付费意愿。

## 已完成的上线闭环

- 邮箱验证码注册与 HttpOnly Cookie 会话
- 首次两栏建档、自我介绍解析和后续档案编辑
- 基于经历、需求、标签、城市与偏好的解释型匹配
- 真人匹配池：人数先攒着，每天 21:00 再匹配
- 自由探索、每日详情额度、搜索与筛选
- 联系请求、邀请码解锁、举报与账户永久删除
- 生产安全响应头、验证码限流和数据库部署前备份

## 本地运行

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
./start.sh
```

打开 `http://127.0.0.1:8000/`。SMTP 未配置时，本地会直接创建登录会话；生产环境应配置阿里云邮件推送。

## 测试

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
PYTHONPYCACHEPREFIX=/tmp/pinge-pycache .venv/bin/python -m pytest -q
node --check app.js
```

## 生产部署

生产域名为 `https://shixi.seu-link.fit`。请用 `deploy/update.py` 上传文件、备份数据库并重启服务；不要用 `deploy/push.py` 覆盖 nginx。

生产环境必须保持：

```dotenv
DISABLE_DOCS=true
ALLOW_SIMULATED_PAYMENT=false
```

## 内测人工核账

旧版 `¥10` 拼拼卡使用人工核账。当前 `PINPIN_SALES_ENABLED=false`（默认）暂停新订单并隐藏收款码，已有待核账订单仍可更正昵称与批准，已购权益不回收。用户通过账户页“既有权益与付款记录”查询；已付款但尚未提交的需联系运营人工核对，避免重复付款。

生产 `.env.production` 配置如下，全部为非代码配置且不会提交到仓库：

```dotenv
MANUAL_PAYMENT_ENABLED=true
MANUAL_PAYMENT_QR_URL=/assets/pinpin-payment-qr.jpg
MANUAL_PAYMENT_CONTACT=微信：你的微信号
PAYMENT_ADMIN_EMAILS=你的登录邮箱@example.com
```

收款二维码可放在 `assets/pinpin-payment-qr.jpg`，部署脚本会在文件存在时自动上传；也可填写已托管的 HTTPS 图片地址。`/review` 只允许 `PAYMENT_ADMIN_EMAILS` 中已登录的账号查看和开通订单。

`/api/pinpin/simulate` 默认关闭，仅能在明确设置 `ALLOW_SIMULATED_PAYMENT=true` 的本地测试环境启用。

若采用履约金模式，仍需补充真实支付渠道、订单状态机、双方履约确认、争议处理和原路退款；这些不能用前端模拟替代。

## 资料同步后台

`/imports` 是资料管理员后台。登录 `DATA_ADMIN_EMAILS`（留空时沿用 `PAYMENT_ADMIN_EMAILS`）中的邮箱后，可粘贴已获授权的 CSV、JSON 或 OCR 文本，先预览再写入。前台每天 21:00 的匹配池只使用真人注册用户；导入资料不会进入公开匹配，也不会对外展示第三方邮箱。

图片 OCR 需要在服务器另配中文 OCR 服务或本机 OCR 引擎；当前入口可直接接收 OCR 后的文本。不要从未授权的猎头平台、社交平台或私人渠道抓取、导入个人信息。

## 岗位发现工作台（本地版本）

首页为无需登录的公开岗位流，顶部导航顺序为“找搭子 / 发现实习 / 我的机会”。沿用原有 Logo、吉祥物、冷灰与浅蓝色，导航和操作栏采用半透明材质。发现页在桌面与手机均为双列岗位卡片，随页面统一滚动；点击卡片打开详情，桌面弹窗、手机全屏，关闭后恢复浏览位置与键盘焦点。“我的机会”在桌面保留列表与详情联动，手机使用全屏详情与底部导航。

- 无需登录即可搜索公司、岗位和城市，筛选方向、地区及远程。
- 收藏时按需登录，成功后恢复收藏动作；不强制填写搭子档案。收藏和投递阶段写入 SQLite，账号之间隔离。
- 点击原站链接只打开招聘页；“已投递 / 面试中 / 已获 Offer / 已结束”由用户手动更新。
- 岗位详情展示同公司、同方向的实际工作经历，与企业 JD 分开。没有内容时明确显示缺失，不按标签匹配陌生人来冒充过来人。
- 默认国内优先，并优先 AI、产品、开发方向；分享链接 `/?job=来源:ID` 回到站内对应岗位。没有虚构参与人数，也不要求凑人才能申请。
- 浏览岗位、工作经历、收藏与记录进展免费；新拼拼卡默认暂停销售，既有权益保留。

工作经历投稿只需登录，不强制填写搭子档案。岗位名称预填可改，填写经历年份、一段文字并确认本人经历与隐私边界。内容进入待审队列；`/imports` 的“工作经历审核”由 `DATA_ADMIN_EMAILS`（未配置时沿用 `PAYMENT_ADMIN_EMAILS`）管理，可公开、下架、处理举报。审核只判断内容是否适合公开，不代表任职核验；公开记录不返回姓名、邮箱或用户 ID。作者可撤回，删除账户会级联删除投稿。默认每人每天最多提交 5 条，每小时最多举报 10 次。经历按公司与方向聚合，以免旧 JD 下架后内容丢失；不声称同一团队或当前岗位得到验证。

国内同步依赖独立的浏览器采集进程，先安装（Web 服务本身不需要浏览器）：

```bash
.venv/bin/pip install -r requirements-jobs.txt
.venv/bin/python -m playwright install chromium
# Linux 服务器缺系统库时使用：python -m playwright install --with-deps chromium
```

同步一次企业公开岗位（国内每个来源默认最多 5 页）：

```bash
.venv/bin/python -m server.sync_jobs
```

需要定时同步时单独运行（此版本没有自动安装服务器定时任务）：

```bash
.venv/bin/python -m server.sync_jobs --interval 21600
```

已接入：小米实习生官网、字节跳动校园招聘官网，以及 Greenhouse 公开接口的 Figma、Cloudflare、Stripe、Databricks。国内适配器正常打开公开页面、翻页并读取页面收到的职位 JSON，不登录、不复用 Cookie、不生成签名、不绕过验证码。仅保留明确标注为实习的岗位，同时保存职责、要求、城市、来源时间和原站地址。公开页面可访问不代表获得企业合作或再分发授权，扩大规模前应确认来源条款与授权。

仅同步国内：`.venv/bin/python -m server.sync_jobs --source xiaomi --source bytedance`。`--max-pages` 可设 1–100，默认 5，页面间隔 1.5 秒。本机可用环境变量 `JOB_BROWSER_EXECUTABLE` 指定已安装 Chrome 的绝对路径，否则使用 Playwright Chromium。不要将本机 Chrome 路径直接搬到 Linux 服务器。

岗位以来源和 ID 去重。只有成功读取完整列表才将缺失岗位标记下架；限量同步只更新读到的记录，来源面板标注“部分列表”。失败或响应结构异常不会清空岗位。不承诺全量或实时有效，以原站为准；较旧记录仍可见读取时间。浏览器超时 45–60 秒，HTTP 超时 25 秒，重复同步间隔至少一小时。地区优先使用官网国家与城市，缺失时做文本归类。

`jobs.js` / `jobs.css` 是岗位界面；`server/jobs.py` 提供公开岗位与私有进展接口；`server/sync_jobs.py` 独立执行同步，`server/job_sources.py` 是国内官网适配器。API 返回最多 1000 条活动岗位，增长到该规模前需补服务端分页。数据库与用户数据不提交 Git；其他开发环境需先同步一次。部署文件清单已更新，但本次仅在本地运行。

图标使用本地固定版本 Lucide 0.468.0，许可位于 `assets/lucide-LICENSE.txt`。测试：`.venv/bin/python -m pytest -q`。

## SEO / GEO 基础与上线验收

首页配置了标题、描述、canonical 和 Open Graph / Twitter 分享信息。无需登录的 `/about` 提供产品定位、参与流程、常见问题和 WebApplication 微数据；不把用户档案当作搜索内容。公开时间说明为北京时间每周一、周三 21:00，排期调整时同步更新 `index.html`、`about.html` 和 `llms.txt`。

`/robots.txt` 允许公共页面被搜索爬虫读取，排除 API、管理页和文档；`/sitemap.xml` 只列首页和产品说明页。敏感路由同时返回 `X-Robots-Tag: noindex, nofollow, noarchive`。robots 和 noindex 不是安全访问控制，API 的登录与权限校验仍必须保留。

`/llms.txt` 是可选公开摘要，不是 AI 搜索收录标准，也不能保证排名或被引用。当前采用普通公开搜索策略，不额外改变训练爬虫政策。Google 明确说明 AI 搜索沿用基础 SEO，无需特殊 AI 文件：<https://developers.google.com/search/docs/appearance/ai-features>。

部署仍由负责服务器的同学执行 `deploy/update.py`；脚本已包含上述新增文件。部署后验证：

```bash
curl -I https://shixi.seu-link.fit/about
curl https://shixi.seu-link.fit/robots.txt
curl https://shixi.seu-link.fit/sitemap.xml
curl https://shixi.seu-link.fit/llms.txt
curl -I https://shixi.seu-link.fit/api/me
```

前四个公开资源应返回 200，API 应保持鉴权并带 noindex。然后由域名管理员完成 Google Search Console、Bing Webmaster Tools 和百度搜索资源平台的站点验证，提交 sitemap，检查抓取报告。不要提交用户档案、后台或付款页面。CDN / WAF 如阻止搜索爬虫，需要单独核查，不能只根据 User-Agent 给私有接口放行。

### 内测营销实验

- 首批招募目标为 20–30 人（实验目标，不是当前人数），先聚焦一个可触达的实习交流圈子，避免小池子里方向过度分散。
- 小红书内容围绕“具体项目问题”“实习群很多却找不到交流对象”“开发者内测记录”，不虚构成功案例。带外链素材需先确认账号和平台规则。
- 经群主同意，在实习群与校园社群围绕下一轮匹配集中招募；合作对象优先实习社群组织者，不先投入广告预算。
- 获得用户授权后才公开脱敏案例。邀请码用于用户主动邀请，不批量私信、不采集第三方联系方式用于营销。
- 内容选题候选：如何找实习搭子、产品实习项目复盘、第一次做用户访谈该问什么、实习经历交流与内推有什么区别。选题尚未验证搜索量，不承诺流量。
- 每周记录访问、完成资料入池、匹配、实际联系和付费审核五个环节，区分自然搜索、社群和内容来源。当前没有新增第三方追踪脚本；需要埋点时先确定隐私与数据保留范围。

### 可参考的开源营销 Skills

- <https://github.com/coreyhaines31/marketingskills>：SEO 审计、AI SEO、转化优化、文案、社区与发布策略。当前最适合参考其中的 `seo-audit` 和 `ai-seo`。
- <https://github.com/kostja94/marketing-skills>：技术 SEO、关键词研究、内容策略、冷启动和上市策略。
- <https://github.com/aaron-he-zhu/aaron-marketing-skills>：SEO / GEO 研究、内容与监测；旧 `seo-geo-claude-skills` 仓库已指向此合集。

本次仅检索与参考，没有安装或执行第三方 Skills、CLI 或营销自动化。后续按需求挑选少量技能，审查内容与依赖后再安装。
