function paymentIdForDocument(documentId) {
  const id = String(documentId || '').trim();
  if (!id) throw new Error('A payment document ID is required.');
  return `KSK-PAY-${id.toUpperCase()}`;
}
function isDuplicatePaymentRetry(recordAlreadyExists) {
  return recordAlreadyExists === true;
}
function validatePaymentRecord(values = {}) {
  const amount = Number(values.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive payment amount.');
  if (!String(values.paymentTo || values.person || '').trim()) throw new Error('Enter who was paid.');
  const date = String(values.date || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || !parsed || parsed.toISOString().slice(0, 10) !== date) throw new Error('Enter a valid payment date.');
  return true;
}
function summarizePaymentRecords(payments = [], contracts = []) {
  const paid = payments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const advances = payments.filter(item => String(item.paymentKind || '').toLowerCase() === 'advance').reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const contractValue = contracts.reduce((sum, item) => sum + (Number(item.agreedAmount) || 0), 0);
  const linked = contracts.map(contract => {
    const total = payments.filter(item => item.contractId === contract.id).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const agreed = Number(contract.agreedAmount) || 0;
    return {remaining: Math.max(0, agreed - total), overpaid: Math.max(0, total - agreed)};
  });
  return { paid, advances, contractValue, remaining: linked.reduce((sum,item)=>sum+item.remaining,0), overpaid: linked.reduce((sum,item)=>sum+item.overpaid,0), count: payments.length };
}
function normalizedPaymentParty(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function paymentStatementLedger(payment, allPayments = [payment], contracts = []) {
  if (!payment) {
    return { history: [], agreedAmount: null, totalPaid: 0, remainingBalance: null };
  }

  const party = normalizedPaymentParty(payment.paymentTo || payment.person);

  const accountPayments = payment.contractId
    ? allPayments.filter(row => row && row.contractId === payment.contractId)
    : party
      ? allPayments.filter(row =>
          normalizedPaymentParty(row.paymentTo || row.person) === party
        )
      : [payment];

  const unique = new Map();

  accountPayments.forEach(row => {
    if (!row) return;
    const key = String(row.id || row.paymentId || `${row.date || ''}-${row.amount || ''}`);
    if (!unique.has(key)) unique.set(key, row);
  });

  const history = [...unique.values()].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')) ||
    String(a.id || a.paymentId || '').localeCompare(String(b.id || b.paymentId || ''))
  );

  const contract = payment.contractId
    ? contracts.find(row => row.id === payment.contractId)
    : contracts.find(row => {
        const name = normalizedPaymentParty(
          row.person || row.paymentTo || row.vendor || row.contractor || row.name
        );
        return party && name === party;
      });

  const agreedAmount = contract ? Number(contract.agreedAmount) || 0 : null;
  const totalPaid = history.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  return {
    history,
    agreedAmount,
    totalPaid,
    remainingBalance: agreedAmount === null ? null : agreedAmount - totalPaid
  };
}
module.exports = { paymentIdForDocument, isDuplicatePaymentRetry, validatePaymentRecord, summarizePaymentRecords, paymentStatementLedger };
