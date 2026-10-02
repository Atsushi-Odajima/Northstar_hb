/** Counts every outbound AI provider call (test assertion: AI OFF → 0). */
export const aiCallCounter = { total: 0, mock: 0, reset() { this.total = 0; this.mock = 0; } };
