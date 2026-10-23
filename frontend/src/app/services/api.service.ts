import { CollectionHistory, CollectionReport } from './collections';
import { NotificationPage, NotificationDetail } from './notifications';
import { VenueSettings, VenueUpdate, VenueMedia } from './venue-settings';
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, Subject, tap } from 'rxjs';
import { CalendarResponse } from './calendar';
import { AdminStats } from './admin-stats';
import { resolveApiBaseUrl } from './api-base-url';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private apiUrl = resolveApiBaseUrl(environment.apiBaseUrl);

  readonly settingsChanges = new Subject<void>();

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

  changeAdminPassword(credentials: { currentPassword: string; newPassword: string }): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/change-password`, credentials, { headers: this.getAuthHeaders() });
  }

  getAdmins(): Observable<{ id: number; username: string }[]> {
    return this.http.get<{ id: number; username: string }[]>(`${this.apiUrl}/admin/admins`, { headers: this.getAuthHeaders() });
  }

  createAdmin(account: { username: string; password: string }): Observable<{ id: number; username: string }> {
    return this.http.post<{ id: number; username: string }>(`${this.apiUrl}/admin/admins`, account, { headers: this.getAuthHeaders() });
  }

  updateAdmin(id: number, account: { username: string; password?: string }): Observable<{ id: number; username: string; reauthentication_required: boolean }> {
    return this.http.patch<{ id: number; username: string; reauthentication_required: boolean }>(`${this.apiUrl}/admin/admins/${id}`, account, { headers: this.getAuthHeaders() });
  }

  deleteAdmin(id: number): Observable<{ deleted_id: number }> {
    return this.http.delete<{ deleted_id: number }>(`${this.apiUrl}/admin/admins/${id}`, { headers: this.getAuthHeaders() });
  }

  getDemoAdminLoginConfig(): Observable<{ enabled: boolean; credentials: { username: string; password: string } | null }> {
    return this.http.get<{ enabled: boolean; credentials: { username: string; password: string } | null }>(`${this.apiUrl}/auth/demo-login-config`);
  }

  logout(): void {
    localStorage.removeItem('admin_token');
    this.tokenSubject.next(null);
  }

  get customerToken(): string | null { return localStorage.getItem('customer_token'); }

  requestCustomerOtp(phone: string): Observable<{ message: string; expires_in: number; debug_code?: string }> {
    return this.http.post<{ message: string; expires_in: number; debug_code?: string }>(`${this.apiUrl}/customer/auth/request-otp`, { phone });
  }

  verifyCustomerOtp(phone: string, code: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/customer/auth/verify-otp`, { phone, code }).pipe(tap(response => {
      localStorage.setItem('customer_token', response.token);
    }));
  }

  isCustomerLoggedIn(): boolean {
    const token = this.customerToken;
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.role !== 'customer' || typeof payload.exp !== 'number' || Date.now() / 1000 >= payload.exp) {
        localStorage.removeItem('customer_token');
        return false;
      }
      return true;
    } catch { localStorage.removeItem('customer_token'); return false; }
  }

  logoutCustomer(): void { localStorage.removeItem('customer_token'); }

  getCustomerBookings(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/customer/bookings`, { headers: new HttpHeaders({ Authorization: `Bearer ${this.customerToken || ''}` }) });
  }

  isLoggedIn(): boolean {
    const token = this.token;
    if (!token) return false;

    // Simple JWT expiration check
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const isExpired = typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) >= payload.exp || !['admin', 'demo_admin'].includes(payload.role);
      if (isExpired) {
        this.logout();
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  isDemoAdmin(): boolean {
    const token = this.token;
    if (!token) return false;
    try { return JSON.parse(atob(token.split('.')[1])).role === 'demo_admin'; }
    catch { return false; }
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
    policy_accepted: boolean;
    policy_version: string;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/slots/confirm`, bookingData, { headers: new HttpHeaders({ Authorization: `Bearer ${this.customerToken || ''}` }) });
  }

  /**
   * Starts a real SSLCommerz payment session for a booking's advance
   * amount. Returns { tran_id, amount, required_advance, gateway_page_url }.
   * The caller is responsible for redirecting window.location to
   * gateway_page_url once the customer confirms they want to pay.
   */
  initiatePayment(bookingId: number, idempotencyKey?: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/payments/initiate`, {
      booking_id: bookingId
    }, { headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} });
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
    return this.http.post<any>(`${this.apiUrl}/recurring-bookings`, data, { headers: new HttpHeaders({ Authorization: `Bearer ${this.customerToken || ''}` }) });
  }

  // --- Admin Dashboard Methods ---
  getAdminCalendar(startDate: string, endDate: string): Observable<CalendarResponse> {
    return this.http.get<CalendarResponse>(`${this.apiUrl}/admin/calendar`, {
      params: { start_date: startDate, end_date: endDate }, headers: this.getAuthHeaders()
    });
  }

  getAdminBookings(filters: { q?: string; date_from?: string; date_to?: string; status?: string; payment_status?: string; page?: number; page_size?: number } = {}): Observable<{ items: any[]; page: number; page_size: number; total: number }> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params[key] = String(value);
    return this.http.get<{ items: any[]; page: number; page_size: number; total: number }>(`${this.apiUrl}/admin/bookings`, {
      params, headers: this.getAuthHeaders()
    });
  }

  exportAdminBookings(filters: { q?: string; date_from?: string; date_to?: string; status?: string; payment_status?: string } = {}): Observable<Blob> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params[key] = String(value);
    return this.http.get(`${this.apiUrl}/admin/bookings/export`, {
      params, headers: this.getAuthHeaders(), responseType: 'blob'
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

  getCancellationQuote(id: number, source: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/admin/bookings/${id}/cancellation-quote?source=${source}`, { headers: this.getAuthHeaders() });
  }

  cancelBooking(id: number, source: string, reason: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/admin/bookings/${id}/cancel`, { source, reason }, { headers: this.getAuthHeaders() });
  }

  recordRefund(id: number, reference: string, amount: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/admin/bookings/${id}/refund-record`, { reference, amount }, { headers: this.getAuthHeaders() });
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

  getAdminStats(): Observable<AdminStats> {
    return this.http.get<AdminStats>(`${this.apiUrl}/admin/stats`, {
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

  getCollectionHistory(id:number): Observable<CollectionHistory> {
    return this.http.get<CollectionHistory>(`${this.apiUrl}/admin/bookings/${id}/collections`,{headers:this.getAuthHeaders()});
  }
  recordCollection(id:number,data:{amount:string;method:string;reference:string;note:string;request_key:string}): Observable<{collection_id:number}> {
    return this.http.post<{collection_id:number}>(`${this.apiUrl}/admin/bookings/${id}/collections`,data,{headers:this.getAuthHeaders()});
  }
  reverseCollection(id:number,data:{reason:string;request_key:string}): Observable<{collection_id:number}> {
    return this.http.post<{collection_id:number}>(`${this.apiUrl}/admin/collections/${id}/reverse`,data,{headers:this.getAuthHeaders()});
  }
  getCollections(params:Record<string,string>): Observable<CollectionReport> {
    return this.http.get<CollectionReport>(`${this.apiUrl}/admin/collections`,{headers:this.getAuthHeaders(),params});
  }
  exportCollections(params:Record<string,string>): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/admin/collections/export`,{headers:this.getAuthHeaders(),params,responseType:'blob'});
  }

  getNotifications(filters: {page: number; booking_id: number | null; event: string; status: string}): Observable<NotificationPage> {
    const params: Record<string,string> = { page: String(filters.page) };
    if (filters.booking_id !== null) params['booking_id'] = String(filters.booking_id);
    if (filters.event) params['event'] = filters.event;
    if (filters.status) params['status'] = filters.status;
    return this.http.get<NotificationPage>(`${this.apiUrl}/admin/notifications`, { headers: this.getAuthHeaders(), params });
  }
  getNotification(id: number): Observable<NotificationDetail> {
    return this.http.get<NotificationDetail>(`${this.apiUrl}/admin/notifications/${id}`, { headers: this.getAuthHeaders() });
  }
  resendNotification(id: number, requestKey: string): Observable<{message: string; job_id: number}> {
    return this.http.post<{message: string; job_id: number}>(`${this.apiUrl}/admin/notifications/${id}/resend`, { request_key: requestKey }, { headers: this.getAuthHeaders() });
  }
  retryNotification(id: number): Observable<{message: string}> {
    return this.http.post<{message: string}>(`${this.apiUrl}/admin/notifications/${id}/retry`, {}, { headers: this.getAuthHeaders() });
  }

  // --- Admin: App Settings ---

  getSettings(): Observable<VenueSettings> {
    return this.http.get<VenueSettings>(`${this.apiUrl}/admin/settings`, { headers: this.getAuthHeaders() });
  }
  updateSettings(data: VenueUpdate): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/admin/settings`, data, { headers: this.getAuthHeaders() }).pipe(tap(() => this.settingsChanges.next()));
  }
  getPublicSettings(): Observable<VenueSettings> {
    return this.http.get<VenueSettings>(`${this.apiUrl}/settings/public`);
  }
  uploadMedia(file: File, kind: 'logo' | 'photo' | 'share'): Observable<VenueMedia> {
    return this.http.post<VenueMedia>(`${this.apiUrl}/admin/media?kind=${kind}`, file, { headers: this.getAuthHeaders().set('Content-Type', file.type) });
  }
  mediaUrl(url: string): string {
    return this.apiUrl.startsWith('http') ? new URL(url, this.apiUrl).href : url;
  }

  // --- Admin: Bulk Slot Blocking ---

  /** Blocks selected slot IDs for every date in the given range. */
  bulkBlockSlots(data: {
    slot_ids: number[];
    start_date: string;
    end_date: string;
    reason?: string;
  }): Observable<{ message: string; blocked: number; skipped: number }> {
    return this.http.post<any>(`${this.apiUrl}/admin/slot-blocks/bulk`, data, {
      headers: this.getAuthHeaders()
    });
  }

  /** Lists existing admin blocks, optionally filtered by date range. */
  getSlotBlocks(startDate?: string, endDate?: string): Observable<any[]> {
    let url = `${this.apiUrl}/admin/slot-blocks`;
    const parts: string[] = [];
    if (startDate) parts.push(`start_date=${startDate}`);
    if (endDate) parts.push(`end_date=${endDate}`);
    if (parts.length) url += '?' + parts.join('&');
    return this.http.get<any[]>(url, { headers: this.getAuthHeaders() });
  }

  /** Removes blocks for selected slot IDs in the given date range. */
  bulkUnblockSlots(data: {
    slot_ids: number[];
    start_date: string;
    end_date: string;
  }): Observable<{ message: string; removed: number }> {
    return this.http.delete<any>(`${this.apiUrl}/admin/slot-blocks/bulk`, {
      headers: this.getAuthHeaders(),
      body: data
    });
  }

  /** Downloads a booking slip PDF by booking ID. */
  downloadBookingSlipPdf(bookingId: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/bookings/${bookingId}/pdf`, {
      responseType: 'blob'
    });
  }
}
