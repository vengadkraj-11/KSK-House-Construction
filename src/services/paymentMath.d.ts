export function paymentIdForDocument(documentId: string): string;
export function isDuplicatePaymentRetry(recordAlreadyExists: boolean): boolean;
export function validatePaymentRecord(values?: Record<string, any>): true;
export function summarizePaymentRecords(payments?: any[], contracts?: any[]): {paid:number;advances:number;contractValue:number;remaining:number;overpaid:number;count:number};
export function paymentStatementLedger(payment: any, allPayments?: any[], contracts?: any[]): {history:any[];agreedAmount:number|null;totalPaid:number;remainingBalance:number|null};
