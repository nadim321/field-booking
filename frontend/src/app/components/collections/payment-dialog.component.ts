import {Component,Input,Output,EventEmitter,OnInit,OnDestroy,inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Subscription,timeout} from 'rxjs';
import {ApiService} from '../../services/api.service';
import {newUuid} from '../../services/uuid';
import {CollectionHistory} from '../../services/collections';
import {DialogDirective} from '../../directives/dialog.directive';
@Component({selector:'app-payment-dialog',standalone:true,imports:[CommonModule,FormsModule,DialogDirective],templateUrl:'./payment-dialog.component.html',styleUrl:'./collections.component.css'})
export class PaymentDialogComponent implements OnInit,OnDestroy {
  readonly api=inject(ApiService);private requests=new Subscription();private read?:Subscription;
  @Input({required:true}) bookingId!:number;
  @Output() closed=new EventEmitter<void>();@Output() changed=new EventEmitter<void>();
  data:CollectionHistory|null=null;loading=false;busy=false;error='';notice='';amount='';method='cash';reference='';note='';reason='';reversing:number|null=null;
  private pending:{signature:string;key:string}|null=null;
  ngOnInit(){this.load();}ngOnDestroy(){this.requests.unsubscribe();this.read?.unsubscribe();}
  load(){this.read?.unsubscribe();this.loading=true;this.error='';this.read=this.api.getCollectionHistory(this.bookingId).pipe(timeout(15000)).subscribe({next:d=>{this.data=d;this.loading=false;},error:()=>{this.loading=false;this.data=null;this.error='Payment history could not be loaded. Refresh before recording money.';}});}
  key(payload:unknown){const signature=JSON.stringify(payload);if(this.pending&&this.pending.signature!==signature)throw Error('Previous request is unconfirmed. Retry it unchanged or reopen after checking history.');if(!this.pending)this.pending={signature,key:newUuid()};return this.pending.key;}
  collect(){if(this.busy||!this.data)return;this.error='';this.notice='';const payload={amount:this.amount,method:this.method,reference:this.reference,note:this.note};let key:string;try{key=this.key(payload);}catch(e){this.error=(e as Error).message;return;}
    this.busy=true;this.requests.add(this.api.recordCollection(this.bookingId,{...payload,request_key:key}).pipe(timeout(15000)).subscribe({next:()=>{this.pending=null;this.busy=false;this.amount='';this.reference='';this.note='';this.notice='Payment recorded.';this.changed.emit();this.load();},error:e=>this.failed(e)}));}
  reverse(){if(this.busy||!this.reversing)return;this.error='';this.notice='';let key:string;try{key=this.key({id:this.reversing,reason:this.reason});}catch(e){this.error=(e as Error).message;return;}this.busy=true;
    this.requests.add(this.api.reverseCollection(this.reversing,{reason:this.reason,request_key:key}).pipe(timeout(15000)).subscribe({next:()=>{this.pending=null;this.busy=false;this.reversing=null;this.reason='';this.notice='Entry reversed. No refund was sent.';this.changed.emit();this.load();},error:e=>this.failed(e)}));}
  failed(e:any){this.busy=false;if(e.status>=400&&e.status<500)this.pending=null;this.error=e.error?.message||'Result unconfirmed. Check history and retry the same request; do not enter it twice.';}
}
