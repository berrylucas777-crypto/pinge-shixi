const orderRows = document.querySelector('#orderRows');
const orderCount = document.querySelector('#orderCount');
const reviewError = document.querySelector('#reviewError');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || '请求失败，请稍后重试');
  return data;
}

function renderOrders(orders) {
  orderCount.textContent = `历史记录 ${orders.length} 笔`;
  if (!orders.length) {
    orderRows.innerHTML = '<p class="review-empty">没有历史订单记录。</p>';
    return;
  }
  orderRows.innerHTML = orders.map((order) => `
    <article class="review-order">
      <div>
        <strong>${escapeHtml(order.payer_nickname)}</strong>
        <span>${escapeHtml(order.order_code)} · ¥${(order.amount_cents / 100).toFixed(0)}</span>
      </div>
      <div class="review-order-meta">
        <span>${escapeHtml(order.name || '未完善资料')} · ${escapeHtml(order.email)}</span>
        <span>${escapeHtml(order.updated_at)} UTC</span>
      </div>
      <span>${order.status === 'approved' ? '已核验（历史记录）' : '待人工处理'}</span>
    </article>
  `).join('');
}

async function loadOrders() {
  reviewError.textContent = '';
  try {
    const data = await request('/api/admin/pinpin-orders?status=all');
    renderOrders(data.orders || []);
  } catch (error) {
    orderCount.textContent = '无法加载';
    reviewError.textContent = error.message === '请先登录' ? '请先在产品首页登录你的核账邮箱，然后再打开此页。' : error.message;
  }
}

document.querySelector('#refreshOrders').addEventListener('click', loadOrders);
loadOrders();
