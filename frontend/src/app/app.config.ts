import { ApplicationConfig, ErrorHandler, provideZoneChangeDetection } from '@angular/core';
import { createErrorHandler } from '@sentry/angular';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { adminSessionInterceptor } from './interceptors/admin-session.interceptor';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    provideRouter(routes),
    provideHttpClient(withInterceptors([adminSessionInterceptor])),
    { provide: ErrorHandler, useValue: createErrorHandler({ logErrors: true }) }
  ]
};
