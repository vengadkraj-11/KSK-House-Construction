export type InventorySummary = {
  material:string;unit:string;purchased:number;received:number;returnedToStock:number;
  returnedToSupplier:number;used:number;wastage:number;lowStockLevel:number;
  supplier:string;rate:number;available:number;lowStock:boolean;
};
export function summarizeInventory(records:any[]):InventorySummary[];
export function summarizeContracts(contracts:any[],payments:any[]):{contract:any;history:any[];advances:number;paid:number;agreed:number;balance:number;overpaid:number}[];
