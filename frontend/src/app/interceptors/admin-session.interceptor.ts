import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ApiService } from '../services/api.service';

export const adminSessionInterceptor: HttpInterceptorFn = (request, next) => {
  const api = inject(ApiService);
  const router = inject(Router);
  return next(request).pipe(catchError((error: HttpErrorResponse) => {
    if (error.status === 401 && error.error?.code === 'ADMIN_SESSION_REVOKED' && api.token && request.headers.get('Authorization') === `Bearer ${api.token}`) {
      api.logout();
      void router.navigate(['/admin/login']);
    }
    return throwError(() => error);
  }));
};
