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
  category: number | null;
}

interface RecurringBookingRecord {
  id: number;
  slot_id: number;
  day_of_week: number; // 0=Sunday .. 6=Saturday
  start_date: string;
  end_date: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  team_name?: string;
  status: 'pending_approval' | 'active' | 'paused' | 'cancelled' | 'expired';
  created_at: string;
  start_time: string;
  end_time: string;
  price: number;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Canonical category mapping, kept in sync with backend/constants/slot-categories.js.
// Category is always assigned manually by the admin -- never auto-derived
// from start_time. These hour ranges are only the business's general
// intent for each label, shown here as a guide in the dropdown.
const SLOT_CATEGORIES: { id: number; label: string; hint: string }[] = [
  { id: 1, label: 'Morning', hint: '6:00 AM - 12:00 PM' },
  { id: 2, label: 'Afternoon', hint: '12:00 PM - 4:00 PM' },
  { id: 3, label: 'Evening', hint: '4:00 PM - 7:00 PM' },
  { id: 4, label: 'Night', hint: '7:00 PM - 12:00 AM' },
  { id: 5, label: 'Midnight', hint: '12:00 AM - 6:00 AM' }
];
const CATEGORY_LABEL_BY_ID: Record<number, string> = SLOT_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.id]: c.label }),
  {} as Record<number, string>
);

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
  activeTab: 'overview' | 'bookings' | 'season' | 'slots' | 'blocking' = 'overview';

  // Stats Data
  stats: any = null;

  // Bookings Data
  bookings: BookingRecord[] = [];
  filteredBookings: BookingRecord[] = [];
  bookingFilter: 'all' | 'pending' | 'approved' | 'cancelled' = 'all';

  // Season / Recurring Bookings Data
  recurringBookings: RecurringBookingRecord[] = [];
  filteredRecurringBookings: RecurringBookingRecord[] = [];
  recurringFilter: 'all' | 'pending_approval' | 'active' | 'paused' | 'cancelled' | 'expired' = 'pending_approval';
  recurringLoading = false;

  // Slots Configuration Data
  slots: SlotConfig[] = [];
  slotCategoryFilter: number | 'all' = 'all'; // for the Slot Setup tab filter
  readonly slotCategories = SLOT_CATEGORIES; // exposed for the template dropdown

  // Create/Edit Slot Modal state
  showSlotModal = false;
  editingSlotId: number | null = null; // null if creating
  slotStartTime = '';
  slotEndTime = '';
  slotPrice = 1000;
  slotIsActive = 1;
  slotCategory: number | null = null; // null = "Uncategorized", admin always picks manually

  // Payment and Turf settings
  advancePaymentPercentage: number = 25;
  turfName: string = '';
  turfAddress: string = '';
  turfPhone: string = '';
  turfEmail: string = '';
  settingsLoading = false;

  // --- Bulk Slot Blocking ---
  // Date range and reason for the block action
  blockStartDate: string = '';
  blockEndDate: string = '';
  blockReason: string = 'maintenance';
  blockCustomReason: string = '';
  // Which slot IDs are checked in the selection list
  selectedSlotIdsForBlock: Set<number> = new Set();
  blockLoading = false;
  // Preview of blocks already set for the chosen date range
  existingBlocks: any[] = [];  // rows from GET /api/admin/slot-blocks
  blockPreviewLoading = false;
  // 'block' or 'unblock' action toggle
  blockAction: 'block' | 'unblock' = 'block';
  readonly blockReasonPresets = [
    { value: 'maintenance', label: '🔧 Maintenance' },
    { value: 'tournament', label: '🏆 Tournament' },
    { value: 'holiday',     label: '🎉 Public Holiday' },
    { value: 'private',     label: '🔒 Private Event' },
    { value: 'custom',      label: '✏️ Custom reason...' }
  ];

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
    this.loadRecurringBookings();
    this.loadSettings();
    // Set default blocking dates to today + 7 days
    const todayStr = new Date().toISOString().split('T')[0];
    this.blockStartDate = todayStr;
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 6);
    this.blockEndDate = nextWeek.toISOString().split('T')[0];
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

  // --- Payment Settings ---
  loadSettings(): void {
    this.apiService.getSettings().subscribe({
      next: (res) => {
        this.advancePaymentPercentage = res.advance_payment_percentage;
        this.turfName = res.turf_name || '';
        this.turfAddress = res.turf_address || '';
        this.turfPhone = res.turf_phone || '';
        this.turfEmail = res.turf_email || '';
      },
      error: (err) => {
        this.handleError(err);
      }
    });
  }

  saveSettings(): void {
    if (this.advancePaymentPercentage <= 0 || this.advancePaymentPercentage > 100) {
      this.showToast('Percentage must be between 1 and 100', 'error');
      return;
    }
    this.settingsLoading = true;
    
    const settingsPayload = {
      advance_payment_percentage: this.advancePaymentPercentage,
      turf_name: this.turfName,
      turf_address: this.turfAddress,
      turf_phone: this.turfPhone,
      turf_email: this.turfEmail
    };

    this.apiService.updateSettings(settingsPayload).subscribe({
      next: () => {
        this.settingsLoading = false;
        this.showToast('Settings updated successfully', 'success');
      },
      error: (err) => {
        this.settingsLoading = false;
        this.showToast(err.error?.message || 'Failed to update settings', 'error');
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

  // --- Season / Recurring Booking Operations ---

  loadRecurringBookings(): void {
    this.recurringLoading = true;
    this.apiService.getAdminRecurringBookings().subscribe({
      next: (res) => {
        this.recurringBookings = res;
        this.applyRecurringFilter();
        this.recurringLoading = false;
      },
      error: (err) => {
        this.recurringLoading = false;
        this.handleError(err);
      }
    });
  }

  setRecurringFilter(filter: 'all' | 'pending_approval' | 'active' | 'paused' | 'cancelled' | 'expired'): void {
    this.recurringFilter = filter;
    this.applyRecurringFilter();
  }

  applyRecurringFilter(): void {
    if (this.recurringFilter === 'all') {
      this.filteredRecurringBookings = this.recurringBookings;
    } else {
      this.filteredRecurringBookings = this.recurringBookings.filter(r => r.status === this.recurringFilter);
    }
  }

  /** Count of templates awaiting approval, used for the sidebar badge. */
  get pendingRecurringCount(): number {
    return this.recurringBookings.filter(r => r.status === 'pending_approval').length;
  }

  dayName(dayOfWeek: number): string {
    return DAY_NAMES[dayOfWeek] || `Day ${dayOfWeek}`;
  }

  approveRecurringBooking(id: number): void {
    this.updateRecurringStatus(id, 'active', 'Season booking approved! Weekly slots will be generated automatically.');
  }

  pauseRecurringBooking(id: number): void {
    this.updateRecurringStatus(id, 'paused', 'Season booking paused.');
  }

  resumeRecurringBooking(id: number): void {
    this.updateRecurringStatus(id, 'active', 'Season booking resumed.');
  }

  cancelRecurringBooking(id: number): void {
    if (!confirm('Cancel this season booking? No further weekly slots will be generated.')) return;
    this.updateRecurringStatus(id, 'cancelled', 'Season booking cancelled.');
  }

  private updateRecurringStatus(id: number, status: string, successMessage: string): void {
    this.recurringLoading = true;
    this.apiService.updateRecurringBooking(id, { status }).subscribe({
      next: () => {
        this.recurringLoading = false;
        this.showToast(successMessage, 'success');
        this.loadRecurringBookings();
      },
      error: (err) => {
        this.recurringLoading = false;
        this.showToast(err.error?.message || 'Failed to update season booking', 'error');
      }
    });
  }

  deleteRecurringBooking(id: number): void {
    if (!confirm('Permanently delete this season booking template? Already-generated weekly bookings will not be removed, but no new ones will be created.')) return;
    this.recurringLoading = true;
    this.apiService.deleteRecurringBooking(id).subscribe({
      next: () => {
        this.recurringLoading = false;
        this.showToast('Season booking template deleted', 'success');
        this.loadRecurringBookings();
      },
      error: (err) => {
        this.recurringLoading = false;
        this.showToast(err.error?.message || 'Failed to delete season booking', 'error');
      }
    });
  }

  /** Manually triggers a generation pass right now (useful right after approving a template, for testing). */
  runRecurringGenerationNow(): void {
    this.recurringLoading = true;
    this.apiService.runRecurringBookingGenerationNow().subscribe({
      next: () => {
        this.recurringLoading = false;
        this.showToast('Generation pass completed', 'success');
        this.loadBookings();
        this.loadStats();
      },
      error: (err) => {
        this.recurringLoading = false;
        this.showToast(err.error?.message || 'Generation pass failed', 'error');
      }
    });
  }

  // --- Bulk Slot Blocking Operations ---

  toggleSlotBlockSelection(slotId: number): void {
    if (this.selectedSlotIdsForBlock.has(slotId)) {
      this.selectedSlotIdsForBlock.delete(slotId);
    } else {
      this.selectedSlotIdsForBlock.add(slotId);
    }
  }

  isSlotSelectedForBlock(slotId: number): boolean {
    return this.selectedSlotIdsForBlock.has(slotId);
  }

  selectAllSlotsForBlock(): void {
    this.slots.forEach(s => this.selectedSlotIdsForBlock.add(s.id));
  }

  clearSlotBlockSelection(): void {
    this.selectedSlotIdsForBlock.clear();
  }

  get resolvedBlockReason(): string {
    return this.blockReason === 'custom'
      ? (this.blockCustomReason.trim() || 'Blocked')
      : this.blockReasonPresets.find(p => p.value === this.blockReason)?.label || 'Blocked';
  }

  /** Loads existing blocks for the current date range so the preview table stays current. */
  loadBlockPreview(): void {
    if (!this.blockStartDate || !this.blockEndDate) return;
    this.blockPreviewLoading = true;
    this.apiService.getSlotBlocks(this.blockStartDate, this.blockEndDate).subscribe({
      next: (rows) => {
        this.existingBlocks = rows;
        this.blockPreviewLoading = false;
      },
      error: () => {
        this.blockPreviewLoading = false;
      }
    });
  }

  applyBulkBlock(): void {
    if (this.selectedSlotIdsForBlock.size === 0) {
      this.showToast('Please select at least one slot', 'error');
      return;
    }
    if (!this.blockStartDate || !this.blockEndDate) {
      this.showToast('Please set a date range', 'error');
      return;
    }
    const slotIds = Array.from(this.selectedSlotIdsForBlock);
    const reason = this.resolvedBlockReason;

    const confirmMsg = this.blockAction === 'block'
      ? `Block ${slotIds.length} slot(s) from ${this.blockStartDate} to ${this.blockEndDate} (reason: "${reason}")? This will prevent customers from booking these slots.`
      : `Unblock ${slotIds.length} slot(s) from ${this.blockStartDate} to ${this.blockEndDate}? Customers will be able to book these slots again.`;

    if (!confirm(confirmMsg)) return;

    this.blockLoading = true;
    if (this.blockAction === 'block') {
      this.apiService.bulkBlockSlots({ slot_ids: slotIds, start_date: this.blockStartDate, end_date: this.blockEndDate, reason }).subscribe({
        next: (res) => {
          this.blockLoading = false;
          this.showToast(`${res.blocked} slot/date(s) blocked. ${res.skipped} already existed.`, 'success');
          this.clearSlotBlockSelection();
          this.loadBlockPreview();
        },
        error: (err) => {
          this.blockLoading = false;
          this.showToast(err.error?.message || 'Failed to apply blocks', 'error');
        }
      });
    } else {
      this.apiService.bulkUnblockSlots({ slot_ids: slotIds, start_date: this.blockStartDate, end_date: this.blockEndDate }).subscribe({
        next: (res) => {
          this.blockLoading = false;
          this.showToast(`${res.removed} block(s) removed.`, 'success');
          this.clearSlotBlockSelection();
          this.loadBlockPreview();
        },
        error: (err) => {
          this.blockLoading = false;
          this.showToast(err.error?.message || 'Failed to remove blocks', 'error');
        }
      });
    }
  }

  /** Groups existingBlocks rows by date for the preview table. */
  get blockedDateGroups(): { date: string; slots: any[] }[] {
    const map: Record<string, any[]> = {};
    this.existingBlocks.forEach(b => {
      if (!map[b.block_date]) map[b.block_date] = [];
      map[b.block_date].push(b);
    });
    return Object.keys(map).sort().map(date => ({ date, slots: map[date] }));
  }

  // --- Slot Template Operations ---
  openAddSlotModal(): void {
    this.editingSlotId = null;
    this.slotStartTime = '';
    this.slotEndTime = '';
    this.slotPrice = 1000;
    this.slotIsActive = 1;
    this.slotCategory = null; // blank by default -- admin always picks manually
    this.showSlotModal = true;
  }

  openEditSlotModal(slot: SlotConfig): void {
    this.editingSlotId = slot.id;
    this.slotStartTime = slot.start_time;
    this.slotEndTime = slot.end_time;
    this.slotPrice = slot.price;
    this.slotIsActive = slot.is_active;
    this.slotCategory = slot.category;
    this.showSlotModal = true;
  }

  closeSlotModal(): void {
    this.showSlotModal = false;
  }

  categoryLabel(category: number | null | undefined): string {
    if (category === null || category === undefined) return 'Uncategorized';
    return CATEGORY_LABEL_BY_ID[category] || 'Uncategorized';
  }

  saveSlotConfig(): void {
    if (!this.slotStartTime || !this.slotEndTime || this.slotPrice === undefined) {
      this.showToast('All fields are required', 'error');
      return;
    }

    const slotData: any = {
      start_time: this.slotStartTime,
      end_time: this.slotEndTime,
      price: this.slotPrice,
      is_active: this.slotIsActive
    };

    // category is only sent when explicitly set; if the admin cleared it
    // back to "Uncategorized" on an edit, tell the backend to actually
    // clear it (plain `category: null` would be ignored by the backend's
    // COALESCE-based update -- see server.js for why).
    if (this.slotCategory !== null) {
      slotData.category = this.slotCategory;
    } else if (this.editingSlotId !== null) {
      slotData.category_clear = true;
    }

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