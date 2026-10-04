# 拼个实习

面向实习生的真实经验交换与搭子匹配产品。当前仓库包含可运行的前端、FastAPI 服务、SQLite 数据库迁移、邮箱验证码登录和生产部署脚本。

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

无需接入支付 API 即可先以人工核账方式开放 `¥10` 拼拼卡：用户扫码付款、填写付款时显示的微信昵称，管理员核对微信账单后在 `/review` 点击开通。用户不需要添加微信，也不需要上传付款截图。

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
