import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, timeout } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { newUuid } from '../../services/uuid';
import { NotificationDetail, NotificationEvent, NotificationPage, NotificationStatus } from '../../services/notifications';

@Component({ selector:'app-notifications', standalone:true, imports:[CommonModule,FormsModule], templateUrl:'./notifications.component.html', styleUrl:'./notifications.component.css' })
export class NotificationsComponent implements OnInit, OnDestroy {
  readonly api=inject(ApiService);
  data: NotificationPage | null=null;
  detail: NotificationDetail | null=null;
  bookingId: number | null=null;
  event: NotificationEvent | ''='';
  status: NotificationStatus | ''='';
  page=1; loading=false; detailLoading=false; retrying=false;
  error=''; detailError=''; notice='';
  private listRequest?: Subscription;
  private detailRequest?: Subscription;
  private retryRequest?: Subscription;
  private requestKeys=new Map<number,string>();
  private timer?: ReturnType<typeof setInterval>;
  readonly events: NotificationEvent[]=['booking_created','booking_confirmed','booking_cancelled','reminder'];
  readonly statuses: NotificationStatus[]=['queued','processing','retrying','sent','simulated','failed','skipped'];
  readonly labels: Record<string,string>={queued:'Queued',processing:'Processing',retrying:'Retrying',sent:'Accepted by SMS provider',simulated:'Simulated — no SMS sent',failed:'Failed',skipped:'Skipped',booking_created:'Booking request',booking_confirmed:'Booking confirmation',booking_cancelled:'Cancellation',reminder:'Game reminder',manual_send:'Manual send requested',manual_retry:'Manual retry requested',interrupted:'Worker interrupted'};
  readonly deliveryLabels: Record<string,string>={delivered:'Delivered (provider receipt)',failed:'Not delivered (provider receipt)'};
  readonly reasons: Record<string,string>={MANUAL_SEND_PENDING:'A manual send is already pending',NOT_SENDABLE:'This status cannot be sent manually',MOCK_SEND_FAILED:'Simulation failed',MOCK_SEND_FAILED_OR_TIMEOUT:'Simulation failed or timed out',WORKER_LEASE_EXPIRED:'Previous attempt interrupted',BOOKING_STATUS_CHANGED:'Booking status changed',BOOKING_NOT_APPROVED:'Booking is no longer approved',BOOKING_REMOVED:'Booking was removed',KICKOFF_PASSED:'Game has already started',SHORT_NOTICE_APPROVAL:'Approved less than 2 hours before kickoff',INVALID_KICKOFF:'Booking time needs correction',INVALID_RECIPIENT:'Phone number needs correction'};
  ngOnInit(): void { this.load(); this.timer=setInterval(()=>{if(!document.hidden&&!this.loading&&!this.retrying)this.load();},30000); }
  ngOnDestroy(): void {clearInterval(this.timer);this.listRequest?.unsubscribe();this.detailRequest?.unsubscribe();this.retryRequest?.unsubscribe();}
  applyFilters(): void {
    this.listRequest?.unsubscribe();this.detailRequest?.unsubscribe();this.detail=null;this.detailLoading=false;this.page=1;this.data=null;this.notice='';this.load();
  }
  load(): void {
    if(this.bookingId!==null&&(!Number.isInteger(this.bookingId)||this.bookingId<1)){this.listRequest?.unsubscribe();this.loading=false;this.error='Enter a valid booking ID.';return;}
    this.listRequest?.unsubscribe();this.loading=true;this.error='';
    this.listRequest=this.api.getNotifications({page:this.page,booking_id:this.bookingId,event:this.event,status:this.status}).pipe(timeout(15000)).subscribe({
      next:data=>{this.data=data;this.loading=false;if(this.detail)this.open(this.detail.id);},
      error:()=>{this.loading=false;this.error=this.data?'Refresh failed. The displayed statuses may be out of date.':'Notifications could not be loaded. Retry.';}
    });
  }
  move(delta:number): void {this.page+=delta;this.data=null;this.detail=null;this.detailLoading=false;this.detailRequest?.unsubscribe();this.load();}
  open(id:number): void {
    this.detailRequest?.unsubscribe();this.detailLoading=true;this.detailError='';
    this.detailRequest=this.api.getNotification(id).pipe(timeout(15000)).subscribe({next:data=>{this.detail=data;this.detailLoading=false;},error:()=>{this.detail=null;this.detailLoading=false;this.detailError='Notification details could not be loaded.';}});
  }
  close(): void {this.detailRequest?.unsubscribe();this.detail=null;this.detailLoading=false;this.detailError='';}
  resend(id:number): void {
    if(this.retrying)return;
    this.retrying=true;this.notice='';this.error='';
    const key=this.requestKeys.get(id)||newUuid();this.requestKeys.set(id,key);
    this.retryRequest=this.api.resendNotification(id,key).pipe(timeout(15000)).subscribe({next:()=>{this.requestKeys.delete(id);this.retrying=false;this.notice=this.data?.mode==='relay'?'Queued. It will be sent to the SMS provider within about a minute.':'Queued for simulation. No real SMS will be sent.';this.load();},error:e=>{if(e.status>=400&&e.status<500)this.requestKeys.delete(id);this.retrying=false;this.error=e.error?.message||'Send could not be confirmed. Refresh before trying again.';}});
  }
}
