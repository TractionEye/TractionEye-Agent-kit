export function logMethodCall(method: string, args?: Record<string, unknown>): void {
  if (args && Object.keys(args).length > 0) {
    console.log(`[TractionEyeClient] ${method}`, args);
    return;
  }
  console.log(`[TractionEyeClient] ${method}`);
}
