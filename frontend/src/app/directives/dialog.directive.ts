import { AfterViewInit, Directive, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, inject } from '@angular/core';

@Directive({ selector: '[bookingDialog]', standalone: true, host: { 'role': 'dialog', 'aria-modal': 'true', 'tabindex': '-1' } })
export class DialogDirective implements AfterViewInit, OnDestroy {
  private element: ElementRef<HTMLElement> = inject(ElementRef);
  private previous = document.activeElement as HTMLElement | null;
  private background: Array<{ element: HTMLElement; inert: boolean }> = [];
  @Input() dialogBusy = false;
  @Output() dialogClose = new EventEmitter<void>();
  ngAfterViewInit(): void {
    // Make sibling branches inert up to the application root, including page navigation.
    let current: HTMLElement | null = this.element.nativeElement;
    while (current?.parentElement && current.parentElement !== document.body) {
      for (const sibling of Array.from(current.parentElement.children)) {
        if (sibling !== current && sibling instanceof HTMLElement) {
          this.background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      current = current.parentElement;
    }
    (this.focusable()[0] || this.element.nativeElement).focus();
  }
  private focusable(): HTMLElement[] {
    return Array.from(this.element.nativeElement.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"], summary'))
      .filter(element => !element.matches(':disabled') && element.getClientRects().length > 0 && !element.closest('[hidden]'));
  }
  @HostListener('keydown', ['$event']) keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!this.dialogBusy) this.dialogClose.emit();
    }
    if (event.key === 'Tab') {
      const items = this.focusable();
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); this.element.nativeElement.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === this.element.nativeElement)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
    }
  }
  ngOnDestroy(): void {
    for (const entry of this.background) entry.element.inert = entry.inert;
    if (this.previous?.isConnected && this.previous !== document.body) this.previous.focus();
    else document.querySelector<HTMLElement>('[data-dialog-return]')?.focus();
  }
}
