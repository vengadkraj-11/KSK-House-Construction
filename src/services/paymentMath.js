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
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function uniquePayments(payments = []) {
  const unique = new Map();
  for (const row of payments) {
    if (!row) continue;
    const key = String(row.id || row.paymentId || `${row.date || ''}-${row.amount || ''}-${row.contractId || ''}`);
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

function agreementForPayment(payment, contracts = []) {
  if (payment?.contractId) return contracts.find(row => String(row.id) === String(payment.contractId)) || null;
  const party = normalizedPaymentParty(payment?.paymentTo || payment?.person);
  if (!party) return null;
  const matches = contracts.filter(row => normalizedPaymentParty(row.person || row.paymentTo || row.vendor || row.contractor || row.name) === party);
  return matches.length === 1 ? matches[0] : null;
}

function paymentStatementLedger(payment, allPayments = [payment], contracts = []) {
  if (!payment) {
    return { history: [], agreedAmount: null, totalPaid: 0, remainingBalance: null };
  }

  const agreement = agreementForPayment(payment, contracts);
  if (payment.contractId && !agreement) throw new Error(`The saved agreement “${payment.contractId}” could not be found. Re-select a valid agreement before exporting this payment PDF.`);
  const party = normalizedPaymentParty(payment.paymentTo || payment.person);
  const accountPayments = payment.contractId
    ? allPayments.filter(row => row && (String(row.contractId || '') === String(payment.contractId) || (!row.contractId && agreementForPayment(row, contracts)?.id === agreement.id)))
    : agreement
      ? allPayments.filter(row => !row.contractId && normalizedPaymentParty(row.paymentTo || row.person) === party)
      : allPayments.filter(row => !row.contractId && normalizedPaymentParty(row.paymentTo || row.person) === party);
  if (!accountPayments.some(row => row && (row.id && payment.id ? row.id === payment.id : row.paymentId && payment.paymentId ? row.paymentId === payment.paymentId : row === payment))) accountPayments.push(payment);
  const history = uniquePayments(accountPayments).sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')) ||
    String(a.id || a.paymentId || '').localeCompare(String(b.id || b.paymentId || ''))
  );

  const contract = agreement;

  const parsedAgreedAmount = contract ? Number(contract.agreedAmount) : NaN;
  const agreedAmount = Number.isFinite(parsedAgreedAmount) && contract.agreedAmount !== '' && contract.agreedAmount !== null && contract.agreedAmount !== undefined ? parsedAgreedAmount : null;
  const totalPaid = history.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  return {
    history,
    agreedAmount,
    totalPaid,
    remainingBalance: agreedAmount === null ? null : agreedAmount - totalPaid
  };
}

function paymentStatementAgreements(displayedPayments = [], allPayments = displayedPayments, contracts = []) {
  const displayed = uniquePayments(displayedPayments);
  const all = uniquePayments(allPayments);
  const included = new Map();
  displayed.forEach(payment => {
    const agreement = agreementForPayment(payment, contracts);
    if (payment.contractId && !agreement) throw new Error(`The saved agreement “${payment.contractId}” could not be found. Refresh agreements and retry the statement export.`);
    if (agreement) included.set(String(agreement.id), agreement);
  });
  return [...included.values()].map(agreement => {
    const payments = all.filter(row => row.contractId
      ? String(row.contractId) === String(agreement.id)
      : agreementForPayment(row, contracts)?.id === agreement.id);
    const totalPaid = payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const agreedAmount = Number(agreement.agreedAmount);
    const hasAgreedAmount = Number.isFinite(agreedAmount) && agreement.agreedAmount !== '' && agreement.agreedAmount !== null && agreement.agreedAmount !== undefined;
    return {agreement, agreedAmount: hasAgreedAmount ? agreedAmount : null, totalPaid,
      remainingBalance: hasAgreedAmount ? agreedAmount - totalPaid : null};
  });
}
module.exports = { paymentIdForDocument, isDuplicatePaymentRetry, validatePaymentRecord, summarizePaymentRecords, paymentStatementLedger, paymentStatementAgreements, agreementForPayment, uniquePayments };
