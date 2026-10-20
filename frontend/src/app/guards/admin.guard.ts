import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiService } from '../services/api.service';

export const adminGuard: CanActivateFn = (_route, state) => {
  const api = inject(ApiService);
  const router = inject(Router);
  if (!api.isLoggedIn()) return router.createUrlTree(['/admin/login']);
  if (api.isDemoAdmin() && /\/(field-configuration|slot-setup|change-password|admins)(?:\?.*)?$/.test(state.url)) {
    return router.createUrlTree(['/admin/dashboard']);
  }
  return true;
};
