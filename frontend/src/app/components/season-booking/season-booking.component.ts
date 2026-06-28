import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

interface SlotOption {
  id: number;
  start_time: string;
  end_time: string;
  price: number;
  is_active: number;
}

@Component({
  selector: 'app-season-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './season-booking.component.html',
  styleUrl: './season-booking.component.css'
})
export class SeasonBookingComponent implements OnInit {
  private apiService = inject(ApiService);

  // Self-serve cap, mirrored client-side from the backend's
  // MAX_RECURRING_RANGE_MONTHS so the date picker can't even let the user
  // pick something the server will reject. The server still re-validates
  // independently -- this is just for a better experience, not security.
  readonly MAX_RANGE_MONTHS = 3;

  todayDate: string = '';
  maxEndDate: string = '';

  // Available slots for the chosen day-of-week, loaded once a start date
  // is picked so prices/times shown are accurate for that weekday.
  slotOptions: SlotOption[] = [];
  loadingSlots: boolean = false;

  // Form fields
  startDate: string = '';
  endDate: string = '';
  selectedSlotId: number | null = null;
  customerName: string = '';
  customerPhone: string = '';
  customerEmail: string = '';
  teamName: string = '';

  submitting: boolean = false;
  submitted: boolean = false;
  errorMsg: string = '';

  // Toast (mirrors booking-portal.component.ts pattern)
  toastMsg: string = '';
  toastType: 'success' | 'error' | '' = '';

  ngOnInit(): void {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    this.todayDate = `${yyyy}-${mm}-${dd}`;
  }

  get selectedDayName(): string {
    if (!this.startDate) return '';
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const d = new Date(this.startDate + 'T00:00:00');
    return dayNames[d.getDay()];
  }

  /** Called when the user picks/changes the start date. */
  onStartDateChange(): void {
    this.errorMsg = '';
    this.selectedSlotId = null;
    this.slotOptions = [];

    if (!this.startDate) {
      this.maxEndDate = '';
      this.endDate = '';
      return;
    }

    // Recompute the max allowed end date client-side (mirrors backend cap).
    const start = new Date(this.startDate + 'T00:00:00');
    const max = new Date(start);
    max.setMonth(max.getMonth() + this.MAX_RANGE_MONTHS);
    this.maxEndDate = max.toISOString().split('T')[0];

    // If a previously chosen end date is now out of range, clear it.
    if (this.endDate && (this.endDate <= this.startDate || this.endDate > this.maxEndDate)) {
      this.endDate = '';
    }

    this.loadSlotsForDate();
  }

  /**
   * Loads the slot list for the chosen start date, reusing the existing
   * public availability endpoint (which already returns start_time,
   * end_time, price, is_active for every active slot). We only need the
   * slot catalog here, not per-date booking status, so any returned date
   * works, but the actual start_date keeps prices accurate if the admin
   * runs time-of-day pricing changes later.
   */
  loadSlotsForDate(): void {
    if (!this.startDate) return;
    this.loadingSlots = true;
    this.apiService.getAvailableSlots(this.startDate).subscribe({
      next: (res) => {
        this.slotOptions = (res.slots || []).filter((s: any) => s.is_active !== 0);
        this.loadingSlots = false;
      },
      error: () => {
        this.errorMsg = 'Failed to load available slot times. Please try again.';
        this.loadingSlots = false;
      }
    });
  }

  get selectedSlot(): SlotOption | undefined {
    return this.slotOptions.find(s => s.id === this.selectedSlotId);
  }

  /** Converts a 24h "HH:MM" string to a friendly 12h "H:MM AM/PM" string.
   * Same logic as booking-portal.component.ts, kept in sync for a
   * consistent customer-facing time format across the whole site. */
  formatTime12h(time24: string): string {
    const [hourStr, minuteStr] = time24.split(':');
    const hour = parseInt(hourStr, 10);
    const period = hour >= 12 ? 'PM' : 'AM';
    let displayHour = hour % 12;
    if (displayHour === 0) displayHour = 12;
    return `${displayHour}:${minuteStr} ${period}`;
  }

  /** Friendly "6:00 PM - 7:00 PM" style range for a slot option. */
  formatTimeRange(slot: SlotOption): string {
    return `${this.formatTime12h(slot.start_time)} - ${this.formatTime12h(slot.end_time)}`;
  }

  submitRequest(): void {
    this.errorMsg = '';

    if (!this.startDate || !this.endDate || !this.selectedSlotId || !this.customerName || !this.customerPhone) {
      this.errorMsg = 'Please fill in all required fields.';
      return;
    }

    if (this.endDate <= this.startDate) {
      this.errorMsg = 'End date must be after start date.';
      return;
    }

    if (this.endDate > this.maxEndDate) {
      this.errorMsg = `Season bookings can run for a maximum of ${this.MAX_RANGE_MONTHS} months.`;
      return;
    }

    this.submitting = true;
    this.apiService.createRecurringBooking({
      slot_id: this.selectedSlotId,
      start_date: this.startDate,
      end_date: this.endDate,
      customer_name: this.customerName,
      customer_phone: this.customerPhone,
      customer_email: this.customerEmail || undefined,
      team_name: this.teamName || undefined
    }).subscribe({
      next: () => {
        this.submitting = false;
        this.submitted = true;
        this.showToast('Season booking request submitted! Awaiting admin approval.', 'success');
      },
      error: (err) => {
        this.submitting = false;
        this.errorMsg = err.error?.message || 'Failed to submit season booking request.';
        this.showToast(this.errorMsg, 'error');
      }
    });
  }

  resetForm(): void {
    this.submitted = false;
    this.startDate = '';
    this.endDate = '';
    this.maxEndDate = '';
    this.selectedSlotId = null;
    this.slotOptions = [];
    this.customerName = '';
    this.customerPhone = '';
    this.customerEmail = '';
    this.teamName = '';
    this.errorMsg = '';
  }

  showToast(message: string, type: 'success' | 'error'): void {
    this.toastMsg = message;
    this.toastType = type;
    setTimeout(() => {
      this.toastMsg = '';
      this.toastType = '';
    }, 4000);
  }
}