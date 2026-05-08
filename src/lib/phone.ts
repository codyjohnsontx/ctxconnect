export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return phone.startsWith("+") ? phone : `+${digits}`;
}

export function isStopMessage(body: string) {
  return ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(body.trim().toUpperCase());
}

export function isStartMessage(body: string) {
  return ["START", "YES", "UNSTOP"].includes(body.trim().toUpperCase());
}
