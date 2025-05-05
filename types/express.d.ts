declare namespace Express {
    interface User {
      id: number;
      username: string;
      displayName: string | null;
      createdAt: Date | null;
      environment: string | null;
      password?: string;
      isPendingSync?: boolean;
    }
  }