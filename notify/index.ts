export interface NotifyPayload {
  recipient: string;
  subject?:  string;
  body:      string;
  metadata?: Record<string, unknown>;
}

export interface NotifyProvider {
  channel: 'email' | 'sms' | 'push';
  send(payload: NotifyPayload): Promise<void>;
}
