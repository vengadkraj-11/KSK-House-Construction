export function paymentIdForDocument(documentId: string): string;
export function validatePaymentRecord(values?: Record<string, any>): true;
export function summarizePaymentRecords(payments?: any[], contracts?: any[]): {paid:number;advances:number;contractValue:number;remaining:number;overpaid:number;count:number};
