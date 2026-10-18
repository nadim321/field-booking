import { VenueInfoComponent } from '../venue/venue-info.component';
import { BrandingService } from '../../services/branding.service';
import { BrandComponent } from '../venue/brand.component';
import { VenueFooterComponent } from '../venue/venue-footer.component';
import { CustomerFaqComponent } from '../venue/customer-faq.component';
import { dhakaToday, shiftDate } from '../../services/calendar';
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, timeout } from 'rxjs';
import { DialogDirective } from '../../directives/dialog.directive';
import { BookingResult, PaymentOutcome, resultOutcome } from '../../services/payment-result';
import { ApiService } from '../../services/api.service';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';

interface TurfSlot {
  id: number;
  start_time: string;
  end_time: string;
  price: number;
  is_active: number;
  category: number | null;
  category_label: string | null;
  status: 'available' | 'held' | 'season_reserved' | 'pending' | 'approved' | 'blocked';
  block_reason: string | null;
  booking_details?: {
    booking_id: number;
    team_name?: string;
    payment_status: 'paid' | 'unpaid';
  };
}

interface HoldInfo {
  slot_id: number;
  booking_date: string;
  session_token: string;
  expires_at: string; // ISO timestamp from backend
}

@Component({
  selector: 'app-booking-portal',
  standalone: true,
  imports: [VenueInfoComponent, BrandComponent, VenueFooterComponent, CustomerFaqComponent, CommonModule, FormsModule, RouterLink, DialogDirective],
  templateUrl: './booking-portal.component.html',
  styleUrl: './booking-portal.component.css'
})
export class BookingPortalComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  language: 'en' | 'bn' = 'en';
  bookingStep: 'details' | 'payment' = 'details';
  submitting = false;
  policyAccepted = false;

  t(en: string, bn: string): string { return this.language === 'bn' ? bn : en; }

  get resultTitle(): string {
    const titles: Record<PaymentOutcome, [string, string]> = {
      checking: ['Checking payment status…', 'পেমেন্টের অবস্থা যাচাই হচ্ছে…'],
      success: ['Booking confirmed', 'বুকিং নিশ্চিত হয়েছে'],
      received: ['Payment received', 'পেমেন্ট পাওয়া গেছে'],
      approved: ['Booking approved', 'বুকিং অনুমোদিত'],
      requested: ['Booking requested', 'বুকিং অনুরোধ পাঠানো হয়েছে'],
      failed: ['Payment failed', 'পেমেন্ট ব্যর্থ হয়েছে'],
      cancelled: ['Payment cancelled', 'পেমেন্ট বাতিল হয়েছে'],
      error: ['Payment status unconfirmed', 'পেমেন্টের অবস্থা নিশ্চিত নয়'],
      booking_cancelled: ['Booking cancelled', 'বুকিং বাতিল হয়েছে']
    };
    return this.t(...titles[this.paymentResultOutcome || 'error']);
  }
  get resultDescription(): string {
    switch (this.paymentResultOutcome) {
      case 'checking': return this.t('Please wait while we verify the server record.', 'সার্ভারের তথ্য যাচাই করা পর্যন্ত অপেক্ষা করুন।');
      case 'success': return this.t('Your payment is verified and your booking is confirmed.', 'আপনার পেমেন্ট যাচাই হয়েছে এবং বুকিং নিশ্চিত।');
      case 'received': return this.t('Payment is verified. Booking approval is still pending.', 'পেমেন্ট যাচাই হয়েছে। বুকিং অনুমোদনের অপেক্ষায়।');
      case 'approved': return this.t('Staff approved this booking. This does not confirm an online payment.', 'কর্তৃপক্ষ বুকিং অনুমোদন করেছে। এটি অনলাইন পেমেন্টের নিশ্চয়তা নয়।');
      case 'requested': return this.t('Your request is pending admin approval.', 'আপনার অনুরোধ অনুমোদনের অপেক্ষায় আছে।');
      case 'failed': case 'cancelled': return this.t('The payment attempt ended. You may retry or contact the turf.', 'পেমেন্ট প্রচেষ্টা শেষ হয়েছে। আবার চেষ্টা করুন বা মাঠে যোগাযোগ করুন।');
      case 'booking_cancelled': return this.t('This booking remains cancelled. Contact the turf about any refund due.', 'বুকিংটি বাতিল রয়েছে। ফেরতযোগ্য টাকার জন্য মাঠে যোগাযোগ করুন।');
      default: return this.t('We could not verify payment. Check again or contact the turf with your booking ID before paying again.', 'পেমেন্ট যাচাই হয়নি। আবার টাকা দেওয়ার আগে অবস্থা যাচাই করুন বা বুকিং নম্বর নিয়ে মাঠে যোগাযোগ করুন।');
    }
  }

  toggleLanguage(): void {
    this.language = this.language === 'en' ? 'bn' : 'en';
    try { localStorage.setItem('booking-language', this.language); } catch { /* Storage may be unavailable. */ }
    this.branding.setCustomerPage('booking', this.language);
  }

  get advanceAmount(): number | null {
    const percentage = Number(this.appSettings?.advance_payment_percentage);
    if (!this.selectedSlot || !Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return null;
    return Math.round(Number(this.selectedSlot.price) * percentage) / 100;
  }

  get amountNow(): number | null { return this.paymentMethod === 'later' ? 0 : this.advanceAmount; }

  get amountDue(): number | null {
    return this.amountNow === null ? null : Math.round((Number(this.selectedSlot?.price || 0) - this.amountNow) * 100) / 100;
  }

  get validDetails(): boolean {
    return !!this.customerName.trim() && /^(?:\+?88)?01[3-9]\d{8}$/.test(this.customerPhone.trim())
      && (!this.customerEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.customerEmail.trim()));
  }

  reviewBooking(): void {
    if (this.validDetails && this.remainingSeconds > 0) this.bookingStep = 'payment';
  }

  selectedDate: string = '';
  tomorrowDate: string = '';
  onlyAvailable = false;
  slots: TurfSlot[] = [];
  loading: boolean = false;
  errorMsg: string = '';
  successMsg: string = '';

  // Booking Modal
  showModal: boolean = false;
  selectedSlot: TurfSlot | null = null;

  // Booking Form Fields
  customerName: string = '';
  customerPhone: string = '';
  customerEmail: string = '';
  teamName: string = '';
  paymentMethod: string = 'later'; // 'later', 'bkash', 'rocket', 'card'

  // Hold / countdown state
  holdInfo: HoldInfo | null = null;
  holdLoading: boolean = false;
  remainingSeconds: number = 0;
  private countdownIntervalId: ReturnType<typeof setInterval> | null = null;
  private slotsRefreshIntervalId: ReturnType<typeof setInterval> | null = null;

  // Notification Toast
  toastMsg: string = '';
  toastType: 'success' | 'error' | '' = '';
  todayDate: string = '';

  // Payment confirmation step -- shown after a booking is created with a
  // paid method selected, BEFORE redirecting to SSLCommerz. Per design
  // decision: the customer reviews the advance amount and explicitly
  // clicks "Pay Now" rather than being redirected immediately.
  showPaymentConfirm: boolean = false;
  paymentConfirmBookingId: number | null = null;
  paymentConfirmAmount: number | null = null;
  paymentConfirmLoading: boolean = false;
  paymentRedirecting = false;
  paymentConfirmError: string = '';

  // Full-page post-payment RESULT view -- shown when the customer is
  // redirected back from SSLCommerz (?payment=success|failed|cancelled|error).
  // One shared view with a state-driven outcome, rather than separate
  // pages, since all outcomes need the same booking summary card and only
  // the headline/actions differ.
  paymentResultOutcome: PaymentOutcome | null = null;
  paymentResultBooking: BookingResult | null = null;
  paymentResultLoading = false;
  private resultTimer?: ReturnType<typeof setTimeout>;
  private resultSubscription?: Subscription;
  private paymentTimer?: ReturnType<typeof setTimeout>;
  private paymentSubscription?: Subscription;
  private resultAttempts = 0;
  private paymentAttempts = 0;
  private paymentKeys = new Map<number, string>();

  paymentResultBookingId: number | null = null; // kept for "Try Again" retry

  // Public app settings (dynamic turf info)
  readonly branding = inject(BrandingService);
  get appSettings() { return this.branding.settings(); }

  ngOnInit(): void {
    try { this.language = localStorage.getItem('booking-language') === 'bn' ? 'bn' : 'en'; } catch { /* Use English. */ }
    this.todayDate = dhakaToday();
    this.selectedDate = this.todayDate;
    this.tomorrowDate = shiftDate(this.todayDate, 1);
    this.branding.setCustomerPage('booking', this.language);



    this.loadSlots();

    // Periodically refresh the slot list so "held" badges from other users'
    // sessions appear/disappear without requiring a manual date change.
    // Skips the refresh while this user has their own booking form open so
    // their in-progress form doesn't get yanked away by a list refresh.
    this.slotsRefreshIntervalId = setInterval(() => {
      if (!this.showModal) {
        this.loadSlots();
      }
    }, 15000);

    const params = this.route.snapshot.queryParamMap;
    let stored: string | null = null;
    try { stored = sessionStorage.getItem('booking-last-result'); } catch { /* Storage unavailable. */ }
    const bookingId = Number(params.get('booking_id') || stored);
    if (Number.isSafeInteger(bookingId) && bookingId > 0) this.showResult(bookingId);
    else if (params.has('payment')) this.paymentResultOutcome = 'error';
    if (params.has('payment')) this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  private rememberBooking(id: number): void {
    try { sessionStorage.setItem('booking-last-result', String(id)); } catch { /* Storage unavailable. */ }
  }
  showResult(id: number): void {
    this.rememberBooking(id);
    this.paymentResultBookingId = id;
    this.refreshPaymentResult();
  }
  refreshPaymentResult(): void {
    clearTimeout(this.resultTimer);
    this.resultSubscription?.unsubscribe();
    this.resultAttempts = 0;
    this.paymentResultOutcome = 'checking';
    this.pollResult();
  }
  private pollResult(): void {
    if (!this.paymentResultBookingId || !this.paymentResultOutcome) return;
    this.resultAttempts++;
    this.paymentResultLoading = true;
    this.resultSubscription = this.apiService.getBookingResult(this.paymentResultBookingId).pipe(timeout(8000)).subscribe({
      next: result => {
        this.paymentResultLoading = false;
        this.paymentResultBooking = result;
        this.paymentResultOutcome = resultOutcome(result);
        if (['failed', 'cancelled'].includes(this.paymentResultOutcome)) this.clearPaymentKey(result.booking_id);
        if (this.paymentResultOutcome === 'checking') this.scheduleResultPoll();
      },
      error: () => {
        this.paymentResultLoading = false;
        this.paymentResultBooking = null;
        this.paymentResultOutcome = 'checking';
        this.scheduleResultPoll();
      }
    });
  }
  private scheduleResultPoll(): void {
    if (this.resultAttempts >= 10) { this.paymentResultOutcome = 'error'; return; }
    this.resultTimer = setTimeout(() => this.pollResult(), 3000);
  }

  /** Dismisses the full-page payment result view, returning to normal browsing. */
  closePaymentResult(): void {
    clearTimeout(this.resultTimer);
    this.resultSubscription?.unsubscribe();
    try { sessionStorage.removeItem('booking-last-result'); } catch { /* Storage unavailable. */ }
    this.paymentResultOutcome = null;
    this.paymentResultBooking = null;
    this.paymentResultBookingId = null;
    this.loadSlots();
  }

  /** From the failed/cancelled result view -- retries payment for the
   * same booking by reopening the payment confirmation step. */
  retryPaymentFromResult(): void {
    if (!this.paymentResultBookingId) return;
    const bookingId = this.paymentResultBookingId;
    this.closePaymentResult();
    this.openPaymentConfirm(bookingId);
  }

  ngOnDestroy(): void {
    clearTimeout(this.resultTimer);
    clearTimeout(this.paymentTimer);
    this.resultSubscription?.unsubscribe();
    this.paymentSubscription?.unsubscribe();
    this.clearCountdown();
    if (this.slotsRefreshIntervalId) {
      clearInterval(this.slotsRefreshIntervalId);
    }
  }

  loadSlots(): void {
    if (!this.selectedDate) return;
    const requestedDate = this.selectedDate;
    this.loading = true;
    this.errorMsg = '';
    this.apiService.getAvailableSlots(this.selectedDate).subscribe({
      next: (res) => {
        if (requestedDate !== this.selectedDate) return;
        this.slots = res.slots;
        this.loading = false;
      },
      error: (err) => {
        if (requestedDate !== this.selectedDate) return;
        this.errorMsg = this.t('Could not load slots. Please try again.', 'স্লট লোড হয়নি। আবার চেষ্টা করুন।');
        this.loading = false;
        this.showToast(this.t('Error loading slots', 'স্লট লোড হয়নি'), 'error');
      }
    });
  }

  onDateChange(): void {
    // Changing date while a hold is active would leave an orphaned hold on
    // the previous date, so cancel it first.
    if (this.holdInfo) {
      this.cancelHoldSilently();
    }
    this.loadSlots();
  }

  selectDate(date: string): void {
    if (date === this.selectedDate || this.holdLoading) return;
    this.selectedDate = date;
    this.onDateChange();
  }

  get visibleAvailableCount(): number { return this.slots.filter(slot => slot.status === 'available').length; }

  /** Filters slots by their stored category field (set manually by the
   * admin -- never derived from start_time). Slots with no category
   * assigned yet (category === null) are deliberately excluded here and
   * shown separately via getUncategorizedSlots(), so nothing silently
   * disappears from the page while waiting to be categorized. */
  getSlotsByCategory(categoryId: number): TurfSlot[] {
    return this.slots.filter(slot => slot.category === categoryId && (!this.onlyAvailable || slot.status === 'available'));
  }

  getUncategorizedSlots(): TurfSlot[] {
    return this.slots.filter(slot => (slot.category === null || slot.category === undefined) && (!this.onlyAvailable || slot.status === 'available'));
  }

  /** Clean display text for the status badge (avoids showing a raw
   * underscore like "SEASON_RESERVED" to the customer). */
  statusLabel(status: TurfSlot['status']): string {
    const labels: Record<string, string> = { available: 'খালি', held: 'সাময়িক সংরক্ষিত', season_reserved: 'সিজন বুকিং', pending: 'অনুমোদনের অপেক্ষায়', approved: 'বুক করা', blocked: 'বন্ধ' };
    if (this.language === 'bn') return labels[status] || status;
    return status === 'season_reserved' ? 'SEASON BOOKING' : status.toUpperCase();
  }

  /** Converts a 24h "HH:MM" string to a friendly 12h "H:MM AM/PM" string.
   * Handles midnight ("00:00" -> "12:00 AM") and noon ("12:00" -> "12:00 PM")
   * correctly rather than showing "0:00". */
  formatTime12h(time24: string): string {
    const [hourStr, minuteStr] = time24.split(':');
    const hour = parseInt(hourStr, 10);
    const period = hour >= 12 ? 'PM' : 'AM';
    let displayHour = hour % 12;
    if (displayHour === 0) displayHour = 12;
    return `${displayHour}:${minuteStr} ${period}`;
  }

  /** Friendly "6:00 PM - 7:00 PM" style range for a slot card. Accepts
   * null so it can be called directly on `selectedSlot` in the modal,
   * which may be null before a slot is chosen. */
  formatTimeRange(slot: TurfSlot | null): string {
    if (!slot) return '';
    return `${this.formatTime12h(slot.start_time)} - ${this.formatTime12h(slot.end_time)}`;
  }

  /**
   * Called when the user clicks a slot card. Only 'available' slots are
   * clickable -- 'held', 'pending', and 'approved' slots are inert.
   * Places a server-side hold before showing the booking form, so the slot
   * is reserved for this user (and shows as 'held' to everyone else) for
   * the duration of the hold window while they fill in the form.
   */
  onSlotClick(slot: TurfSlot): void {
    if (slot.status !== 'available' || slot.is_active === 0 || this.holdLoading) return;

    const heldDate = this.selectedDate;
    this.holdLoading = true;
    this.apiService.holdSlot(slot.id, this.selectedDate).subscribe({
      next: (res) => {
        this.holdLoading = false;
        this.holdInfo = {
          slot_id: slot.id,
          booking_date: heldDate,
          session_token: res.session_token,
          expires_at: res.expires_at
        };
        this.selectedSlot = slot;
        this.showModal = true;
        this.bookingStep = 'details';
        this.policyAccepted = false;

        // Reset form fields
        // Preserve details when the customer changes slots or a hold expires.
        this.paymentMethod = 'later';

        this.startCountdown(res.expires_at);

        // Reflect the hold immediately in the local slot list so the card
        // turns grey/"Held" right away rather than waiting on the next poll.
        this.markSlotAsHeldLocally(slot.id);
      },
      error: (err) => {
        this.holdLoading = false;
        this.showToast(this.t('This slot is unavailable. Refresh and try again.', 'স্লটটি পাওয়া যাচ্ছে না। রিফ্রেশ করে আবার চেষ্টা করুন।'), 'error');
        this.loadSlots();
      }
    });
  }

  /** Kept for the template's existing handler name; delegates to onSlotClick. */
  openBookingModal(slot: TurfSlot): void {
    this.onSlotClick(slot);
  }

  private markSlotAsHeldLocally(slotId: number): void {
    const slot = this.slots.find(s => s.id === slotId);
    if (slot && slot.status === 'available') {
      slot.status = 'held';
    }
  }

  private startCountdown(expiresAtIso: string): void {
    this.clearCountdown();
    const expiresAtMs = new Date(expiresAtIso).getTime();

    const tick = () => {
      const msLeft = expiresAtMs - Date.now();
      this.remainingSeconds = Math.max(0, Math.ceil(msLeft / 1000));
      if (msLeft <= 0) {
        this.onHoldExpired();
      }
    };

    tick();
    this.countdownIntervalId = setInterval(tick, 1000);
  }

  private clearCountdown(): void {
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }
  }

  get remainingMinutesLabel(): string {
    const m = Math.floor(this.remainingSeconds / 60);
    const s = this.remainingSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private onHoldExpired(): void {
    this.clearCountdown();
    if (this.submitting) return;
    this.showToast(this.t('Your hold expired. Select a slot again; your details are kept.', 'সময় শেষ। আবার স্লট বেছে নিন; আপনার তথ্য রাখা হয়েছে।'), 'error');
    this.closeBookingModal();
    this.loadSlots();
  }

  /**
   * User clicked Cancel, or closed the modal without submitting.
   * Tells the backend to delete the hold immediately (rather than waiting
   * for it to expire naturally), then refreshes the slot list so the slot
   * becomes available again right away for other users.
   */
  closeBookingModal(): void {
    if (this.submitting) return;
    if (this.holdInfo) {
      this.cancelHoldSilently();
    }
    this.showModal = false;
    this.selectedSlot = null;
    this.holdInfo = null;
    this.clearCountdown();
    this.remainingSeconds = 0;
  }

  /** Fires the cancel-hold request without blocking the UI on its response. */
  private cancelHoldSilently(): void {
    const hold = this.holdInfo;
    if (!hold) return;
    this.apiService.cancelHold(hold.slot_id, hold.booking_date, hold.session_token).subscribe({
      next: () => this.loadSlots(),
      error: () => {
        // Non-fatal: the hold will still expire naturally via the existing
        // cron/admin cleanup if this request fails for any reason.
        this.loadSlots();
      }
    });
  }

  submitBooking(): void {
    if (!this.selectedSlot || !this.holdInfo || this.submitting || this.remainingSeconds <= 0 || !this.policyAccepted || !this.appSettings?.cancellation_policy?.version || this.bookingStep !== 'payment' || !this.validDetails || this.amountNow === null) return;
    if (!this.customerName || !this.customerPhone) {
      this.showToast(this.t('Name and phone number are required', 'নাম ও মোবাইল নম্বর দিন'), 'error');
      return;
    }

    const bookingData = {
      slot_id: this.selectedSlot.id,
      booking_date: this.holdInfo.booking_date,
      customer_name: this.customerName.trim(),
      customer_phone: this.customerPhone.trim(),
      customer_email: this.customerEmail.trim(),
      team_name: this.teamName,
      policy_accepted: this.policyAccepted,
      policy_version: this.appSettings?.cancellation_policy?.version,
      session_token: this.holdInfo.session_token
    };

    this.submitting = true;
    this.apiService.confirmBooking(bookingData).subscribe({
      next: (res) => {
        this.submitting = false;
        this.clearCountdown();
        const usedPaymentMethod = this.paymentMethod;
        this.rememberBooking(res.booking_id);

        // Hold has already been deleted server-side as part of confirm, so
        // just clear local hold state without firing another cancel call.
        this.showModal = false;
        this.selectedSlot = null;
        this.holdInfo = null;
        this.remainingSeconds = 0;

        this.loadSlots();

        // If paying now: show the confirmation step (review amount, then
        // an explicit "Pay Now" click) rather than redirecting immediately.
        if (usedPaymentMethod !== 'later') {
          this.openPaymentConfirm(res.booking_id);
        } else {
          this.showToast(this.t('Booking requested. Pending admin approval.', 'বুকিং অনুরোধ পাঠানো হয়েছে। অনুমোদনের অপেক্ষায়।'), 'success');
          this.showResult(res.booking_id);
        }
      },
      error: (err) => {
        this.submitting = false;
        const message = this.t('Booking submission failed. Your details are kept.', 'বুকিং পাঠানো যায়নি। আপনার তথ্য রাখা হয়েছে।');
        this.showToast(message, 'error');

        // A 400 here most likely means the hold expired or was invalidated
        // server-side between the countdown tick and submit -- treat it the
        // same as expiry locally so the UI doesn't get stuck showing a form
        // tied to a hold that no longer exists.
        if (err.status === 400) {
          this.showModal = false;
          this.selectedSlot = null;
          this.holdInfo = null;
          this.clearCountdown();
          this.remainingSeconds = 0;
        }
        this.loadSlots();
      }
    });
  }

  /**
   * Opens the payment confirmation step for a just-created booking. Calls
   * /api/payments/initiate up front so the exact advance amount is known
   * and shown to the customer before they commit to "Pay Now" -- the
   * actual redirect to SSLCommerz only happens when they click that
   * button (see confirmAndPay()), not here.
   */
  openPaymentConfirm(bookingId: number): void {
    this.rememberBooking(bookingId);
    this.paymentRedirecting = false;
    this._pendingGatewayUrl = null;
    this.paymentConfirmBookingId = bookingId;
    this.paymentConfirmAmount = null;
    this.paymentConfirmError = '';
    this.showPaymentConfirm = true;
    this.paymentConfirmLoading = true;

    clearTimeout(this.paymentTimer);
    this.paymentSubscription?.unsubscribe();
    this.paymentAttempts = 0;
    this.requestPayment(bookingId);
  }

  private paymentKey(id: number): string {
    let key = this.paymentKeys.get(id);
    try { key ||= sessionStorage.getItem('payment-key-' + id) || undefined; } catch { /* Storage unavailable. */ }
    key ||= crypto.randomUUID();
    this.paymentKeys.set(id, key);
    try { sessionStorage.setItem('payment-key-' + id, key); } catch { /* Storage unavailable. */ }
    return key;
  }
  private clearPaymentKey(id: number): void {
    this.paymentKeys.delete(id);
    try { sessionStorage.removeItem('payment-key-' + id); } catch { /* Storage unavailable. */ }
  }
  retryPaymentPreparation(): void {
    if (this.paymentConfirmBookingId) this.openPaymentConfirm(this.paymentConfirmBookingId);
  }
  private requestPayment(bookingId: number): void {
    this.paymentAttempts++;
    this.paymentSubscription = this.apiService.initiatePayment(bookingId, this.paymentKey(bookingId)).pipe(timeout(25000)).subscribe({
      next: res => {
        if (!this.showPaymentConfirm || this.paymentConfirmBookingId !== bookingId) return;
        if (res.state === 'initializing' && this.paymentAttempts < 10) {
          this.paymentTimer = setTimeout(() => this.requestPayment(bookingId), 3000);
          return;
        }
        this.paymentConfirmLoading = false;
        if (res.state === 'paid') {
          this.showPaymentConfirm = false;
          this.showResult(bookingId);
        } else if (res.state === 'ready' && res.gateway_page_url) {
          this.paymentConfirmAmount = res.amount;
          this._pendingGatewayUrl = res.gateway_page_url;
        } else {
          if (res.retryable) this.clearPaymentKey(bookingId);
          this.paymentConfirmError = res.retryable
            ? this.t('Payment attempt ended. You can try again.', 'পেমেন্ট প্রচেষ্টা শেষ হয়েছে। আবার চেষ্টা করতে পারেন।')
            : this.t('Payment status needs verification. Contact the turf before paying again.', 'পেমেন্ট যাচাই প্রয়োজন। আবার টাকা দেওয়ার আগে মাঠে যোগাযোগ করুন।');
        }
      },
      error: () => {
        this.paymentConfirmLoading = false;
        this.paymentConfirmError = this.t('Could not prepare payment. Retry to check the same attempt.', 'পেমেন্ট প্রস্তুত হয়নি। একই প্রচেষ্টার অবস্থা দেখতে আবার চেষ্টা করুন।');
      }
    });
  }

  private _pendingGatewayUrl: string | null = null;

  /** Customer clicked "Pay Now" -- this is the only place that actually
   * navigates the browser away to SSLCommerz's hosted payment page. */
  confirmAndPay(): void {
    if (!this._pendingGatewayUrl || this.paymentConfirmLoading) return;
    this.paymentConfirmLoading = true;
    this.paymentRedirecting = true;
    window.location.href = this._pendingGatewayUrl;
  }

  /** Customer chose to skip paying now ("Pay at the turf instead"). */
  closePaymentConfirm(): void {
    if (this.paymentRedirecting) return;
    clearTimeout(this.paymentTimer);
    this.paymentSubscription?.unsubscribe();
    this.showPaymentConfirm = false;
    this.paymentConfirmBookingId = null;
    this.paymentConfirmAmount = null;
    this._pendingGatewayUrl = null;
    this.showToast(this.t('Your booking is pending admin approval.', 'আপনার বুকিং অনুমোদনের অপেক্ষায় আছে।'), 'success');
  }

  showToast(message: string, type: 'success' | 'error'): void {
    this.toastMsg = message;
    this.toastType = type;
    setTimeout(() => {
      this.toastMsg = '';
      this.toastType = '';
    }, 4000);
  }

  downloadBookingSlip(bookingId: number): void {
    if (!bookingId) return;
    this.apiService.downloadBookingSlipPdf(bookingId).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `booking_slip_${bookingId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      },
      error: (err) => {
        this.showToast(this.t('Failed to download booking slip PDF.', 'বুকিং স্লিপ ডাউনলোড হয়নি।'), 'error');
      }
    });
  }
}
