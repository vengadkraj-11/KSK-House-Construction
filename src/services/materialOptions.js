function getMaterialOptions(sheets = {}) {
  const result = [];
  for (const id of ['materials_ground', 'materials_first', 'materials_boq']) {
    const rows = sheets[id]?.values || [];
    const headers = (rows[0] || []).map(value => String(value || '').trim());
    const index = headers.findIndex(header => /material|item|description/i.test(header));
    if (index < 0) continue;
    for (const row of rows.slice(1)) {
      const value = String(row?.[index] || '').trim();
      if (value) result.push(value);
    }
  }
  return [...new Set(result)];
}

module.exports = {getMaterialOptions};
