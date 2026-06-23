import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { RouterLink } from '@angular/router';

interface TurfSlot {
  id: number;
  start_time: string;
  end_time: string;
  price: number;
  is_active: number;
  status: 'available' | 'pending' | 'approved';
  booking_details?: {
    booking_id: number;
    team_name?: string;
    payment_status: 'paid' | 'unpaid';
  };
}

@Component({
  selector: 'app-booking-portal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './booking-portal.component.html',
  styleUrl: './booking-portal.component.css'
})
export class BookingPortalComponent implements OnInit {
  private apiService = inject(ApiService);

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

  // Notification Toast
  toastMsg: string = '';
  toastType: 'success' | 'error' | '' = '';
  todayDate: string = '';

  ngOnInit(): void {
    // Set default date to today in YYYY-MM-DD local format
    this.todayDate = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    this.selectedDate = `${yyyy}-${mm}-${dd}`;

    this.loadSlots();
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
    this.loadSlots();
  }

  getSlotsByCategory(category: 'morning' | 'afternoon' | 'evening' | 'night'): TurfSlot[] {
    return this.slots.filter(slot => {
      const hour = parseInt(slot.start_time.split(':')[0]);
      if (category === 'morning') return hour >= 6 && hour < 12;
      if (category === 'afternoon') return hour >= 12 && hour < 16;
      if (category === 'evening') return hour >= 16 && hour < 18;
      return hour >= 18 || hour < 6;
    });
  }

  openBookingModal(slot: TurfSlot): void {
    if (slot.status !== 'available' || slot.is_active === 0) return;
    this.selectedSlot = slot;
    this.showModal = true;
    // Reset form fields
    this.customerName = '';
    this.customerPhone = '';
    this.customerEmail = '';
    this.teamName = '';
    this.paymentMethod = 'later';
  }

  closeBookingModal(): void {
    this.showModal = false;
    this.selectedSlot = null;
  }

  submitBooking(): void {
    if (!this.selectedSlot) return;
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
      team_name: this.teamName
    };

    this.loading = true;
    this.apiService.createBooking(bookingData).subscribe({
      next: (res) => {
        this.closeBookingModal();
        this.loadSlots();
        this.loading = false;

        // If paying now (simulated checkout)
        if (this.paymentMethod !== 'later') {
          this.initiateCheckout(res.booking_id, this.paymentMethod);
        } else {
          this.showToast('Booking requested successfully! Pending admin approval.', 'success');
        }
      },
      error: (err) => {
        this.loading = false;
        this.showToast(err.error?.message || 'Booking submission failed', 'error');
      }
    });
  }

  initiateCheckout(bookingId: number, method: string): void {
    this.showToast('Initiating payment gateway...', 'success');
    this.apiService.initiatePayment(bookingId, method).subscribe({
      next: (res) => {
        if (res.checkout_url) {
          // Redirect the user to the mock checkout page
          window.location.href = res.checkout_url;
        } else {
          this.showToast('Payment initiated (Mock)', 'success');
        }
      },
      error: (err) => {
        this.showToast('Payment failed, booking placed as pending', 'error');
      }
    });
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
