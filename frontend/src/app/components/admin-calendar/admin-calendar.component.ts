import { PaymentDialogComponent } from '../collections/payment-dialog.component';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, Subscription, catchError, of, switchMap, timeout } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { CALENDAR_STATUSES, CalendarCell, CalendarResponse, CalendarSlot, calendarRange, dhakaToday, shiftDate } from '../../services/calendar';
import { DialogDirective } from '../../directives/dialog.directive';

@Component({
  selector: 'app-admin-calendar', standalone: true,
  imports: [PaymentDialogComponent, CommonModule, FormsModule, DialogDirective],
  templateUrl: './admin-calendar.component.html', styleUrl: './admin-calendar.component.css'
})
export class AdminCalendarComponent implements OnInit, OnDestroy {
  readonly api = inject(ApiService);
  private router = inject(Router);
  private requests = new Subject<void>();
  private subscription = new Subscription();
  private timer?: ReturnType<typeof setInterval>;
  private onVisible = () => { if (!document.hidden) this.refresh(); };
  readonly statuses = CALENDAR_STATUSES;
  view: 'week' | 'day' = window.matchMedia('(max-width: 767px)').matches ? 'day' : 'week';
  selectedDate = dhakaToday();
  data: CalendarResponse | null = null;
  rows: { slot: CalendarSlot; cells: CalendarCell[] }[] = [];
  loading = false;
  error = '';
  selectedKey: string | null = null;
  paymentBookingId:number|null=null;
  openPayments(id:number):void {this.selectedKey=null;this.paymentBookingId=id;}

  ngOnInit(): void {
    this.subscription.add(this.requests.pipe(switchMap(() => {
      const [start, end] = calendarRange(this.selectedDate, this.view);
      if (this.data && (this.data.start_date !== start || this.data.end_date !== end)) {
        this.data = null;
        this.rows = [];
        this.selectedKey = null;
      }
      this.loading = true;
      this.error = '';
      return this.api.getAdminCalendar(start, end).pipe(timeout(15000), catchError(error => {
        if (error.status === 401 || error.status === 403) {
          this.data = null;
          this.rows = [];
          this.selectedKey = null;
          this.api.logout();
          this.router.navigate(['/admin/login']);
        }
        this.error = this.data ? 'Refresh failed. Displayed data may be out of date.' : 'Calendar could not be loaded. Please try again.';
        return of(null);
      }));
    })).subscribe(data => {
      this.loading = false;
      if (!data) return;
      this.data = data;
      const cells = new Map(data.cells.map(cell => [this.cellKey(cell), cell]));
      this.rows = data.slots.map(slot => ({ slot, cells: data.dates.map(date => cells.get(`${slot.id}:${date}`)!) }));
    }));
    this.refresh();
    this.timer = setInterval(() => { if (!document.hidden && !this.loading) this.refresh(); }, 30000);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.requests.complete();
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  refresh(): void { this.requests.next(); }
  changeView(view: 'week' | 'day'): void { this.view = view; this.selectedKey = null; this.refresh(); }
  changeDate(date: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) return;
    this.selectedDate = date;
    this.selectedKey = null;
    this.refresh();
  }
  move(direction: number): void { this.changeDate(shiftDate(this.selectedDate, direction * (this.view === 'week' ? 7 : 1))); }
  today(): void { this.changeDate(dhakaToday()); }
  isToday(date: string): boolean { return date === dhakaToday(); }
  cellKey(cell: CalendarCell): string { return `${cell.slot_id}:${cell.date}`; }
  trackRow(_index: number, row: { slot: CalendarSlot }): number { return row.slot.id; }
  trackCell(_index: number, cell: CalendarCell): string { return `${cell.slot_id}:${cell.date}`; }
  statusLabel(status: string): string { return this.statuses.find(item => item.key === status)?.label || status; }
  statusIcon(status: string): string { return this.statuses.find(item => item.key === status)?.icon || ''; }
  formatTime(time: string): string {
    const [hour, minute] = time.split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  }
  overnight(slot: CalendarSlot): boolean { return slot.end_time <= slot.start_time; }
  get range(): [string, string] { return calendarRange(this.selectedDate, this.view); }
  get selectedCell(): CalendarCell | undefined { return this.data?.cells.find(cell => this.cellKey(cell) === this.selectedKey); }
  get selectedSlot(): CalendarSlot | undefined { return this.data?.slots.find(slot => slot.id === this.selectedCell?.slot_id); }
}
