export type Role = 'owner' | 'viewer' | null;

export type SheetDocument = {
  name: string;
  range: string;
  values: any[][];
  formulas: string[][];
  updatedAt?: any;
  updatedBy?: string;
};

export type SheetMap = Record<string, SheetDocument>;

export type ActivityItem = {
  id: string;
  title?: string;
  body?: string;
  actorName?: string;
  sheetName?: string;
  createdAt?: any;
};

export type Quote = {
  item: string;
  unit: string;
  floorArea: string;
  vendors: {name: string; rate: string; deliveryDays: string; notes: string}[];
  selectedVendor: string;
  notes: string;
};
