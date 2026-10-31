function getDailyExpenseVoucherRows(sheet = {}) {
  const rows = sheet.values || [];
  const headers = (rows[0] || []).map(value => String(value || '').trim());
  const find = pattern => headers.findIndex(header => pattern.test(header));
  const voucherIndex = find(/bill \/ voucher/i);
  if (voucherIndex < 0) return [];
  return rows.slice(1).map((row, index) => {
    const rowIndex = index + 1;
    return {
      id: sheet.recordIds?.[rowIndex] || '', rowIndex,
      voucherNumber: String(row?.[voucherIndex] || '').trim(),
      date: dateValue(row, find(/^date$/i)), floor: value(row, find(/floor \/ area/i)),
      stage: value(row, find(/work stage/i)), category: value(row, find(/expense category/i)),
      description: value(row, find(/item \/ description/i)), paymentTo: value(row, find(/vendor \/ person/i)),
      amount: value(row, find(/amount paid/i)).replace(/[₹,\s]/g, ''), method: value(row, find(/payment mode/i)),
      paidBy: value(row, find(/paid by/i)), receivedBy: value(row, find(/received by/i)),
      billReceived: value(row, find(/bill received/i)), notes: value(row, find(/notes/i))
    };
  }).filter(row => row.voucherNumber);
}
function value(row, index) { return index < 0 ? '' : String(row?.[index] ?? ''); }
function dateValue(row, index) {
  const raw = row?.[index];
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date((raw - 25569) * 86400000).toISOString().slice(0, 10);
  return value(row, index);
}
function canCreateVoucherPayment(payments = [], sourceExpenseId, allowPartial = false, editingId) {
  return !sourceExpenseId || allowPartial || !payments.some(payment => payment.sourceExpenseId === sourceExpenseId && payment.id !== editingId);
}
function voucherRemainingAmount(expense, payments = [], editingId) {
  if (!expense) return null;
  const total = Number(String(expense.amount ?? '').replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(total)) return null;
  const paid = payments.filter(payment => payment.id !== editingId &&
    ((expense.id && payment.sourceExpenseId === expense.id) ||
     (!payment.sourceExpenseId && expense.voucherNumber && payment.voucherNumber === expense.voucherNumber)))
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  return Math.max(0, total - paid);
}
function validateAgreementLink(contractId, person, contracts = []) {
  if (!contractId) return true;
  const contract = contracts.find(item => item.id === contractId);
  return !!contract && contract.person === person;
}
module.exports = {getDailyExpenseVoucherRows, canCreateVoucherPayment, voucherRemainingAmount, validateAgreementLink};
