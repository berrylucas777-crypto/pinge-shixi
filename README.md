# 拼个实习

面向实习生的真实经验交换与搭子匹配产品。当前仓库包含可运行的前端、FastAPI 服务、SQLite 数据库迁移、邮箱验证码登录、群聊匹配池导入和生产部署脚本。

## 已完成的上线闭环

- 邮箱验证码注册与 HttpOnly Cookie 会话
- 首次两栏建档、自我介绍解析和后续档案编辑
- 基于经历、需求、标签、城市与偏好的解释型匹配
- 77 条脱敏群聊资料自动导入固定匹配池
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

生产域名为 `https://shixi.seu-link.fit`。`deploy/push.py` 会在覆盖文件前备份 `data/pingo.db`，上传匹配池 JSON，执行数据库兼容迁移并验证健康检查。

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

`/imports` 是资料管理员后台。登录 `DATA_ADMIN_EMAILS`（留空时沿用 `PAYMENT_ADMIN_EMAILS`）中的邮箱后，可粘贴已获授权的 CSV、JSON 或 OCR 文本，先预览和修改规范化资料，再写入匹配池。导入资料不会保存或公开第三方邮箱，联系人默认以小红书昵称展示；每批同步会记录来源、格式、数量和操作人。

图片 OCR 需要在服务器另配中文 OCR 服务或本机 OCR 引擎；当前入口可直接接收 OCR 后的文本。不要从未授权的猎头平台、社交平台或私人渠道抓取、导入个人信息。
