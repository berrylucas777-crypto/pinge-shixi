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

## 支付状态

仓库没有伪造真实扣款。`/api/pinpin/simulate` 默认关闭，仅能在明确设置 `ALLOW_SIMULATED_PAYMENT=true` 的本地测试环境启用。接入商户支付、签名回调、退款和对账前，生产页面只展示“真实支付接入中”。

若采用履约金模式，仍需补充真实支付渠道、订单状态机、双方履约确认、争议处理和原路退款；这些不能用前端模拟替代。
