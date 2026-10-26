import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-my-bookings', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  template: `<main class="my-bookings"><header><a routerLink="/">← Browse slots</a><button (click)="logout()">Log out</button></header><h1>My bookings</h1><p *ngIf="loading">Loading your bookings…</p><p class="error" *ngIf="error" role="alert">{{error}}</p>
    <p *ngIf="notice" class="notice" role="status">{{notice}}</p><section *ngIf="!loading"><h2>Bookings</h2><p *ngIf="!bookings.length">No bookings found for this phone number.</p><article *ngFor="let b of bookings"><div><strong>#{{b.booking_id}} · {{b.booking_date}}</strong><p>{{b.start_time}}–{{b.end_time}} · {{b.status}}</p><p *ngIf="b.cancellation_request_status">Cancellation request: {{b.cancellation_request_status}}</p></div><div><span>Payment: {{b.payment_status}} (৳{{b.amount_paid | number:'1.2-2'}})</span><span *ngIf="b.refund_amount != null">Refund: ৳{{b.refund_amount | number:'1.2-2'}} · {{b.refund_payout_status || 'manual review'}}</span><button *ngIf="b.status !== 'cancelled' && !['pending','reviewing'].includes(b.cancellation_request_status || '') && cancellationFormId !== b.booking_id" (click)="openCancellation(b)">Request cancellation</button><form *ngIf="cancellationFormId === b.booking_id" (ngSubmit)="submitCancellation(b)"><label>Why do you need to cancel?<textarea name="reason" [(ngModel)]="cancellationReason" maxlength="500" required></textarea></label><div><button type="submit" [disabled]="!cancellationReason.trim() || submitting">{{submitting ? 'Sending…' : 'Send request'}}</button><button type="button" (click)="closeCancellation()">Keep booking</button></div></form></div></article>
    <h2>Season requests</h2><p *ngIf="!recurring.length">No season booking requests found.</p><article *ngFor="let r of recurring"><div><strong>Every {{dayName(r.day_of_week)}}</strong><p>{{r.start_time}}–{{r.end_time}} · {{r.start_date}} to {{r.end_date}}</p></div><span>{{r.status.replace('_',' ')}}</span></article></section></main>`,
  styles: [`.my-bookings{max-width:900px;margin:3rem auto;padding:1.5rem;color:#172b22}.my-bookings header{display:flex;justify-content:space-between}.my-bookings article{display:flex;justify-content:space-between;gap:1rem;margin:.8rem 0;padding:1rem;border:1px solid #dce8df;border-radius:.8rem;background:#fff}.my-bookings article p{margin:.4rem 0 0}.my-bookings article div:last-child{display:grid;text-align:right}.my-bookings button{padding:.5rem .8rem;border:0;border-radius:.5rem;background:#176a40;color:white}.my-bookings form{text-align:left;min-width:min(320px,70vw)}.my-bookings form label{display:grid;gap:.4rem}.my-bookings textarea{min-height:5rem;padding:.6rem;border:1px solid #9ab5a2;border-radius:.5rem;font:inherit}.my-bookings form div{display:flex;gap:.4rem;margin-top:.5rem}.error{color:#b42318}.notice{color:#176a40}@media(max-width:600px){.my-bookings article{flex-direction:column}.my-bookings article div:last-child{text-align:left}}`]
})
export class MyBookingsComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  bookings: any[] = [];
  recurring: any[] = [];
  loading = true;
  error = '';
  notice = '';
  cancellationFormId: number | null = null;
  cancellationReason = '';
  submitting = false;
  ngOnInit(): void {
    this.api.getCustomerBookings().subscribe({ next: data => { this.bookings = data.bookings || []; this.recurring = data.recurring_bookings || []; this.loading = false; }, error: e => { this.error = e.error?.message || 'Could not load bookings.'; this.loading = false; } });
  }
  dayName(day: number): string { return new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + day))); }
  openCancellation(booking: any): void { this.cancellationFormId = booking.booking_id; this.cancellationReason = ''; this.error = ''; }
  closeCancellation(): void { if (!this.submitting) this.cancellationFormId = null; }
  submitCancellation(booking: any): void {
    if (this.submitting || !this.cancellationReason.trim()) return;
    this.submitting = true;
    this.api.requestBookingCancellation(booking.booking_id, this.cancellationReason.trim()).subscribe({ next: () => { this.notice = 'Cancellation request sent. The venue will review it.'; this.submitting = false; this.cancellationFormId = null; this.api.getCustomerBookings().subscribe({ next: data => this.bookings = data.bookings || [] }); }, error: e => { this.submitting = false; this.error = e.error?.message || 'Could not send cancellation request.'; } });
  }
  logout(): void { this.api.logoutCustomer(); this.router.navigate(['/']); }
}
