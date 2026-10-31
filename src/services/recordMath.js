function summarizeInventory(records = []) {
  const items = new Map();
  for (const row of records) {
    const material = String(row.material || 'Unspecified').trim();
    const unit = String(row.unit || 'units').trim();
    const key = `${material.toLocaleLowerCase()}|${unit.toLocaleLowerCase()}`;
    const stock = items.get(key) || {
      material, unit, purchased: 0, received: 0, returnedToStock: 0,
      returnedToSupplier: 0, used: 0, wastage: 0, lowStockLevel: 0,
      supplier: '', rate: 0
    };
    const quantity = Number(row.quantity) || 0;
    switch (String(row.direction || '').trim().toLowerCase()) {
      case 'purchase': case 'purchased': stock.purchased += quantity; break;
      case 'received': case 'receipt': stock.received += quantity; break;
      case 'returned-to-stock': stock.returnedToStock += quantity; break;
      case 'returned-to-supplier': stock.returnedToSupplier += quantity; break;
      case 'used': stock.used += quantity; break;
      case 'wastage': stock.wastage += quantity; break;
      // Old "returned" rows are deliberately excluded because destination is unknown.
    }
    const threshold = Number(row.lowStockLevel) || 0;
    const movementTime = timeValue(row.date) || timeValue(row.updatedAt) || timeValue(row.createdAt);
    if (movementTime >= (stock.latestMetadataTime ?? -1)) {
      stock.latestMetadataTime = movementTime;
      if (threshold) stock.lowStockLevel = threshold;
      if (Number.isFinite(Number(row.unitRate)) && Number(row.unitRate) > 0) stock.rate = Number(row.unitRate);
      if (row.supplier) stock.supplier = String(row.supplier);
    }
    items.set(key, stock);
  }
  return [...items.values()].map(({latestMetadataTime, ...item}) => ({
    ...item,
    available: item.received + item.returnedToStock - item.returnedToSupplier - item.used - item.wastage,
    lowStock: item.lowStockLevel > 0 && item.received + item.returnedToStock - item.returnedToSupplier - item.used - item.wastage <= item.lowStockLevel
  }));
}

function timeValue(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function summarizeContracts(contracts = [], payments = []) {
  return contracts.map(contract => {
    const history = payments.filter(payment => payment.contractId === contract.id);
    const isAdvance = payment => String(payment.paymentKind || '').trim().toLowerCase() === 'advance';
    const advances = history.filter(isAdvance).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    const paid = history.filter(payment => !isAdvance(payment)).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    const agreed = Number(contract.agreedAmount) || 0;
    const balance=Math.max(0,agreed-advances-paid);
    const overpaid=Math.max(0,advances+paid-agreed);
    return {contract, history, advances, paid, agreed, balance, overpaid};
  });
}

module.exports = {summarizeInventory, summarizeContracts};
