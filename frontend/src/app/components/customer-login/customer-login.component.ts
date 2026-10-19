import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-customer-login', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  template: `<main class="customer-auth"><a routerLink="/">← Back to booking</a><section><h1>Customer login</h1><p>{{demoCodeEnabled ? 'Enter your mobile number and the default verification code.' : 'Enter your mobile number to receive a one-time verification code.'}}</p>
    <form (ngSubmit)="demoCodeEnabled ? verify() : sendCode()"><label>Bangladesh mobile number<input name="phone" type="tel" [(ngModel)]="phone" placeholder="017XXXXXXXX" required pattern="(\\+?88)?01[3-9][0-9]{8}" [disabled]="sent" [readonly]="busy"></label>
      <button *ngIf="!demoCodeEnabled && !sent" type="submit" [disabled]="busy || !settingsLoaded">{{busy?'Sending…':'Send code'}}</button>
      <label *ngIf="demoCodeEnabled || sent">{{demoCodeEnabled ? 'Default code' : '6-digit code'}}<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" [(ngModel)]="code" maxlength="6" required></label>
      <button *ngIf="demoCodeEnabled || sent" type="submit" [disabled]="busy || !settingsLoaded">{{busy?'Checking…':'Verify and continue'}}</button></form>
    <p *ngIf="demoCodeEnabled && settingsLoaded">Default code: 123456</p>
    <p class="error" *ngIf="error" role="alert">{{error}}</p><p class="success" *ngIf="sent && !error">Code sent. It expires in 5 minutes. <span *ngIf="debugCode">Local test code: {{debugCode}}</span></p></section></main>`,
  styles: [`.customer-auth{max-width:540px;margin:4rem auto;padding:1.5rem;color:#172b22}.customer-auth section{margin-top:1.5rem;padding:2rem;border:1px solid #dce8df;border-radius:1rem;background:#fff}.customer-auth form{display:grid;gap:1rem;margin-top:1.25rem}.customer-auth label{display:grid;gap:.5rem}.customer-auth input{padding:.8rem;border:1px solid #b8c9be;border-radius:.5rem;font:inherit}.customer-auth button{padding:.8rem;border:0;border-radius:.5rem;background:#176a40;color:white;font:inherit;cursor:pointer}.error{color:#b42318}.success{color:#176a40}`]
})
export class CustomerLoginComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  phone = '';
  code = '';
  sent = false;
  debugCode = '';
  busy = false;
  error = '';
  demoCodeEnabled = false;
  settingsLoaded = false;

  ngOnInit(): void {
    this.api.getPublicSettings().subscribe({
      next: settings => { this.demoCodeEnabled = settings.my_bookings_demo_code_enabled === true; this.settingsLoaded = true; },
      error: () => { this.error = 'Could not load login settings. Refresh and try again.'; }
    });
  }

  sendCode(): void {
    if (this.busy || !this.settingsLoaded || this.demoCodeEnabled || !this.phone.trim()) return;
    this.busy = true; this.error = '';
    this.api.requestCustomerOtp(this.phone).subscribe({ next: result => { this.sent = true; this.debugCode = result.debug_code || ''; this.busy = false; }, error: e => { this.error = e.error?.message || 'Could not send code.'; this.busy = false; } });
  }
  verify(): void {
    if (this.busy || !this.settingsLoaded || !this.code.trim() || (!this.demoCodeEnabled && !this.sent)) return;
    this.busy = true; this.error = '';
    this.api.verifyCustomerOtp(this.phone, this.code).subscribe({
      next: () => { this.busy = false; const requested = this.route.snapshot.queryParamMap.get('returnUrl') || '/my-bookings'; this.router.navigateByUrl(requested.startsWith('/') && !requested.startsWith('//') ? requested : '/my-bookings'); },
      error: e => { this.error = e.error?.message || 'Code verification failed.'; this.busy = false; }
    });
  }
}
