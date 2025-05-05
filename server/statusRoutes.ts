const express = require('express');
const db = require('./db.js');
const schema = require('./shared/schema.js');
const jwtMiddleware = require('./jwtMiddleware.js');
const { eq, desc } = require('drizzle-orm');

import { Request, Response } from 'express';

type User = typeof schema.User;
type WatchlistEntry = typeof schema.WatchlistEntry;

// Define response data structure
interface StatusResponse {
  status: string;
  stats: {
    users: {
      total: number;
      adminUsers: { id: number; username: string }[];
      topUsers?: { id: number; username: string }[];
      userActivity?: { id: number; username: string }[];
    };
    movies: { total: number };
    watchlistEntries: { total: number };
    sessions: { total: number };
    platforms: { total: number };
  };
  recentRegistrations?: { id: number; username: string; createdAt: Date }[];
  recentActivity?: { id: number; userId: number; movieId: number; createdAt: Date }[];
}

const statusRoutesRouter = express.Router();

statusRoutesRouter.get('/ping', jwtMiddleware.isJwtAuthenticated, async (req: Request, res: Response) => {
  try {
    const dbInstance = await db.getDb();
    const stats = {
      users: (await dbInstance.select().from(schema.users)).length,
      movies: (await dbInstance.select().from(schema.movies)).length,
      watchlistEntries: (await dbInstance.select().from(schema.watchlistEntries)).length,
      sessions: (await dbInstance.select().from(schema.sessions)).length,
      platforms: (await dbInstance.select().from(schema.platforms)).length,
    };

    const admins = await dbInstance.select().from(schema.users).where(eq(schema.users.role, 'admin'));
    const responseData: StatusResponse = {
      status: 'ok',
      stats: {
        users: {
          total: stats.users,
          adminUsers: admins.map((user: User) => ({
            id: user.id,
            username: user.username,
          })),
        },
        movies: {
          total: stats.movies,
        },
        watchlistEntries: {
          total: stats.watchlistEntries,
        },
        sessions: {
          total: stats.sessions,
        },
        platforms: {
          total: stats.platforms,
        },
      },
    };

    const topUsersResult = await dbInstance.select().from(schema.users).limit(5);
    responseData.stats.users.topUsers = topUsersResult.map((user: User) => ({
      id: user.id,
      username: user.username,
    }));

    const userActivityResult = await dbInstance.select().from(schema.users).limit(5);
    responseData.stats.users.userActivity = userActivityResult.map((user: User) => ({
      id: user.id,
      username: user.username,
    }));

    const recentRegistrations = await dbInstance
      .select()
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt))
      .limit(5);
    responseData.recentRegistrations = recentRegistrations.map((registration: User) => ({
      id: registration.id,
      username: registration.username,
      createdAt: registration.createdAt,
    }));

    const recentActivity = await dbInstance
      .select()
      .from(schema.watchlistEntries)
      .orderBy(desc(schema.watchlistEntries.createdAt))
      .limit(5);
    responseData.recentActivity = recentActivity.map((activity: WatchlistEntry) => ({
      id: activity.id,
      userId: activity.userId,
      movieId: activity.movieId,
      createdAt: activity.createdAt,
    }));

    res.status(200).json(responseData);
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Status check failed' });
  }
});

module.exports = statusRoutesRouter;