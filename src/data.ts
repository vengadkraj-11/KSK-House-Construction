import workbook from '../assets/ksk_workbook.json';
import {SheetDocument, SheetMap} from './types';

export const SHEET_ORDER = [
  'project_dashboard', 'project_setup', 'materials_ground', 'materials_first',
  'materials_boq', 'labour_work', 'professional_fees', 'misc_equipment',
  'daily_expenses', 'work_schedule', 'floor_summary'
];

export const SHEET_TITLES: Record<string, string> = {
  project_dashboard: 'Project Dashboard',
  project_setup: 'Project Setup',
  materials_ground: 'Ground Floor Materials',
  materials_first: 'First Floor Materials',
  materials_boq: 'Materials & BOQ',
  labour_work: 'Labour & Work',
  professional_fees: 'Professional Fees',
  misc_equipment: 'Misc & Equipment',
  daily_expenses: 'Daily Expenses',
  work_schedule: 'Work Schedule',
  floor_summary: 'Floor Summary',
  quotation_compare: 'Quotation Compare'
};

export const ICONS: Record<string, string> = {
  project_dashboard: '◫', project_setup: '⚙', materials_ground: '▦',
  materials_first: '▦', materials_boq: '▤', labour_work: '♧',
  professional_fees: '▣', misc_equipment: '⌂', daily_expenses: '₹',
  work_schedule: '◷', floor_summary: '▥', quotation_compare: '⇄'
};

export const LOCAL_WORKBOOK: SheetMap = Object.fromEntries(
  Object.entries((workbook as any).sheets).map(([key, item]: [string, any]) => [key, {
    name: item.name,
    range: item.range,
    values: item.values,
    formulas: item.formulas
  } as SheetDocument])
);

export const QUOTE_TEMPLATE: SheetDocument = {
  name: 'Quotation Compare',
  range: 'A1:J1',
  values: [[
    'Item / Material', 'Unit', 'Floor / Area', 'Vendor 1', 'Rate 1 (₹)',
    'Vendor 2', 'Rate 2 (₹)', 'Vendor 3', 'Rate 3 (₹)', 'Selected Vendor / Notes'
  ]],
  formulas: [['', '', '', '', '', '', '', '', '', '']]
};

export function headersForSheet(sheetId: string, sheet: SheetDocument): string[] {
  const raw = (sheet.values?.[0] || []).map((v: any) => v == null ? '' : String(v));
  if (sheetId === 'professional_fees') {
    if (!raw[7]) raw[7] = 'Paid Amount';
    if (!raw[8]) raw[8] = 'Payment Notes';
  }
  if (sheetId === 'project_setup') return ['Setting', 'Value to fill', 'Notes'];
  return raw;
}

export function meaningfulRows(sheet: SheetDocument) {
  return (sheet.values || []).map((row, index) => ({row, index}))
    .filter(({row, index}) => index > 0 && row.some((v: any) => v !== null && v !== undefined && v !== '')
      || index > 0 && (sheet.formulas?.[index] || []).some((f: any) => !!f));
}

export function excelSerialToDate(value: any): string {
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') return value;
  return '';
}

export function dateToExcelSerial(value: string): any {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  return Math.round((date.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}

export function displayCell(sheetId: string, sheet: SheetDocument, rowIndex: number, colIndex: number): any {
  const row = sheet.values[rowIndex] || [];
  const formula = sheet.formulas?.[rowIndex]?.[colIndex];
  if (!formula) return row[colIndex];
  const num = (v: any) => v === null || v === '' || v === undefined ? 0 : Number(v) || 0;
  const has = (v: any) => v !== null && v !== '' && v !== undefined;
  const asDateNum = (v: any) => typeof v === 'number' ? v : (Number.isFinite(Date.parse(v)) ? Date.parse(v) / 86400000 + 25569 : 0);
  if (sheetId === 'materials_boq') {
    if (colIndex === 9) return has(row[6]) && has(row[7]) ? num(row[6]) * num(row[7]) * (1 + num(row[8])) : '';
    if (colIndex === 13) return has(row[6]) ? num(row[6]) - num(row[12]) : '';
  }
  if (sheetId === 'labour_work') {
    if (colIndex === 7) return has(row[5]) && has(row[6]) ? num(row[5]) * num(row[6]) : '';
    if (colIndex === 13) return has(row[7]) ? num(row[7]) - num(row[12]) : '';
  }
  if (sheetId === 'professional_fees') {
    if (colIndex === 5) return has(row[4]) ? num(row[4]) : '';
    const isSiteEngineer = /site\s*engineer/i.test(String(row[1] || ''));
    const paymentTotal = (sheet.values || []).slice(1).reduce(
      (sum: number, r: any[]) => sum + (!has(r[1]) && has(r[7]) ? num(r[7]) : 0), 0
    );
    if (colIndex === 9) {
      return isSiteEngineer ? (paymentTotal || '') : row[9];
    }
    if (colIndex === 10) {
      const paid = isSiteEngineer ? paymentTotal : num(row[9]);
      return has(row[5]) ? num(row[5]) - paid : '';
    }
  }
  if (sheetId === 'misc_equipment' && colIndex === 6) {
    return has(row[4]) && has(row[5]) ? num(row[4]) * num(row[5]) : '';
  }
  if ((sheetId === 'materials_ground' || sheetId === 'materials_first')) {
    if (colIndex === 9) return has(row[6]) && has(row[7]) ? num(row[6]) * num(row[7]) * (1 + num(row[8])) : '';
    if (colIndex === 15) return has(row[14]) && has(row[7]) ? num(row[14]) * num(row[7]) : '';
    if (colIndex === 16) return has(row[6]) ? num(row[6]) - num(row[14]) : '';
  }
  if (sheetId === 'work_schedule') {
    if (colIndex === 7) return has(row[3]) && has(row[4]) ? Math.max(0, asDateNum(row[4]) - asDateNum(row[3]) + 1) : '';
    if (colIndex === 14) return has(row[4]) && has(row[6]) ? Math.max(0, asDateNum(row[6]) - asDateNum(row[4])) : '';
  }
  return row[colIndex];
}
