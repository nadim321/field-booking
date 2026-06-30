import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './booking-portal.component.html',
  styleUrl: './booking-portal.component.css'
})
export class BookingPortalComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  selectedDate: string = '';
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
  paymentConfirmError: string = '';

  // Full-page post-payment RESULT view -- shown when the customer is
  // redirected back from SSLCommerz (?payment=success|failed|cancelled|error).
  // One shared view with a state-driven outcome, rather than separate
  // pages, since all outcomes need the same booking summary card and only
  // the headline/actions differ.
  paymentResultOutcome: 'success' | 'failed' | 'cancelled' | 'error' | null = null;
  paymentResultBooking: {
    booking_id: number;
    booking_date: string;
    start_time: string;
    end_time: string;
    price: number;
    amount_paid: number;
    balance_due: number;
    status: string;
    payment_status: string;
  } | null = null;
  paymentResultLoading: boolean = false;
  paymentResultBookingId: number | null = null; // kept for "Try Again" retry

  ngOnInit(): void {
    // Set default date to today in YYYY-MM-DD local format
    this.todayDate = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    this.selectedDate = `${yyyy}-${mm}-${dd}`;

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

    // After a customer pays via SSLCommerz, the backend redirects back
    // here with ?payment=success|failed|cancelled&booking_id=X (see
    // GET /api/payments/success in server.js). Show a full-page result
    // view (booking summary + outcome) rather than just a toast, then
    // strip the query params so refreshing the page doesn't re-show it.
    const params = this.route.snapshot.queryParamMap;
    const paymentResult = params.get('payment');
    const bookingIdParam = params.get('booking_id');

    if (paymentResult === 'success' || paymentResult === 'failed' || paymentResult === 'cancelled' || paymentResult === 'error') {
      this.paymentResultOutcome = paymentResult;
      const bookingId = bookingIdParam ? parseInt(bookingIdParam, 10) : null;
      this.paymentResultBookingId = bookingId;

      if (bookingId) {
        this.paymentResultLoading = true;
        this.apiService.getBookingResult(bookingId).subscribe({
          next: (res) => {
            this.paymentResultLoading = false;
            this.paymentResultBooking = res;
          },
          error: () => {
            this.paymentResultLoading = false;
            // Booking summary couldn't be fetched -- the outcome message
            // alone still tells the customer what happened, just without
            // the detail card.
            this.paymentResultBooking = null;
          }
        });
      }
    }
    if (paymentResult) {
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  /** Dismisses the full-page payment result view, returning to normal browsing. */
  closePaymentResult(): void {
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
    this.clearCountdown();
    if (this.slotsRefreshIntervalId) {
      clearInterval(this.slotsRefreshIntervalId);
    }
  }

  loadSlots(): void {
    if (!this.selectedDate) return;
    this.loading = true;
    this.errorMsg = '';
    this.apiService.getAvailableSlots(this.selectedDate).subscribe({
      next: (res) => {
        this.slots = res.slots;
        this.loading = false;
      },
      error: (err) => {
        this.errorMsg = err.error?.message || 'Failed to load turf slots. Make sure backend is running.';
        this.loading = false;
        this.showToast('Error loading slots', 'error');
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

  /** Filters slots by their stored category field (set manually by the
   * admin -- never derived from start_time). Slots with no category
   * assigned yet (category === null) are deliberately excluded here and
   * shown separately via getUncategorizedSlots(), so nothing silently
   * disappears from the page while waiting to be categorized. */
  getSlotsByCategory(categoryId: number): TurfSlot[] {
    return this.slots.filter(slot => slot.category === categoryId);
  }

  getUncategorizedSlots(): TurfSlot[] {
    return this.slots.filter(slot => slot.category === null || slot.category === undefined);
  }

  /** Clean display text for the status badge (avoids showing a raw
   * underscore like "SEASON_RESERVED" to the customer). */
  statusLabel(status: TurfSlot['status']): string {
    if (status === 'season_reserved') return 'SEASON BOOKING';
    if (status === 'blocked') return 'BLOCKED';
    return status.toUpperCase();
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

    this.holdLoading = true;
    this.apiService.holdSlot(slot.id, this.selectedDate).subscribe({
      next: (res) => {
        this.holdLoading = false;
        this.holdInfo = {
          slot_id: slot.id,
          booking_date: this.selectedDate,
          session_token: res.session_token,
          expires_at: res.expires_at
        };
        this.selectedSlot = slot;
        this.showModal = true;

        // Reset form fields
        this.customerName = '';
        this.customerPhone = '';
        this.customerEmail = '';
        this.teamName = '';
        this.paymentMethod = 'later';

        this.startCountdown(res.expires_at);

        // Reflect the hold immediately in the local slot list so the card
        // turns grey/"Held" right away rather than waiting on the next poll.
        this.markSlotAsHeldLocally(slot.id);
      },
      error: (err) => {
        this.holdLoading = false;
        this.showToast(err.error?.message || 'This slot just became unavailable', 'error');
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
    this.showToast('Your hold expired. Please select the slot again.', 'error');
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
    if (!this.selectedSlot || !this.holdInfo) return;
    if (!this.customerName || !this.customerPhone) {
      this.showToast('Name and phone number are required', 'error');
      return;
    }

    const bookingData = {
      slot_id: this.selectedSlot.id,
      booking_date: this.selectedDate,
      customer_name: this.customerName,
      customer_phone: this.customerPhone,
      customer_email: this.customerEmail,
      team_name: this.teamName,
      session_token: this.holdInfo.session_token
    };

    this.loading = true;
    this.apiService.confirmBooking(bookingData).subscribe({
      next: (res) => {
        this.loading = false;
        this.clearCountdown();
        const usedPaymentMethod = this.paymentMethod;

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
          this.showToast('Booking requested successfully! Pending admin approval.', 'success');
        }
      },
      error: (err) => {
        this.loading = false;
        const message = err.error?.message || 'Booking submission failed';
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
    this.paymentConfirmBookingId = bookingId;
    this.paymentConfirmAmount = null;
    this.paymentConfirmError = '';
    this.showPaymentConfirm = true;
    this.paymentConfirmLoading = true;

    this.apiService.initiatePayment(bookingId).subscribe({
      next: (res) => {
        this.paymentConfirmLoading = false;
        this.paymentConfirmAmount = res.amount;
        // Stash the gateway URL for confirmAndPay() to use -- re-fetching
        // it on click would create a second, redundant payment session.
        this._pendingGatewayUrl = res.gateway_page_url;
      },
      error: (err) => {
        this.paymentConfirmLoading = false;
        this.paymentConfirmError = err.error?.message || 'Failed to start payment. Your booking is still pending -- you can try paying later.';
      }
    });
  }

  private _pendingGatewayUrl: string | null = null;

  /** Customer clicked "Pay Now" -- this is the only place that actually
   * navigates the browser away to SSLCommerz's hosted payment page. */
  confirmAndPay(): void {
    if (!this._pendingGatewayUrl) return;
    window.location.href = this._pendingGatewayUrl;
  }

  /** Customer chose to skip paying now ("Pay at the turf instead"). */
  closePaymentConfirm(): void {
    this.showPaymentConfirm = false;
    this.paymentConfirmBookingId = null;
    this.paymentConfirmAmount = null;
    this._pendingGatewayUrl = null;
    this.showToast('No problem -- your booking is pending admin approval. You can pay later if you change your mind.', 'success');
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