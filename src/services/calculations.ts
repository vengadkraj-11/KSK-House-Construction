import {SheetMap, SheetDocument} from '../types';

const n = (v: any) => Number(v) || 0;
const has = (v: any) => v !== null && v !== undefined && v !== '';
const rows = (sheet?: SheetDocument) => sheet?.values?.slice(1) || [];

export type DashboardNumbers = {
  materialsBudget: number;
  materialsPaid: number;
  labourBudget: number;
  labourPaid: number;
  feesBudget: number;
  feesPaid: number;
  miscBudget: number;
  miscPaid: number;
  contingency: number;
  totalBudget: number;
  totalPaid: number;
  totalRemaining: number;
  dailyExpenses: number;
  progress: number;
};

export function calculateDashboard(sheets: SheetMap): DashboardNumbers {
  const materials = rows(sheets.materials_boq);
  const labour = rows(sheets.labour_work);
  const fees = rows(sheets.professional_fees);
  const misc = rows(sheets.misc_equipment);
  const daily = rows(sheets.daily_expenses);
  const schedule = rows(sheets.work_schedule);
  const setup = sheets.project_setup?.values || [];

  const materialsBudget = materials.reduce((sum, r, index) => {
    const formula = sheets.materials_boq?.formulas?.[index + 1]?.[9];
    const amount = formula ? (has(r[6]) && has(r[7]) ? n(r[6]) * n(r[7]) * (1 + n(r[8])) : 0) : (has(r[9]) ? n(r[9]) : 0);
    return sum + amount;
  }, 0);
  const materialsPaid = materials.reduce((sum, r) => sum + n(r[14]), 0);
  const labourBudget = labour.reduce((sum, r, index) => {
    const formula = sheets.labour_work?.formulas?.[index + 1]?.[7];
    return sum + (formula ? (has(r[5]) && has(r[6]) ? n(r[5]) * n(r[6]) : 0) : (has(r[7]) ? n(r[7]) : 0));
  }, 0);
  const labourPaid = labour.reduce((sum, r) => sum + n(r[12]), 0);
  const feesBudget = fees.reduce((sum, r, index) => {
    const formula = sheets.professional_fees?.formulas?.[index + 1]?.[5];
    return sum + (formula ? n(r[4]) : (has(r[5]) ? n(r[5]) : n(r[4])));
  }, 0);
  const feesPaid = fees.reduce((sum, r, index) => {
    const formula = sheets.professional_fees?.formulas?.[index + 1]?.[9];
    if (formula) return sum; // calculated from the payment-detail rows below
    return sum + n(r[9]);
  }, 0) + fees.reduce((sum, r) => sum + (!has(r[1]) && has(r[7]) ? n(r[7]) : 0), 0);
  const miscBudget = misc.reduce((sum, r, index) => {
    const formula = sheets.misc_equipment?.formulas?.[index + 1]?.[6];
    return sum + (formula ? (has(r[4]) && has(r[5]) ? n(r[4]) * n(r[5]) : 0) : (has(r[6]) ? n(r[6]) : 0));
  }, 0);
  const miscPaid = misc.reduce((sum, r) => sum + n(r[7]), 0);
  const contingencyRate = n(setup?.[6]?.[1]);
  const base = materialsBudget + labourBudget + feesBudget + miscBudget;
  const contingency = base * contingencyRate;
  const totalBudget = base + contingency;
  const totalPaid = materialsPaid + labourPaid + feesPaid + miscPaid;
  const dailyExpenses = daily.reduce((sum, r) => sum + n(r[7]), 0);
  const progressRows = schedule.filter(r => has(r[2]));
  const progress = progressRows.length
    ? progressRows.reduce((sum, r) => sum + Math.max(0, Math.min(100, n(r[11]))), 0) / progressRows.length
    : 0;

  return {
    materialsBudget, materialsPaid, labourBudget, labourPaid,
    feesBudget, feesPaid, miscBudget, miscPaid, contingency,
    totalBudget, totalPaid, totalRemaining: Math.max(0, totalBudget - totalPaid),
    dailyExpenses, progress
  };
}

export function calculateFloorSummary(sheets: SheetMap) {
  const materialRows = rows(sheets.materials_boq);
  const labourRows = rows(sheets.labour_work);
  const floors = ['Ground Floor', 'First Floor', 'Common/External'];
  return floors.map(floor => {
    const material = materialRows.reduce((s, r, index) => {
      if (r[1] !== floor) return s;
      const formula = sheets.materials_boq?.formulas?.[index + 1]?.[9];
      return s + (formula ? (has(r[6]) && has(r[7]) ? n(r[6]) * n(r[7]) * (1 + n(r[8])) : 0) : n(r[9]));
    }, 0);
    const labour = labourRows.reduce((s, r, index) => {
      if (r[1] !== floor) return s;
      const formula = sheets.labour_work?.formulas?.[index + 1]?.[7];
      return s + (formula ? (has(r[5]) && has(r[6]) ? n(r[5]) * n(r[6]) : 0) : n(r[7]));
    }, 0);
    return {floor, materials: material, labour, total: material + labour};
  });
}

export function countMaterials(sheets: SheetMap) {
  const boq = rows(sheets.materials_boq);
  const ground = rows(sheets.materials_ground);
  const first = rows(sheets.materials_first);
  const received = boq.reduce((sum, r) => sum + n(r[12]), 0);
  const planned = boq.reduce((sum, r) => sum + n(r[6]), 0);
  const stockLines = [...ground, ...first].filter(r => has(r[3])).length;
  return {received, planned, stockLines};
}
