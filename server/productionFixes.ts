const express = require('express');
let storage: any = null;

try {
  storage = require('./storage.js');
  console.log('[PROD_FIX] storage loaded:', !!storage);
} catch (err) {
  console.error('[PROD_FIX] Error loading storage:', err);
  storage = null;
}

import { Request, Response } from 'express';

console.log('[PROD_FIX] Initializing module...');

function registerEmergencyEndpoints() {
  console.log('[PROD_FIX] Creating router...');
  const productionFixesRouter = express.Router();

  productionFixesRouter.get('/emergency/reset', async (req: Request, res: Response) => {
    try {
      console.log('[PROD_FIX] Handling GET /emergency/reset');
      if (!storage || !storage.storage) {
        throw new Error('Storage module not initialized');
      }
      const users = await storage.storage.getAllUsers();
      for (const user of users) {
        if (!user.environment) {
          await storage.storage.updateUser(user.id, { environment: 'production' });
        }
      }
      res.status(200).json({ status: 'success', message: 'Production fixes applied' });
    } catch (err) {
      console.error('[PROD_FIX] Error applying fixes:', err);
      res.status(500).json({ status: 'error', message: 'Failed to apply production fixes' });
    }
  });

  console.log('[PROD_FIX] Returning router:', productionFixesRouter);
  return productionFixesRouter;
}

const exportsObj = { registerEmergencyEndpoints };
console.log('[PROD_FIX] Module exports:', exportsObj);
module.exports = exportsObj;

console.log('[PROD_FIX] Module initialization complete');