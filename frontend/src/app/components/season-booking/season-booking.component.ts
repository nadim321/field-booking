import { BrandComponent } from '../venue/brand.component';
import { VenueFooterComponent } from '../venue/venue-footer.component';
import { CustomerFaqComponent } from '../venue/customer-faq.component';
import { BrandingService } from '../../services/branding.service';
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { dhakaToday } from '../../services/calendar';

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
  imports: [BrandComponent, VenueFooterComponent, CustomerFaqComponent, CommonModule, FormsModule, RouterLink],
  templateUrl: './season-booking.component.html',
  styleUrl: './season-booking.component.css'
})
export class SeasonBookingComponent implements OnInit {
  private apiService = inject(ApiService);
  private branding = inject(BrandingService);
  language: 'en' | 'bn' = 'en';
  private slotRequest = 0;

  t(en: string, bn: string): string { return this.language === 'bn' ? bn : en; }
  toggleLanguage(): void {
    this.language = this.language === 'en' ? 'bn' : 'en';
    try { localStorage.setItem('booking-language', this.language); } catch { /* Storage may be unavailable. */ }
    this.branding.setCustomerPage('season', this.language);
  }

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
  otpCode = '';
  otpSent = false;
  phoneVerified = false;

  // Toast (mirrors booking-portal.component.ts pattern)
  toastMsg: string = '';
  toastType: 'success' | 'error' | '' = '';

  ngOnInit(): void {
    try { this.language = localStorage.getItem('booking-language') === 'bn' ? 'bn' : 'en'; } catch { /* Use English. */ }
    this.todayDate = dhakaToday();
    this.branding.setCustomerPage('season', this.language);
  }

  get selectedDayName(): string {
    if (!this.startDate) return '';
    const locale = this.language === 'bn' ? 'bn-BD' : 'en-US';
    return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${this.startDate}T00:00:00Z`));
  }

  /** Called when the user picks/changes the start date. */
  onStartDateChange(): void {
    this.errorMsg = '';
    this.selectedSlotId = null;
    this.slotOptions = [];

    if (!this.startDate) {
      this.slotRequest++;
      this.loadingSlots = false;
      this.maxEndDate = '';
      this.endDate = '';
      return;
    }

    // Recompute the max allowed end date client-side (mirrors backend cap).
    const [year, month, day] = this.startDate.split('-').map(Number);
    const max = new Date(Date.UTC(year, month - 1, day));
    max.setUTCMonth(max.getUTCMonth() + this.MAX_RANGE_MONTHS);
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
    const requestDate = this.startDate;
    const request = ++this.slotRequest;
    this.loadingSlots = true;
    this.apiService.getAvailableSlots(requestDate).subscribe({
      next: (res) => {
        if (request !== this.slotRequest || requestDate !== this.startDate) return;
        this.slotOptions = (res.slots || []).filter((s: any) => s.is_active !== 0);
        this.loadingSlots = false;
      },
      error: () => {
        if (request !== this.slotRequest || requestDate !== this.startDate) return;
        this.errorMsg = this.t('Failed to load available slot times. Please try again.', 'খালি স্লট লোড হয়নি। আবার চেষ্টা করুন।');
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
      this.errorMsg = this.t('Please fill in all required fields.', 'প্রয়োজনীয় সব তথ্য পূরণ করুন।');
      return;
    }

    if (this.endDate <= this.startDate) {
      this.errorMsg = this.t('End date must be after start date.', 'শেষ তারিখ শুরুর তারিখের পরে হতে হবে।');
      return;
    }

    if (this.endDate > this.maxEndDate) {
      this.errorMsg = this.t(`Season bookings can run for a maximum of ${this.MAX_RANGE_MONTHS} months.`, `সিজন বুকিং সর্বোচ্চ ${this.MAX_RANGE_MONTHS} মাসের জন্য করা যাবে।`);
      return;
    }

    if (!this.otpSent) {
      this.submitting = true;
      this.apiService.requestCustomerOtp(this.customerPhone).subscribe({
        next: result => { this.otpSent = true; this.otpCode = result.debug_code || ''; this.submitting = false; },
        error: err => { this.submitting = false; this.errorMsg = err.error?.message || this.t('Could not send verification code.', 'যাচাই কোড পাঠানো যায়নি।'); }
      });
      return;
    }
    if (!this.phoneVerified) {
      this.submitting = true;
      this.apiService.verifyCustomerOtp(this.customerPhone, this.otpCode).subscribe({
        next: () => { this.phoneVerified = true; this.createSeasonRequest(); },
        error: err => { this.submitting = false; this.errorMsg = err.error?.message || this.t('Code verification failed.', 'কোড যাচাই করা যায়নি।'); }
      });
      return;
    }
    this.createSeasonRequest();
  }

  onPhoneChange(): void { this.otpSent = false; this.phoneVerified = false; this.otpCode = ''; }

  private createSeasonRequest(): void {
    if (!this.selectedSlotId) { this.submitting = false; return; }

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
        this.showToast(this.t('Season booking request submitted! Awaiting venue approval.', 'সিজন বুকিং অনুরোধ পাঠানো হয়েছে। মাঠ কর্তৃপক্ষের অনুমোদনের অপেক্ষায় আছে।'), 'success');
      },
      error: (err) => {
        this.submitting = false;
        const serverMessage = err.error?.message || '';
        this.errorMsg = serverMessage.startsWith('Season booking range cannot exceed')
          ? this.t(serverMessage, `সিজন বুকিং সর্বোচ্চ ${this.MAX_RANGE_MONTHS} মাসের জন্য করা যাবে।`)
          : serverMessage === 'Selected slot is not active or does not exist'
            ? this.t('The selected slot is no longer available. Choose another time.', 'নির্বাচিত স্লটটি আর পাওয়া যাচ্ছে না। অন্য সময় বেছে নিন।')
            : (this.language === 'bn' ? (serverMessage ? 'অনুরোধ পাঠানো যায়নি। তথ্য যাচাই করে আবার চেষ্টা করুন।' : 'সিজন বুকিং অনুরোধ পাঠানো যায়নি। আবার চেষ্টা করুন।') : serverMessage || 'Failed to submit season booking request.');
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
    this.branding.setCustomerPage('season', this.language);
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
