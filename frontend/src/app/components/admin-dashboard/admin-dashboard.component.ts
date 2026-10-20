import { PaymentDialogComponent } from '../collections/payment-dialog.component';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BrandComponent } from '../venue/brand.component';
import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AdminCalendarComponent } from '../admin-calendar/admin-calendar.component';
import { AdminStats } from '../../services/admin-stats';

interface BookingRecord {
  id: number;
  slot_id: number;
  booking_date: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  team_name?: string;
  status: 'pending' | 'approved' | 'cancelled';
  payment_status: 'paid' | 'unpaid' | 'partially_paid';
  refund_amount?: number;
  refunded_amount?: number;
  refund_payout_status?: string | null;
  cancellation_source?: string;
  cancellation_reason?: string;
  created_at: string;
  start_time: string;
  end_time: string;
  price: number;
  price_source: 'captured' | 'legacy_estimate';
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

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [PaymentDialogComponent, BrandComponent, CommonModule, FormsModule, RouterLink, RouterOutlet, AdminCalendarComponent],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.css'
})
export class AdminDashboardComponent implements OnInit {
  private apiService = inject(ApiService);
  get demoReadOnly(): boolean { return this.apiService.isDemoAdmin(); }
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  // Tabs navigation
  activeTab: 'calendar' | 'overview' | 'bookings' | 'season' | 'slots' | 'field' | 'notifications' | 'collections' | 'blocking' | 'security' = 'calendar';

  get pageTitle(): string {
    return this.activeTab === 'collections' ? 'Collections' : this.activeTab === 'notifications' ? 'Notifications' : this.activeTab === 'field' ? 'Field Configuration' : this.activeTab === 'slots' ? 'Slot Setup' : this.activeTab === 'security' ? 'Change Password' : 'Admin Control Panel';
  }
  get pageDescription(): string {
    return this.activeTab === 'collections' ? 'Record receipts, review corrections and reconcile daily collections.' : this.activeTab === 'notifications' ? 'Track mock SMS notifications, reminders and retry attempts.' : this.activeTab === 'field' ? 'Manage your venue branding, photos, facilities and contact information.' : this.activeTab === 'slots' ? 'Manage slot times, prices, availability and advance payments.' : this.activeTab === 'security' ? 'Update your admin account password.' : 'Manage bookings, configure turf slots, and analyze revenue.';
  }
  navigateTab(tab: 'calendar' | 'overview' | 'bookings' | 'season' | 'blocking'): void {
    this.router.navigate(['/admin/dashboard'], { queryParams: tab === 'calendar' ? {} : { tab } });
  }
  private syncPage(): void {
    const child = this.route.firstChild?.snapshot.routeConfig?.path;
    const tab = this.route.snapshot.queryParamMap.get('tab');
    const safeTab = this.demoReadOnly && tab === 'blocking' ? 'calendar' : tab;
    this.activeTab = child === 'collections' ? 'collections' : child === 'notifications' ? 'notifications' : child === 'change-password' ? 'security' : child === 'field-configuration' ? 'field' : child === 'slot-setup' ? 'slots' : ['overview','bookings','season','blocking'].includes(safeTab || '') ? safeTab as 'overview' | 'bookings' | 'season' | 'blocking' : 'calendar';
    if (this.activeTab === 'blocking') { this.loadSlots(); this.selectedSlotIdsForBlock.clear(); this.loadBlockPreview(); }
  }

  paymentBookingId:number|null=null;
  collectionChanged():void {this.loadBookings();this.loadStats();}

  // Stats Data
  stats: AdminStats | null = null;
  readonly financialMetrics = [
    { key: 'received_amount', label: 'Received amount (all bookings)' },
    { key: 'approved_outstanding', label: 'Outstanding — approved bookings' },
    { key: 'pending_outstanding', label: 'Outstanding — pending requests' },
    { key: 'refunded_amount', label: 'Refunded amount (completed)' },
    { key: 'refund_outstanding', label: 'Refund outstanding' },
    { key: 'net_received', label: 'Net received (after refunds)' }
  ] as const;

  // Bookings Data
  bookings: BookingRecord[] = [];
  filteredBookings: BookingRecord[] = [];
  bookingFilter: 'all' | 'pending' | 'approved' | 'cancelled' = 'all';
  bookingSearch = '';
  bookingDateFrom = '';
  bookingDateTo = '';
  bookingPaymentFilter: '' | 'unpaid' | 'partially_paid' | 'paid' = '';
  bookingsPage = 1;
  readonly bookingsPageSize = 25;
  bookingsTotal = 0;
  bookingsLoading = false;
  bookingsExporting = false;
  private bookingsRequest = 0;
  get bookingsPageCount(): number { return Math.max(1, Math.ceil(this.bookingsTotal / this.bookingsPageSize)); }

  // Season / Recurring Bookings Data
  recurringBookings: RecurringBookingRecord[] = [];
  filteredRecurringBookings: RecurringBookingRecord[] = [];
  recurringFilter: 'all' | 'pending_approval' | 'active' | 'paused' | 'cancelled' | 'expired' = 'pending_approval';
  recurringLoading = false;

