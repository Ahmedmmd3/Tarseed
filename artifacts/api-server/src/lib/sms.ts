const TWILIO_ACCOUNT_SID = "TWILIO_ACCOUNT_SID";
const TWILIO_AUTH_TOKEN = "TWILIO_AUTH_TOKEN";
const TWILIO_FROM_NUMBER = "TWILIO_FROM_NUMBER";

export type SmsMessage = {
  to: string;
  body: string;
};

export function isSmsDeliveryConfigured(): boolean {
  if (process.env.NODE_ENV === "test" && process.env.SMS_DELIVERY_FORCE_UNCONFIGURED === "1") return false;
  if (process.env.NODE_ENV === "test") return true;
  return Boolean(
    process.env[TWILIO_ACCOUNT_SID]?.trim()
    && process.env[TWILIO_AUTH_TOKEN]?.trim()
    && process.env[TWILIO_FROM_NUMBER]?.trim(),
  );
}

export async function sendSmsWithTwilio(message: SmsMessage): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    const delayMs = Number.parseInt(process.env.SMS_DELIVERY_TEST_DELAY_MS ?? "0", 10);
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (process.env.SMS_DELIVERY_TEST_FAIL === "1") {
      throw new Error("Simulated SMS delivery failure.");
    }
    return;
  }

  const accountSid = process.env[TWILIO_ACCOUNT_SID]?.trim();
  const authToken = process.env[TWILIO_AUTH_TOKEN]?.trim();
  const from = process.env[TWILIO_FROM_NUMBER]?.trim();
  if (!isSmsDeliveryConfigured() || !accountSid || !authToken || !from) {
    throw new Error("SMS delivery is not configured.");
  }

  const payload = new URLSearchParams({
    From: from,
    To: message.to,
    Body: message.body,
  });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
    },
  );
  if (!response.ok) {
    throw new Error(`Twilio request failed with status ${response.status}`);
  }
}