/**
 * Webhook signature verification.
 *
 * The IRCd signs each delivery as:
 *     X-PushBot-Signature: sha256=<hex(HMAC-SHA256(webhook_secret, rawBody))>
 * (pb_webhook_fire / pb_hmac_sha256_hex). The HMAC is over the RAW request
 * body bytes only — there is no timestamp in the signed string, so the n8n
 * webhook MUST verify against the exact bytes it received, before any JSON
 * re-serialisation.
 *
 * This file is implemented (not stubbed): it is small, security-critical,
 * and the wire shape is locked.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { SIGNATURE_PREFIX } from './constants';

/**
 * Constant-time check of an `X-PushBot-Signature` header against the raw body.
 *
 * @param rawBody  The exact bytes received (Buffer preferred; string is utf8-encoded).
 * @param secret   The bot's webhook_secret.
 * @param header   The `X-PushBot-Signature` header value, e.g. "sha256=abc123…".
 * @returns true iff the signature matches. Caller should reply 401 (no body) on false.
 */
export function verifyWebhookSignature(
	rawBody: Buffer | string,
	secret: string,
	header: string | undefined,
): boolean {
	if (!header || !secret) return false;
	if (!header.startsWith(SIGNATURE_PREFIX)) return false;

	const provided = header.slice(SIGNATURE_PREFIX.length).trim().toLowerCase();
	const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
	const expected = createHmac('sha256', secret).update(body).digest('hex');

	// timingSafeEqual throws on length mismatch; guard first.
	const a = Buffer.from(provided, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
