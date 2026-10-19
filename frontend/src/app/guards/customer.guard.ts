import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiService } from '../services/api.service';

export const customerGuard: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);
  return api.isCustomerLoggedIn() || router.createUrlTree(['/customer/login'], { queryParams: { returnUrl: '/my-bookings' } });
};
