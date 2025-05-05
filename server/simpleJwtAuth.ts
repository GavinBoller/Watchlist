const jwtSimpleLib = require('jsonwebtoken');
const simpleJwtSchema = require('./shared/schema.js');
const jwtAuth = require('./jwtAuth.js');
import { UserResponse } from './shared/types.js';

async function simpleJwtLogin(username: string, password: string) {
  try {
    const result = await jwtAuth.authenticateJWT(username, password);
    if (!result) {
      return null;
    }
    const { user } = result;
    const token = jwtSimpleLib.sign({ id: user.id, username: user.username }, jwtAuth.JWT_SECRET, {
      expiresIn: jwtAuth.TOKEN_EXPIRATION,
    });
    return { user: user as UserResponse, token };
  } catch (err) {
    console.error('[SIMPLE_JWT] Error:', err);
    throw err;
  }
}

module.exports = { simpleJwtLogin };