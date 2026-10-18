export interface CollectionEntry {
  id:number; booking_id:number;kind:'opening'|'collection'|'reversal';amount:string;method:string;reference:string|null;
  note:string;actor_id:number|null;actor_name:string|null;created_at:string|null;reversal_of:number|null;can_reverse?:boolean;
}
export interface CollectionHistory {
  booking_id:number;status:string;price:string;received:string;outstanding:string;excess:string;required_advance:string;
  review_required:boolean;advance_review:boolean;entries:CollectionEntry[];
  gateway_history:{id:number;tran_id:string;amount:string;status:string;bank_tran_id:string|null}[];
}
export interface CollectionTotals {gross:string;corrections:string;net:string;}
export interface CollectionReport {
  start:string;end:string;page:number;page_size:number;total:number;items:CollectionEntry[];summary:CollectionTotals;
  by_method:(CollectionTotals&{method:string})[];by_staff:(CollectionTotals&{actor_id:number|null;actor_name:string|null})[];
  staff:{id:number;name:string}[];refunded_amount:string;refund_scope:string;
}