  // Slot list for bulk blocking; editing lives on the Slot Setup page.
  slots: SlotConfig[] = [];

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
    this.syncPage();
    this.router.events.pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.syncPage());
    this.loadStats();
    this.loadBookings();
    this.loadSlots();
    this.loadRecurringBookings();

    // Set default blocking dates to today + 7 days
    const todayStr = new Date().toISOString().split('T')[0];
    this.blockStartDate = todayStr;
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 6);
    this.blockEndDate = nextWeek.toISOString().split('T')[0];
    if (this.activeTab === 'blocking') this.loadBlockPreview();
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
    const request = ++this.bookingsRequest;
    this.bookingsLoading = true;
    this.apiService.getAdminBookings(this.bookingQuery()).subscribe({
      next: (res) => {
        if (request !== this.bookingsRequest) return;
        const lastPage = Math.max(1, Math.ceil(res.total / this.bookingsPageSize));
        if (this.bookingsPage > lastPage) { this.bookingsPage = lastPage; this.loadBookings(); return; }
        this.bookings = res.items;
        this.filteredBookings = res.items;
        this.bookingsTotal = res.total;
        this.bookingsPage = res.page;
        this.bookingsLoading = false;
      },
      error: (err) => {
        if (request !== this.bookingsRequest) return;
        this.bookingsLoading = false;
        this.handleError(err);
      }
    });
  }

  private bookingQuery() {
    return { q: this.bookingSearch.trim(), date_from: this.bookingDateFrom, date_to: this.bookingDateTo,
      status: this.bookingFilter === 'all' ? '' : this.bookingFilter, payment_status: this.bookingPaymentFilter,
      page: this.bookingsPage, page_size: this.bookingsPageSize };
  }

  searchBookings(): void { this.bookingsPage = 1; this.loadBookings(); }

  clearBookingFilters(): void {
    this.bookingSearch = ''; this.bookingDateFrom = ''; this.bookingDateTo = '';
    this.bookingPaymentFilter = ''; this.bookingFilter = 'all'; this.bookingsPage = 1; this.loadBookings();
  }

  changeBookingsPage(delta: number): void {
    const page = this.bookingsPage + delta;
    if (page < 1 || page > this.bookingsPageCount || this.bookingsLoading) return;
    this.bookingsPage = page; this.loadBookings();
  }

  exportBookings(): void {
    this.bookingsExporting = true;
    const filters = this.bookingQuery();
    const { page, page_size, ...allMatches } = filters;
    this.apiService.exportAdminBookings(allMatches).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = 'bookings.csv'; link.click(); URL.revokeObjectURL(url);
        this.bookingsExporting = false;
      },
      error: err => { this.bookingsExporting = false; this.handleError(err); }
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

  cancellationBooking: BookingRecord | null = null;
  cancellationSource = 'customer';
  cancellationReason = '';
  cancellationQuote: any = null;
  cancellationBusy = false;
  cancellationError = '';

  openCancellation(booking: BookingRecord): void {
    this.cancellationBooking = booking;
    this.cancellationSource = 'customer';
    this.cancellationReason = '';
    this.refreshCancellationQuote();
  }

  refreshCancellationQuote(): void {
    if (!this.cancellationBooking) return;
    this.cancellationQuote = null;
    this.cancellationError = '';
    this.cancellationBusy = true;
    this.apiService.getCancellationQuote(this.cancellationBooking.id, this.cancellationSource).subscribe({
      next: quote => { this.cancellationQuote = quote; this.cancellationBusy = false; },
      error: err => { this.cancellationError = err.error?.message || 'Could not calculate refund'; this.cancellationBusy = false; }
    });
  }

  confirmCancellation(): void {
    if (!this.cancellationBooking || !this.cancellationQuote || this.cancellationBusy || !this.cancellationReason.trim()) return;
    this.cancellationBusy = true;
    this.apiService.cancelBooking(this.cancellationBooking.id, this.cancellationSource, this.cancellationReason).subscribe({
      next: result => {
        this.cancellationBusy = false;
        this.cancellationBooking = null;
        this.showToast(result.already_cancelled ? 'Booking was already cancelled.' : `Booking cancelled. Refund due: ৳${result.refund_amount}. Automatic: ৳${result.refund_automatic_amount || 0}; manual: ৳${result.refund_manual_amount || 0}.`, 'success');
        this.loadBookings(); this.loadStats();
      },
      error: err => { this.cancellationBusy = false; this.cancellationError = err.error?.message || 'Cancellation failed'; }
    });
  }

  recordRefund(booking: BookingRecord): void {
    const due = Number(booking.refund_amount || 0) - Number(booking.refunded_amount || 0);
    const reference = prompt(`Only after returning ৳${due.toFixed(2)} to the original payment method, enter the refund transaction reference. This action records the refund; it does not transfer money.`);
    if (!reference?.trim()) return;
    this.apiService.recordRefund(booking.id, reference.trim(), Math.round(due * 100) / 100).subscribe({
      next: () => { this.showToast('Refund recorded.', 'success'); this.loadBookings(); },
      error: err => this.showToast(err.error?.message || 'Could not record refund', 'error')
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
    this.bookingsPage = 1;
    this.loadBookings();
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
