import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, tap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private apiUrl = window.location.hostname === 'localhost'
    ? 'http://localhost:5000/api'
    : '/api';

  // Auth State
  private tokenSubject = new BehaviorSubject<string | null>(localStorage.getItem('admin_token'));
  token$ = this.tokenSubject.asObservable();

  get token(): string | null {
    return this.tokenSubject.value;
  }

  // --- Auth Methods ---
  login(credentials: { username: string; password: string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/auth/login`, credentials).pipe(
      tap(response => {
        if (response && response.token) {
          localStorage.setItem('admin_token', response.token);
          this.tokenSubject.next(response.token);
        }
      })
    );
  }

  logout(): void {
    localStorage.removeItem('admin_token');
    this.tokenSubject.next(null);
  }

  isLoggedIn(): boolean {
    const token = this.token;
    if (!token) return false;

    // Simple JWT expiration check
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const isExpired = Math.floor(Date.now() / 1000) >= payload.exp;
      if (isExpired) {
        this.logout();
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  private getAuthHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.token || ''}`
    });
  }

  // --- Public Customer Methods ---
  getAvailableSlots(date: string): Observable<any> {
    return this.http.get<any>(`${`${this.apiUrl}/slots/available`}?date=${date}`);
  }

  /** Fetches a non-personal summary of a booking for the post-payment
   * result page (date, time, price, payment status -- no customer PII,
   * since booking IDs are guessable). */
  getBookingResult(bookingId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/bookings/${bookingId}/result`);
  }

  // Legacy direct-booking endpoint. Retained for admin/legacy usage; the
  // customer booking portal now uses holdSlot() + confirmBooking() instead.
  createBooking(bookingData: {
    slot_id: number;
    booking_date: string;
    customer_name: string;
    customer_phone: string;
    customer_email?: string;
    team_name?: string;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/bookings`, bookingData);
  }

  // --- Hold / Confirm Flow ---

  /** Places a temporary hold on a slot. Returns { session_token, expires_at }. */
  holdSlot(slotId: number, bookingDate: string): Observable<{ session_token: string; expires_at: string }> {
    return this.http.post<{ session_token: string; expires_at: string }>(`${this.apiUrl}/slots/hold`, {
      slot_id: slotId,
      booking_date: bookingDate
    });
  }

  /** Cancels an active hold immediately (user clicked Cancel / closed the modal). */
  cancelHold(slotId: number, bookingDate: string, sessionToken: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/slots/hold`, {
      body: {
        slot_id: slotId,
        booking_date: bookingDate,
        session_token: sessionToken
      }
    });
  }

  /** Confirms a booking against a still-valid hold. */
  confirmBooking(bookingData: {
    slot_id: number;
    booking_date: string;
    customer_name: string;
    customer_phone: string;
    customer_email?: string;
    team_name?: string;
    session_token: string;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/slots/confirm`, bookingData);
  }

  /**
   * Starts a real SSLCommerz payment session for a booking's advance
   * amount. Returns { tran_id, amount, required_advance, gateway_page_url }.
   * The caller is responsible for redirecting window.location to
   * gateway_page_url once the customer confirms they want to pay.
   */
  initiatePayment(bookingId: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/payments/initiate`, {
      booking_id: bookingId
    });
  }

  // --- Season / Recurring Booking (Customer self-serve) ---

  /**
   * Submits a self-serve season booking request. day_of_week is derived
   * server-side from start_date -- not sent from the client. Returns the
   * created template with status 'pending_approval'; no slots are
   * reserved until an admin approves it.
   */
  createRecurringBooking(data: {
    slot_id: number;
    start_date: string;
    end_date: string;
    customer_name: string;
    customer_phone: string;
    customer_email?: string;
    team_name?: string;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/recurring-bookings`, data);
  }

  // --- Admin Dashboard Methods ---
  getAdminBookings(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/admin/bookings`, {
      headers: this.getAuthHeaders()
    });
  }

  updateBookingStatus(bookingId: number, status: string, paymentStatus?: string): Observable<any> {
    const body: any = {};
    if (status) body.status = status;
    if (paymentStatus) body.payment_status = paymentStatus;

    return this.http.put<any>(`${this.apiUrl}/admin/bookings/${bookingId}`, body, {
      headers: this.getAuthHeaders()
    });
  }

  deleteBooking(bookingId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/admin/bookings/${bookingId}`, {
      headers: this.getAuthHeaders()
    });
  }

  getAdminSlots(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/admin/slots`, {
      headers: this.getAuthHeaders()
    });
  }

  createSlot(slotData: {
    start_time: string;
    end_time: string;
    price: number;
    is_active: number;
    category?: number | null;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/admin/slots`, slotData, {
      headers: this.getAuthHeaders()
    });
  }

  updateSlot(slotId: number, slotData: {
    start_time?: string;
    end_time?: string;
    price?: number;
    is_active?: number;
    category?: number | null;
    category_clear?: boolean;
  }): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/admin/slots/${slotId}`, slotData, {
      headers: this.getAuthHeaders()
    });
  }

  deleteSlot(slotId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/admin/slots/${slotId}`, {
      headers: this.getAuthHeaders()
    });
  }

  getAdminStats(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/admin/stats`, {
      headers: this.getAuthHeaders()
    });
  }

  // --- Admin: Recurring / Season Booking Management ---

  /** Lists recurring booking templates. Pass a status to filter (e.g. the approval inbox). */
  getAdminRecurringBookings(status?: string): Observable<any[]> {
    const url = status
      ? `${this.apiUrl}/admin/recurring-bookings?status=${encodeURIComponent(status)}`
      : `${this.apiUrl}/admin/recurring-bookings`;
    return this.http.get<any[]>(url, {
      headers: this.getAuthHeaders()
    });
  }

  /** Approves, pauses, resumes, or cancels a template; or extends its end_date. */
  updateRecurringBooking(id: number, data: { status?: string; end_date?: string }): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/admin/recurring-bookings/${id}`, data, {
      headers: this.getAuthHeaders()
    });
  }

  deleteRecurringBooking(id: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/admin/recurring-bookings/${id}`, {
      headers: this.getAuthHeaders()
    });
  }

  /** Manually triggers one generation pass immediately (debugging/testing aid). */
  runRecurringBookingGenerationNow(): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/admin/recurring-bookings/run-now`, {}, {
      headers: this.getAuthHeaders()
    });
  }

  // --- Admin: App Settings ---

  getSettings(): Observable<{ advance_payment_percentage: number }> {
    return this.http.get<{ advance_payment_percentage: number }>(`${this.apiUrl}/admin/settings`, {
      headers: this.getAuthHeaders()
    });
  }

  updateSettings(data: { advance_payment_percentage: number }): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/admin/settings`, data, {
      headers: this.getAuthHeaders()
    });
  }
}