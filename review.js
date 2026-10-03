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
  orderCount.textContent = `待核对 ${orders.length} 笔`;
  if (!orders.length) {
    orderRows.innerHTML = '<p class="review-empty">现在没有待核对的订单。</p>';
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
      <button class="primary-button review-approve" data-order-id="${order.id}" type="button"><span>核对无误，开通</span><span class="arrow">→</span></button>
    </article>
  `).join('');
  document.querySelectorAll('.review-approve').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      reviewError.textContent = '';
      try {
        const result = await request(`/api/admin/pinpin-orders/${button.dataset.orderId}/approve`, { method: 'POST' });
        await loadOrders();
        if (!result.email_sent) reviewError.textContent = '权益已开通，但通知邮件未发送；请检查邮件配置。';
      } catch (error) {
        reviewError.textContent = error.message;
        button.disabled = false;
      }
    });
  });
}

async function loadOrders() {
  reviewError.textContent = '';
  try {
    const data = await request('/api/admin/pinpin-orders');
    renderOrders(data.orders || []);
  } catch (error) {
    orderCount.textContent = '无法加载';
    reviewError.textContent = error.message === '请先登录' ? '请先在产品首页登录你的核账邮箱，然后再打开此页。' : error.message;
  }
}

document.querySelector('#refreshOrders').addEventListener('click', loadOrders);
loadOrders();
