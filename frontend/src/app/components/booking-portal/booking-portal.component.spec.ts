import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { BookingPortalComponent } from './booking-portal.component';

describe('booking result verification lifecycle', () => {
  let component: BookingPortalComponent;
  let api: { getBookingResult: jasmine.Spy; getAvailableSlots: jasmine.Spy; getPublicSettings: jasmine.Spy; initiatePayment: jasmine.Spy };
  beforeEach(() => {
    sessionStorage.clear();
    api = { getBookingResult: jasmine.createSpy().and.returnValue(throwError(() => new Error('offline'))), getAvailableSlots: jasmine.createSpy().and.returnValue(of({ slots: [] })), getPublicSettings: jasmine.createSpy().and.returnValue(of({})), initiatePayment: jasmine.createSpy().and.returnValue(NEVER) };
    TestBed.configureTestingModule({ providers: [
      { provide: ApiService, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ payment: 'success', booking_id: '1' }) } } },
      { provide: Router, useValue: { navigate: jasmine.createSpy() } }
    ] });
    component = TestBed.runInInjectionContext(() => new BookingPortalComponent());
  });
  afterEach(() => { component.ngOnDestroy(); sessionStorage.clear(); });
  it('restores the booking reference for retry and reuses the key after a timeout', fakeAsync(() => {
    component.paymentResultBookingId = 12;
    component.retryPaymentFromResult();
    expect(sessionStorage.getItem('booking-last-result')).toBe('12');
    const key = api.initiatePayment.calls.first().args[1];
    tick(25000);
    expect(component.paymentConfirmLoading).toBeFalse();
    expect(component.paymentConfirmError).toBeTruthy();
    component.retryPaymentPreparation();
    expect(api.initiatePayment.calls.mostRecent().args[1]).toBe(key);
    component.ngOnDestroy();
  }));
  it('does not close a payment modal during gateway navigation', () => {
    component.showPaymentConfirm = true;
    component.paymentRedirecting = true;
    component.closePaymentConfirm();
    expect(component.showPaymentConfirm).toBeTrue();
  });
  it('does not trust forged success and stops after ten failed checks', fakeAsync(() => {
    component.ngOnInit();
    expect(component.paymentResultOutcome).toBe('checking');
    tick(27000);
    expect(api.getBookingResult).toHaveBeenCalledTimes(10);
    expect(component.paymentResultOutcome).toBe('error');
    component.ngOnDestroy();
  }));
  it('accepts delayed verified payment and cancels pending polling on close', fakeAsync(() => {
    component.showResult(1);
    api.getBookingResult.and.returnValue(of({ status: 'approved', amount_paid: 500, payment_attempt: { verified_payment: true } }));
    tick(3000);
    expect(component.paymentResultOutcome).toBe('success');
    component.closePaymentResult();
    tick(30000);
    expect(api.getBookingResult).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem('booking-last-result')).toBeNull();
  }));
});
