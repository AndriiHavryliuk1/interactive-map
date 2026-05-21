import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

import { SignalMessage } from '../../shared/models/signal.model';

export interface SignalGateway {
  readonly liveSignals$: Observable<SignalMessage>;
  readonly historicalSignals: readonly SignalMessage[];
}

export const SIGNAL_GATEWAY = new InjectionToken<SignalGateway>('SIGNAL_GATEWAY');
