import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-operations', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './operations.component.html', styleUrl: './operations.component.css'
})
export class OperationsComponent implements OnInit {
  private api = inject(ApiService);
  start = this.day(-6);
  end = this.day(0);
  expenseDate = this.day(0);
  category = '';
  amount = '';
  method = 'cash';
  reference = '';
  note = '';
  data: any = { days: [], expenses: [] };
  audit: any[] = [];
  cancellationRequests: any[] = [];
  loading = false;
  saving = false;
  error = '';
  notice = '';

  ngOnInit(): void { this.load(); this.loadAudit(); this.loadCancellationRequests(); }
  private day(offset: number): string { const d = new Date(); d.setDate(d.getDate() + offset); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(d); }
  load(): void {
    this.loading = true; this.error = '';
    this.api.getOperations(this.start, this.end).subscribe({ next: value => { this.data = value; this.loading = false; }, error: e => { this.error = e.error?.message || 'Operations report could not be loaded.'; this.loading = false; } });
  }
  loadAudit(): void { this.api.getAuditLog().subscribe({ next: rows => this.audit = rows, error: e => { if (!this.error) this.error = e.error?.message || 'Activity log could not be loaded.'; } }); }
  loadCancellationRequests(): void { this.api.getCancellationRequests().subscribe({ next: rows => this.cancellationRequests = rows, error: e => { if (!this.error) this.error = e.error?.message || 'Cancellation requests could not be loaded.'; } }); }
  reviewCancellation(request: any, decision: 'approve' | 'reject'): void {
    const response = window.prompt(decision === 'reject' ? 'Why are you rejecting this cancellation request?' : 'Optional note for the cancellation record (leave blank to skip).');
    if (decision === 'reject' && !response?.trim()) return;
    const note = response?.trim() || '';
    this.api.reviewCancellationRequest(request.id, decision, note).subscribe({ next: () => { this.notice = decision === 'approve' ? 'Request approved and booking cancelled.' : 'Request rejected.'; this.loadCancellationRequests(); this.loadAudit(); }, error: e => this.error = e.error?.message || 'Request could not be reviewed.' });
  }
  addExpense(): void {
    if (this.saving || !this.category.trim() || !this.amount) return;
    this.saving = true; this.error = ''; this.notice = '';
    this.api.createExpense({ expense_date: this.expenseDate, category: this.category.trim(), amount: this.amount, method: this.method, reference: this.reference.trim(), note: this.note.trim() }).subscribe({
      next: () => { this.saving = false; this.notice = 'Expense recorded.'; this.category = ''; this.amount = ''; this.reference = ''; this.note = ''; this.load(); this.loadAudit(); },
      error: e => { this.saving = false; this.error = e.error?.message || 'Expense could not be recorded.'; }
    });
  }
  voidExpense(expense: any): void {
    const reason = window.prompt(`Why are you voiding the ${expense.category} expense?`);
    if (!reason?.trim()) return;
    this.api.voidExpense(expense.id, reason.trim()).subscribe({ next: () => { this.notice = 'Expense voided and kept in the record.'; this.load(); this.loadAudit(); }, error: e => this.error = e.error?.message || 'Expense could not be voided.' });
  }
}
