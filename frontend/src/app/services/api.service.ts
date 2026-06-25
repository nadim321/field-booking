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

  initiatePayment(bookingId: number, paymentMethod: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/payments/checkout`, {
      booking_id: bookingId,
      payment_method: paymentMethod
    });
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
}