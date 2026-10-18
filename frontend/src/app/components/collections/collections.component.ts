import {Component,OnInit,OnDestroy,inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Subscription,timeout} from 'rxjs';
import {ApiService} from '../../services/api.service';
import {CollectionReport} from '../../services/collections';
import {dhakaToday} from '../../services/calendar';
import {PaymentDialogComponent} from './payment-dialog.component';
@Component({selector:'app-collections',standalone:true,imports:[CommonModule,FormsModule,PaymentDialogComponent],templateUrl:'./collections.component.html',styleUrl:'./collections.component.css'})
export class CollectionsComponent implements OnInit,OnDestroy {
  private api=inject(ApiService);private read?:Subscription;private download?:Subscription;
  start=dhakaToday();end=this.start;method='';staff='';page=1;data:CollectionReport|null=null;error='';loading=false;exporting=false;bookingId:number|null=null;
  applied:Record<string,string>={start:this.start,end:this.end,method:'',staff_id:''};
  ngOnInit(){this.load();}ngOnDestroy(){this.read?.unsubscribe();this.download?.unsubscribe();}
  apply(){this.page=1;this.data=null;this.applied={start:this.start,end:this.end,method:this.method,staff_id:this.staff};this.load();}
  load(){this.read?.unsubscribe();this.loading=true;this.error='';this.read=this.api.getCollections({...this.applied,page:String(this.page)}).pipe(timeout(15000)).subscribe({next:d=>{this.data=d;this.loading=false;},error:e=>{this.loading=false;this.error=e.error?.message||'Collections could not be refreshed. Displayed data may be out of date.';}});}
  move(delta:number){this.page+=delta;this.data=null;this.load();}
  export(){if(this.exporting)return;this.exporting=true;this.error='';this.download=this.api.exportCollections(this.applied).pipe(timeout(30000)).subscribe({next:blob=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`collections-${this.applied['start']}-${this.applied['end']}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.exporting=false;},error:()=>{this.exporting=false;this.error='Export failed. Retry or choose a smaller date range.';}});}
}
