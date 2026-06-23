import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

interface BookingRecord {
  id: number;
  slot_id: number;
  booking_date: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  team_name?: string;
  status: 'pending' | 'approved' | 'cancelled';
  payment_status: 'paid' | 'unpaid';
  created_at: string;
  start_time: string;
  end_time: string;
  price: number;
}

interface SlotConfig {
  id: number;
  start_time: string;
  end_time: string;
  price: number;
  is_active: number;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.css'
})
export class AdminDashboardComponent implements OnInit {
  private apiService = inject(ApiService);
  private router = inject(Router);

  // Tabs navigation
  activeTab: 'overview' | 'bookings' | 'slots' = 'overview';

  // Stats Data
  stats: any = null;

  // Bookings Data
  bookings: BookingRecord[] = [];
  filteredBookings: BookingRecord[] = [];
  bookingFilter: 'all' | 'pending' | 'approved' | 'cancelled' = 'all';

  // Slots Configuration Data
  slots: SlotConfig[] = [];
  
  // Create/Edit Slot Modal state
  showSlotModal = false;
  editingSlotId: number | null = null; // null if creating
  slotStartTime = '';
  slotEndTime = '';
  slotPrice = 1000;
  slotIsActive = 1;

  loading = false;
  errorMsg = '';
  successMsg = '';

  // Toast
  toastMsg = '';
  toastType: 'success' | 'error' | '' = '';

  ngOnInit(): void {
    if (!this.apiService.isLoggedIn()) {
      this.router.navigate(['/admin/login']);
      return;
    }
    this.loadStats();
    this.loadBookings();
    this.loadSlots();
  }

  // --- API Load Operations ---
  loadStats(): void {
    this.apiService.getAdminStats().subscribe({
      next: (res) => {
        this.stats = res;
      },
      error: (err) => {
        this.handleError(err);
      }
    });
  }

  loadBookings(): void {
    this.apiService.getAdminBookings().subscribe({
      next: (res) => {
        this.bookings = res;
        this.applyBookingFilter();
      },
      error: (err) => {
        this.handleError(err);
      }
    });
  }

  loadSlots(): void {
    this.apiService.getAdminSlots().subscribe({
      next: (res) => {
        this.slots = res;
      },
      error: (err) => {
        this.handleError(err);
      }
    });
  }

  // --- Booking Operations ---
  updateBookingStatus(id: number, status: string, paymentStatus?: string): void {
    this.loading = true;
    this.apiService.updateBookingStatus(id, status, paymentStatus).subscribe({
      next: () => {
        this.loading = false;
        this.showToast('Booking updated successfully!', 'success');
        this.loadBookings();
        this.loadStats();
      },
      error: (err) => {
        this.loading = false;
        this.showToast(err.error?.message || 'Failed to update booking', 'error');
      }
    });
  }

  deleteBooking(id: number): void {
    if (!confirm('Are you sure you want to delete this booking record?')) return;
    this.loading = true;
    this.apiService.deleteBooking(id).subscribe({
      next: () => {
        this.loading = false;
        this.showToast('Booking record deleted', 'success');
        this.loadBookings();
        this.loadStats();
      },
      error: (err) => {
        this.loading = false;
        this.showToast(err.error?.message || 'Failed to delete booking', 'error');
      }
    });
  }

  setBookingFilter(filter: 'all' | 'pending' | 'approved' | 'cancelled'): void {
    this.bookingFilter = filter;
    this.applyBookingFilter();
  }

  applyBookingFilter(): void {
    if (this.bookingFilter === 'all') {
      this.filteredBookings = this.bookings;
    } else {
      this.filteredBookings = this.bookings.filter(b => b.status === this.bookingFilter);
    }
  }

  // --- Slot Template Operations ---
  openAddSlotModal(): void {
    this.editingSlotId = null;
    this.slotStartTime = '';
    this.slotEndTime = '';
    this.slotPrice = 1000;
    this.slotIsActive = 1;
    this.showSlotModal = true;
  }

  openEditSlotModal(slot: SlotConfig): void {
    this.editingSlotId = slot.id;
    this.slotStartTime = slot.start_time;
    this.slotEndTime = slot.end_time;
    this.slotPrice = slot.price;
    this.slotIsActive = slot.is_active;
    this.showSlotModal = true;
  }

  closeSlotModal(): void {
    this.showSlotModal = false;
  }

  saveSlotConfig(): void {
    if (!this.slotStartTime || !this.slotEndTime || this.slotPrice === undefined) {
      this.showToast('All fields are required', 'error');
      return;
    }

    const slotData = {
      start_time: this.slotStartTime,
      end_time: this.slotEndTime,
      price: this.slotPrice,
      is_active: this.slotIsActive
    };

    this.loading = true;
    if (this.editingSlotId !== null) {
      this.apiService.updateSlot(this.editingSlotId, slotData).subscribe({
        next: () => {
          this.loading = false;
          this.showToast('Slot configuration updated', 'success');
          this.closeSlotModal();
          this.loadSlots();
        },
        error: (err) => {
          this.loading = false;
          this.showToast(err.error?.message || 'Failed to update slot', 'error');
        }
      });
    } else {
      this.apiService.createSlot(slotData).subscribe({
        next: () => {
          this.loading = false;
          this.showToast('Slot configuration added', 'success');
          this.closeSlotModal();
          this.loadSlots();
        },
        error: (err) => {
          this.loading = false;
          this.showToast(err.error?.message || 'Failed to create slot', 'error');
        }
      });
    }
  }

  toggleSlotActive(slot: SlotConfig): void {
    const updatedStatus = slot.is_active === 1 ? 0 : 1;
    this.apiService.updateSlot(slot.id, { is_active: updatedStatus }).subscribe({
      next: () => {
        this.showToast(`Slot is now ${updatedStatus === 1 ? 'Active' : 'Blocked'}`, 'success');
        this.loadSlots();
      },
      error: (err) => {
        this.showToast('Failed to update status', 'error');
      }
    });
  }

  deleteSlotConfig(id: number): void {
    if (!confirm('Are you sure you want to delete this slot template? Existing slot bookings for this hour might be orphaned.')) return;
    this.loading = true;
    this.apiService.deleteSlot(id).subscribe({
      next: () => {
        this.loading = false;
        this.showToast('Slot template deleted', 'success');
        this.loadSlots();
      },
      error: (err) => {
        this.loading = false;
        this.showToast(err.error?.message || 'Failed to delete slot configuration', 'error');
      }
    });
  }

  // --- Helpers ---
  handleError(err: any): void {
    console.error(err);
    if (err.status === 401 || err.status === 403) {
      this.showToast('Session expired. Please log in again.', 'error');
      this.apiService.logout();
      this.router.navigate(['/admin/login']);
    } else {
      this.errorMsg = err.error?.message || 'A network error occurred. Please check backend connection.';
      this.showToast(this.errorMsg, 'error');
    }
  }

  showToast(message: string, type: 'success' | 'error'): void {
    this.toastMsg = message;
    this.toastType = type;
    setTimeout(() => {
      this.toastMsg = '';
      this.toastType = '';
    }, 4000);
  }

  logout(): void {
    this.apiService.logout();
    this.router.navigate(['/admin/login']);
  }
}
