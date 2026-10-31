function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function renderReceiptSection(images = []) {
  const valid = images.filter(image => typeof image?.image === 'string' && image.image.length > 0);
  if (!valid.length) return '<h2>Receipts</h2><p>No linked receipt images were available.</p>';
  return `<h2>Receipts</h2>${valid.map(item => `<div class="receipt"><b>Voucher ${escapeHtml(item.voucher || '—')}</b> · ${escapeHtml(item.payment || '')} · ${escapeHtml(item.filename || 'receipt.jpg')}<br/><img src="data:image/jpeg;base64,${item.image}"/></div>`).join('')}`;
}
module.exports = {renderReceiptSection};
