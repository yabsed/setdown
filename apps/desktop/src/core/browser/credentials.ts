export type CredentialInfo = { id: string; origin: string; username: string; updatedAt: number };
export type CredentialStatus = { available: boolean; unlocked: boolean; accounts: CredentialInfo[] };
