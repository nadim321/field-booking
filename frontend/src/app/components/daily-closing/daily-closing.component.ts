import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

const dhakaDay = (offset = 0): string => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(d);
};

@Component({
  selector: 'app-daily-closing', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './daily-closing.component.html', styleUrl: './daily-closing.component.css'
})
export class DailyClosingComponent implements OnInit {
  private api = inject(ApiService);
  date = dhakaDay();
  maxDate = dhakaDay();
  summary: any = null;
  history: any[] = [];
  usage: any = null;
  usageStart = `${dhakaDay().slice(0, 8)}01`;
  usageEnd = dhakaDay();
  countedCash = '';
  cashRefundsPaid = '';
  note = '';
  loading = false;
  saving = false;
  error = '';
  notice = '';
  usageError = '';

  ngOnInit(): void { this.load(); this.loadHistory(); this.loadUsage(); }

  get expected(): number {
    if (!this.summary) return 0;
    const refunds = Number(this.cashRefundsPaid || 0);
    return Math.round((this.summary.expected_cash_before_refunds - (Number.isFinite(refunds) ? refunds : 0)) * 100) / 100;
  }
  get variance(): number | null {
    if (this.countedCash === '' || !Number.isFinite(Number(this.countedCash))) return null;
    return Math.round((Number(this.countedCash) - this.expected) * 100) / 100;
  }
  get closed(): boolean { return !!this.summary?.closing; }
  get needsNote(): boolean { return this.closed || (this.variance !== null && this.variance !== 0); }
  get canSubmit(): boolean {
    return !this.saving && !!this.summary?.ledger_check?.ok && this.countedCash !== '' && this.variance !== null && (!this.needsNote || !!this.note.trim());
  }

  shiftDay(offset: number): void {
    const d = new Date(`${this.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset);
    const next = d.toISOString().slice(0, 10);
    if (next > this.maxDate) return;
    this.date = next; this.load();
  }

  load(): void {
    if (!this.date) return;
    this.loading = true; this.error = ''; this.notice = '';
    this.api.getDailySummary(this.date).subscribe({
      next: value => {
        this.summary = value; this.loading = false;
        this.countedCash = value.closing ? String(value.closing.counted_cash) : '';
        this.cashRefundsPaid = value.closing && value.closing.cash_refunds_paid ? String(value.closing.cash_refunds_paid) : '';
        this.note = '';
      },
      error: e => { this.loading = false; this.summary = null; this.error = e.error?.message || 'Daily summary could not be loaded.'; }
    });
  }
  loadHistory(): void {
    const end = dhakaDay(); const start = dhakaDay(-29);
    this.api.getDailyClosings(start, end).subscribe({ next: rows => this.history = rows, error: () => {} });
  }
  loadUsage(): void {
    this.usageError = '';
    this.api.getSmsUsage(this.usageStart, this.usageEnd).subscribe({ next: value => this.usage = value, error: e => { this.usageError = e.error?.message || 'SMS usage could not be loaded.'; } });
  }
  submit(): void {
    if (!this.canSubmit) return;
    this.saving = true; this.error = ''; this.notice = '';
    this.api.closeDay(this.date, { counted_cash: this.countedCash, cash_refunds_paid: this.cashRefundsPaid || '0', note: this.note.trim() }).subscribe({
      next: result => {
        this.saving = false;
        this.notice = result.variance === 0 ? 'Day closed. Cash matches the ledger.' : `Day closed with a cash difference of ৳${result.variance}.`;
        this.load(); this.loadHistory();
      },
      error: e => { this.saving = false; this.error = e.error?.message || 'The day could not be closed.'; }
    });
  }
  methodLabel(method: string): string {
    return ({ cash: 'Cash', bkash: 'bKash', nagad: 'Nagad', bank_transfer: 'Bank transfer', gateway: 'Online gateway', legacy: 'Legacy' } as Record<string, string>)[method] || method;
  }
  deliveryLabel(value: string | null): string {
    return value === 'delivered' ? 'Delivered' : value === 'failed' ? 'Not delivered' : 'No receipt';
  }
}
