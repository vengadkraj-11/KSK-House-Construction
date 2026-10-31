export type DailyExpenseVoucher = {id:string;rowIndex:number;voucherNumber:string;date:string;floor:string;stage:string;category:string;description:string;paymentTo:string;amount:string;method:string;paidBy:string;receivedBy:string;billReceived:string;notes:string};
export function getDailyExpenseVoucherRows(sheet?:any):DailyExpenseVoucher[];
export function canCreateVoucherPayment(payments:any[],sourceExpenseId:string,allowPartial?:boolean,editingId?:string):boolean;
export function validateAgreementLink(contractId:string,person:string,contracts:any[]):boolean;
